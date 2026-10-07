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
    /\b(not|no|never|non|won'?t|don'?t|can'?t|cannot|prefer\s+not)(\s*-?\s*|\s+(to\s+|play(ing)?\s+|be\s+|put\s+me\s+)*)(a\s+)?(in\s+(the\s+)?(goal|net)|(backup\s+)?(goalies?|goaltenders?)|goalkeepers?|netminders?|g)\b/i.test(pos) ||
    /\b(any|anywhere|anything|everything|all)\s+but\s+(a\s+)?(in\s+(the\s+)?(goal|net)|(backup\s+)?(goalies?|goaltenders?)|goalkeepers?|netminders?|g)\b/i.test(pos) ||
    /\bexcept\s+(for\s+)?(a\s+)?(in\s+(the\s+)?(goal|net)|(backup\s+)?(goalies?|goaltenders?)|goalkeepers?|netminders?|g)\b/i.test(pos)
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

  const goalieTokens = [
    "g",
    "goalie",
    "goalies",
    "goaltender",
    "goaltenders",
    "goalkeeper",
    "goalkeepers",
    "netminder",
    "netminders",
  ]
  if (tokens.some((t) => goalieTokens.includes(t))) return true
  if (/\b(backup\s+goalies?|in\s+(the\s+)?(goal|net))\b/i.test(pos) && !/\bin\s+(the\s+)?goal[\s-]+scor/i.test(pos)) return true

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

  // Map skater filter buttons to keywords that indicate that position (G uses isPlayerGoalie)
  const filterKeywords: Record<string, string[]> = {
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
  const matchesG = isPlayerGoalie(rawPos)
  const hasSpecificSkaterPos = matchesD || matchesC || matchesF

  // If specific skater positions are named, only match those (or G if player is also goalie)
  // Even if "both", "any", etc. are present (e.g., "Both Forward and Defense", "Any forward position")
  if (hasSpecificSkaterPos) {
    return filterKeys.some((k) => {
      if (k === "D") return matchesD
      if (k === "C") return matchesC
      if (k === "F") return matchesF
      if (k === "G") return matchesG
      return false
    })
  }

  // If player listed "not goalie" (or equivalent) with no specific position:
  if (notGoalie) {
    return filterKeys.some((k) => k !== "G")
  }

  // True wildcard positions ("all", "whatever") without specific positions
  if (tokens.some((t) => ["all", "whatever"].includes(t))) {
    if (notGoalie) {
      return filterKeys.some((k) => k !== "G")
    }
    return true
  }

  // "any" or "both" without specific positions defaults to skater positions unless goalie is explicitly indicated
  if (tokens.some((t) => ["any", "both"].includes(t))) {
    if (matchesG) return true
    return filterKeys.some((k) => k !== "G")
  }

  return filterKeys.some((filterKey) => {
    if (filterKey === "G") return matchesG
    const keywords = filterKeywords[filterKey] || [filterKey.toLowerCase()]
    return keywords.some(
      (kw) => tokens.includes(kw) || (kw.includes(" ") && pos.includes(kw))
    )
  })
}

/**
 * Extract normalized position chips (G, D, C, F) for display badges.
 */
export function getPositionChips(rawPos: unknown): Array<"G" | "D" | "C" | "F"> {
  if (typeof rawPos !== "string" || !rawPos.trim()) return []

  const pos = rawPos.toLowerCase()
  const notGoalie = isNotGoaliePosition(pos)
  const tokens = pos.split(/[,/\s-]+/).map((t) => t.replace(/[^a-z]/g, "")).filter(Boolean)

  const chips: Array<"G" | "D" | "C" | "F"> = []

  if (!notGoalie && isPlayerGoalie(rawPos)) {
    chips.push("G")
  }

  const matchesD = ["defense", "defence", "def", "d", "rd", "ld", "defensemen", "defenseman"].some(
    (kw) => tokens.includes(kw) || (kw.includes(" ") && pos.includes(kw))
  )
  if (matchesD) {
    chips.push("D")
  }

  const matchesC = ["center", "centre", "c"].some(
    (kw) => tokens.includes(kw) || (kw.includes(" ") && pos.includes(kw))
  )
  if (matchesC) {
    chips.push("C")
  }

  const matchesF = [
    "forward", "forwards", "f", "fwd", "wing", "winger", "w",
    "lw", "rw", "rf", "offense", "left wing", "right wing"
  ].some((kw) => tokens.includes(kw) || (kw.includes(" ") && pos.includes(kw)))
  if (matchesF) {
    chips.push("F")
  }

  if (chips.length > 0) {
    return chips
  }

  // If no specific position matched, check for generic wildcards
  if (tokens.some((t) => ["all", "whatever"].includes(t))) {
    return notGoalie ? ["D", "C", "F"] : ["G", "D", "C", "F"]
  }

  if (tokens.some((t) => ["any", "both"].includes(t))) {
    return ["D", "F"]
  }

  if (notGoalie) {
    return ["D", "F"]
  }

  return []
}

