import type { FantasyConfig } from "./config"
import type { SavedLineup, SeasonGame } from "./lineups"
import {
  gameState,
  rankByPoints,
  scoreWeek,
  selectionGameLines,
  type ScoredSelection,
  type SelectionGameLine,
  type WeekStats,
} from "./scoring"
import type { TeamRef } from "./week"
import { countsForGame, gameWeekId, weekContaining } from "./week"

export interface StandingsInput {
  /** Pass Team Names only. Nothing else about a Manager belongs in public standings. */
  managers: { id: number; teamName: string }[]
  lineups: (SavedLineup & { managerId: number })[]
  games: SeasonGame[]
  stats: WeekStats
  playerNames: Map<number, string>
  /** Names the matchups in each Selection's game lines. */
  teams: TeamRef[]
  config: FantasyConfig
  launchedAt: Date
  now: Date
}

export interface PublicGameLine extends SelectionGameLine {
  matchup: string
}

export interface PublicSelection extends ScoredSelection {
  playerName: string
  /** The scored games behind `points`. Empty for a Selection that didn't play. */
  games: PublicGameLine[]
}

export interface SeasonRow {
  rank: number
  /** Public on purpose: the Manager page URL uses it, since Team Names can be renamed. */
  managerId: number
  teamName: string
  points: number
}

export interface WeekRow extends SeasonRow {
  selections: PublicSelection[]
}

export interface StandingsWeek {
  id: string
  /** True while a game in the Week hasn't been scored, so the result can still change. */
  provisional: boolean
  /** Only Managers who submitted a Lineup for the Week. */
  rows: WeekRow[]
}

/** Plain data: this is stored in the page cache, so it has to survive JSON. */
export interface FantasyStandings {
  /** Locked Weeks with counting games, oldest first. */
  weeks: StandingsWeek[]
  season: { provisional: boolean; rows: SeasonRow[] }
}

function ranked<T extends { managerId: number; teamName: string; points: number }>(rows: T[]) {
  return rankByPoints([...rows].sort((a, b) => a.teamName.localeCompare(b.teamName)))
}

/** Derived from the current stats on every call. Lineups outside a locked Week never appear. */
export function buildStandings(input: StandingsInput): FantasyStandings {
  const { managers, lineups, games, stats, playerNames, teams, config, launchedAt, now } = input
  const teamNames = new Map(teams.map(({ slug, name }) => [slug, name]))
  const teamLabel = (slug: string) => teamNames.get(slug) ?? slug
  const lastLockedWeek = weekContaining(now, config.lock).id

  const gamesByWeek = new Map<string, SeasonGame[]>()
  for (const game of games) {
    if (!countsForGame(game, launchedAt, config.lock)) continue
    const weekId = gameWeekId(game, config.lock)
    if (weekId > lastLockedWeek) continue
    gamesByWeek.set(weekId, [...(gamesByWeek.get(weekId) ?? []), game])
  }

  // A Selection can outlive its Player row. Show a placeholder, but leave a trail.
  const nameOf = (playerId: number) => {
    const name = playerNames.get(playerId)
    if (name === undefined) console.warn(`Fantasy standings: no Player ${playerId} for a Selection`)
    return name ?? "Unknown"
  }

  const managerNames = new Map(managers.map((manager) => [manager.id, manager.teamName]))
  const seasonPoints = new Map(managers.map((manager) => [manager.id, 0]))

  // A Selection that didn't play, or a Backup who wasn't needed, scored nothing to show.
  const gameLines = ({ playerId, kind }: ScoredSelection, weekGames: SeasonGame[]) =>
    selectionGameLines(playerId, kind, stats, weekGames, config).map((line) => {
      const game = weekGames.find(({ id }) => id === line.gameId)
      if (!game) throw new Error(`Scored game ${line.gameId} is not among the games of its Week`)
      return { ...line, matchup: `${teamLabel(game.homeTeam)} vs ${teamLabel(game.awayTeam)}` }
    })

  const weeks = [...gamesByWeek.keys()].sort().map((id): StandingsWeek => {
    const weekGames = gamesByWeek.get(id)!
    const rows = lineups.flatMap(({ managerId, weekId, lineup }) => {
      const managerName = managerNames.get(managerId)
      if (weekId !== id || managerName === undefined) return []
      const { points, selections } = scoreWeek(lineup, stats, weekGames, config)
      seasonPoints.set(managerId, (seasonPoints.get(managerId) ?? 0) + points)
      return [
        {
          managerId,
          teamName: managerName,
          points,
          selections: selections.map((s): PublicSelection => ({
            ...s,
            playerName: nameOf(s.playerId),
            games: s.outcome === "played" ? gameLines(s, weekGames) : [],
          })),
        },
      ]
    })
    return {
      id,
      provisional: weekGames.some((game) => gameState(game) === "pending"),
      rows: ranked(rows),
    }
  })

  return {
    weeks,
    season: {
      provisional: weeks.some((week) => week.provisional),
      rows: ranked(managers.map(({ id, teamName }) => ({ managerId: id, teamName, points: seasonPoints.get(id)! }))),
    },
  }
}
