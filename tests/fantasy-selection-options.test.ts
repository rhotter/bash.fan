import { describe, expect, it } from "vitest"
import type { WeekOverview } from "@/lib/fantasy/week"
import type { LineupForm } from "@/lib/fantasy/lineups"
import { buildSelectionGroups, playersForSlot, type SelectionOption } from "@/lib/fantasy/selection-options"

const overview: WeekOverview = {
  weekId: "2026-11-07",
  games: [
    {
      id: "g1",
      home: { slug: "seals", name: "Seals" },
      away: { slug: "yetis", name: "Yetis" },
      startLabel: "Sat 9:00a",
      result: null,
    },
  ],
  byeTeams: [{ slug: "owls", name: "Owls" }],
}

const player = (id: number, name: string, teams: string[], overrides: Partial<SelectionOption> = {}): SelectionOption => ({
  id,
  name,
  teams,
  isGoalie: false,
  onBye: false,
  usesLeft: 3,
  pointsPerGame: 4.5,
  ...overrides,
})

describe("buildSelectionGroups", () => {
  it("groups Players by Week game, then team, with uses left and points per game", () => {
    const groups = buildSelectionGroups(overview, [
      player(1, "Ada", ["seals"]),
      player(2, "Bo", ["yetis"], { usesLeft: 0, pointsPerGame: 6 }),
    ])

    expect(groups).toEqual([
      {
        gameId: "g1",
        label: "Seals vs Yetis · Sat 9:00a",
        teams: [
          {
            slug: "seals",
            name: "Seals",
            players: [{ id: 1, name: "Ada", usesLeft: 3, pointsPerGame: 4.5, disabled: false }],
          },
          {
            slug: "yetis",
            name: "Yetis",
            players: [{ id: 2, name: "Bo", usesLeft: 0, pointsPerGame: 6, disabled: true }],
          },
        ],
      },
    ])
  })

  it("filters by name ignoring case and drops teams and games with no match", () => {
    const players = [player(1, "Ada Lovelace", ["seals"]), player(2, "Bo", ["yetis"])]

    const [group] = buildSelectionGroups(overview, players, "LOVE")
    expect(group.teams.map((t) => [t.slug, t.players.map((p) => p.name)])).toEqual([["seals", ["Ada Lovelace"]]])
    expect(buildSelectionGroups(overview, players, "zzz")).toEqual([])
  })

  it("leaves out Players on a Bye", () => {
    const [group] = buildSelectionGroups(overview, [player(1, "Ada", ["seals"], { onBye: true }), player(2, "Bo", ["seals"])])

    expect(group.teams[0].players.map((p) => p.name)).toEqual(["Bo"])
  })
})

describe("playersForSlot", () => {
  const rostered = (
    id: number,
    isGoalie: boolean,
    overrides: Partial<LineupForm["players"][number]> = {}
  ): LineupForm["players"][number] => ({
    id,
    name: `Player ${id}`,
    team: "Seals",
    teams: ["seals"],
    isGoalie,
    onBye: false,
    skaterUsesLeft: 2,
    goalieUsesLeft: 3,
    pointsPerGame: 5,
    ...overrides,
  })
  const players = [rostered(1, false), rostered(2, false), rostered(7, true), rostered(8, true)]
  const base = { players, chosen: new Set<number>(), current: null, defaultGoalieIds: new Set([7]), everyGoalie: false }
  const ids = (list: SelectionOption[]) => list.map((p) => p.id)

  it("offers skaters, not flagged goalies, for a skater slot with that slot's uses left", () => {
    const offered = playersForSlot({ ...base, goalieSlot: false })

    expect(ids(offered)).toEqual([1, 2])
    expect(offered[0]).toMatchObject({ usesLeft: 2, pointsPerGame: 5 })
  })

  it("offers only the default goalies for a goalie slot, or every Player when asked", () => {
    expect(ids(playersForSlot({ ...base, goalieSlot: true }))).toEqual([7])
    expect(ids(playersForSlot({ ...base, goalieSlot: true, everyGoalie: true }))).toEqual([1, 2, 7, 8])
    expect(playersForSlot({ ...base, goalieSlot: true })[0].usesLeft).toBe(3)
  })

  it("leaves out Players chosen in other slots but keeps the slot's own Player", () => {
    const offered = playersForSlot({ ...base, goalieSlot: false, chosen: new Set([1, 2]), current: 1 })

    expect(ids(offered)).toEqual([1])
  })

  it("keeps the current goalie even when they're not a default goalie", () => {
    const offered = playersForSlot({ ...base, goalieSlot: true, chosen: new Set([8]), current: 8 })

    expect(ids(offered)).toEqual([7, 8])
  })
})
