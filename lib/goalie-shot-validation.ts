// Stats are persisted in Postgres integer columns, so reject values that would
// fail only after other boxscore rows have already been written.
const MAX_STAT = 2_147_483_647

function isShotCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_STAT
}

/** The live scorekeeper tracks three regulation periods and optional OT. */
export function validateShotArray(value: unknown, label: string): string | null {
  if (!Array.isArray(value) || value.length < 3 || value.length > 4 || !Array.from(value).every(isShotCount)) {
    return `${label} must contain 3 or 4 nonnegative integer period totals`
  }
  if (!isShotCount(value.reduce((sum, shots) => sum + shots, 0))) {
    return `${label} total is too large`
  }
  return null
}

/**
 * An allocation is optional for one goalie, mandatory for multiple goalies.
 * Entries for the other team are allowed; callers reject unassigned IDs.
 * totalGoalieShots excludes opposing empty-net goals, which no goalie faced.
 */
export function validateGoalieShotAllocation(
  allocation: Record<string, number> | undefined,
  goalies: readonly { goalieId: number; goalsAgainst: number }[],
  totalGoalieShots: number,
  teamLabel: string,
): string | null {
  if (allocation !== undefined && (
    allocation === null || typeof allocation !== "object" || Array.isArray(allocation) ||
    Object.entries(allocation).some(([id, shots]) => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || !isShotCount(shots))
  )) {
    return "Goalie shot allocations must map player IDs to nonnegative integer shots"
  }
  if (!isShotCount(totalGoalieShots)) {
    return `${teamLabel} opponent shots must include all empty-net goals`
  }
  if (goalies.length === 0) return `${teamLabel} needs an assigned goalie before finalizing`

  const hasExplicitShots = goalies.some((goalie) => allocation?.[String(goalie.goalieId)] !== undefined)
  if (goalies.length > 1 || hasExplicitShots) {
    if (goalies.some((goalie) => allocation?.[String(goalie.goalieId)] === undefined)) {
      return `${teamLabel} needs an explicit shots-against total for every goalie; shots cannot be split from time played`
    }
    const allocatedTotal = goalies.reduce((sum, goalie) => sum + allocation![String(goalie.goalieId)], 0)
    if (allocatedTotal !== totalGoalieShots) {
      return `${teamLabel} goalie shots against must total ${totalGoalieShots} (opponent shots minus empty-net goals)`
    }
  }

  for (const goalie of goalies) {
    const shotsAgainst = allocation?.[String(goalie.goalieId)] ?? totalGoalieShots
    if (!isShotCount(goalie.goalsAgainst) || shotsAgainst < goalie.goalsAgainst) {
      return `${teamLabel} goalie #${goalie.goalieId} shots against cannot be less than goals against (${goalie.goalsAgainst})`
    }
  }
  return null
}
