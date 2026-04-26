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
      gameCount: sql<number>`(SELECT COUNT(*) FROM games WHERE season_id = ${id})`,
      completedGameCount: sql<number>`(SELECT COUNT(*) FROM games WHERE season_id = ${id} AND status = 'final')`,
      playerCount: sql<number>`(SELECT COUNT(DISTINCT player_id) FROM player_seasons WHERE season_id = ${id})`,
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

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["active"],
  active: ["completed"],
  completed: [],
}

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
    } = body

    // Validate status transition
    if (status && status !== existing.status) {
      const allowed = VALID_TRANSITIONS[existing.status] || []
      if (!allowed.includes(status)) {
        return NextResponse.json(
          { error: `Cannot transition from ${existing.status} to ${status}` },
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

    // Auto-set is_current when activating
    if (status === "active" && existing.status === "draft") {
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

    await db.transaction(async (tx) => {
      // If we are making this season current, unset all other current seasons first
      if (updates.isCurrent === true) {
        await tx
          .update(schema.seasons)
          .set({ isCurrent: false })
          .where(eq(schema.seasons.isCurrent, true))
      }

      await tx
        .update(schema.seasons)
        .set(updates)
        .where(eq(schema.seasons.id, id))
    })

    // Bust the Next.js season cache so subsequent reads see fresh data
    // @ts-expect-error - Next.js canary changed the signature of revalidateTag
    revalidateTag("seasons")

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Failed to update season" }, { status: 500 })
  }
}
