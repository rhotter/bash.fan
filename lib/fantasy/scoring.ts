import type { FantasyConfig } from "./config"

export interface WeekGame {
  id: string
  status: string
  isForfeit: boolean
  hasBoxscore: boolean
}

export interface SkaterStatLine {
  playerId: number
  gameId: string
  goals: number
  assists: number
  ppg: number
  shg: number
  pim: number
  /** A game played as a Sub scores nothing and isn't attendance. */
  isSub: boolean
}

export interface GoalieStatLine {
  playerId: number
  gameId: string
  saves: number
  goalsAgainst: number
  shutouts: number
  result: string | null
  /** A game played as a Sub scores nothing and isn't attendance. */
  isSub: boolean
}

export interface WeekStats {
  skater: SkaterStatLine[]
  goalie: GoalieStatLine[]
}

/** A Manager's Selections for one Week, as Player ids. */
export interface Lineup {
  skaters: number[]
  /** May hold fewer than the slot count once no default goalie can be selected. */
  goalies: number[]
  skaterBackups: number[]
  goalieBackups: number[]
}

export type SelectionKind = "skater" | "goalie"

/**
 * - `played`: a starter with a stats row, or a Backup covering an absent starter. Costs a use.
 * - `absent`: a starter who didn't play, in a Week with nothing left to score.
 * - `pending`: no stats row yet, but a game in the Week is still not scored.
 * - `unused`: a Backup who isn't needed.
 */
export type SelectionOutcome = "played" | "absent" | "pending" | "unused"

export interface ScoredSelection {
  playerId: number
  kind: SelectionKind
  isBackup: boolean
  outcome: SelectionOutcome
  points: number
}

export interface ScoredWeek {
  points: number
  /** True while a game in the Week hasn't been scored, so the result can still change. */
  provisional: boolean
  selections: ScoredSelection[]
}

export type GameState = "scored" | "pending" | "void"

/** Scored (final with a boxscore), pending (not final, or no boxscore yet), or void (a forfeit counts for nobody). */
export function gameState(game: WeekGame): GameState {
  if (game.isForfeit) return "void"
  return game.status === "final" && game.hasBoxscore ? "scored" : "pending"
}

function scoredGameIds(games: WeekGame[]) {
  return new Set(games.filter((g) => gameState(g) === "scored").map((g) => g.id))
}

function skaterLinePoints(line: SkaterStatLine, config: FantasyConfig) {
  const { skater } = config.weights
  return (
    line.goals * skater.goal +
    line.assists * skater.assist +
    line.ppg * skater.ppg +
    line.shg * skater.shg +
    line.pim * skater.pim
  )
}

function goalieLinePoints(line: GoalieStatLine, config: FantasyConfig) {
  const { goalie } = config.weights
  return (
    line.saves * goalie.save +
    line.goalsAgainst * goalie.goalAgainst +
    (line.result === "W" ? goalie.win : 0) +
    line.shutouts * goalie.shutout
  )
}

export interface StatFigure {
  label: string
  value: number
}

/** One scored game of a Selection: what the Player did and the points it earned. */
export interface SelectionGameLine {
  gameId: string
  points: number
  stats: StatFigure[]
}

/**
 * A Player's scored games in a Week, in the order the games are given. A skater slot scores everything
 * the Player did, so a game with both kinds of row lists both; a goalie slot scores goalie stats only.
 * Games played as a Sub or not yet scored have no line, matching how points are counted.
 */
export function selectionGameLines(
  playerId: number,
  kind: SelectionKind,
  stats: WeekStats,
  games: WeekGame[],
  config: FantasyConfig
): SelectionGameLine[] {
  const scored = scoredGameIds(games)
  return games.flatMap(({ id: gameId }) => {
    if (!scored.has(gameId)) return []
    const counts = (line: { playerId: number; gameId: string; isSub: boolean }) =>
      line.playerId === playerId && line.gameId === gameId && !line.isSub
    const skating = kind === "skater" ? stats.skater.find(counts) : undefined
    const goal = stats.goalie.find(counts)
    if (!skating && !goal) return []
    return [
      {
        gameId,
        points: (skating ? skaterLinePoints(skating, config) : 0) + (goal ? goalieLinePoints(goal, config) : 0),
        stats: [
          ...(skating
            ? [
                { label: "G", value: skating.goals },
                { label: "A", value: skating.assists },
                { label: "PPG", value: skating.ppg },
                { label: "SHG", value: skating.shg },
                { label: "PIM", value: skating.pim },
              ]
            : []),
          ...(goal
            ? [
                { label: "SV", value: goal.saves },
                { label: "GA", value: goal.goalsAgainst },
                { label: "W", value: goal.result === "W" ? 1 : 0 },
                { label: "SO", value: goal.shutouts },
              ]
            : []),
        ],
      },
    ]
  })
}

