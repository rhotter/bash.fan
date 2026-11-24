import { describe, it, expect, vi, beforeEach } from "vitest"
import type { BashGame } from "@/lib/hockey-data"
import { buildBracketRounds, hasBracketMetadata, normalizeRound } from "@/lib/playoff-bracket-utils"

const { mockFetchBashData, mockGetCurrentSeason, mockGenerateOGImage, mockGeneratePlayoffBracketOGImage } = vi.hoisted(() => ({
  mockFetchBashData: vi.fn(),
  mockGetCurrentSeason: vi.fn(),
  mockGenerateOGImage: vi.fn(() => new Response("og-default", { headers: { "content-type": "image/png" } })),
  mockGeneratePlayoffBracketOGImage: vi.fn(() => new Response("og-bracket", { headers: { "content-type": "image/png" } })),
}))

vi.mock("@/lib/fetch-bash-data", () => ({
  fetchBashData: mockFetchBashData,
}))

vi.mock("@/lib/seasons", () => ({
  getCurrentSeason: mockGetCurrentSeason,
}))

vi.mock("@/lib/og-image", () => ({
  generateOGImage: mockGenerateOGImage,
  generatePlayoffBracketOGImage: mockGeneratePlayoffBracketOGImage,
}))

import { GET as getScheduleOG } from "@/app/api/bash/og/schedule/route"

function makePlayoffGame(overrides: Partial<BashGame> = {}): BashGame {
  return {
    id: "pg1",
    date: "2027-04-17",
    time: "11:00am",
    homeTeam: "No ReGretzkys",
    homeSlug: "no-regretzkys",
    awayTeam: "Seals",
    awaySlug: "seals",
    homeScore: null,
    awayScore: null,
    status: "upcoming",
    isOvertime: false,
    isPlayoff: true,
    isForfeit: false,
    location: "The Lick",
    hasBoxscore: false,
    hasLiveStats: false,
    livePeriod: null,
    liveClockSeconds: null,
    liveClockRunning: null,
    liveClockStartedAt: null,
    gameType: "playoff",
    hasShootout: false,
    homePlaceholder: null,
    awayPlaceholder: null,
    seriesId: "sf-a",
    seriesGameNumber: 1,
    bracketRound: "semifinal",
    title: null,
    ...overrides,
  }
}

