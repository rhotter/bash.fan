import { revalidateTag } from "next/cache"

/** Fantasy responses depend on who's asking and on the Lock, so HTTP caches must never keep them. The cached public pages are in lib/cached-page-data.ts. */
export function reply(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } })
}

/** Drops the cached public pages. By then the write has committed, so a failure here is logged, never reported as a failed write. */
export function refreshPublicPages() {
  try {
    revalidateTag("fantasy", { expire: 0 })
  } catch (error) {
    console.error("Saved, but could not refresh the cached Fantasy pages (they update within 30s):", error)
  }
}
