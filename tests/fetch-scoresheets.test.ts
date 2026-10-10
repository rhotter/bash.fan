import { describe, expect, it, vi, beforeEach } from "vitest"
import { fetchBatchScoresheets } from "@/lib/fetch-scoresheets"
import * as dbModule from "@/lib/db"

vi.mock("@/lib/db", () => ({
  rawSql: vi.fn(),
  db: {
    select: vi.fn(),
  },
  schema: {
    playerSeasons: {
      teamSlug: "team_slug",
      seasonId: "season_id",
      playerId: "player_id",
      isCaptain: "is_captain",
      isGoalie: "is_goalie",
    },
    players: {
      id: "id",
      name: "name",
    },
    adhocGameRosters: {
      gameId: "game_id",
      teamSide: "team_side",
      playerId: "player_id",
      isSub: "is_sub",
    },
    gameOfficials: {
      gameId: "game_id",
      name: "name",
      role: "role",
    },
  },
}))

describe("fetchBatchScoresheets helper", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns null when season does not exist", async () => {
    vi.mocked(dbModule.rawSql).mockResolvedValueOnce([])

    const result = await fetchBatchScoresheets("non-existent-season")
    expect(result).toBeNull()
  })

  it("returns empty games array when no remaining games are found", async () => {
    // 1st rawSql call: season query
    vi.mocked(dbModule.rawSql).mockResolvedValueOnce([{ id: "2026-fall", name: "2026 Fall" }])
    // 2nd rawSql call: games query (no remaining games)
    vi.mocked(dbModule.rawSql).mockResolvedValueOnce([])

    const result = await fetchBatchScoresheets("2026-fall")
    expect(result).not.toBeNull()
    expect(result?.season).toEqual({ id: "2026-fall", name: "2026 Fall" })
    expect(result?.games).toEqual([])
  })

  it("sorts games chronologically by date and time (10:00am before 1:00pm)", async () => {
    // Season
    vi.mocked(dbModule.rawSql).mockResolvedValueOnce([{ id: "2026-fall", name: "2026 Fall" }])
    // Games in mixed order
    vi.mocked(dbModule.rawSql).mockResolvedValueOnce([
      {
        id: "g2",
        date: "2026-10-15",
        time: "1:00pm",
        home_slug: "team-a",
        away_slug: "team-b",
        home_name: "Team A",
        away_name: "Team B",
        season_name: "2026 Fall",
        season_id: "2026-fall",
      },
      {
        id: "g1",
        date: "2026-10-15",
        time: "10:00am",
        home_slug: "team-c",
        away_slug: "team-d",
        home_name: "Team C",
        away_name: "Team D",
        season_name: "2026 Fall",
        season_id: "2026-fall",
      },
      {
        id: "g0",
        date: "2026-10-10",
        time: "8:00pm",
        home_slug: "team-a",
        away_slug: "team-c",
        home_name: "Team A",
        away_name: "Team C",
        season_name: "2026 Fall",
        season_id: "2026-fall",
      },
    ])

    // Mock drizzle select chains for playerSeasons, adhocGameRosters, gameOfficials
    const mockSelect = vi.fn()
    vi.mocked(dbModule.db.select).mockImplementation(mockSelect)

    // Call 1: playerSeasons
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              { teamSlug: "team-a", name: "Alice", isCaptain: true, isGoalie: false },
              { teamSlug: "team-b", name: "Bob", isCaptain: false, isGoalie: true },
            ]),
          }),
        }),
      }),
    })

    // Call 2: adhocGameRosters
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              { gameId: "g0", teamSide: "home", name: "Sub Charlie", isSub: true },
            ]),
          }),
        }),
      }),
    })

    // Call 3: gameOfficials
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { gameId: "g0", name: "Ref John", role: "ref" },
        ]),
      }),
    })

    const result = await fetchBatchScoresheets("2026-fall")
    expect(result).not.toBeNull()
    expect(result?.games.length).toBe(3)

    // Check chronological order: g0 (Oct 10 8pm), then g1 (Oct 15 10am), then g2 (Oct 15 1pm)
    expect(result?.games[0].game.id).toBe("g0")
    expect(result?.games[1].game.id).toBe("g1")
    expect(result?.games[2].game.id).toBe("g2")

    // Check roster combination for g0 home: Alice + Sub Charlie (sorted by name ASC)
    const g0Home = result?.games[0].homeRoster
    expect(g0Home).toEqual([
      { name: "Alice", is_captain: true, is_goalie: false, is_sub: false },
      { name: "Sub Charlie", is_captain: false, is_goalie: false, is_sub: true },
    ])

    // Check officials for g0
    expect(result?.games[0].officials).toEqual([
      { name: "Ref John", role: "ref" },
    ])
  })

  it("deduplicates players in mergeScoresheetRosters when a player is in both season and adhoc rosters", async () => {
    const { mergeScoresheetRosters } = await import("@/lib/fetch-scoresheets")
    const seasonRoster = [
      { name: "Sam Veteran", is_captain: true, is_goalie: false, is_sub: false },
      { name: "Alex Goalie", is_captain: false, is_goalie: true, is_sub: false },
    ]
    const adhocRoster = [
      { name: "Sam Veteran", is_captain: false, is_goalie: false, is_sub: true },
      { name: "Guest Player", is_captain: false, is_goalie: false, is_sub: true },
    ]

    const merged = mergeScoresheetRosters(seasonRoster, adhocRoster)
    expect(merged.length).toBe(3)
    // Sam Veteran preserved captain flag and updated sub flag
    const sam = merged.find((p) => p.name === "Sam Veteran")
    expect(sam).toBeDefined()
    expect(sam?.is_captain).toBe(true)
    expect(sam?.is_sub).toBe(true)
  })

  it("trims player names and handles URI-encoded season ID", async () => {
    const { mergeScoresheetRosters } = await import("@/lib/fetch-scoresheets")
    const seasonRoster = [
      { name: "  Trimmed Player  ", is_captain: true, is_goalie: false, is_sub: false },
    ]
    const adhocRoster = [
      { name: "Trimmed Player", is_captain: false, is_goalie: false, is_sub: false },
    ]
    const merged = mergeScoresheetRosters(seasonRoster, adhocRoster)
    expect(merged.length).toBe(1)
    expect(merged[0].name).toBe("Trimmed Player")
    expect(merged[0].is_captain).toBe(true)

    // URI-encoded season ID lookup
    vi.mocked(dbModule.rawSql).mockResolvedValueOnce([{ id: "2026 Fall", name: "2026 Fall" }])
    vi.mocked(dbModule.rawSql).mockResolvedValueOnce([])
    const result = await fetchBatchScoresheets("2026%20Fall")
    expect(result).not.toBeNull()
    expect(result?.season.name).toBe("2026 Fall")
  })

  it("sorts 12:00am before 12:00pm, 1:00pm, 11:30pm, and places missing dates last", async () => {
    vi.mocked(dbModule.rawSql).mockResolvedValueOnce([{ id: "2026-fall", name: "2026 Fall" }])
    vi.mocked(dbModule.rawSql).mockResolvedValueOnce([
      { id: "g_missing_date", date: "", time: "10:00am", home_slug: "a", away_slug: "b", home_name: "A", away_name: "B", season_name: "S", season_id: "s" },
      { id: "g_1130pm", date: "2026-10-15", time: "11:30pm", home_slug: "a", away_slug: "b", home_name: "A", away_name: "B", season_name: "S", season_id: "s" },
      { id: "g_1200pm", date: "2026-10-15", time: "12:00pm", home_slug: "a", away_slug: "b", home_name: "A", away_name: "B", season_name: "S", season_id: "s" },
      { id: "g_1200am", date: "2026-10-15", time: "12:00am", home_slug: "a", away_slug: "b", home_name: "A", away_name: "B", season_name: "S", season_id: "s" },
      { id: "g_100pm", date: "2026-10-15", time: "1:00pm", home_slug: "a", away_slug: "b", home_name: "A", away_name: "B", season_name: "S", season_id: "s" },
      { id: "g_tbd", date: "2026-10-15", time: "TBD", home_slug: "a", away_slug: "b", home_name: "A", away_name: "B", season_name: "S", season_id: "s" },
    ])

    const mockSelect = vi.fn()
    vi.mocked(dbModule.db.select).mockImplementation(mockSelect)
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
        where: vi.fn().mockResolvedValue([]),
      }),
    })

    const result = await fetchBatchScoresheets("2026-fall")
    expect(result).not.toBeNull()
    const gameIds = result?.games.map((g) => g.game.id)
    // Order on Oct 15: 12:00am (00:00) -> 12:00pm (12:00) -> 1:00pm (13:00) -> 11:30pm (23:30) -> TBD (23:59)
    // Followed by missing date (9999-99-99)
    expect(gameIds).toEqual([
      "g_1200am",
      "g_1200pm",
      "g_100pm",
      "g_1130pm",
      "g_tbd",
      "g_missing_date",
    ])
  })

  it("merges season and adhoc rosters case-insensitively without duplicating players", async () => {
    const { mergeScoresheetRosters } = await import("@/lib/fetch-scoresheets")
    const seasonRoster = [
      { name: "John Doe", is_captain: true, is_goalie: false, is_sub: false },
    ]
    const adhocRoster = [
      { name: "john doe", is_captain: false, is_goalie: true, is_sub: true },
      { name: "Jane Smith", is_captain: false, is_goalie: false, is_sub: false },
    ]

    const merged = mergeScoresheetRosters(seasonRoster, adhocRoster)
    expect(merged.length).toBe(2)
    const john = merged.find((p) => p.name.toLowerCase() === "john doe")
    expect(john).toBeDefined()
    expect(john?.is_captain).toBe(true)
    expect(john?.is_goalie).toBe(true)
    expect(john?.is_sub).toBe(true)
  })
})

