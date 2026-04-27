import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"
import { revalidateTag } from "next/cache"

interface RouteContext {
  params: Promise<{ id: string; gameId: string }>
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId, gameId } = await context.params

  try {
    const body = await request.json()
    
    // Map gameType to isPlayoff correctly if provided
    let isPlayoff = undefined;
    if (body.gameType !== undefined) {
      isPlayoff = body.gameType === "playoff" || body.gameType === "championship"
    }

    // Allowlist editable fields to prevent mass-assignment
    const updateData: Record<string, unknown> = {}
    if (body.date !== undefined) updateData.date = body.date
    if (body.time !== undefined) updateData.time = body.time
    if (body.homeTeam !== undefined) updateData.homeTeam = body.homeTeam
    if (body.awayTeam !== undefined) updateData.awayTeam = body.awayTeam
    if (body.homeScore !== undefined) updateData.homeScore = body.homeScore
    if (body.awayScore !== undefined) updateData.awayScore = body.awayScore
    if (body.status !== undefined) updateData.status = body.status
    if (body.isOvertime !== undefined) updateData.isOvertime = body.isOvertime
    if (body.isForfeit !== undefined) updateData.isForfeit = body.isForfeit
    if (body.location !== undefined) updateData.location = body.location
    if (body.hasBoxscore !== undefined) updateData.hasBoxscore = body.hasBoxscore
    if (body.gameType !== undefined) updateData.gameType = body.gameType
    if (body.hasShootout !== undefined) updateData.hasShootout = body.hasShootout
    if (body.notes !== undefined) updateData.notes = body.notes === "" ? null : body.notes
    if (body.homeNotes !== undefined) updateData.homeNotes = body.homeNotes === "" ? null : body.homeNotes
    if (body.awayNotes !== undefined) updateData.awayNotes = body.awayNotes === "" ? null : body.awayNotes
    if (body.homePlaceholder !== undefined) updateData.homePlaceholder = body.homePlaceholder
    if (body.awayPlaceholder !== undefined) updateData.awayPlaceholder = body.awayPlaceholder
    if (isPlayoff !== undefined) updateData.isPlayoff = isPlayoff

    // 1. Update the target game
    await db.update(schema.games)
      .set(updateData)
      .where(and(
        eq(schema.games.id, gameId),
        eq(schema.games.seasonId, seasonId)
      ))

    // 2. Series-aware auto-advancement logic
    // If the game is a playoff game, it is now "final", and has a seriesId, we need to check if the series is clinched.
    if (body.status === "final") {
      const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1)
      
      if (game && game.gameType === "playoff" && game.seriesId && game.nextGameId && game.nextGameSlot) {
        // Fetch all games in this series
        const seriesGames = await db.select()
          .from(schema.games)
          .where(and(
            eq(schema.games.seasonId, seasonId),
            eq(schema.games.seriesId, game.seriesId)
          ))

        // Derive the intended series length from the max game number, not row count
        // This is more robust if an admin manually deletes a game from the series
        const maxGameNum = Math.max(...seriesGames.map(sg => sg.seriesGameNumber ?? 1))
        const seriesLength = maxGameNum
        const winsNeededToClinch = Math.ceil(seriesLength / 2)

        const winCounts: Record<string, number> = {}
        for (const sg of seriesGames) {
          if (sg.status === "final" && !sg.isForfeit) {
            // Determine winner of this game
            const homeScore = sg.homeScore || 0
            const awayScore = sg.awayScore || 0
            
            let winnerSlug: string | null = null
            if (homeScore > awayScore) {
              winnerSlug = sg.homeTeam
            } else if (awayScore > homeScore) {
              winnerSlug = sg.awayTeam
            }
            // Ignore ties (shouldn't happen in playoffs, but just in case)

            if (winnerSlug) {
              winCounts[winnerSlug] = (winCounts[winnerSlug] || 0) + 1
            }
          }
        }

        // Check if any team has reached the required wins
        let clinchedWinner: string | null = null
        for (const [teamSlug, wins] of Object.entries(winCounts)) {
          if (wins >= winsNeededToClinch) {
            clinchedWinner = teamSlug
            break
          }
        }

        // If someone clinched the series, advance them to the next game
        if (clinchedWinner) {
          const updateSlot = game.nextGameSlot === "home" ? { homeTeam: clinchedWinner } : { awayTeam: clinchedWinner }
          
          await db.update(schema.games)
            .set(updateSlot)
            .where(eq(schema.games.id, game.nextGameId))
        }
      }
    }

    // @ts-expect-error - Next.js canary changed revalidateTag signature // TODO: Remove after Next.js stabilizes
    revalidateTag("seasons")
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to update game:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId, gameId } = await context.params
  const url = new URL(request.url)
  const force = url.searchParams.get("force") === "true"

  try {
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1)

    if (!game) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 })
    }

    // Protection for final games with boxscores
    if (game.status === "final" && game.hasBoxscore && !force) {
      return NextResponse.json(
        { error: "Cannot delete a final game with boxscore data unless forced" },
        { status: 400 }
      )
    }

    // Must delete child records first since no cascade is defined
    await db.delete(schema.playerGameStats).where(eq(schema.playerGameStats.gameId, gameId))
    await db.delete(schema.goalieGameStats).where(eq(schema.goalieGameStats.gameId, gameId))
    await db.delete(schema.gameOfficials).where(eq(schema.gameOfficials.gameId, gameId))
    await db.delete(schema.gameLive).where(eq(schema.gameLive.gameId, gameId))

    // Null out any nextGameId references pointing to this game
    await db.update(schema.games)
      .set({ nextGameId: null, nextGameSlot: null })
      .where(eq(schema.games.nextGameId, gameId))

    // Delete the game itself
    await db.delete(schema.games).where(and(
      eq(schema.games.id, gameId),
      eq(schema.games.seasonId, seasonId)
    ))

    // @ts-expect-error - Next.js canary changed revalidateTag signature // TODO: Remove after Next.js stabilizes
    revalidateTag("seasons")
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to delete game:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
