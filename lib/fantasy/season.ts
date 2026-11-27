import { and, asc, desc, eq } from "drizzle-orm"
import { db, schema } from "@/lib/db"
import { DEFAULT_CONTEST } from "./view-state"
import { checkFantasyConfig, type FantasyConfig } from "./config"
import { endsBeforeFirstWeek, firstWeekId, runStatus, takesRegistrations } from "./week"

export { DEFAULT_CONTEST, parseContest } from "./view-state"

export interface FantasySeason {
  seasonId: string
  contest: string
  config: FantasyConfig
  launchedAt: Date
}

const { fantasyLineups, fantasyManagers, fantasyPredictions, fantasySeasons } = schema

type ContestRow = typeof fantasySeasons.$inferSelect

const invalidMessage = (row: ContestRow, issues: string[]) =>
  `Stored Fantasy config for ${row.seasonId}/${row.contest} is invalid: ${issues.join("; ")}`

/** The config column is jsonb, so a hand-edited row could hold anything. Fail loudly, naming the row, rather than mis-scoring. */
function toFantasySeason(row: ContestRow): FantasySeason {
  const checked = checkFantasyConfig(row.config)
  if (!checked.ok) throw new Error(invalidMessage(row, checked.issues))
  return { ...row, config: checked.config }
}

async function readContestRow(seasonId: string, contest: string): Promise<ContestRow | undefined> {
  const [row] = await db
    .select()
    .from(fantasySeasons)
    .where(and(eq(fantasySeasons.seasonId, seasonId), eq(fantasySeasons.contest, contest)))
  return row
}

export async function getFantasySeason(seasonId: string, contest = DEFAULT_CONTEST): Promise<FantasySeason | null> {
  const row = await readContestRow(seasonId, contest)
  return row ? toFantasySeason(row) : null
}

/** A contest as stored, for the admin, who has to be able to see and replace a config that isn't valid. */
export async function getStoredContest(seasonId: string, contest: string) {
  const row = await readContestRow(seasonId, contest)
  if (!row) return null
  const checked = checkFantasyConfig(row.config)
  // Read loosely, so the closing day stays protected even when the rest of the config is broken.
  const dayOfWeek = (row.config as { lock?: { dayOfWeek?: unknown } } | null)?.lock?.dayOfWeek
  return {
    launchedAt: row.launchedAt,
    stored: row.config as unknown,
    dayOfWeek: typeof dayOfWeek === "number" ? dayOfWeek : null,
    ...(checked.ok
      ? { season: { ...row, config: checked.config }, issues: null }
      : { season: null, issues: checked.issues }),
  }
}

async function readContests(seasonId: string) {
  const rows = await db
    .select()
    .from(fantasySeasons)
    .where(eq(fantasySeasons.seasonId, seasonId))
    .orderBy(asc(fantasySeasons.launchedAt), asc(fantasySeasons.contest))
  const valid: FantasySeason[] = []
  const invalid: string[] = []
  for (const row of rows) {
    const checked = checkFantasyConfig(row.config)
    if (checked.ok) valid.push({ ...row, config: checked.config })
    else {
      console.error(invalidMessage(row, checked.issues))
      invalid.push(row.contest)
    }
  }
  const start = (season: FantasySeason) => firstWeekId(season.config, season.launchedAt)
  // The sort is stable, so runs starting the same Week keep the query's order.
  valid.sort((a, b) => start(a).localeCompare(start(b)))
  return { valid, invalid }
}

/**
 * Every contest turned on for a season in the order they start, then the order they were turned on.
 * One with an invalid stored config is logged and left out, so it can't take the others down with it.
 */
export async function listFantasyContests(seasonId: string): Promise<FantasySeason[]> {
  return (await readContests(seasonId)).valid
}

/** For the admin: the key of every contest turned on, including any whose config needs repair, which come last. */
export async function listContestKeys(seasonId: string) {
  const { valid, invalid } = await readContests(seasonId)
  return [...valid.map((season) => season.contest), ...invalid]
}

/** Every contest of the current season that an admin has turned on, in the order of `listFantasyContests`. */
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
 * A contest of the current season, once an admin has turned it on. With no key it's the default: the first
 * current run to have started, so `/fantasy` keeps showing the regular season while the playoffs run beside it.
 * With none current it's the next upcoming one.
 */
