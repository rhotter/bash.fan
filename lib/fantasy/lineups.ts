import { and, arrayContains, eq, inArray, or } from "drizzle-orm"
import { z } from "zod"
import { db, schema } from "@/lib/db"
import type { FantasyConfig } from "./config"
import type { ManagerIdentity } from "./managers"
import { buildPickemStandings, type Prediction } from "./pickem"
import {
  countUses,
  goalieOptions,
  noGoalieAvailable,
  playersOnBye,
  pointsPerGame,
  remainingUses,
  scoreWeek,
  validateLineup,
  type Lineup,
  type LineupError,
  type ScoredWeek,
  type WeekGame,
  type WeekStats,
} from "./scoring"
import { getFantasySeason, type FantasySeason } from "./season"
import { buildStandings } from "./standings"
import { buildWeekOverview, countsForGame, gameWeekId, openWeek } from "./week"

const { fantasyLineups, fantasyPredictions } = schema

const playerIds = z.array(z.number().int().positive()).max(20)

export const lineupRequestSchema = z.object({
  weekId: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lineup: z.object({
    skaters: playerIds,
    goalies: playerIds,
    skaterBackups: playerIds,
    goalieBackups: playerIds,
  }),
})

export interface SeasonGame extends WeekGame {
  date: string
  time: string
  gameType: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
}

export interface SavedLineup {
  weekId: string
  lineup: Lineup
}

/** Scores saved Lineups from the current stats, so corrections flow through. */
export function scoreSavedLineups(
  saved: SavedLineup[],
  games: SeasonGame[],
  stats: WeekStats,
  config: FantasyConfig,
  launchedAt: Date
) {
  const counting = games.filter((game) => countsForGame(game, launchedAt, config.lock))
  return saved.map(({ weekId, lineup }) => {
    const weekGames = counting.filter((game) => gameWeekId(game, config.lock) === weekId)
    return scoreWeek(lineup, stats, weekGames, config)
  })
}

const everySlot = ({ skaters, goalies, skaterBackups, goalieBackups }: Lineup) => [
  ...skaters,
  ...goalies,
  ...skaterBackups,
  ...goalieBackups,
]

/** player_seasons has a row per team, so a traded Player is folded into one entry. */
function foldRoster(rows: { id: number; name: string; team: string; teamSlug: string; isGoalie: boolean }[]) {
  type RosterPlayer = { id: number; name: string; team: string; teams: string[]; isGoalie: boolean }
  const players = new Map<number, RosterPlayer>()
  for (const { teamSlug, ...row } of rows) {
    const player = players.get(row.id)
    if (!player) players.set(row.id, { ...row, teams: [teamSlug] })
    else {
      player.isGoalie ||= row.isGoalie
      player.teams.push(teamSlug)
      if (!player.team.split(" / ").includes(row.team)) player.team += ` / ${row.team}`
    }
  }
  return [...players.values()]
}

const { games: gamesTable, goalieGameStats: goalieStats, playerGameStats: skaterStats } = schema

/** The season's games of the types a contest scores, such as regular games or playoff games. */
const scoredGames = (seasonId: string, gameTypes: string[]) =>
  and(eq(gamesTable.seasonId, seasonId), inArray(gamesTable.gameType, gameTypes))

export function readSeasonGames(seasonId: string, gameTypes: string[]): Promise<SeasonGame[]> {
  return db
    .select({
      id: gamesTable.id,
      date: gamesTable.date,
      time: gamesTable.time,
      gameType: gamesTable.gameType,
      homeTeam: gamesTable.homeTeam,
      awayTeam: gamesTable.awayTeam,
      homeScore: gamesTable.homeScore,
      awayScore: gamesTable.awayScore,
      status: gamesTable.status,
      isForfeit: gamesTable.isForfeit,
      hasBoxscore: gamesTable.hasBoxscore,
    })
    .from(gamesTable)
    .where(scoredGames(seasonId, gameTypes))
}

export function selectedPlayerIds(lineups: SavedLineup[]) {
  return [...new Set(lineups.flatMap(({ lineup }) => everySlot(lineup)))]
}

/** The season's stats for every Player selected in these Lineups. */
export function readSelectedStats(seasonId: string, gameTypes: string[], lineups: SavedLineup[]): Promise<WeekStats> {
  return readPlayerStats(seasonId, gameTypes, selectedPlayerIds(lineups))
}

