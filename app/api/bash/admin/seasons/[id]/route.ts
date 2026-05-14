import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, sql, and } from "drizzle-orm"
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

  const [season] = await db
    .select()
    .from(schema.seasons)
    .where(eq(schema.seasons.id, id))
    .limit(1)

  if (!season) {
    return NextResponse.json({ error: "Season not found" }, { status: 404 })
  }

  const teams = await db
    .select({ teamSlug: schema.seasonTeams.teamSlug, teamName: schema.teams.name })
    .from(schema.seasonTeams)
    .innerJoin(schema.teams, eq(schema.seasonTeams.teamSlug, schema.teams.slug))
    .where(eq(schema.seasonTeams.seasonId, id))

  const [counts] = await db
    .select({
      gameCount: sql<number>`(SELECT COUNT(*)::int FROM games WHERE season_id = ${id})`,
      completedGameCount: sql<number>`(SELECT COUNT(*)::int FROM games WHERE season_id = ${id} AND status = 'final')`,
      playerCount: sql<number>`(SELECT COUNT(DISTINCT player_id)::int FROM player_seasons WHERE season_id = ${id})`,
    })
    .from(sql`(SELECT 1) AS _`)

  return NextResponse.json({
    ...season,
    teams,
    gameCount: counts?.gameCount ?? 0,
    completedGameCount: counts?.completedGameCount ?? 0,
    playerCount: counts?.playerCount ?? 0,
  })
}

const VALID_STATUSES = ["draft", "active", "completed", "archived"]


