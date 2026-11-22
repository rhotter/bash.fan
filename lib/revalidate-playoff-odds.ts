import { revalidateTag } from "next/cache"

/**
 * Safely invalidates the `playoff-odds` Next.js cache tag immediately after score or schedule writes.
 * Uses `{ expire: 0 }` so the next read recomputes fresh odds instead of serving stale-while-revalidate.
 * No-ops cleanly outside the Next.js request context (e.g. unit tests or CLI scripts).
 */
export function revalidatePlayoffOdds(): void {
  try {
    revalidateTag("playoff-odds", { expire: 0 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (!msg.includes("static generation store missing")) {
      console.error("Failed to revalidate playoff-odds cache tag:", error)
    }
  }
}