async function readPlayerStats(seasonId: string, gameTypes: string[], selected: number[]): Promise<WeekStats> {
  const seasonGames = scoredGames(seasonId, gameTypes)
  const [skater, goalie] = await Promise.all([
    db
      .select({
        playerId: skaterStats.playerId,
        gameId: skaterStats.gameId,
        goals: skaterStats.goals,
        assists: skaterStats.assists,
        ppg: skaterStats.ppg,
        shg: skaterStats.shg,
        pim: skaterStats.pim,
        isSub: skaterStats.isSub,
      })
      .from(skaterStats)
      .innerJoin(gamesTable, eq(gamesTable.id, skaterStats.gameId))
      .where(and(seasonGames, inArray(skaterStats.playerId, selected))),
    db
      .select({
        playerId: goalieStats.playerId,
        gameId: goalieStats.gameId,
        saves: goalieStats.saves,
        goalsAgainst: goalieStats.goalsAgainst,
        shutouts: goalieStats.shutouts,
        result: goalieStats.result,
        isSub: goalieStats.isSub,
      })
      .from(goalieStats)
      .innerJoin(gamesTable, eq(gamesTable.id, goalieStats.gameId))
      .where(and(seasonGames, inArray(goalieStats.playerId, selected))),
  ])
  return { skater, goalie }
}

async function readSeasonState(manager: ManagerIdentity, gameTypes: string[]) {
  const { seasonId } = manager
  const { playerSeasons, players, teams } = schema
  const seasonGames = scoredGames(seasonId, gameTypes)

  const [rosterRows, games, goaliesPlayed, lineupRows] = await Promise.all([
    db
      .select({
        id: playerSeasons.playerId,
        name: players.name,
        team: teams.name,
        teamSlug: playerSeasons.teamSlug,
        isGoalie: playerSeasons.isGoalie,
      })
      .from(playerSeasons)
      .innerJoin(players, eq(players.id, playerSeasons.playerId))
      .innerJoin(teams, eq(teams.slug, playerSeasons.teamSlug))
      .where(eq(playerSeasons.seasonId, seasonId))
      .orderBy(players.name, teams.name),
    readSeasonGames(seasonId, gameTypes),
    db
      .selectDistinct({ playerId: goalieStats.playerId })
      .from(goalieStats)
      .innerJoin(gamesTable, eq(gamesTable.id, goalieStats.gameId))
      .where(and(seasonGames, eq(goalieStats.isSub, false))),
    db.select().from(fantasyLineups).where(eq(fantasyLineups.managerId, manager.id)),
  ])

  const lineups: SavedLineup[] = lineupRows.map(({ weekId, skaters, goalies, skaterBackups, goalieBackups }) => ({
    weekId,
    lineup: { skaters, goalies, skaterBackups, goalieBackups },
  }))

  // Uses depend on the Manager's Lineups and points per game on the whole roster, so this read follows the one above.
  const roster = foldRoster(rosterRows)
  const stats = await readPlayerStats(seasonId, gameTypes, [...new Set([...selectedPlayerIds(lineups), ...roster.map((p) => p.id)])])

  return {
    players: roster,
    teams: [...new Map(rosterRows.map((row) => [row.teamSlug, { slug: row.teamSlug, name: row.team }])).values()],
    games,
    stats,
    lineups,
    playedInGoal: new Set(goaliesPlayed.map((row) => row.playerId)),
  }
}

type SeasonState = Awaited<ReturnType<typeof readSeasonState>>

/**
 * Uses counted at save time. A starter in a locked Week still waiting on a boxscore holds a
 * use, or a Manager could over-select a Player in the gap after the Lock. It's handed back if
 * the boxscore shows they were absent.
 */
export function usesHeldForCap(weeks: Pick<ScoredWeek, "selections">[]) {
  return countUses(
    weeks.map((week) => ({
      ...week,
      selections: week.selections.map((s) => (s.outcome === "pending" ? { ...s, outcome: "played" as const } : s)),
    }))
  )
}

function weekGames(state: SeasonState, season: FantasySeason, weekId: string) {
  const { lock } = season.config
  return state.games.filter(
    (game) => countsForGame(game, season.launchedAt, lock) && gameWeekId(game, lock) === weekId
  )
}

/** Cap and Bye inputs for the open Week, to validate a save and to build the form. Its own Lineup doesn't count against itself. */
function capContext(state: SeasonState, season: FantasySeason, weekId: string) {
  const earlier = state.lineups.filter((saved) => saved.weekId !== weekId)
  const scored = scoreSavedLineups(earlier, state.games, state.stats, season.config, season.launchedAt)
  const roster = state.players.map((p) => ({ playerId: p.id, isGoalie: p.isGoalie }))
  return {
    roster,
    uses: usesHeldForCap(scored),
    defaultGoalies: goalieOptions(roster, state.playedInGoal),
    onBye: playersOnBye(
      state.players.map(({ id, teams }) => ({ playerId: id, teams })),
      weekGames(state, season, weekId)
    ),
    config: season.config,
  }
}