export async function PUT(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await context.params

  const [existing] = await db
    .select()
    .from(schema.seasons)
    .where(eq(schema.seasons.id, id))
    .limit(1)

  if (!existing) {
    return NextResponse.json({ error: "Season not found" }, { status: 404 })
  }

  try {
    const body = await request.json()
    const {
      name,
      seasonType,
      leagueId,
      status,
      standingsMethod,
      gameLength,
      defaultLocation,
      adminNotes,
      statsOnly,
      playoffTeams,
      isCurrent,
    } = body

    // Validate status
    if (status && status !== existing.status) {
      if (!VALID_STATUSES.includes(status)) {
        return NextResponse.json(
          { error: `Invalid status: ${status}` },
          { status: 400 }
        )
      }
    }

    // Build update object
    const updates: Record<string, unknown> = {}
    if (name !== undefined) updates.name = name
    if (seasonType !== undefined) updates.seasonType = seasonType
    if (leagueId !== undefined) updates.leagueId = leagueId
    if (status !== undefined) updates.status = status
    if (standingsMethod !== undefined) updates.standingsMethod = standingsMethod
    if (gameLength !== undefined) updates.gameLength = gameLength
    if (defaultLocation !== undefined) updates.defaultLocation = defaultLocation
    if (adminNotes !== undefined) updates.adminNotes = adminNotes
    if (statsOnly !== undefined) updates.statsOnly = statsOnly
    if (playoffTeams !== undefined && existing.status === "draft") {
      updates.playoffTeams = playoffTeams
    }
    if (isCurrent !== undefined) updates.isCurrent = isCurrent

    // Auto-set is_current when activating
    if (status === "active" && existing.status !== "active") {
      // Validate no players are 'tbd'
      const unassignedPlayers = await db
        .select({ id: schema.playerSeasons.playerId })
        .from(schema.playerSeasons)
        .where(
          and(
            eq(schema.playerSeasons.seasonId, id),
            eq(schema.playerSeasons.teamSlug, 'tbd')
          )
        )
        .limit(1)
        
      if (unassignedPlayers.length > 0) {
        return NextResponse.json(
          { error: "Cannot activate season while players are still unassigned." },
          { status: 400 }
        )
      }

      updates.isCurrent = true
    }

    // If we are making this season current, unset all other current seasons first
    if (updates.isCurrent === true) {
      await db
        .update(schema.seasons)
        .set({ isCurrent: false })
        .where(eq(schema.seasons.isCurrent, true))
    }

    await db
      .update(schema.seasons)
      .set(updates)
      .where(eq(schema.seasons.id, id))

    // Bust the Next.js season cache so subsequent reads see fresh data
    // @ts-expect-error - Next.js canary changed revalidateTag signature // TODO: Remove after Next.js stabilizes
    revalidateTag("seasons")

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Failed to update season:", err)
    return NextResponse.json({ error: "Failed to update season" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await context.params

  const [existing] = await db
    .select()
    .from(schema.seasons)
    .where(eq(schema.seasons.id, id))
    .limit(1)

  if (!existing) {
    return NextResponse.json({ error: "Season not found" }, { status: 404 })
  }

  // Safety check: require explicit confirmation for non-draft seasons
  const url = new URL(request.url)
  const force = url.searchParams.get("force") === "true"

  if (existing.status !== "draft" && !force) {
    return NextResponse.json(
      { error: "Cannot delete a non-draft season without force=true confirmation" },
      { status: 400 }
    )
  }

  try {
    // Get all game IDs for this season first (needed for cascading child deletes)
    const gameRows = await db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.seasonId, id))
    const gameIds = gameRows.map((g) => g.id)

    if (gameIds.length > 0) {
      // Delete game-level children
      for (const gid of gameIds) {
        await db.delete(schema.gameOfficials).where(eq(schema.gameOfficials.gameId, gid))
        await db.delete(schema.playerGameStats).where(eq(schema.playerGameStats.gameId, gid))
        await db.delete(schema.goalieGameStats).where(eq(schema.goalieGameStats.gameId, gid))
        await db.delete(schema.gameLive).where(eq(schema.gameLive.gameId, gid))
      }

      // Delete games
      await db.delete(schema.games).where(eq(schema.games.seasonId, id))
    }

    // Delete season-level children
    await db.delete(schema.playerSeasonStats).where(eq(schema.playerSeasonStats.seasonId, id))
    await db.delete(schema.playerSeasons).where(eq(schema.playerSeasons.seasonId, id))
    await db.delete(schema.playerAwards).where(eq(schema.playerAwards.seasonId, id))
    await db.delete(schema.seasonTeams).where(eq(schema.seasonTeams.seasonId, id))

    // Delete draft artifacts — must delete trade items first because
    // draftTradeItems.pickId references draftPicks.id without ON DELETE CASCADE
    const draftRows = await db
      .select({ id: schema.draftInstances.id })
      .from(schema.draftInstances)
      .where(eq(schema.draftInstances.seasonId, id))

    for (const draft of draftRows) {
      const trades = await db
        .select({ id: schema.draftTrades.id })
        .from(schema.draftTrades)
        .where(eq(schema.draftTrades.draftId, draft.id))
      for (const t of trades) {
        await db.delete(schema.draftTradeItems).where(eq(schema.draftTradeItems.tradeId, t.id))
      }
      await db.delete(schema.draftTrades).where(eq(schema.draftTrades.draftId, draft.id))
    }

    // Now safe to delete draft instances (remaining children cascade)
    await db.delete(schema.draftInstances).where(eq(schema.draftInstances.seasonId, id))

    // Delete registration chains (registrations → periods, no cascade on either FK)
    const periodRows = await db
      .select({ id: schema.registrationPeriods.id })
      .from(schema.registrationPeriods)
      .where(eq(schema.registrationPeriods.seasonId, id))
    const periodIds = periodRows.map((p) => p.id)

    if (periodIds.length > 0) {
      for (const pid of periodIds) {
        // Registration children (answers, extras, acknowledgements cascade on registration delete,
        // but registrations themselves don't cascade on period delete)
        const regRows = await db
          .select({ id: schema.registrations.id })
          .from(schema.registrations)
          .where(eq(schema.registrations.periodId, pid))

        for (const reg of regRows) {
          await db.delete(schema.registrationAnswers).where(eq(schema.registrationAnswers.registrationId, reg.id))
          await db.delete(schema.registrationExtras).where(eq(schema.registrationExtras.registrationId, reg.id))
          await db.delete(schema.noticeAcknowledgements).where(eq(schema.noticeAcknowledgements.registrationId, reg.id))
        }

        await db.delete(schema.registrations).where(eq(schema.registrations.periodId, pid))
      }

      // Period children (questions, notices, discounts, extras cascade on period delete)
      for (const pid of periodIds) {
        await db.delete(schema.registrationPeriods).where(eq(schema.registrationPeriods.id, pid))
      }
    }

    // Delete the season itself
    await db.delete(schema.seasons).where(eq(schema.seasons.id, id))

    // @ts-expect-error - Next.js canary changed revalidateTag signature // TODO: Remove after Next.js stabilizes
    revalidateTag("seasons")

    return NextResponse.json({ ok: true, deleted: id })
  } catch (err) {
    console.error("Failed to delete season:", err)
    return NextResponse.json({ error: "Failed to delete season" }, { status: 500 })
  }
}
