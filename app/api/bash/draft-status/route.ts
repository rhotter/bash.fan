import { fetchDraftStatus } from "@/lib/fetch-draft-status"
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
    const draftStatus = await fetchDraftStatus()

    return NextResponse.json(
      draftStatus,
      {
        headers: {
          "Cache-Control": draftStatus.status === "live"
            ? "public, s-maxage=5, stale-while-revalidate=10"
            : "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    )
  } catch {
    return NextResponse.json({ status: null })
  }
}
