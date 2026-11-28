import { and, eq, inArray } from "drizzle-orm"
import { db, schema } from "@/lib/db"
import { loadPublicManager, readSeasonGames, readSelectedStats, selectedPlayerIds, usesHeldForCap } from "@/lib/fantasy/lineups"
import { findManagerById, listPublicManagers } from "@/lib/fantasy/managers"
import { buildPickemStandings } from "@/lib/fantasy/pickem"
import { listCurrentFantasyContests, otherOpenContests, pickContest, type FantasySeason } from "@/lib/fantasy/season"
import { buildStandings } from "@/lib/fantasy/standings"
import { buildWeekOverview, openWeek, pickableWeeks, runStatus } from "@/lib/fantasy/week"

const { fantasyLineups, fantasyManagers, fantasyPredictions, playerSeasons, players, teams } = schema

async function readSeasonLineups(seasonId: string, contest: string) {
  const rows = await db
    .select({
      managerId: fantasyLineups.managerId,
      weekId: fantasyLineups.weekId,
      skaters: fantasyLineups.skaters,
      goalies: fantasyLineups.goalies,
      skaterBackups: fantasyLineups.skaterBackups,
      goalieBackups: fantasyLineups.goalieBackups,
    })
    .from(fantasyLineups)
    .innerJoin(fantasyManagers, eq(fantasyManagers.id, fantasyLineups.managerId))
    .where(and(eq(fantasyManagers.seasonId, seasonId), eq(fantasyManagers.contest, contest)))
  return rows.map(({ managerId, weekId, ...lineup }) => ({ managerId, weekId, lineup }))
}

/** Every Prediction in one Contest of the season. Only locked Weeks may reach a public response. */
async function readSeasonPredictions(seasonId: string, contest: string) {
  return db
    .select({
      managerId: fantasyPredictions.managerId,
      gameId: fantasyPredictions.gameId,
      homeScore: fantasyPredictions.homeScore,
      awayScore: fantasyPredictions.awayScore,
    })
    .from(fantasyPredictions)
    .innerJoin(fantasyManagers, eq(fantasyManagers.id, fantasyPredictions.managerId))
    .where(and(eq(fantasyManagers.seasonId, seasonId), eq(fantasyManagers.contest, contest)))
}

/** One row for each team a Player has been on this season. */
function readSeasonRosters(seasonId: string) {
  return db
    .select({ playerId: playerSeasons.playerId, slug: teams.slug, name: teams.name })
    .from(playerSeasons)
    .innerJoin(teams, eq(teams.slug, playerSeasons.teamSlug))
    .where(eq(playerSeasons.seasonId, seasonId))
    .orderBy(teams.name)
}

async function readStandingsInput(season: FantasySeason, now: Date) {
  const { seasonId, contest, config, launchedAt } = season
  const [managers, lineups, games, rosters, predictions] = await Promise.all([
    listPublicManagers(seasonId, contest),
    readSeasonLineups(seasonId, contest),
    readSeasonGames(seasonId, config.gameTypes),
    readSeasonRosters(seasonId),
    readSeasonPredictions(seasonId, contest),
  ])
  // Which Players matter depends on the Lineups, so these reads follow the ones above.
  const [stats, names] = await Promise.all([
    readSelectedStats(seasonId, config.gameTypes, lineups),
    db
      .select({ id: players.id, name: players.name })
      .from(players)
      .where(inArray(players.id, selectedPlayerIds(lineups))),
  ])
  const playerNames = new Map(names.map(({ id, name }) => [id, name]))
  const seasonTeams = [...new Map(rosters.map(({ slug, name }) => [slug, { slug, name }])).values()]
  const playerTeams = new Map<number, string[]>()
  for (const { playerId, slug } of rosters) playerTeams.set(playerId, [...(playerTeams.get(playerId) ?? []), slug])
  return { managers, lineups, predictions, games, teams: seasonTeams, playerTeams, stats, playerNames, config, launchedAt, now }
}