/**
 * Each Player's points as a goalie for a Week. Entries exist only for Players with a non-Sub goalie row in a
 * scored game, which is how `scoreKind` tells played from absent.
 */
export function goaliePointsByPlayer(stats: WeekStats, games: WeekGame[], config: FantasyConfig) {
  const scored = scoredGameIds(games)
  const points = new Map<number, number>()
  for (const line of stats.goalie) {
    if (line.isSub || !scored.has(line.gameId)) continue
    points.set(line.playerId, (points.get(line.playerId) ?? 0) + goalieLinePoints(line, config))
  }
  return points
}

/** Each Player's points for a Week across both stat types. Entries follow the same rule as goalie points. */
export function pointsByPlayer(stats: WeekStats, games: WeekGame[], config: FantasyConfig) {
  const scored = scoredGameIds(games)
  const points = goaliePointsByPlayer(stats, games, config)
  for (const line of stats.skater) {
    if (line.isSub || !scored.has(line.gameId)) continue
    points.set(line.playerId, (points.get(line.playerId) ?? 0) + skaterLinePoints(line, config))
  }
  return points
}

function scoreKind(
  kind: SelectionKind,
  starters: number[],
  backups: number[],
  points: Map<number, number>,
  provisional: boolean
): ScoredSelection[] {
  const selection = (playerId: number, isBackup: boolean, outcome: SelectionOutcome) => ({
    playerId,
    kind,
    isBackup,
    outcome,
    points: outcome === "played" ? (points.get(playerId) ?? 0) : 0,
  })

  const absentStarters = starters.filter((id) => !points.has(id))
  const results = starters.map((id) =>
    selection(id, false, points.has(id) ? "played" : provisional ? "pending" : "absent")
  )
  // A starter who might still play isn't absent, so no Backup comes in for them yet.
  let uncovered = provisional ? 0 : absentStarters.length
  for (const id of backups) {
    const covers = points.has(id) && uncovered > 0
    if (covers) uncovered--
    results.push(selection(id, true, covers ? "played" : "unused"))
  }
  return results
}

/** Scores one Lineup from the current stats. Pure, so corrections flow through on re-run. */
export function scoreWeek(
  lineup: Lineup,
  stats: WeekStats,
  games: WeekGame[],
  config: FantasyConfig
): ScoredWeek {
  const points = pointsByPlayer(stats, games, config)
  const goaliePoints = goaliePointsByPlayer(stats, games, config)
  const provisional = games.some((g) => gameState(g) === "pending")
  const selections = [
    ...scoreKind("skater", lineup.skaters, lineup.skaterBackups, points, provisional),
    // The goalie slot counts goalie stats only, so a Player who only skated is absent from it.
    ...scoreKind("goalie", lineup.goalies, lineup.goalieBackups, goaliePoints, provisional),
  ]
  return {
    points: selections.reduce((total, s) => total + s.points, 0),
    provisional,
    selections,
  }
}

/** Uses per Player, counted separately by the kind of slot they scored in. */
export type UsesByKind = Record<SelectionKind, Map<number, number>>

/** One use for each Week a Selection played for the Lineup. */
export function countUses(weeks: Pick<ScoredWeek, "selections">[]): UsesByKind {
  const uses: UsesByKind = { skater: new Map(), goalie: new Map() }
  for (const week of weeks) {
    for (const { playerId, kind, outcome } of week.selections) {
      if (outcome === "played") uses[kind].set(playerId, (uses[kind].get(playerId) ?? 0) + 1)
    }
  }
  return uses
}

export interface RosterEntry {
  playerId: number
  isGoalie: boolean
}

/** Uses left per Player for a kind of slot. The slot sets the cap. `null` means uncapped. */
export function remainingUses(
  playerIds: number[],
  kind: SelectionKind,
  uses: Map<number, number>,
  config: FantasyConfig
) {
  const cap = config.usageCap[kind]
  return new Map(
    playerIds.map((id) => [id, cap === null ? null : Math.max(0, cap - (uses.get(id) ?? 0))])
  )
}

/**
 * The goalies offered by default: Players who have played goal this season, or the whole
 * pool until someone has. Any rostered Player can still fill a goalie slot.
 */
export function goalieOptions(roster: RosterEntry[], playedInGoal: Set<number>) {
  const ids = roster.map((entry) => entry.playerId)
  const played = ids.filter((id) => playedInGoal.has(id))
  return played.length > 0 ? played : ids
}

