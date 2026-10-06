/**
 * Draft query helpers — shared conditions and utilities for draft data access.
 */


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

/**
 * Check if the raw position string explicitly specifies non-goalie intent
 * (e.g. "not goalie", "not a goalie", "anywhere but goalie", "except goalie").
 */
export function isNotGoaliePosition(rawPos: unknown): boolean {
  if (typeof rawPos !== "string" || !rawPos.trim()) return false
  const pos = rawPos.toLowerCase()
  return (
    /\b(not|no|never|non)\s*-?\s*(a\s+)?(goalies?|goalkeepers?|netminders?|goals?|g)\b/i.test(pos) ||
    /\b(any|anywhere|anything|everything|all)\s+but\s+(a\s+)?(goalies?|goalkeepers?|netminders?|goals?|g)\b/i.test(pos) ||
    /\bexcept\s+(for\s+)?(a\s+)?(goalies?|goalkeepers?|netminders?|goals?|g)\b/i.test(pos)
  )
}

/**
 * Determine if a player is designated as a goalie based on their registration position.
 * Returns false if the player explicitly indicated "not goalie".
 */
export function isPlayerGoalie(rawPos: unknown): boolean {
  if (typeof rawPos !== "string" || !rawPos.trim()) return false
  if (isNotGoaliePosition(rawPos)) return false

  const pos = rawPos.toLowerCase()
  const tokens = pos.split(/[,/\s-]+/).map((t) => t.replace(/[^a-z]/g, "")).filter(Boolean)

  const goalieTokens = ["g", "goalie", "goalies", "goal", "goals", "goalkeeper", "goalkeepers", "netminder", "netminders"]
  if (tokens.some((t) => goalieTokens.includes(t))) return true
  if (pos.includes("backup goalie") || pos.includes("backup goalies")) return true

  return false
}

/**
 * Filter available draft pool players by position button filter (G, D, C, F).
 * - "not goalie" players are excluded from G.
 * - If a specific skater position is listed (e.g. "Defense, not goalie"), only that position matches.
 * - If no specific position is listed (e.g. "not goalie"), they are eligible for all skater positions (D, C, F).
 * - Wildcards ("all", "any", "whatever", "both") match all positions unless non-goalie intent is present.
 */
export function matchesPositionFilter(rawPos: unknown, filterKeys: string[]): boolean {
  if (!filterKeys || filterKeys.length === 0) return true
  if (typeof rawPos !== "string" || !rawPos.trim()) return false

  const pos = rawPos.toLowerCase()
  const notGoalie = isNotGoaliePosition(pos)

  // Tokenize: split on commas, slashes, hyphens, whitespace; strip non-alpha chars
  const tokens = pos.split(/[,/\s-]+/).map((t) => t.replace(/[^a-z]/g, "")).filter(Boolean)

  // Map filter buttons to keywords that indicate that position
  const filterKeywords: Record<string, string[]> = {
    G: ["goalie", "goalies", "goal", "goals", "g", "goalkeeper", "goalkeepers", "netminder", "netminders", "backup goalie", "backup goalies"],
    D: ["defense", "defence", "def", "d", "rd", "ld", "defensemen", "defenseman"],
    C: ["center", "centre", "c"],
    F: [
      "forward",
      "forwards",
      "f",
      "fwd",
      "wing",
      "winger",
      "w",
      "lw",
      "rw",
      "rf",
      "offense",
      "left wing",
      "right wing",
    ],
  }

  const matchesD = filterKeywords.D.some((kw) => tokens.includes(kw) || (kw.includes(" ") && pos.includes(kw)))
  const matchesC = filterKeywords.C.some((kw) => tokens.includes(kw) || (kw.includes(" ") && pos.includes(kw)))
  const matchesF = filterKeywords.F.some((kw) => tokens.includes(kw) || (kw.includes(" ") && pos.includes(kw)))
  const hasSpecificSkaterPos = matchesD || matchesC || matchesF

  // If player listed "not goalie" (or equivalent):
  if (notGoalie) {
    const activeSkaterFilters = filterKeys.filter((k) => k !== "G")
    if (activeSkaterFilters.length === 0) return false

    // If player specified a position (e.g., "Defense, not goalie"), match only that position
    if (hasSpecificSkaterPos) {
      return activeSkaterFilters.some((k) => {
        if (k === "D") return matchesD
        if (k === "C") return matchesC
        if (k === "F") return matchesF
        return false
      })
    }

    // Generic "not goalie" with no other position matches all skater positions
    return true
  }

  // Wildcard positions match every filter
  const wildcards = ["all", "any", "whatever", "both"]
  if (tokens.some((t) => wildcards.includes(t))) return true

  return filterKeys.some((filterKey) => {
    const keywords = filterKeywords[filterKey] || [filterKey.toLowerCase()]
    return keywords.some(
      (kw) => tokens.includes(kw) || (kw.includes(" ") && pos.includes(kw))
    )
  })
}
