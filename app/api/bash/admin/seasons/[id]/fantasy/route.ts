import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"
import { db, schema } from "@/lib/db"
import { fetchFantasyOverview } from "@/lib/fetch-fantasy"
import { checkFantasyConfig, DEFAULT_FANTASY_CONFIG } from "@/lib/fantasy/config"
import { listManagers } from "@/lib/fantasy/managers"
import { refreshPublicPages, reply } from "@/lib/fantasy/reply"
import {
  DEFAULT_CONTEST,
  getFantasySeason,
  hasLineups,
  listFantasyContests,
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
    const [season, lineupsExist, managers, contests] = await Promise.all([
      getFantasySeason(id, contest),
      hasLineups(id, contest),
      listManagers(id, contest),
      listFantasyContests(id),
    ])
    return reply({
      contest,
      contests: contests.map((c) => c.contest),
      enabled: season !== null,
      config: season?.config ?? DEFAULT_FANTASY_CONFIG,
      launchedAt: season?.launchedAt ?? null,
      hasLineups: lineupsExist,
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
    // A request with no config turns a contest on with the defaults. It never resets one that's already on.
    if (body.config === undefined && (await getFantasySeason(id, contest))) {
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

    await saveFantasyConfig(id, contest, config, new Date())
    refreshPublicPages()
    return reply({ contest, config })
  } catch (error) {
    console.error("Failed to save Fantasy config:", error)
    return reply({ error: "Could not save the config." }, 500)
  }
}
