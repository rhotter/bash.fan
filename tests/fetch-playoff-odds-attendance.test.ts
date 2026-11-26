import { beforeEach, describe, expect, it, vi } from "vitest"
import { fetchPlayoffOdds } from "@/lib/fetch-playoff-odds"

const mockRawSql = vi.hoisted(() => vi.fn())
const mockGetSeasonById = vi.hoisted(() => vi.fn())
const mockGetCurrentSeason = vi.hoisted(() => vi.fn())

function extractSqlText(sqlObj: unknown): string {
  if (!sqlObj || typeof sqlObj !== "object") return String(sqlObj ?? "")
  const chunks = (sqlObj as { queryChunks?: unknown[] }).queryChunks
  if (!Array.isArray(chunks)) return ""
  return chunks
    .map((c) => {
      if (c && typeof c === "object" && "value" in c && Array.isArray((c as { value: unknown }).value)) {
        return (c as { value: string[] }).value.join("")
      }
      return "?"
    })
    .join("")
}

vi.mock("@/lib/db", () => ({
  rawSql: (...args: unknown[]) => mockRawSql(...args),
}))

vi.mock("@/lib/seasons", () => ({
  getSeasonById: (...args: unknown[]) => mockGetSeasonById(...args),
  getCurrentSeason: (...args: unknown[]) => mockGetCurrentSeason(...args),
}))

