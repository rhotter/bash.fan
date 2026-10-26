/**
 * Trade Validation Helper for Mid-Season Traded Player Support.
 * Validates trade inputs, participating teams (2-team or N-team circular),
 * directed player moves, draft picks, and notes according to PRD §5.3.2.
 */

export interface TradeDraftPickInput {
  fromTeamSlug: string
  toTeamSlug: string
  round: number
  originalTeamSlug: string
  targetSeason: string
}

export interface TradePlayerMoveInput {
  playerId: number
  fromTeamSlug: string
  toTeamSlug: string
}

export interface TradeInput {
  teamSlugs?: string[]
  teamASlug?: string
  teamBSlug?: string
  playerMoves?: TradePlayerMoveInput[]
  teamAPlayerIds?: number[]
  teamBPlayerIds?: number[]
  draftPicks?: TradeDraftPickInput[]
  notes?: string
}

export interface ValidatedPlayerMove {
  playerId: number
  fromTeamSlug: string
  toTeamSlug: string
}

export interface TradeValidationSuccess {
  valid: true
  data: {
    teamSlugs: string[]
    teamASlug: string
    teamBSlug: string
    playerMoves: ValidatedPlayerMove[]
    teamAPlayerIds: number[]
    teamBPlayerIds: number[]
    draftPicks: Array<{
      itemType: "draft_pick"
      fromTeamSlug: string
      toTeamSlug: string
      playerId: null
      draftPickRound: number
      draftPickOriginalTeamSlug: string
      draftPickTargetSeason: string
    }>
    notes?: string
  }
}

export interface TradeValidationFailure {
  valid: false
  error: string
}

export type TradeValidationResult = TradeValidationSuccess | TradeValidationFailure

/**
 * Computes the next Fall season ID given a current season ID.
 * E.g. "bash-2026-2027" -> "2027-2028", "2025-2026" -> "2026-2027", "2026-summer" -> "2026-2027".
 */
export function getNextFallSeasonId(seasonId: string): string {
  const fallMatch = seasonId.match(/(\d{4})-(\d{4})/)
  if (fallMatch) {
    const startYear = Number(fallMatch[1])
    return `${startYear + 1}-${startYear + 2}`
  }
  const summerMatch = seasonId.match(/(\d{4})-summer/i)
  if (summerMatch) {
    const year = Number(summerMatch[1])
    return `${year}-${year + 1}`
  }
  return "2027-2028"
}

/**
 * Returns candidate draft_pick_target_season strings that match a given Fall season ID.
 * Returns an empty array for Summer seasons so Fall trades never apply to Summer drafts.
 */
export function getTargetFallSeasonCandidates(seasonId: string, seasonType?: string): string[] {
  if (seasonType && seasonType !== "fall") return []
  if (/summer/i.test(seasonId)) return []
  const fallMatch = seasonId.match(/(\d{4})-(\d{4})/)
  if (!fallMatch) return [seasonId]
  const range = `${fallMatch[1]}-${fallMatch[2]}`
  return Array.from(new Set([seasonId, range, `bash-${range}`]))
}

