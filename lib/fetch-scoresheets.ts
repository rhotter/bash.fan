import { cache } from "react"
import { db, schema, rawSql } from "@/lib/db"
import { eq, inArray, sql } from "drizzle-orm"
import { toHHMM } from "@/lib/format-time"
import type { ScoresheetGameData, ScoresheetRosterPlayer, ScoresheetOfficial } from "@/components/admin/game-scoresheet"

export interface BatchScoresheetGameItem {
  game: ScoresheetGameData
  homeRoster: ScoresheetRosterPlayer[]
  awayRoster: ScoresheetRosterPlayer[]
  officials: ScoresheetOfficial[]
}

export interface BatchScoresheetsResult {
  season: {
    id: string
    name: string
  }
  games: BatchScoresheetGameItem[]
}

export function mergeScoresheetRosters(
  seasonRoster: ScoresheetRosterPlayer[],
  adhocRoster: ScoresheetRosterPlayer[]
): ScoresheetRosterPlayer[] {
  const map = new Map<string, ScoresheetRosterPlayer>()
  for (const player of seasonRoster) {
    const name = player.name?.trim() || ""
    if (name) map.set(name, { ...player, name })
  }
  for (const player of adhocRoster) {
    const name = player.name?.trim() || ""
    if (!name) continue
    const existing = map.get(name)
    if (existing) {
      map.set(name, {
        name,
        is_captain: existing.is_captain || player.is_captain,
        is_goalie: existing.is_goalie || player.is_goalie,
        is_sub: player.is_sub ?? existing.is_sub,
      })
    } else {
      map.set(name, { ...player, name })
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchBatchScoresheetsInternal(seasonId: string): Promise<BatchScoresheetsResult | null> {
  let normalizedId: string
  try {
    normalizedId = decodeURIComponent(seasonId)
  } catch {
    normalizedId = seasonId
  }

  const seasonRows = await rawSql(sql`
    SELECT id, name FROM seasons WHERE id = ${normalizedId} OR id = ${seasonId} LIMIT 1
  `)
  const season = seasonRows[0] as { id: string; name: string } | undefined
  if (!season) return null

  const gameRows = await rawSql(sql`
    SELECT
      g.id, g.date, g.time, g.location, g.is_playoff,
      g.game_type, g.status, g.notes,
      g.home_team AS home_slug, g.away_team AS away_slug,
      COALESCE(ht.name, g.home_placeholder, g.home_team, 'TBD') AS home_name,
      COALESCE(at.name, g.away_placeholder, g.away_team, 'TBD') AS away_name,
      COALESCE(s.name, 'Season') AS season_name,
      g.season_id
    FROM games g
    LEFT JOIN teams ht ON ht.slug = g.home_team
    LEFT JOIN teams at ON at.slug = g.away_team
    LEFT JOIN seasons s ON s.id = g.season_id
    WHERE g.season_id = ${season.id}
      AND (LOWER(g.status) != 'final' OR g.status IS NULL)
    ORDER BY g.date ASC, g.time ASC
  `)

  const sortedGames = (gameRows as ScoresheetGameData[]).sort((a, b) => {
    const dateA = a.date?.trim() || "9999-99-99"
    const dateB = b.date?.trim() || "9999-99-99"
    if (dateA !== dateB) {
      return dateA.localeCompare(dateB)
    }
    const timeA = toHHMM(a.time) || "23:59"
    const timeB = toHHMM(b.time) || "23:59"
    return timeA.localeCompare(timeB) || a.id.localeCompare(b.id)
  })

  if (sortedGames.length === 0) {
    return {
      season,
      games: [],
    }
  }

  const gameIds = sortedGames.map((g) => g.id)

  const [seasonRosterRows, adhocRows, officialsRows] = await Promise.all([
    db
      .select({
        teamSlug: schema.playerSeasons.teamSlug,
        name: schema.players.name,
        isCaptain: schema.playerSeasons.isCaptain,
        isGoalie: schema.playerSeasons.isGoalie,
      })
      .from(schema.playerSeasons)
      .innerJoin(schema.players, eq(schema.players.id, schema.playerSeasons.playerId))
      .where(eq(schema.playerSeasons.seasonId, season.id))
      .orderBy(schema.players.name),
    db
      .select({
        gameId: schema.adhocGameRosters.gameId,
        teamSide: schema.adhocGameRosters.teamSide,
        name: schema.players.name,
        isSub: schema.adhocGameRosters.isSub,
      })
      .from(schema.adhocGameRosters)
      .innerJoin(schema.players, eq(schema.players.id, schema.adhocGameRosters.playerId))
      .where(inArray(schema.adhocGameRosters.gameId, gameIds))
      .orderBy(schema.players.name),
    db
      .select({
        gameId: schema.gameOfficials.gameId,
        name: schema.gameOfficials.name,
        role: schema.gameOfficials.role,
      })
      .from(schema.gameOfficials)
      .where(inArray(schema.gameOfficials.gameId, gameIds)),
  ])

  const seasonRosterByTeam = new Map<string, ScoresheetRosterPlayer[]>()
  for (const row of seasonRosterRows) {
    const current = seasonRosterByTeam.get(row.teamSlug) || []
    current.push({
      name: row.name,
      is_captain: Boolean(row.isCaptain),
      is_goalie: Boolean(row.isGoalie),
      is_sub: false,
    })
    seasonRosterByTeam.set(row.teamSlug, current)
  }

  const adhocRosterByKey = new Map<string, ScoresheetRosterPlayer[]>()
  for (const row of adhocRows) {
    const key = `${row.gameId}:${row.teamSide}`
    const current = adhocRosterByKey.get(key) || []
    current.push({
      name: row.name,
      is_captain: false,
      is_goalie: false,
      is_sub: Boolean(row.isSub),
    })
    adhocRosterByKey.set(key, current)
  }

  const officialsByGame = new Map<string, ScoresheetOfficial[]>()
  for (const row of officialsRows) {
    const current = officialsByGame.get(row.gameId) || []
    current.push({
      name: row.name,
      role: row.role,
    })
    officialsByGame.set(row.gameId, current)
  }

  const games: BatchScoresheetGameItem[] = sortedGames.map((game) => {
    const homeSeason = seasonRosterByTeam.get(game.home_slug) || []
    const homeAdhoc = adhocRosterByKey.get(`${game.id}:home`) || []
    const homeRoster = mergeScoresheetRosters(homeSeason, homeAdhoc)

    const awaySeason = seasonRosterByTeam.get(game.away_slug) || []
    const awayAdhoc = adhocRosterByKey.get(`${game.id}:away`) || []
    const awayRoster = mergeScoresheetRosters(awaySeason, awayAdhoc)

    const officials = officialsByGame.get(game.id) || []

    return {
      game,
      homeRoster,
      awayRoster,
      officials,
    }
  })

  return {
    season,
    games,
  }
}

export const fetchBatchScoresheets = cache(fetchBatchScoresheetsInternal)
