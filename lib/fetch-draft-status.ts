import { db } from "@/lib/db"
import * as schema from "@/lib/db/schema"
import { sql, notInArray } from "drizzle-orm"
import { unstable_cache } from "next/cache"

export type PublicDraftStatus = {
  status: string | null
  seasonSlug?: string
  draftDate?: string | null
}

/** Shared by the initial footer render and its client revalidation endpoint. */
export async function fetchDraftStatus(): Promise<PublicDraftStatus> {
  // Find any non-draft (public) draft instance, prioritizing live > published > completed
  const draft = await db
    .select({
      status: schema.draftInstances.status,
      seasonId: schema.draftInstances.seasonId,
      draftDate: schema.draftInstances.draftDate,
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

  if (!draft.length) return { status: null }

  const { status, seasonId, draftDate } = draft[0]
  return { status, seasonSlug: seasonId, draftDate: draftDate?.toISOString() ?? null }
}

// Keep layout reads inexpensive without slowing the live-status refresh interval.
const cachedDraftStatus = unstable_cache(fetchDraftStatus, ["public-draft-status-v1"], {
  revalidate: 5,
})

export async function fetchInitialDraftStatus(): Promise<PublicDraftStatus> {
  try {
    return await cachedDraftStatus()
  } catch {
    // A database outage must not prevent the rest of the site from rendering.
    return { status: null }
  }
}
