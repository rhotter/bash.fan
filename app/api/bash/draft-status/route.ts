import { db } from "@/lib/db"
import * as schema from "@/lib/db/schema"
import { eq, and, not } from "drizzle-orm"
import { NextResponse } from "next/server"

/**
 * Lightweight endpoint that returns the current season's draft status
 * for nav link rendering. Returns null if no public draft exists.
 *
 * Response: { status: "published" | "live" | "completed", seasonSlug: string } | { status: null }
 */
export async function GET() {
  try {
    // Find the current season
    const currentSeason = await db.query.seasons.findFirst({
      where: eq(schema.seasons.isCurrent, true),
    })

    if (!currentSeason) {
      return NextResponse.json({ status: null }, {
        headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
      })
    }

    // Find draft instance for current season (not in "draft" status — that's admin-only)
    const draft = await db.query.draftInstances.findFirst({
      where: and(
        eq(schema.draftInstances.seasonId, currentSeason.id),
        not(eq(schema.draftInstances.status, "draft"))
      ),
    })

    if (!draft) {
      return NextResponse.json({ status: null }, {
        headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
      })
    }

    return NextResponse.json(
      { status: draft.status, seasonSlug: currentSeason.id },
      {
        headers: {
          "Cache-Control": draft.status === "live"
            ? "public, s-maxage=5, stale-while-revalidate=10"
            : "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    )
  } catch {
    return NextResponse.json({ status: null })
  }
}
