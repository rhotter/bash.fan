import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"
import { db, schema } from "@/lib/db"
import { fetchFantasyOverview } from "@/lib/fetch-fantasy"
import { checkFantasyConfig, DEFAULT_FANTASY_CONFIG } from "@/lib/fantasy/config"
import { listManagers } from "@/lib/fantasy/managers"
import { refreshPublicPages, reply } from "@/lib/fantasy/reply"
import { endsBeforeFirstWeek, picksOpenAt, runStatus } from "@/lib/fantasy/week"
import {
  DEFAULT_CONTEST,
  getStoredContest,
  hasLineups,
  hasLineupsOffDay,
  hasPredictions,
  listContestKeys,
  parseContest,
  saveFantasyConfig,
} from "@/lib/fantasy/season"

type Context = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Context) {
  if (!(await getSession())) return reply({ error: "Unauthorized" }, 401)
  const { id } = await params
  const contest = parseContest(new URL(request.url).searchParams.get("contest") ?? DEFAULT_CONTEST)
  if (!contest) return reply({ error: "That contest isn't valid." }, 400)
  try {
    const [existing, lineupsExist, predictionsExist, managers, contests] = await Promise.all([
      getStoredContest(id, contest),
      hasLineups(id, contest),
      hasPredictions(id, contest),
      listManagers(id, contest),
      listContestKeys(id),
    ])
    const season = existing?.season ?? null
    return reply({
      contest,
      contests,
      enabled: existing !== null,
      // Set when the stored config can't be used, so the admin can see why and save a replacement.
      configIssues: existing?.issues ?? null,
      storedConfig: existing?.issues ? existing.stored : null,
      status: season ? runStatus(season.config, new Date()) : null,
      picksOpenAt: season ? (picksOpenAt(season.config)?.toISOString() ?? null) : null,
      config: season?.config ?? DEFAULT_FANTASY_CONFIG,
      launchedAt: season?.launchedAt ?? null,
      hasLineups: lineupsExist,
      hasPredictions: predictionsExist,
      managers,
      overview: season ? await fetchFantasyOverview(season) : null,
    })
  } catch (error) {
    console.error("Failed to load Fantasy admin data:", error)
    return reply({ error: "Could not load Fantasy." }, 500)
  }
}

/** Turns the game on, or replaces the config. Still allowed once Lineups exist. */
export async function PUT(request: Request, { params }: Context) {
  if (!(await getSession())) return reply({ error: "Unauthorized" }, 401)
  const { id } = await params
  try {
    const body = await request.json().catch(() => null)
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return reply({ error: "That config isn't valid." }, 400)
    }
    const contest = parseContest(body.contest ?? DEFAULT_CONTEST)
    if (!contest) return reply({ error: "That contest isn't valid. Use letters, numbers and dashes." }, 400)
    // Not parsed, so a valid config can replace one that no longer passes.
    const existing = await getStoredContest(id, contest)
    // A request with no config turns a contest on with the defaults. It never resets one that's already on.
    if (body.config === undefined && existing) {
      return reply({ error: "Send the config to change it. This contest is already on." }, 400)
    }
    const checked = checkFantasyConfig(body.config === undefined ? DEFAULT_FANTASY_CONFIG : body.config)
    if (!checked.ok) return reply({ error: "That config isn't valid.", issues: checked.issues }, 400)
    const { config } = checked

    const [season] = await db
      .select({ id: schema.seasons.id })
      .from(schema.seasons)
      .where(eq(schema.seasons.id, id))
    if (!season) return reply({ error: "Season not found" }, 404)

    const now = new Date()
    const endIssue = endsBeforeFirstWeek(config, existing?.launchedAt ?? now)
    if (endIssue) return reply({ error: "That config isn't valid.", issues: [endIssue] }, 400)

    // Changing back to the day the Lineups were saved under stays allowed.
    const { dayOfWeek } = config.lock
    if (existing && dayOfWeek !== existing.dayOfWeek && (await hasLineupsOffDay(id, contest, dayOfWeek))) {
      return reply(
        { error: "That config isn't valid.", issues: ["lock.dayOfWeek: The closing day can't change once Lineups are saved"] },
        400
      )
    }

    await saveFantasyConfig(id, contest, config, now)
    refreshPublicPages()
    return reply({ contest, config })
  } catch (error) {
    console.error("Failed to save Fantasy config:", error)
    return reply({ error: "Could not save the config." }, 500)
  }
}