export async function getCurrentFantasySeason(contest?: string, now = new Date()): Promise<FantasySeason | null> {
  return pickContest(await listCurrentFantasyContests(), contest, now)
}

/** The named contest, or the default when none is named. Takes contests in the order they start. */
export function pickContest(contests: FantasySeason[], contest?: string, now = new Date()) {
  if (contest !== undefined) return contests.find((c) => c.contest === contest) ?? null
  const withStatus = contests.map((season) => ({ season, status: runStatus(season.config, now) }))
  const current = withStatus.find(({ status }) => status === "active" || status === "final-week")
  const upcoming = withStatus.find(({ status }) => status === "upcoming")
  // With every run over, the latest is the one people are most likely after.
  return (current ?? upcoming)?.season ?? contests.at(-1) ?? null
}

const isJoinable = (season: FantasySeason, now: Date) => takesRegistrations(runStatus(season.config, now))

/**
 * The contest a registration is for, shared by the page and the API so they can't disagree. A named contest
 * is returned even once closed, so the caller can say so. With none named it's the default among those still
 * taking people, not one playing its last Week. With every contest closed it's the overall default.
 */
export function pickRegistrationContest(contests: FantasySeason[], contest?: string, now = new Date()) {
  if (contest !== undefined) return pickContest(contests, contest, now)
  const joinable = contests.filter((season) => isJoinable(season, now))
  return pickContest(joinable.length > 0 ? joinable : contests, undefined, now)
}

export interface OpenContest {
  contest: string
}

/** The contests people can join now, apart from `except`. Plain data for the page cache. */
export function otherOpenContests(contests: FantasySeason[], except: string, now = new Date()): OpenContest[] {
  return contests
    .filter((season) => season.contest !== except && isJoinable(season, now))
    .map(({ contest }) => ({ contest }))
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

/** Whether any Manager has made a Prediction, which a config change can drop from the standings too. */
export async function hasPredictions(seasonId: string, contest = DEFAULT_CONTEST) {
  const [prediction] = await db
    .select({ managerId: fantasyPredictions.managerId })
    .from(fantasyPredictions)
    .innerJoin(fantasyManagers, eq(fantasyManagers.id, fantasyPredictions.managerId))
    .where(and(eq(fantasyManagers.seasonId, seasonId), eq(fantasyManagers.contest, contest)))
    .limit(1)
  return prediction !== undefined
}

/**
 * Whether any saved Lineup would be left off this closing day. A Lineup's `week_id` is its closing day's date,
 * so one on another weekday matches no Week: it stops scoring and its uses are forgotten.
 */
export async function hasLineupsOffDay(seasonId: string, contest: string, dayOfWeek: number) {
  const rows = await db
    .selectDistinct({ weekId: fantasyLineups.weekId })
    .from(fantasyLineups)
    .innerJoin(fantasyManagers, eq(fantasyManagers.id, fantasyLineups.managerId))
    .where(and(eq(fantasyManagers.seasonId, seasonId), eq(fantasyManagers.contest, contest)))
  return rows.some(({ weekId }) => new Date(`${weekId}T00:00:00Z`).getUTCDay() !== dayOfWeek)
}

/**
 * Turns the game on, or replaces the config. Allowed after Lineups exist: standings are derived from the
 * config on every read, so a change re-scores every Week. `launchedAt` keeps its first value.
 * Throws on an invalid config, so a bad one can never be stored.
 */
export async function saveFantasyConfig(seasonId: string, contest: string, config: FantasyConfig, now: Date) {
  const checked = checkFantasyConfig(config)
  if (!checked.ok) throw new Error(`Invalid Fantasy config: ${checked.issues.join("; ")}`)
  const existing = await readContestRow(seasonId, contest)
  const endIssue = endsBeforeFirstWeek(checked.config, existing?.launchedAt ?? now)
  if (endIssue) throw new Error(`Invalid Fantasy config: ${endIssue}`)
  await db
    .insert(fantasySeasons)
    .values({ seasonId, contest, config: checked.config, launchedAt: now })
    .onConflictDoUpdate({ target: [fantasySeasons.seasonId, fantasySeasons.contest], set: { config: checked.config } })
}
