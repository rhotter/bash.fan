import { afterEach, describe, expect, it, vi } from "vitest"
import { syncDatabase } from "../scripts/export-prod-db"

const denied = () => Object.assign(new Error("permission denied"), { code: "42501" })

type Rows = Record<string, unknown>[]

/** A tagged-template client that answers from the first matching entry, and records every query. */
function fakeClient(answer: (query: string) => Rows = () => []) {
  const queries: string[] = []
  const client = async (strings: TemplateStringsArray) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim()
    queries.push(query)
    return answer(query)
  }
  return { client: client as never, queries }
}

/** A source with one game, where reading any of `unreadable` is denied. */
function source(unreadable: string[], rows: Record<string, Rows> = {}) {
  return fakeClient((query) => {
    const table = /FROM (\w+)/.exec(query)?.[1] ?? ""
    if (unreadable.includes(table)) throw denied()
    return rows[table] ?? (table === "games" ? [{ id: "g1" }] : [])
  })
}

const writesTo = (queries: string[], table: string) =>
  queries.filter((query) => new RegExp(`(DELETE FROM|INSERT INTO|UPDATE) ${table}\\b`).test(query))

describe("syncDatabase with a restricted source role", () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([
    "game_officials",
    "adhoc_game_rosters",
    "game_live",
    "player_awards",
    "franchises",
    "draft_instances",
    "season_trades",
  ])("leaves the target's %s alone and reports it as skipped", async (table) => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const dev = fakeClient()

    await expect(syncDatabase(source([table]).client, dev.client, ["s"])).resolves.toEqual([table])

    expect(writesTo(dev.queries, table)).toEqual([])
  })

  it("reports nothing skipped when everything can be read, even after a run that skipped", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    await syncDatabase(source(["game_live"]).client, fakeClient().client, ["s"])

    await expect(syncDatabase(source([]).client, fakeClient().client, ["s"])).resolves.toEqual([])
  })

  it("prints skipped, not zero, in the counts", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})

    await syncDatabase(
      source(["game_officials", "game_live", "player_awards", "season_trades"]).client,
      fakeClient().client,
      ["s"]
    )

    const counts = log.mock.calls.map(([line]) => String(line)).find((line) => line.includes("Games:"))
    for (const label of ["Live States", "Officials", "Awards", "Trades", "Trade Items"]) {
      expect(counts).toContain(`${label}: skipped`)
    }
  })

  it("says which placeholder franchises it created", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const seasonTeams = [
      { season_id: "s", team_slug: "new", franchise_slug: "new-franchise" },
      { season_id: "s", team_slug: "old", franchise_slug: "existing-franchise" },
    ]
    // Like Postgres, ON CONFLICT DO NOTHING returns a row only for the franchise that was missing.
    let inserts = 0
    const dev = fakeClient((query) =>
      query.startsWith("INSERT INTO franchises") && inserts++ === 0 ? [{ slug: "new-franchise" }] : []
    )

    await syncDatabase(source(["franchises"], { season_teams: seasonTeams }).client, dev.client, ["s"])

    const placeholders = log.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("placeholder"))
    expect(placeholders).toHaveLength(1)
    expect(placeholders[0]).toContain("new-franchise")
  })
})