/** Players with no team playing. A Week with no games puts nobody on a Bye. */
export function playersOnBye(
  roster: { playerId: number; teams: string[] }[],
  weekGames: { homeTeam: string; awayTeam: string }[]
) {
  if (weekGames.length === 0) return new Set<number>()
  const playing = new Set(weekGames.flatMap((game) => [game.homeTeam, game.awayTeam]))
  return new Set(
    roster.filter(({ teams }) => !teams.some((team) => playing.has(team))).map(({ playerId }) => playerId)
  )
}

/** Whether a Manager has no default goalie left, so the goalie slot may stay empty. */
export function noGoalieAvailable(
  defaultGoalies: number[],
  goalieUsesLeft: Map<number, number | null>,
  onBye: Set<number>
) {
  return defaultGoalies.every((id) => goalieUsesLeft.get(id) === 0 || onBye.has(id))
}

export type LineupError =
  | "skater-slots"
  | "goalie-slot"
  | "too-many-backups"
  | "duplicate-player"
  | "not-rostered"
  | "wrong-kind"
  | "at-usage-cap"
  | "on-bye"

export interface LineupContext {
  roster: RosterEntry[]
  /** Uses so far, excluding the Week being saved. */
  uses: UsesByKind
  /** From `goalieOptions`. The goalie slot may stay empty once none of these can be selected. */
  defaultGoalies: number[]
  /** From `playersOnBye`, for the Week being saved. */
  onBye: Set<number>
  config: FantasyConfig
}

/** Save-time rules. An empty result means the Lineup can be saved. */
export function validateLineup(lineup: Lineup, context: LineupContext): LineupError[] {
  const { roster, uses, defaultGoalies, onBye, config } = context
  const errors = new Set<LineupError>()
  const rosterById = new Map(roster.map((entry) => [entry.playerId, entry]))
  const ids = roster.map((entry) => entry.playerId)
  const skaterUsesLeft = remainingUses(ids, "skater", uses.skater, config)
  const goalieUsesLeft = remainingUses(ids, "goalie", uses.goalie, config)

  const { skaters, goalies, skaterBackups, goalieBackups } = lineup
  const goalieSlotOptional = noGoalieAvailable(defaultGoalies, goalieUsesLeft, onBye)

  if (skaters.length !== config.lineup.skaters) errors.add("skater-slots")
  if (goalies.length > config.lineup.goalies) errors.add("goalie-slot")
  if (goalies.length < config.lineup.goalies && !goalieSlotOptional) errors.add("goalie-slot")
  if (
    skaterBackups.length > config.lineup.skaterBackups ||
    goalieBackups.length > config.lineup.goalieBackups
  ) {
    errors.add("too-many-backups")
  }

  const skaterSlots = [...skaters, ...skaterBackups]
  const goalieSlots = [...goalies, ...goalieBackups]
  const all = [...skaterSlots, ...goalieSlots]
  if (new Set(all).size !== all.length) errors.add("duplicate-player")

  for (const id of skaterSlots) {
    const entry = rosterById.get(id)
    if (!entry) errors.add("not-rostered")
    else if (entry.isGoalie) errors.add("wrong-kind")
    else if (skaterUsesLeft.get(id) === 0) errors.add("at-usage-cap")
  }
  for (const id of goalieSlots) {
    if (!rosterById.has(id)) errors.add("not-rostered")
    else if (goalieUsesLeft.get(id) === 0) errors.add("at-usage-cap")
  }
  if (all.some((id) => onBye.has(id))) errors.add("on-bye")
  return [...errors]
}

/** Sorts by `compare`. Entries it calls equal share a rank and the next rank is skipped. */
export function rankBy<T>(entries: T[], compare: (a: T, b: T) => number) {
  const sorted = [...entries].sort(compare)
  let rank = 0
  return sorted.map((entry, index) => {
    if (index === 0 || compare(sorted[index - 1], entry) !== 0) rank = index + 1
    return { ...entry, rank }
  })
}

/** Highest points first. */
export function rankByPoints<T extends { points: number }>(entries: T[]) {
  return rankBy(entries, (a, b) => b.points - a.points)
}

/** Each Player's average points over the scored games they appeared in. */
export function pointsPerGame(stats: WeekStats, games: WeekGame[], config: FantasyConfig) {
  const totals = new Map<number, { points: number; games: number }>()
  for (const game of games) {
    for (const [playerId, points] of pointsByPlayer(stats, [game], config)) {
      const total = totals.get(playerId) ?? { points: 0, games: 0 }
      totals.set(playerId, { points: total.points + points, games: total.games + 1 })
    }
  }
  return new Map([...totals].map(([playerId, total]) => [playerId, total.points / total.games]))
}