/** The Manager's own locked Weeks. Weeks they missed aren't listed. */
function managerHistory(manager: ManagerIdentity, state: SeasonState, season: FantasySeason, now: Date) {
  const { weeks, season: table } = buildStandings({
    managers: [manager],
    lineups: state.lineups.map((saved) => ({ ...saved, managerId: manager.id })),
    games: state.games,
    stats: state.stats,
    playerNames: new Map(state.players.map((player) => [player.id, player.name])),
    teams: state.teams,
    config: season.config,
    launchedAt: season.launchedAt,
    now,
  })
  return {
    points: table.rows[0].points,
    weeks: weeks.flatMap(({ id, provisional, rows }) =>
      rows.map(({ points, selections }) => ({ id, provisional, points, selections }))
    ),
  }
}

/** The Manager's own locked Weeks of Predictions, with the games they were for. */
function pickemHistory(
  manager: ManagerIdentity,
  state: SeasonState,
  season: FantasySeason,
  predictions: Prediction[],
  now: Date
) {
  const { weeks, season: table } = buildPickemStandings({
    managers: [manager],
    predictions: predictions.map((p) => ({ ...p, managerId: manager.id })),
    games: state.games,
    config: season.config,
    launchedAt: season.launchedAt,
    now,
  })
  const total = table.rows[0]
  return {
    correct: total?.correct ?? 0,
    goalError: total?.goalError ?? 0,
    weeks: weeks.flatMap(({ id, provisional, rows }) =>
      rows.map(({ correct, goalError, predictions: made }) => ({
        id,
        provisional,
        correct,
        goalError,
        predictions: made,
        games: buildWeekOverview({
          weekId: id,
          games: state.games,
          teams: state.teams,
          config: season.config,
          launchedAt: season.launchedAt,
        }).games,
      }))
    ),
  }
}

export async function loadLineupForm(manager: ManagerIdentity, now = new Date()) {
  const context = await readManagerContext(manager)
  if (!context) return null
  const { season, state, predictions } = context

  const week = openWeek(now, season.config.lock)
  const { roster, uses, defaultGoalies, onBye } = capContext(state, season, week.id)
  const ids = roster.map((entry) => entry.playerId)
  const skaterUses = remainingUses(ids, "skater", uses.skater, season.config)
  const goalieUses = remainingUses(ids, "goalie", uses.goalie, season.config)

  const average = pointsPerGame(state.stats, state.games, season.config)

  return {
    teamName: manager.teamName,
    overview: buildWeekOverview({
      weekId: week.id,
      games: state.games,
      teams: state.teams,
      config: season.config,
      launchedAt: season.launchedAt,
    }),
    week: { id: week.id, lockAt: week.lockAt.toISOString(), timeZone: season.config.lock.timeZone },
    noGames: weekGames(state, season, week.id).length === 0,
    slots: season.config.lineup,
    players: state.players.map((player) => ({
      ...player,
      onBye: onBye.has(player.id),
      skaterUsesLeft: skaterUses.get(player.id) ?? null,
      goalieUsesLeft: goalieUses.get(player.id) ?? null,
      pointsPerGame: average.get(player.id) ?? 0,
    })),
    defaultGoalieIds: defaultGoalies,
    goalieSlotOptional: noGoalieAvailable(defaultGoalies, goalieUses, onBye),
    lineup: state.lineups.find((saved) => saved.weekId === week.id)?.lineup ?? null,
    history: managerHistory(manager, state, season, now),
    predictions,
    pickemHistory: pickemHistory(manager, state, season, predictions, now),
  }
}

/** Everything a Manager's pages are built from, or null if their season isn't set up. */
async function readManagerContext(manager: ManagerIdentity) {
  const [season, predictions] = await Promise.all([
    getFantasySeason(manager.seasonId, manager.contest),
    readManagerPredictions(manager.id),
  ])
  if (!season) return null
  return { season, state: await readSeasonState(manager, season.config.gameTypes), predictions }
}

/** A Manager's public page: Team Name and locked Weeks only, never the open Week. */
export async function loadPublicManager(manager: ManagerIdentity, now = new Date()) {
  const context = await readManagerContext(manager)
  if (!context) return null
  const { season, state, predictions } = context
  return {
    teamName: manager.teamName,
    history: managerHistory(manager, state, season, now),
    pickemHistory: pickemHistory(manager, state, season, predictions, now),
  }
}

