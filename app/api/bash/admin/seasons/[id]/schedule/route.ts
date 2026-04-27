import { NextRequest, NextResponse } from "next/server"
import { db, schema, rawSql } from "@/lib/db"
import { sql, eq, and } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"
import { revalidateTag } from "next/cache"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await context.params

  try {
    const rows = await rawSql(sql`
      SELECT
        g.id, g.date, g.time, g.home_score as "homeScore", g.away_score as "awayScore",
        g.status, g.is_overtime as "isOvertime", g.is_playoff as "isPlayoff", g.is_forfeit as "isForfeit",
        g.location, g.has_boxscore as "hasBoxscore", g.notes,
        g.game_type as "gameType", g.has_shootout as "hasShootout",
        g.away_notes as "awayNotes", g.home_notes as "homeNotes",
        g.home_placeholder as "homePlaceholder", g.away_placeholder as "awayPlaceholder",
        g.next_game_id as "nextGameId", g.next_game_slot as "nextGameSlot",
        g.bracket_round as "bracketRound", g.series_id as "seriesId", g.series_game_number as "seriesGameNumber",
        ht.name as "homeTeam", ht.slug as "homeSlug",
        awt.name as "awayTeam", awt.slug as "awaySlug"
      FROM games g
      JOIN teams ht ON g.home_team = ht.slug
      JOIN teams awt ON g.away_team = awt.slug
      WHERE g.season_id = ${id}
      ORDER BY g.date ASC, 
        CASE 
          WHEN g.time = 'TBD' THEN '23:59'::time 
          WHEN g.time ILIKE '%a%' OR g.time ILIKE '%p%' THEN 
            to_timestamp(
              replace(replace(lower(g.time), 'a', ' AM'), 'p', ' PM'), 
              'HH:MI AM'
            )::time 
          ELSE 
            g.time::time 
        END ASC
    `)

    return NextResponse.json(rows)
  } catch (error) {
    console.error("Failed to fetch schedule:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await context.params

  try {
    const body = await request.json()
    const {
      date,
      time,
      homeTeam,
      awayTeam,
      location,
      gameType,
      status,
      homeScore,
      awayScore,
      isOvertime,
      hasShootout,
      isForfeit,
      notes,
      homeNotes,
      awayNotes,
    } = body

    if (!date || !time || !homeTeam || !awayTeam) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Map gameType to isPlayoff correctly
    const isPlayoff = gameType === "playoff" || gameType === "championship"

    const gameId = "gen-" + crypto.randomUUID().slice(0, 8)

    await db.insert(schema.games).values({
      id: gameId,
      seasonId: id,
      date,
      time,
      homeTeam,
      awayTeam,
      location: location || "The Lick",
      gameType: gameType || "regular",
      status: status || "upcoming",
      homeScore: homeScore ?? null,
      awayScore: awayScore ?? null,
      isOvertime: isOvertime ?? false,
      isPlayoff,
      hasShootout: hasShootout ?? false,
      isForfeit: isForfeit ?? false,
      notes: notes || null,
      homeNotes: homeNotes || null,
      awayNotes: awayNotes || null,
    })

    // @ts-expect-error - Next.js canary changed revalidateTag signature // TODO: Remove after Next.js stabilizes
    revalidateTag("seasons")

    return NextResponse.json({ success: true, gameId })
  } catch (error) {
    console.error("Failed to create game:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await context.params
  const url = new URL(request.url)
  const mode = url.searchParams.get("mode")

  try {
    if (mode === "upcoming") {
      // Null out nextGameId pointers from surviving games to upcoming games being deleted
      const upcomingIds = (await db.select({ id: schema.games.id })
        .from(schema.games)
        .where(and(eq(schema.games.seasonId, id), eq(schema.games.status, "upcoming")))).map(g => g.id)
      
      if (upcomingIds.length > 0) {
        for (const uid of upcomingIds) {
          await db.update(schema.games)
            .set({ nextGameId: null, nextGameSlot: null })
            .where(eq(schema.games.nextGameId, uid))
        }
      }

      await db.delete(schema.games).where(
        and(eq(schema.games.seasonId, id), eq(schema.games.status, "upcoming"))
      )
    } else if (mode === "all") {
      await db.delete(schema.games).where(eq(schema.games.seasonId, id))
    } else {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 })
    }

    // @ts-expect-error - Next.js canary changed revalidateTag signature // TODO: Remove after Next.js stabilizes
    revalidateTag("seasons")

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to delete schedule:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