describe("toHHMM and normalizeTimeForStorage utilities", () => {
  it("accurately converts 12am/12pm edge cases and shorthand", async () => {
    const { toHHMM, normalizeTimeForStorage } = await import("@/lib/format-time")

    // 12am midnight
    expect(toHHMM("12:00am")).toBe("00:00")
    expect(toHHMM("12:15am")).toBe("00:15")
    expect(toHHMM("12:00a")).toBe("00:00")

    // 12pm noon
    expect(toHHMM("12:00pm")).toBe("12:00")
    expect(toHHMM("12:30pm")).toBe("12:30")
    expect(toHHMM("12:00p")).toBe("12:00")

    // Afternoon and evening
    expect(toHHMM("1:00pm")).toBe("13:00")
    expect(toHHMM("1:15pm")).toBe("13:15")
    expect(toHHMM("11:30pm")).toBe("23:30")
    expect(toHHMM("9:00p")).toBe("21:00")
    expect(toHHMM("6:00a")).toBe("06:00")

    // Whitespace handling and 24h with optional seconds
    expect(toHHMM(" 8:00pm ")).toBe("20:00")
    expect(toHHMM("14:00:00")).toBe("14:00")
    expect(toHHMM("09:00")).toBe("09:00")

    // Invalid times
    expect(toHHMM("13:00pm")).toBe("")
    expect(toHHMM("9:65pm")).toBe("")
    expect(toHHMM("25:00")).toBe("")
    expect(toHHMM("TBD")).toBe("")
    expect(toHHMM("")).toBe("")
    expect(toHHMM(null)).toBe("")
    expect(toHHMM(undefined)).toBe("")

    // normalizeTimeForStorage validation
    expect(normalizeTimeForStorage(" 8:00pm ")).toBe("8:00pm")
    expect(normalizeTimeForStorage("12:00am")).toBe("12:00am")
    expect(normalizeTimeForStorage("12:00pm")).toBe("12:00pm")
    expect(normalizeTimeForStorage("14:00")).toBe("2:00pm")
    expect(normalizeTimeForStorage("09:00")).toBe("9:00am")
    expect(normalizeTimeForStorage("13:00pm")).toBe("13:00pm") // fallback as-is
  })
})