export function validateTradeInput(input: unknown): TradeValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, error: "Invalid trade payload: expected an object" }
  }

  const raw = input as Record<string, unknown>

  // 1. Resolve participating teamSlugs (supports teamSlugs array OR teamASlug/teamBSlug pair)
  let teamSlugs: string[] = []
  if (raw.teamSlugs !== undefined) {
    if (!Array.isArray(raw.teamSlugs)) {
      return { valid: false, error: "teamSlugs must be an array of team slugs" }
    }
    const seenTeams = new Set<string>()
    for (const entry of raw.teamSlugs) {
      const slug = typeof entry === "string" ? entry.trim() : ""
      if (!slug) {
        return { valid: false, error: "All teamSlugs entries must be non-empty strings" }
      }
      if (seenTeams.has(slug)) {
        return { valid: false, error: "Cannot trade between the same team" }
      }
      seenTeams.add(slug)
      teamSlugs.push(slug)
    }
    if (teamSlugs.length < 2) {
      return { valid: false, error: "At least two distinct teams are required in teamSlugs" }
    }
  } else {
    const teamASlug = typeof raw.teamASlug === "string" ? raw.teamASlug.trim() : ""
    const teamBSlug = typeof raw.teamBSlug === "string" ? raw.teamBSlug.trim() : ""

    if (!teamASlug || !teamBSlug) {
      return { valid: false, error: "Both teamASlug and teamBSlug are required" }
    }

    if (teamASlug === teamBSlug) {
      return { valid: false, error: "Cannot trade between the same team" }
    }

    teamSlugs = [teamASlug, teamBSlug]
  }

  const teamASlug = teamSlugs[0]
  const teamBSlug = teamSlugs[1]
  const validTeams = new Set(teamSlugs)

  // 2. Validate teamAPlayerIds / teamBPlayerIds (2-team shorthand)
  const rawAPlayerIds = raw.teamAPlayerIds
  if (rawAPlayerIds !== undefined && !Array.isArray(rawAPlayerIds)) {
    return { valid: false, error: "teamAPlayerIds must be an array of player IDs" }
  }
  const aList = (rawAPlayerIds as unknown[]) || []
  const teamAPlayerIds: number[] = []
  for (const id of aList) {
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
      return { valid: false, error: `Invalid player ID on Team A: ${String(id)} (must be a positive integer)` }
    }
    if (!teamAPlayerIds.includes(id)) {
      teamAPlayerIds.push(id)
    }
  }

  const rawBPlayerIds = raw.teamBPlayerIds
  if (rawBPlayerIds !== undefined && !Array.isArray(rawBPlayerIds)) {
    return { valid: false, error: "teamBPlayerIds must be an array of player IDs" }
  }
  const bList = (rawBPlayerIds as unknown[]) || []
  const teamBPlayerIds: number[] = []
  for (const id of bList) {
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
      return { valid: false, error: `Invalid player ID on Team B: ${String(id)} (must be a positive integer)` }
    }
    if (!teamBPlayerIds.includes(id)) {
      teamBPlayerIds.push(id)
    }
  }

  // Check for overlapping players between teamAPlayerIds and teamBPlayerIds
  const aSet = new Set(teamAPlayerIds)
  for (const bId of teamBPlayerIds) {
    if (aSet.has(bId)) {
      return { valid: false, error: `Player ID ${bId} cannot appear on both teams in the same trade` }
    }
  }

  // 3. Build directed playerMoves (from explicit playerMoves or derived from teamAPlayerIds/teamBPlayerIds)
  const playerMoves: ValidatedPlayerMove[] = []
  const moveByPlayerId = new Map<number, ValidatedPlayerMove>()

  if (raw.playerMoves !== undefined) {
    if (!Array.isArray(raw.playerMoves)) {
      return { valid: false, error: "playerMoves must be an array if provided" }
    }
    for (let i = 0; i < raw.playerMoves.length; i++) {
      const m = raw.playerMoves[i]
      if (!m || typeof m !== "object" || Array.isArray(m)) {
        return { valid: false, error: `Player move at index ${i} must be an object` }
      }
      const moveObj = m as Record<string, unknown>
      const pid = moveObj.playerId
      const fromTeam = typeof moveObj.fromTeamSlug === "string" ? moveObj.fromTeamSlug.trim() : ""
      const toTeam = typeof moveObj.toTeamSlug === "string" ? moveObj.toTeamSlug.trim() : ""

      if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
        return { valid: false, error: `Invalid player ID in playerMoves at index ${i}: ${String(pid)} (must be a positive integer)` }
      }
      if (!fromTeam || !toTeam) {
        return { valid: false, error: `Player move at index ${i} requires fromTeamSlug and toTeamSlug` }
      }
      if (fromTeam === toTeam) {
        return { valid: false, error: `Player move at index ${i} cannot have identical fromTeamSlug and toTeamSlug` }
      }
      if (!validTeams.has(fromTeam) || !validTeams.has(toTeam)) {
        return { valid: false, error: `Player move at index ${i} must be between participating teams (${teamSlugs.join(", ")})` }
      }

      const existing = moveByPlayerId.get(pid)
      if (existing) {
        if (existing.fromTeamSlug !== fromTeam || existing.toTeamSlug !== toTeam) {
          return { valid: false, error: `Player ID ${pid} cannot appear on both teams in the same trade` }
        }
        continue
      }

      const move: ValidatedPlayerMove = { playerId: pid, fromTeamSlug: fromTeam, toTeamSlug: toTeam }
      moveByPlayerId.set(pid, move)
      playerMoves.push(move)
    }
  } else {
    for (const pid of teamAPlayerIds) {
      const move: ValidatedPlayerMove = { playerId: pid, fromTeamSlug: teamASlug, toTeamSlug: teamBSlug }
      moveByPlayerId.set(pid, move)
      playerMoves.push(move)
    }
    for (const pid of teamBPlayerIds) {
      const move: ValidatedPlayerMove = { playerId: pid, fromTeamSlug: teamBSlug, toTeamSlug: teamASlug }
      moveByPlayerId.set(pid, move)
      playerMoves.push(move)
    }
  }

  // Keep teamAPlayerIds / teamBPlayerIds synchronized when playerMoves was supplied for a 2-team trade
  if (raw.playerMoves !== undefined && teamAPlayerIds.length === 0 && teamBPlayerIds.length === 0) {
    for (const m of playerMoves) {
      if (m.fromTeamSlug === teamASlug && m.toTeamSlug === teamBSlug) {
        teamAPlayerIds.push(m.playerId)
      } else if (m.fromTeamSlug === teamBSlug && m.toTeamSlug === teamASlug) {
        teamBPlayerIds.push(m.playerId)
      }
    }
  }

  // 4. Validate draft picks
  const rawPicks = raw.draftPicks
  if (rawPicks !== undefined && !Array.isArray(rawPicks)) {
    return { valid: false, error: "draftPicks must be an array if provided" }
  }

  const draftPicks: TradeValidationSuccess["data"]["draftPicks"] = []
  if (Array.isArray(rawPicks)) {
    for (let i = 0; i < rawPicks.length; i++) {
      const pick = rawPicks[i]
      if (!pick || typeof pick !== "object" || Array.isArray(pick)) {
        return { valid: false, error: `Draft pick at index ${i} must be an object` }
      }
      const p = pick as Record<string, unknown>
      const fromTeam = typeof p.fromTeamSlug === "string" ? p.fromTeamSlug.trim() : ""
      const toTeam = typeof p.toTeamSlug === "string" ? p.toTeamSlug.trim() : ""
      const originalTeam = typeof p.originalTeamSlug === "string" ? p.originalTeamSlug.trim() : ""
      const targetSeason = typeof p.targetSeason === "string" ? p.targetSeason.trim() : ""
      const round = p.round

      if (!fromTeam || !toTeam) {
        return { valid: false, error: `Draft pick at index ${i} requires fromTeamSlug and toTeamSlug` }
      }

      if (fromTeam === toTeam) {
        return { valid: false, error: `Draft pick at index ${i} cannot have identical fromTeamSlug and toTeamSlug` }
      }

      if (!validTeams.has(fromTeam) || !validTeams.has(toTeam)) {
        return {
          valid: false,
          error: `Draft pick at index ${i} must be traded between ${teamSlugs.join(" and ")}`,
        }
      }

      if (typeof round !== "number" || !Number.isInteger(round) || round < 1 || round > 20) {
        return { valid: false, error: `Draft pick round must be an integer between 1 and 20 (got ${String(round)})` }
      }

      if (!originalTeam) {
        return { valid: false, error: `Draft pick at index ${i} requires originalTeamSlug` }
      }

      if (!targetSeason) {
        return { valid: false, error: `Draft pick at index ${i} requires targetSeason` }
      }

      draftPicks.push({
        itemType: "draft_pick",
        fromTeamSlug: fromTeam,
        toTeamSlug: toTeam,
        playerId: null,
        draftPickRound: round,
        draftPickOriginalTeamSlug: originalTeam,
        draftPickTargetSeason: targetSeason,
      })
    }
  }

  // 5. Ensure trade has at least one asset exchanged
  const totalAssets = playerMoves.length + draftPicks.length
  if (totalAssets === 0) {
    return { valid: false, error: "Trade must include at least one player or draft pick" }
  }

  // 6. Notes validation
  let notes: string | undefined
  if (typeof raw.notes === "string") {
    const trimmed = raw.notes.trim()
    if (trimmed.length > 0) {
      notes = trimmed
    }
  }

  return {
    valid: true,
    data: {
      teamSlugs,
      teamASlug,
      teamBSlug,
      playerMoves,
      teamAPlayerIds,
      teamBPlayerIds,
      draftPicks,
      ...(notes ? { notes } : {}),
    },
  }
}