export type LineupForm = NonNullable<Awaited<ReturnType<typeof loadLineupForm>>>

export type SaveResult =
  | { outcome: "saved" }
  | { outcome: "locked"; openWeekId: string }
  | { outcome: "no-games" }
  | { outcome: "invalid"; errors: LineupError[] }

/**
 * Saves a Manager's Lineup for the Week they were editing. A Week other than the open one
 * is refused, so a form left open past the Lock can't land in the following Week.
 */
export async function saveLineup(
  manager: ManagerIdentity,
  season: FantasySeason,
  weekId: string,
  lineup: Lineup,
  now = new Date()
): Promise<SaveResult> {
  const open = openWeek(now, season.config.lock)
  if (weekId !== open.id) return { outcome: "locked", openWeekId: open.id }

  const state = await readSeasonState(manager, season.config.gameTypes)
  if (weekGames(state, season, weekId).length === 0) return { outcome: "no-games" }

  const errors = validateLineup(lineup, capContext(state, season, weekId))
  if (errors.length > 0) return { outcome: "invalid", errors }

  const values = { ...lineup, updatedAt: now }
  await db
    .insert(fantasyLineups)
    .values({ managerId: manager.id, weekId, ...values })
    .onConflictDoUpdate({ target: [fantasyLineups.managerId, fantasyLineups.weekId], set: values })
  return { outcome: "saved" }
}

/**
 * Points the merged Player's slots at the surviving one. The first slot held by either id wins, scanning
 * starting slots (skaters, goalies) before Backups, so a starter is never lost to a Backup.
 * Like a save, a merge never leaves a Player in two slots. A Lineup that held both ends up one slot short:
 * a Backup if one of them was a Backup, otherwise a starter, which the Manager must refill before the Lock.
 */
export function replaceInLineup(lineup: Lineup, fromId: number, toId: number): Lineup {
  let seen = false
  const swap = (ids: number[]) =>
    ids.flatMap((id) => {
      if (id !== fromId && id !== toId) return [id]
      if (seen) return []
      seen = true
      return [toId]
    })
  // Object literal order is the slot order: starters first.
  return {
    skaters: swap(lineup.skaters),
    goalies: swap(lineup.goalies),
    skaterBackups: swap(lineup.skaterBackups),
    goalieBackups: swap(lineup.goalieBackups),
  }
}

/**
 * Keeps saved Lineups pointing at a live Player when a duplicate is merged away.
 * The Neon HTTP driver has no interactive transactions, so each update only applies if the Lineup is unchanged
 * since it was read (a concurrent save wins), and the function throws if any Lineup still holds the duplicate.
 * Re-running is safe: only Lineups still holding the duplicate are touched.
 */
export async function reassignLineupPlayer(fromId: number, toId: number) {
  const { skaters, goalies, skaterBackups, goalieBackups, managerId, weekId } = fantasyLineups
  const holdsPlayer = or(
    arrayContains(skaters, [fromId]),
    arrayContains(goalies, [fromId]),
    arrayContains(skaterBackups, [fromId]),
    arrayContains(goalieBackups, [fromId])
  )
  const affected = await db.select().from(fantasyLineups).where(holdsPlayer)
  for (const row of affected) {
    try {
      await db
        .update(fantasyLineups)
        .set(replaceInLineup(row, fromId, toId))
        .where(
          and(
            eq(managerId, row.managerId),
            eq(weekId, row.weekId),
            eq(skaters, row.skaters),
            eq(goalies, row.goalies),
            eq(skaterBackups, row.skaterBackups),
            eq(goalieBackups, row.goalieBackups)
          )
        )
    } catch (error) {
      console.error(`Could not move Lineup (manager ${row.managerId}, week ${row.weekId}) from player ${fromId} to ${toId}:`, error)
      throw error
    }
  }
  const remaining = await db.select({ managerId, weekId }).from(fantasyLineups).where(holdsPlayer)
  if (remaining.length > 0) {
    throw new Error(
      `${remaining.length} Lineup(s) still hold player ${fromId} after reassignment (changed concurrently?); re-run the merge`
    )
  }
}

/** The Manager's own saved Predictions, shown on their Manager Link page. */
export async function readManagerPredictions(managerId: number): Promise<Prediction[]> {
  return db
    .select({
      gameId: fantasyPredictions.gameId,
      homeScore: fantasyPredictions.homeScore,
      awayScore: fantasyPredictions.awayScore,
    })
    .from(fantasyPredictions)
    .where(eq(fantasyPredictions.managerId, managerId))
}