/** The public /fantasy snapshot, or null while the game is off. Team Names only. */
export async function fetchFantasyStandings(contest?: string) {
  const now = new Date()
  const allContests = await listCurrentFantasyContests()
  const season = pickContest(allContests, contest, now)
  if (!season) return null
  const { config, launchedAt } = season
  const input = await readStandingsInput(season, now)
  const standings = buildStandings(input)
  const pickem = buildPickemStandings(input)
  const status = runStatus(config, now)
  const [nextPick] = pickableWeeks(input.games, launchedAt, config, now)
  const nextWeek = nextPick ?? openWeek(now, config.lock)
  // The next Week to pick has no standings yet, but Managers need its games and Bye to choose against.
  // A run under way with nothing left to pick shows the open Week, which says it has no games.
  const showsNextWeek = nextPick !== undefined || status === "active"
  const overviewWeekIds = [
    ...new Set([...standings.weeks.map(({ id }) => id), ...(showsNextWeek ? [nextWeek.id] : [])]),
  ].sort()
  const overviews = Object.fromEntries(
    overviewWeekIds.map((id) => [
      id,
      buildWeekOverview({ weekId: id, games: input.games, teams: input.teams, config, launchedAt }),
    ])
  )
  return {
    status,
    contest: season.contest,
    contests: allContests.map((c) => c.contest),
    otherOpenContests: otherOpenContests(allContests, season.contest, now),
    nextLockAt: nextWeek.lockAt.toISOString(),
    timeZone: config.lock.timeZone,
    /** The soonest Week still taking picks. */
    openWeekId: nextWeek.id,
    overviews,
    ...standings,
    pickem,
  }
}

/** Admin-only: every Manager's locked Weeks, plus uses held against the cap. */
export async function fetchFantasyOverview(season: FantasySeason) {
  const now = new Date()
  const input = await readStandingsInput(season, now)
  const { weeks, season: table } = buildStandings(input)
  const [nextPick] = pickableWeeks(input.games, season.launchedAt, season.config, now)
  const playerNames = input.playerNames

  return {
    weeks: weeks.map(({ id, provisional }) => ({ id, provisional })),
    managers: table.rows.map((row) => {
      const managerWeeks = weeks.flatMap(({ id, provisional, rows }) =>
        rows
          .filter(({ managerId }) => managerId === row.managerId)
          .map(({ points, selections }) => ({ id, provisional, points, selections }))
      )
      const held = usesHeldForCap(managerWeeks)
      const uses = (["skater", "goalie"] as const).flatMap((kind) =>
        [...held[kind]].map(([playerId, used]) => ({
          playerId,
          playerName: playerNames.get(playerId) ?? (console.warn(`Fantasy standings: no Player ${playerId} for a cap use`), "Unknown"),
          kind,
          used,
          cap: season.config.usageCap[kind],
        }))
      )
      return {
        ...row,
        weeks: managerWeeks,
        uses: uses.sort((a, b) => b.used - a.used || a.playerName.localeCompare(b.playerName)),
        openWeekSubmitted: input.lineups.some(
          ({ managerId, weekId }) => managerId === row.managerId && weekId === nextPick?.id
        ),
      }
    }),
  }
}

export type FantasyOverview = Awaited<ReturnType<typeof fetchFantasyOverview>>

export type FantasyPageData = NonNullable<Awaited<ReturnType<typeof fetchFantasyStandings>>>

/**
 * A Manager's public page data, or null while the game is off or for an id outside the current season.
 * A Manager belongs to one contest, so that's the contest the page is about.
 */
export async function fetchFantasyManager(managerId: number) {
  const manager = await findManagerById(managerId)
  if (!manager) return null
  const contests = await listCurrentFantasyContests()
  const season = pickContest(contests, manager.contest)
  if (!season || season.seasonId !== manager.seasonId) return null
  const profile = await loadPublicManager(manager)
  return profile ? { ...profile, contest: season.contest, multipleContests: contests.length > 1 } : null
}

export type FantasyManagerPageData = NonNullable<Awaited<ReturnType<typeof fetchFantasyManager>>>
