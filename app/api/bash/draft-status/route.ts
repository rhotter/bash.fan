import { db } from "@/lib/db"
import * as schema from "@/lib/db/schema"
import { sql, notInArray } from "drizzle-orm"
import { NextResponse } from "next/server"

/**
 * Lightweight endpoint that returns the most relevant public draft status
 * for nav link rendering. Searches all seasons for published/live/completed drafts.
 * Priority: live > published > completed.
 *
 * Response: { status: "published" | "live" | "completed", seasonSlug: string } | { status: null }
 */
export async function GET() {
  try {
    // Find any non-draft (public) draft instance, prioritizing live > published > completed
    const draft = await db
      .select({
        status: schema.draftInstances.status,
        seasonId: schema.draftInstances.seasonId,
      })
      .from(schema.draftInstances)
      .where(notInArray(schema.draftInstances.status, ["draft", "archived"]))
      .orderBy(
        sql`CASE ${schema.draftInstances.status}
          WHEN 'live' THEN 0
          WHEN 'published' THEN 1
          WHEN 'completed' THEN 2
          ELSE 3
        END`
      )
      .limit(1)

    if (!draft.length) {
      return NextResponse.json({ status: null }, {
        headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
      })
    }

    const { status, seasonId } = draft[0]

    return NextResponse.json(
      { status, seasonSlug: seasonId },
      {
        headers: {
          "Cache-Control": status === "live"
            ? "public, s-maxage=5, stale-while-revalidate=10"
            : "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    )
  } catch {
    return NextResponse.json({ status: null })
  }
}
