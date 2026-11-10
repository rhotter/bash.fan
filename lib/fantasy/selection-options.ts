import type { LineupForm } from "./lineups"
import type { WeekOverview } from "./week"

export interface SelectionOption {
  id: number
  name: string
  /** Slugs of the teams the Player is rostered on this season. */
  teams: string[]
  isGoalie: boolean
  onBye: boolean
  /** Uses left for the slot being filled, or null when the Usage Cap doesn't apply. */
  usesLeft: number | null
  pointsPerGame: number
}

export interface SelectionOptionRow {
  id: number
  name: string
  usesLeft: number | null
  pointsPerGame: number
  disabled: boolean
}

export interface SelectionGroup {
  gameId: string
  label: string
  teams: { slug: string; name: string; players: SelectionOptionRow[] }[]
}

/** Players on a Bye can't score, so they're left out. Teams and games with nobody left are dropped. */
export function buildSelectionGroups(overview: WeekOverview, players: SelectionOption[], query = ""): SelectionGroup[] {
  const needle = query.trim().toLowerCase()
  const eligible = players.filter((p) => !p.onBye && p.name.toLowerCase().includes(needle))

  return overview.games
    .map((game) => ({
      gameId: game.id,
      label: `${game.home.name} vs ${game.away.name} · ${game.startLabel}`,
      teams: [game.home, game.away]
        .map((team) => ({
          slug: team.slug,
          name: team.name,
          players: eligible
            .filter((p) => p.teams.includes(team.slug))
            .map(({ id, name, usesLeft, pointsPerGame }) => ({
              id,
              name,
              usesLeft,
              pointsPerGame,
              disabled: usesLeft === 0,
            })),
        }))
        .filter((team) => team.players.length > 0),
    }))
    .filter((group) => group.teams.length > 0)
}

interface SlotQuery {
  players: LineupForm["players"]
  goalieSlot: boolean
  /** Players already chosen in any slot of the Lineup. */
  chosen: Set<number>
  /** The Player in the slot being edited, who stays on offer. */
  current: number | null
  defaultGoalieIds: Set<number>
  everyGoalie: boolean
}

/** Who can fill one slot, shaped for the sheet. The Usage Cap shown is that slot kind's. */
export function playersForSlot({ players, goalieSlot, chosen, current, defaultGoalieIds, everyGoalie }: SlotQuery): SelectionOption[] {
  return players
    .filter((player) => {
      if (player.id === current) return true
      if (chosen.has(player.id)) return false
      return goalieSlot ? everyGoalie || defaultGoalieIds.has(player.id) : !player.isGoalie
    })
    .map((player) => ({
      id: player.id,
      name: player.name,
      teams: player.teams,
      isGoalie: player.isGoalie,
      onBye: player.onBye,
      usesLeft: goalieSlot ? player.goalieUsesLeft : player.skaterUsesLeft,
      pointsPerGame: player.pointsPerGame,
    }))
}
