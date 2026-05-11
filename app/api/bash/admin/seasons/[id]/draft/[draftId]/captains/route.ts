import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import * as schema from "@/lib/db/schema"
import { eq, and } from "drizzle-orm"

/**
 * PUT /api/bash/admin/seasons/[id]/draft/[draftId]/captains
 *
 * Saves captain designations for a season by updating `playerSeasons.isCaptain`.
 * Called during draft wizard configuration before navigating to keeper setup.
 *
 * Body: { captains: [{ teamSlug, playerId, playerName }] }
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; draftId: string }> }
) {
  try {
    const { id: seasonId } = await params
    const { captains } = await req.json()

    if (!Array.isArray(captains)) {
      return NextResponse.json({ error: "captains must be an array" }, { status: 400 })
    }

    // 1. Clear all existing captain flags for this season
    await db
      .update(schema.playerSeasons)
      .set({ isCaptain: false })
      .where(eq(schema.playerSeasons.seasonId, seasonId))

    // 2. Set isCaptain for each designated captain
    if (captains.length > 0) {
      for (const cap of captains) {
        const { teamSlug, playerId } = cap as { teamSlug: string; playerId: number }
        await db
          .update(schema.playerSeasons)
          .set({ isCaptain: true, teamSlug })
          .where(
            and(
              eq(schema.playerSeasons.seasonId, seasonId),
              eq(schema.playerSeasons.playerId, playerId)
            )
          )
      }
    }

    return NextResponse.json({ ok: true, captainCount: captains.length })
  } catch (err) {
    console.error("Failed to save captains:", err)
    return NextResponse.json({ error: "Failed to save captains" }, { status: 500 })
  }
}
