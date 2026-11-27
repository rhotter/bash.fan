import { describe, expect, it } from "vitest"
import { setupGame } from "./factories/setupGame"
import { setupSeason } from "./factories/setupSeason"
import { setupTeam } from "./factories/setupTeam"

describe("test factories", () => {
  it("derives a team's slug from its name, and lets a test choose either", async () => {
    const { team } = await setupTeam({ name: "Rink Rats" })
    expect(team).toEqual({ slug: "rink-rats", name: "Rink Rats" })

    const { team: chosen } = await setupTeam({ slug: "chosen", name: "Another Name" })
    expect(chosen.slug).toBe("chosen")
  })

  it("never ties a game's score, even when a test sets one side", async () => {
    const { season } = await setupSeason()
    const { team: homeTeam } = await setupTeam()
    const { team: awayTeam } = await setupTeam()

    for (let i = 0; i < 40; i++) {
      const { game } = await setupGame({ season, homeTeam, awayTeam })
      expect(game.homeScore).not.toBe(game.awayScore)
      const { game: oneSide } = await setupGame({ season, homeTeam, awayTeam, awayScore: 3 })
      expect(oneSide.awayScore).toBe(3)
      expect(oneSide.homeScore).not.toBe(3)
    }
  })

  it("leaves scores empty when a test passes null", async () => {
    const { season } = await setupSeason()
    const { team: homeTeam } = await setupTeam()
    const { team: awayTeam } = await setupTeam()

    const { game } = await setupGame({ season, homeTeam, awayTeam, status: "upcoming", homeScore: null, awayScore: null })
    expect([game.homeScore, game.awayScore]).toEqual([null, null])
  })
})