describe("fetchPlayoffOdds parallel attendance query", () => {
  beforeEach(() => {
    mockRawSql.mockReset()
    mockGetSeasonById.mockReset()
    mockGetCurrentSeason.mockReset()
    mockGetCurrentSeason.mockResolvedValue({
      id: "bash-2026-2027",
      name: "BASH 2026-2027",
      seasonType: "fall",
      status: "active",
      playoffTeams: 2,
    })
  })

  it("executes all 3 DB queries in a single parallel Promise.all wave and populates attendance + fullStrength", async () => {
    const scheduleRows = [
      {
        id: "g1",
        date: "2026-10-10",
        time: "9:00am",
        location: "The Lick",
        away_slug: "kings",
        away_name: "Kings",
        home_slug: "seals",
        home_name: "Seals",
        away_score: 2,
        home_score: 4,
        status: "final",
        is_overtime: false,
        has_shootout: false,
        is_forfeit: false,
        is_playoff: false,
        game_type: "regular",
      },
      {
        id: "g2",
        date: "2026-10-17",
        time: "9:00am",
        location: "The Lick",
        away_slug: "kings",
        away_name: "Kings",
        home_slug: "seals",
        home_name: "Seals",
        away_score: 3,
        home_score: 4,
        status: "final",
        is_overtime: false,
        has_shootout: false,
        is_forfeit: false,
        is_playoff: false,
        game_type: "regular",
      },
      {
        id: "g3-ff",
        date: "2026-10-20",
        time: "9:00am",
        location: "The Lick",
        away_slug: "kings",
        away_name: "Kings",
        home_slug: "seals",
        home_name: "Seals",
        away_score: 0,
        home_score: 5,
        status: "final",
        is_overtime: false,
        has_shootout: false,
        is_forfeit: true,
        is_playoff: false,
        game_type: "regular",
      },
      {
        id: "g4-up",
        date: "2026-10-24",
        time: "9:00am",
        location: "The Lick",
        away_slug: "seals",
        away_name: "Seals",
        home_slug: "kings",
        home_name: "Kings",
        away_score: null,
        home_score: null,
        status: "upcoming",
        is_overtime: false,
        has_shootout: false,
        is_forfeit: false,
        is_playoff: false,
        game_type: "regular",
      },
      {
        id: "g5-live",
        date: "2026-10-24",
        time: "11:00am",
        location: "The Lick",
        away_slug: "kings",
        away_name: "Kings",
        home_slug: "seals",
        home_name: "Seals",
        away_score: 1,
        home_score: 1,
        status: "live",
        is_overtime: false,
        has_shootout: false,
        is_forfeit: false,
        is_playoff: false,
        game_type: "regular",
      },
    ]
    const colorRows = [
      { team_slug: "kings", color: "#111111" },
      { team_slug: "seals", color: "#222222" },
    ]
    const attendanceRows = [
      // g1: complete two-sided boxscores (8 vs 13)
      { game_id: "g1", team_slug: "kings", skaters: 7, dressed: 8 },
      { game_id: "g1", team_slug: "seals", skaters: 12, dressed: 13 },
      // g2: kings has 0 skaters (only goalie stub) -> ignored; seals has 13 dressed
      { game_id: "g2", team_slug: "kings", skaters: 0, dressed: 1 },
      { game_id: "g2", team_slug: "seals", skaters: 12, dressed: 13 },
      // g3-ff: even if rows exist, forfeit games must stay null
      { game_id: "g3-ff", team_slug: "seals", skaters: 10, dressed: 11 },
      // g4-up: upcoming game must stay null
      { game_id: "g4-up", team_slug: "kings", skaters: 9, dressed: 10 },
      // g5-live: live game must stay null
      { game_id: "g5-live", team_slug: "kings", skaters: 10, dressed: 11 },
    ]

    let resolveSchedule!: (rows: unknown[]) => void
    let resolveColors!: (rows: unknown[]) => void
    let resolveAttendance!: (rows: unknown[]) => void

    mockRawSql
      .mockImplementationOnce(() => new Promise((r) => { resolveSchedule = r }))
      .mockImplementationOnce(() => new Promise((r) => { resolveColors = r }))
      .mockImplementationOnce(() => new Promise((r) => { resolveAttendance = r }))

    const snapshotPromise = fetchPlayoffOdds(null, "weighted")
    // Allow getCurrentSeason() microtask to resolve and launch Promise.all
    await new Promise<void>((r) => { setTimeout(r, 0) })

    // All 3 rawSql queries must have been dispatched simultaneously before any resolves
    expect(mockRawSql).toHaveBeenCalledTimes(3)
    const attendanceSql = extractSqlText(mockRawSql.mock.calls[2][0])
    expect(attendanceSql).toContain("UNION ALL")
    expect(attendanceSql).toContain("player_game_stats")
    expect(attendanceSql).toContain("goalie_game_stats")
    expect(attendanceSql).toContain("COUNT(DISTINCT")
    expect(attendanceSql).toContain("NOT g.is_forfeit")
    expect(attendanceSql).toContain("team_slug IS NOT NULL")
    expect(attendanceSql).toContain("g.status = 'final'")
    expect(attendanceSql).toContain("g.id NOT LIKE 'test-%'")

    resolveSchedule(scheduleRows)
    resolveColors(colorRows)
    resolveAttendance(attendanceRows)

    const snapshot = await snapshotPromise

    const byId = Object.fromEntries(snapshot.regularGames.map((g) => [g.id, g]))
    expect(byId.g1.awayAttendance).toBe(8)
    expect(byId.g1.homeAttendance).toBe(13)
    expect(byId.g2.awayAttendance).toBeNull()
    expect(byId.g2.homeAttendance).toBe(13)
    expect(byId["g3-ff"].awayAttendance).toBeNull()
    expect(byId["g3-ff"].homeAttendance).toBeNull()
    expect(byId["g4-up"].awayAttendance).toBeNull()
    expect(byId["g4-up"].homeAttendance).toBeNull()
    expect(byId["g5-live"].awayAttendance).toBeNull()
    expect(byId["g5-live"].homeAttendance).toBeNull()

    const teamsBySlug = Object.fromEntries(snapshot.teams.map((t) => [t.slug, t]))
    expect(teamsBySlug.kings.avgAttendance).toBe(8)
    expect(teamsBySlug.kings.attendanceTier).toBe("low")
    expect(teamsBySlug.kings.fullStrength).toBeGreaterThan(teamsBySlug.kings.strength)

    expect(teamsBySlug.seals.avgAttendance).toBe(13)
    expect(teamsBySlug.seals.attendanceTier).toBe("high")
    expect(teamsBySlug.seals.fullStrength).toBeLessThan(teamsBySlug.seals.strength)
  })
})
