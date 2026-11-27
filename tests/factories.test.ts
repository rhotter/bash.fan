import { sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { db, rawSql, schema } from "@/lib/db"
import { setupGame } from "./factories/setupGame"
import { setupGoalieGame } from "./factories/setupGoalieGame"
import { setupPlayer } from "./factories/setupPlayer"
import { setupPlayerGame } from "./factories/setupPlayerGame"
import { setupSeason } from "./factories/setupSeason"
import { setupTeam } from "./factories/setupTeam"

describe("test factories", () => {
  // Undeclared, `drizzle-kit push` would drop it from a database that has game IDs allocated.
  it("builds the game ID sequence from schema.ts", async () => {
    const rows = await rawSql(sql`SELECT to_regclass('games_gen_seq')::text AS name`)
    expect(rows[0].name).toBe("games_gen_seq")
  })

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

  it.each(["upcoming", "live"])("gives no score or boxscore by default to a game that is %s", async (status) => {
    const { season } = await setupSeason()
    const { team: homeTeam } = await setupTeam()
    const { team: awayTeam } = await setupTeam()

    const { game } = await setupGame({ season, homeTeam, awayTeam, status })
    expect([game.homeScore, game.awayScore, game.hasBoxscore]).toEqual([null, null, false])
  })

  it("records a Player's skater and goalie stats for a game", async () => {
    const { season } = await setupSeason()
    const { team: homeTeam } = await setupTeam()
    const { team: awayTeam } = await setupTeam()
    const { player } = await setupPlayer({ roster: [{ season, team: homeTeam }] })
    const { game } = await setupGame({ season, homeTeam, awayTeam })

    await setupPlayerGame({ player, game, goals: 2 })
    await setupGoalieGame({ player, game, saves: 20 })

    expect(await db.select().from(schema.playerSeasons)).toHaveLength(1)
    expect(await db.select().from(schema.playerGameStats)).toMatchObject([{ playerId: player.id, goals: 2 }])
    expect(await db.select().from(schema.goalieGameStats)).toMatchObject([{ playerId: player.id, saves: 20 }])
  })

  it("loads the functions and triggers that schema.ts can't express", async () => {
    const rows = await rawSql(sql`
      SELECT tgname AS name FROM pg_trigger WHERE NOT tgisinternal
      UNION ALL SELECT proname FROM pg_proc WHERE proname = 'check_operator_attempt'
    `)
    expect(rows.map((row) => row.name)).toEqual(
      expect.arrayContaining(["bash_live_push", "clear_legacy_game_pin", "check_operator_attempt"])
    )
  })

  it("leaves scores empty when a test passes null", async () => {
    const { season } = await setupSeason()
    const { team: homeTeam } = await setupTeam()
    const { team: awayTeam } = await setupTeam()

    const { game } = await setupGame({ season, homeTeam, awayTeam, status: "upcoming", homeScore: null, awayScore: null })
    expect([game.homeScore, game.awayScore]).toEqual([null, null])
  })
})

// These two run in order: the second checks what the reset before it cleared.
describe("test database reset", () => {
  const nextIds = async () => {
    const { player } = await setupPlayer()
    const [{ n }] = await rawSql(sql`SELECT nextval('games_gen_seq') AS n`)
    return [player.id, Number(n)]
  }

  it("starts ID sequences at 1", async () => {
    expect(await nextIds()).toEqual([1, 1])
  })

  it("empties tables and restarts ID sequences before the next test", async () => {
    expect(await db.select().from(schema.players)).toEqual([])
    expect(await nextIds()).toEqual([1, 1])
  })
})
