import { db } from "@/lib/db"
import * as schema from "@/lib/db/schema"
import { eq, and } from "drizzle-orm"
import { NextResponse } from "next/server"
import { getSession } from "@/lib/admin-session"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; draftId: string }> }
) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: seasonId, draftId } = await params

  const draft = await db.query.draftInstances.findFirst({
    where: eq(schema.draftInstances.id, draftId),
  })

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 })
  }

  if (draft.status !== "live" && draft.status !== "completed") {
    return NextResponse.json(
      { error: "Draft must be live or completed to push rosters" },
      { status: 400 }
    )
  }

  // Fetch all picks with players assigned
  const picks = await db
    .select({
      playerId: schema.draftPicks.playerId,
      teamSlug: schema.draftPicks.teamSlug,
      isKeeper: schema.draftPicks.isKeeper,
    })
    .from(schema.draftPicks)
    .where(eq(schema.draftPicks.draftId, draftId))

  const picksWithPlayers = picks.filter((p) => p.playerId !== null)

  if (picksWithPlayers.length === 0) {
    return NextResponse.json({ error: "No picks to push" }, { status: 400 })
  }

  // Get pool for registration metadata (goalie, captain, rookie flags)
  const poolEntries = await db.query.draftPool.findMany({
    where: eq(schema.draftPool.draftId, draftId),
  })

  const poolMap = new Map<number, typeof poolEntries[number]>()
  for (const entry of poolEntries) {
    poolMap.set(entry.playerId, entry)
  }

  // Get existing captains from keeper assignments
  const captains = await db
    .select({
      playerId: schema.playerSeasons.playerId,
      teamSlug: schema.playerSeasons.teamSlug,
    })
    .from(schema.playerSeasons)
    .where(
      and(
        eq(schema.playerSeasons.seasonId, seasonId),
        eq(schema.playerSeasons.isCaptain, true)
      )
    )

  const captainSet = new Set(captains.map((c) => `${c.playerId}-${c.teamSlug}`))

  let inserted = 0
  let updated = 0
  let skipped = 0

  for (const pick of picksWithPlayers) {
    const playerId = pick.playerId!
    const teamSlug = pick.teamSlug
    const poolEntry = poolMap.get(playerId)
    const meta = poolEntry?.registrationMeta as Record<string, unknown> | null

    const isGoalie =
      typeof meta?.positions === "string" && meta.positions.includes("G")
    const isRookie = meta?.isRookie === true
    const isCaptain = captainSet.has(`${playerId}-${teamSlug}`)

    // Check if player_season already exists (any team assignment for this season)
    const existing = await db.query.playerSeasons.findFirst({
      where: and(
        eq(schema.playerSeasons.playerId, playerId),
        eq(schema.playerSeasons.seasonId, seasonId)
      ),
    })

    if (existing) {
      // Update team assignment and flags
      await db
        .update(schema.playerSeasons)
        .set({
          teamSlug,
          isGoalie,
          isRookie,
          isCaptain,
        })
        .where(
          and(
            eq(schema.playerSeasons.playerId, playerId),
            eq(schema.playerSeasons.seasonId, seasonId)
          )
        )
      updated++
    } else {
      try {
        await db.insert(schema.playerSeasons).values({
          playerId,
          seasonId,
          teamSlug,
          isGoalie,
          isRookie,
          isCaptain,
        })
        inserted++
      } catch {
        // If there's a conflict, skip silently — commissioner can resolve manually
        skipped++
      }
    }
  }

  // Mark draft as completed if it was live
  if (draft.status === "live") {
    await db
      .update(schema.draftInstances)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(schema.draftInstances.id, draftId))
  }

  return NextResponse.json({
    success: true,
    summary: {
      total: picksWithPlayers.length,
      inserted,
      updated,
      skipped,
    },
  })
}
