import { and, asc, desc, eq } from "drizzle-orm"
import { db, schema } from "@/lib/db"
import { DEFAULT_CONTEST } from "./view-state"
import { checkFantasyConfig, type FantasyConfig } from "./config"

export { DEFAULT_CONTEST, parseContest } from "./view-state"

export interface FantasySeason {
  seasonId: string
  contest: string
  config: FantasyConfig
  launchedAt: Date
}

const { fantasyLineups, fantasyManagers, fantasySeasons } = schema

/** The config column is jsonb, so a hand-edited row could hold anything. Fail loudly, naming the row, rather than mis-scoring. */
function toFantasySeason(row: typeof fantasySeasons.$inferSelect): FantasySeason {
  const checked = checkFantasyConfig(row.config)
  if (!checked.ok) {
    throw new Error(`Stored Fantasy config for ${row.seasonId}/${row.contest} is invalid: ${checked.issues.join("; ")}`)
  }
  return { ...row, config: checked.config }
}

export async function getFantasySeason(seasonId: string, contest = DEFAULT_CONTEST): Promise<FantasySeason | null> {
  const [row] = await db
    .select()
    .from(fantasySeasons)
    .where(and(eq(fantasySeasons.seasonId, seasonId), eq(fantasySeasons.contest, contest)))
  return row ? toFantasySeason(row) : null
}

/** Every contest turned on for a season, the one launched first at the front. */
export async function listFantasyContests(seasonId: string): Promise<FantasySeason[]> {
  const rows = await db
    .select()
    .from(fantasySeasons)
    .where(eq(fantasySeasons.seasonId, seasonId))
    .orderBy(asc(fantasySeasons.launchedAt), asc(fantasySeasons.contest))
  return rows.map(toFantasySeason)
}

/** Every contest of the current season that an admin has turned on, the one launched first at the front. */
export async function listCurrentFantasyContests(): Promise<FantasySeason[]> {
  const [row] = await db
    .select({ seasonId: fantasySeasons.seasonId })
    .from(fantasySeasons)
    .innerJoin(schema.seasons, eq(schema.seasons.id, fantasySeasons.seasonId))
    .where(eq(schema.seasons.isCurrent, true))
    .orderBy(desc(schema.seasons.id))
    .limit(1)
  return row ? listFantasyContests(row.seasonId) : []
}

/**
 * A contest of the current season, once an admin has turned it on. With no key it's the first one
 * launched, so `/fantasy` keeps showing the regular season while the playoffs run beside it.
 */
export async function getCurrentFantasySeason(contest?: string): Promise<FantasySeason | null> {
  return pickContest(await listCurrentFantasyContests(), contest)
}

/** The named contest, or the first launched when none is named. */
export function pickContest(contests: FantasySeason[], contest?: string) {
  return (contest === undefined ? contests[0] : contests.find((c) => c.contest === contest)) ?? null
}

/** Whether any Manager has saved a Lineup, so a config change would re-score real Selections. */
export async function hasLineups(seasonId: string, contest = DEFAULT_CONTEST) {
  const [lineup] = await db
    .select({ managerId: fantasyLineups.managerId })
    .from(fantasyLineups)
    .innerJoin(fantasyManagers, eq(fantasyManagers.id, fantasyLineups.managerId))
    .where(and(eq(fantasyManagers.seasonId, seasonId), eq(fantasyManagers.contest, contest)))
    .limit(1)
  return lineup !== undefined
}

/**
 * Turns the game on, or replaces the config. Allowed after Lineups exist: standings are derived from the
 * config on every read, so a change re-scores every Week. `launchedAt` keeps its first value.
 * Throws on an invalid config, so a bad one can never be stored.
 */
export async function saveFantasyConfig(seasonId: string, contest: string, config: FantasyConfig, now: Date) {
  const checked = checkFantasyConfig(config)
  if (!checked.ok) throw new Error(`Invalid Fantasy config: ${checked.issues.join("; ")}`)
  await db
    .insert(fantasySeasons)
    .values({ seasonId, contest, config: checked.config, launchedAt: now })
    .onConflictDoUpdate({ target: [fantasySeasons.seasonId, fantasySeasons.contest], set: { config: checked.config } })
}
