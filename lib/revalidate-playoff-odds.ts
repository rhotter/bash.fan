import { revalidateTag } from "next/cache"

/**
 * Safely invalidates the `playoff-odds` Next.js cache tag after score or schedule writes.
 * No-ops cleanly outside the Next.js request context (e.g. unit tests or CLI scripts).
 */
export function revalidatePlayoffOdds(): void {
  try {
    revalidateTag("playoff-odds", "max")
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (!msg.includes("static generation store missing")) {
      console.error("Failed to revalidate playoff-odds cache tag:", error)
    }
  }
}
