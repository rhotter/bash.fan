import { NextResponse } from "next/server"
import { getSession } from "@/lib/admin-session"
import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"

/**
 * POST /api/bash/admin/players/merge-manual
 * Body: { keepId: number, mergeId: number, name?: string }
 *
 * Merges player `mergeId` into `keepId`. All stats, seasons, draft data,
 * awards, etc. from mergeId are reassigned to keepId. Duplicate rows
 * (same game/season) are de-duped, preferring keepId's existing data.
 * The merged player row is deleted. Optionally renames the kept player.
 */
export async function POST(request: Request) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { keepId, mergeId, name } = await request.json()

    if (!keepId || !mergeId || typeof keepId !== "number" || typeof mergeId !== "number") {
      return NextResponse.json(
        { error: "keepId and mergeId are required (numbers)" },
        { status: 400 }
      )
    }
    if (keepId === mergeId) {
      return NextResponse.json(
        { error: "keepId and mergeId must be different" },
        { status: 400 }
      )
    }

    // Verify both players exist
    const keepPlayer = await rawSql(sql`SELECT id, name FROM players WHERE id = ${keepId}`)
    const mergePlayer = await rawSql(sql`SELECT id, name FROM players WHERE id = ${mergeId}`)

    if (keepPlayer.length === 0) {
      return NextResponse.json({ error: `Player ${keepId} not found` }, { status: 404 })
    }
    if (mergePlayer.length === 0) {
      return NextResponse.json({ error: `Player ${mergeId} not found` }, { status: 404 })
    }

    // Reassign all references from mergeId -> keepId (same logic as mergeDuplicatePlayers)
    const canonicalId = keepId
    const dupeId = mergeId

    // player_seasons: delete dupes, reassign rest
    await rawSql(sql`
      DELETE FROM player_seasons
      WHERE player_id = ${dupeId}
        AND (season_id, team_slug) IN (
          SELECT season_id, team_slug FROM player_seasons WHERE player_id = ${canonicalId}
        )
    `)
    await rawSql(sql`UPDATE player_seasons SET player_id = ${canonicalId} WHERE player_id = ${dupeId}`)

    // player_game_stats
    await rawSql(sql`
      UPDATE player_game_stats pgs_c
      SET team_slug = COALESCE(pgs_c.team_slug, pgs_d.team_slug)
      FROM player_game_stats pgs_d
      WHERE pgs_c.player_id = ${canonicalId}
        AND pgs_d.player_id = ${dupeId}
        AND pgs_c.game_id = pgs_d.game_id
    `)
    await rawSql(sql`
      DELETE FROM player_game_stats
      WHERE player_id = ${dupeId}
        AND game_id IN (SELECT game_id FROM player_game_stats WHERE player_id = ${canonicalId})
    `)
    await rawSql(sql`UPDATE player_game_stats SET player_id = ${canonicalId} WHERE player_id = ${dupeId}`)

    // goalie_game_stats
    await rawSql(sql`
      UPDATE goalie_game_stats ggs_c
      SET team_slug = COALESCE(ggs_c.team_slug, ggs_d.team_slug)
      FROM goalie_game_stats ggs_d
      WHERE ggs_c.player_id = ${canonicalId}
        AND ggs_d.player_id = ${dupeId}
        AND ggs_c.game_id = ggs_d.game_id
    `)
    await rawSql(sql`
      UPDATE goalie_game_stats ggs_d
      SET team_slug = COALESCE(ggs_d.team_slug, ggs_c.team_slug)
      FROM goalie_game_stats ggs_c
      WHERE ggs_c.player_id = ${canonicalId}
        AND ggs_d.player_id = ${dupeId}
        AND ggs_c.game_id = ggs_d.game_id
    `)
    await rawSql(sql`
      DELETE FROM goalie_game_stats d
      USING goalie_game_stats c
      WHERE d.player_id = ${dupeId} AND c.player_id = ${canonicalId}
        AND d.game_id = c.game_id AND c.seconds >= d.seconds
    `)
    await rawSql(sql`
      DELETE FROM goalie_game_stats
      WHERE player_id = ${canonicalId}
        AND game_id IN (SELECT game_id FROM goalie_game_stats WHERE player_id = ${dupeId})
    `)
    await rawSql(sql`UPDATE goalie_game_stats SET player_id = ${canonicalId} WHERE player_id = ${dupeId}`)

    // player_season_stats
    await rawSql(sql`
      DELETE FROM player_season_stats
      WHERE player_id = ${dupeId}
        AND (season_id, team_slug, is_playoff) IN (
          SELECT season_id, team_slug, is_playoff FROM player_season_stats WHERE player_id = ${canonicalId}
        )
    `)
    await rawSql(sql`UPDATE player_season_stats SET player_id = ${canonicalId} WHERE player_id = ${dupeId}`)

    // player_awards
    await rawSql(sql`UPDATE player_awards SET player_id = ${canonicalId} WHERE player_id = ${dupeId}`)

    // hall_of_fame
    await rawSql(sql`UPDATE hall_of_fame SET player_id = ${canonicalId} WHERE player_id = ${dupeId}`)

    // draft_pool
    await rawSql(sql`
      DELETE FROM draft_pool
      WHERE player_id = ${dupeId}
        AND draft_id IN (SELECT draft_id FROM draft_pool WHERE player_id = ${canonicalId})
    `)
    await rawSql(sql`UPDATE draft_pool SET player_id = ${canonicalId} WHERE player_id = ${dupeId}`)

    // draft_picks
    await rawSql(sql`UPDATE draft_picks SET player_id = ${canonicalId} WHERE player_id = ${dupeId}`)

    // draft_trade_items
    await rawSql(sql`UPDATE draft_trade_items SET player_id = ${canonicalId} WHERE player_id = ${dupeId}`)

    // season_trade_items
    await rawSql(sql`UPDATE season_trade_items SET player_id = ${canonicalId} WHERE player_id = ${dupeId}`)

    // adhoc_game_rosters
    await rawSql(sql`
      DELETE FROM adhoc_game_rosters
      WHERE player_id = ${dupeId}
        AND game_id IN (SELECT game_id FROM adhoc_game_rosters WHERE player_id = ${canonicalId})
    `)
    await rawSql(sql`UPDATE adhoc_game_rosters SET player_id = ${canonicalId} WHERE player_id = ${dupeId}`)

    // users
    await rawSql(sql`UPDATE users SET player_id = ${canonicalId} WHERE player_id = ${dupeId}`)

    // Delete the merged player
    await rawSql(sql`DELETE FROM players WHERE id = ${dupeId}`)

    // Optionally rename
    const finalName = name || keepPlayer[0].name
    await rawSql(sql`UPDATE players SET name = ${finalName} WHERE id = ${canonicalId}`)

    return NextResponse.json({
      success: true,
      kept: { id: canonicalId, name: finalName },
      merged: { id: dupeId, name: mergePlayer[0].name },
    })
  } catch (error) {
    console.error("Failed to merge players:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
