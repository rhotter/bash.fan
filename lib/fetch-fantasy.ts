import { and, eq, inArray } from "drizzle-orm"
import { db, schema } from "@/lib/db"
import { loadPublicManager, readSeasonGames, readSelectedStats, selectedPlayerIds, usesHeldForCap } from "@/lib/fantasy/lineups"
import { findManagerById, listPublicManagers } from "@/lib/fantasy/managers"
import { buildPickemStandings } from "@/lib/fantasy/pickem"
import { getCurrentFantasySeason, listCurrentFantasyContests, pickContest, type FantasySeason } from "@/lib/fantasy/season"
import { buildStandings } from "@/lib/fantasy/standings"
import { buildWeekOverview, openWeek } from "@/lib/fantasy/week"

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

function readSeasonTeams(seasonId: string) {
  return db
    .selectDistinct({ slug: teams.slug, name: teams.name })
    .from(playerSeasons)
    .innerJoin(teams, eq(teams.slug, playerSeasons.teamSlug))
    .where(eq(playerSeasons.seasonId, seasonId))
}

async function readStandingsInput(season: FantasySeason, now: Date) {
  const { seasonId, contest, config, launchedAt } = season
  const [managers, lineups, games, seasonTeams, predictions] = await Promise.all([
    listPublicManagers(seasonId, contest),
    readSeasonLineups(seasonId, contest),
    readSeasonGames(seasonId, config.gameTypes),
    readSeasonTeams(seasonId),
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
  return { managers, lineups, predictions, games, teams: seasonTeams, stats, playerNames, config, launchedAt, now }
}

/** The public /fantasy snapshot, or null while the game is off. Team Names only. */
export async function fetchFantasyStandings(contest?: string) {
  const now = new Date()
  const allContests = await listCurrentFantasyContests()
  const season = pickContest(allContests, contest)
  if (!season) return null
  const { config, launchedAt } = season
  const input = await readStandingsInput(season, now)
  const standings = buildStandings(input)
  const pickem = buildPickemStandings(input)
  const openWeekId = openWeek(now, config.lock).id
  // The open Week has no standings yet, but Managers need its games and Bye to choose against.
  const overviewWeekIds = [...new Set([...standings.weeks.map(({ id }) => id), openWeekId])].sort()
  const overviews = Object.fromEntries(
    overviewWeekIds.map((id) => [
      id,
      buildWeekOverview({ weekId: id, games: input.games, teams: input.teams, config, launchedAt }),
    ])
  )
  return {
    contest: season.contest,
    contests: allContests.map((c) => c.contest),
    nextLockAt: openWeek(now, config.lock).lockAt.toISOString(),
    timeZone: config.lock.timeZone,
    openWeekId,
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
  const openWeekId = openWeek(now, season.config.lock).id
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
          ({ managerId, weekId }) => managerId === row.managerId && weekId === openWeekId
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
  const season = await getCurrentFantasySeason(manager.contest)
  if (!season || season.seasonId !== manager.seasonId) return null
  const profile = await loadPublicManager(manager)
  return profile ? { ...profile, contest: season.contest } : null
}

export type FantasyManagerPageData = NonNullable<Awaited<ReturnType<typeof fetchFantasyManager>>>
