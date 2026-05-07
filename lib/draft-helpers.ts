/**
 * Draft query helpers — shared conditions and utilities for draft data access.
 */

import { eq, SQL } from "drizzle-orm"
import { schema } from "@/lib/db"

/**
 * Builds a WHERE condition to exclude simulation rows from draft queries.
 * Use this on any query against draftPicks, draftTrades, or draftLog to ensure
 * simulation data is filtered out by default.
 *
 * @example
 *   db.select().from(schema.draftPicks).where(
 *     and(eq(schema.draftPicks.draftId, id), withoutSimulation(schema.draftPicks))
 *   )
 */
export function withoutSimulation(
  table: { isSimulation: typeof schema.draftPicks.isSimulation }
): SQL {
  return eq(table.isSimulation, false)
}

/**
 * Generate all pick slot rows for a draft when transitioning to live.
 *
 * For snake drafts, even-numbered rounds reverse the team order
 * (e.g., Round 1: A→B→C→D, Round 2: D→C→B→A, Round 3: A→B→C→D…)
 *
 * @param teamSlugs - Teams in draft order (position 1→N)
 * @param rounds - Total number of rounds
 * @param draftType - "snake" or "linear"
 * @param ownershipMap - Map from "originalTeam::round" → current owner (from trade resolution)
 * @returns Array of pick slot objects ready for DB insertion
 */
export function generatePickSlots(
  teamSlugs: string[],
  rounds: number,
  draftType: "snake" | "linear",
  ownershipMap: Map<string, string>
): Array<{
  round: number
  pickNumber: number
  teamSlug: string
  originalTeamSlug: string
}> {
  const picks: Array<{
    round: number
    pickNumber: number
    teamSlug: string
    originalTeamSlug: string
  }> = []

  let pickNumber = 1
  const numTeams = teamSlugs.length

  for (let round = 1; round <= rounds; round++) {
    // Snake draft: reverse order on even rounds
    const isReversed = draftType === "snake" && round % 2 === 0
    const orderForRound = isReversed ? [...teamSlugs].reverse() : [...teamSlugs]

    for (let pos = 0; pos < numTeams; pos++) {
      const originalTeamSlug = orderForRound[pos]
      // Check if this pick slot has been traded
      const ownerKey = `${originalTeamSlug}::${round}`
      const teamSlug = ownershipMap.get(ownerKey) || originalTeamSlug

      picks.push({
        round,
        pickNumber,
        teamSlug,
        originalTeamSlug,
      })
      pickNumber++
    }
  }

  return picks
}