describe("playoff-bracket-utils", () => {
  it("normalizes round names and detects bracket metadata", () => {
    expect(normalizeRound("play-in")).toBe("play-in")
    expect(normalizeRound("Quarterfinals")).toBe("quarterfinal")
    expect(normalizeRound("Semifinals")).toBe("semifinal")
    expect(normalizeRound("Championship")).toBe("final")
    expect(normalizeRound("unknown")).toBeNull()

    expect(hasBracketMetadata([makePlayoffGame({ seriesId: null, bracketRound: null })])).toBe(false)
    expect(hasBracketMetadata([makePlayoffGame()])).toBe(true)
  })

  it("orders rounds, tallies wins across swapped home/away, and avoids premature clinch on 2-game series", () => {
    const games: BashGame[] = [
      makePlayoffGame({
        id: "f1",
        bracketRound: "final",
        seriesId: "final",
        awayTeam: "TBD",
        awaySlug: "tbd",
        awayPlaceholder: "Winner SF-A",
        homeTeam: "TBD",
        homeSlug: "tbd",
        homePlaceholder: "Winner SF-B",
      }),
      makePlayoffGame({
        id: "pi1",
        bracketRound: "play-in",
        seriesId: "play-in",
        awayTeam: "Yetis",
        awaySlug: "yetis",
        homeTeam: "Reign",
        homeSlug: "reign",
        awayScore: 3,
        homeScore: 2,
        status: "final",
      }),
      makePlayoffGame({
        id: "qf1",
        bracketRound: "quarterfinal",
        seriesId: "qf-a",
      }),
      // Best-of-3 with only 2 games scheduled so far; Seals win G1, G2 unplayed -> NOT clinched
      makePlayoffGame({
        id: "sf1",
        bracketRound: "semifinal",
        seriesId: "sf-a",
        seriesGameNumber: 1,
        awayTeam: "Seals",
        awaySlug: "seals",
        homeTeam: "No ReGretzkys",
        homeSlug: "no-regretzkys",
        awayScore: 4,
        homeScore: 2,
        status: "final",
      }),
      makePlayoffGame({
        id: "sf2",
        bracketRound: "semifinal",
        seriesId: "sf-a",
        seriesGameNumber: 2,
        awayTeam: "No ReGretzkys",
        awaySlug: "no-regretzkys",
        homeTeam: "Seals",
        homeSlug: "seals",
        status: "upcoming",
      }),
    ]

    const rounds = buildBracketRounds(games)
    expect(rounds.map((r) => r.round)).toEqual(["play-in", "quarterfinal", "semifinal", "final"])
    expect(rounds[0].series[0].clinchedBy).toBe("top")

    const sfSeries = rounds[2].series[0]
    expect(sfSeries.top.wins).toBe(1)
    expect(sfSeries.bottom.wins).toBe(0)
    expect(sfSeries.clinchedBy).toBeNull()
  })

  it("resolves team identity from later games if G1 is TBD", () => {
    const games: BashGame[] = [
      makePlayoffGame({
        id: "g1-tbd",
        seriesGameNumber: 1,
        awayTeam: "TBD",
        awaySlug: "tbd",
        awayPlaceholder: "Play-in Winner",
        homeTeam: "No ReGretzkys",
        homeSlug: "no-regretzkys",
        status: "upcoming",
      }),
      makePlayoffGame({
        id: "g2-resolved",
        seriesGameNumber: 2,
        awayTeam: "Yetis",
        awaySlug: "yetis",
        homeTeam: "No ReGretzkys",
        homeSlug: "no-regretzkys",
        awayScore: 5,
        homeScore: 1,
        status: "final",
      }),
    ]

    const rounds = buildBracketRounds(games)
    expect(rounds[0].series[0].top.name).toBe("Yetis")
    expect(rounds[0].series[0].top.wins).toBe(1)
  })

  it("does not duplicate a team when G1 is partially TBD and G2 swaps home/away", () => {
    const games: BashGame[] = [
      makePlayoffGame({
        id: "g1-partial",
        seriesGameNumber: 1,
        awayTeam: "TBD",
        awaySlug: "tbd",
        awayPlaceholder: "Play-in Winner",
        homeTeam: "No ReGretzkys",
        homeSlug: "no-regretzkys",
        status: "upcoming",
      }),
      makePlayoffGame({
        id: "g2-swapped",
        seriesGameNumber: 2,
        awayTeam: "No ReGretzkys",
        awaySlug: "no-regretzkys",
        homeTeam: "Yetis",
        homeSlug: "yetis",
        awayScore: 2,
        homeScore: 4,
        status: "final",
      }),
    ]

    const rounds = buildBracketRounds(games)
    const series = rounds[0].series[0]
    expect(series.top.slug).toBe("yetis")
    expect(series.top.wins).toBe(1)
    expect(series.bottom.slug).toBe("no-regretzkys")
    expect(series.bottom.wins).toBe(0)
  })
})

describe("GET /api/bash/og/schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCurrentSeason.mockResolvedValue({ name: "2026-2027" })
    mockFetchBashData.mockResolvedValue({ games: [makePlayoffGame()], standings: [], lastUpdated: "" })
  })

  it("renders Season Schedule OG for non-playoff requests", async () => {
    const res = await getScheduleOG(new Request("http://localhost:3000/api/bash/og/schedule"))
    expect(res.headers.get("content-type")).toBe("image/png")
    expect(mockGenerateOGImage).toHaveBeenCalledWith("Season Schedule", "bayareastreethockey.com")
  })

  it("renders Playoff Bracket OG and normalizes season=all", async () => {
    const res = await getScheduleOG(new Request("http://localhost:3000/api/bash/og/schedule?season=all&gameType=playoff"))
    expect(res.headers.get("content-type")).toBe("image/png")
    expect(mockFetchBashData).toHaveBeenCalledWith(undefined)
    expect(mockGeneratePlayoffBracketOGImage).toHaveBeenCalledWith(expect.any(Array), "Fall 2026–27")
  })
})
