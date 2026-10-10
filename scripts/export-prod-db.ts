/**
 * Export / Replicate seasons, boxscores, rosters, and drafts from Production into a Dev DB.
 *
 * Usage:
 *   PROD_URL='<prod-conn-string>' DEV_URL='<dev-conn-string>' npx tsx scripts/export-prod-db.ts
 *   npx tsx scripts/export-prod-db.ts --from '<prod-conn-string>' --to '<dev-conn-string>'
 *   npx tsx scripts/export-prod-db.ts --from '...' --to '...' --seasons 2026-summer,bash-2026-2027
 */

import "./env";
import { neon } from "@neondatabase/serverless";

function parseArgs() {
  const args = process.argv.slice(2);
  let devUrl =
    process.env.DEV_URL ||
    process.env.DEV_DATABASE_URL ||
    process.env.TARGET_DATABASE_URL ||
    process.env.DATABASE_URL;
  let prodUrl =
    process.env.PROD_URL ||
    process.env.PROD_DATABASE_URL ||
    process.env.SOURCE_DATABASE_URL;
  let seasons = ["2025-2026", "2026-summer", "bash-2026-2027"];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--to" || arg === "--dev" || arg === "--target") {
      devUrl = args[++i];
    } else if (arg === "--from" || arg === "--prod" || arg === "--source") {
      prodUrl = args[++i];
    } else if (arg === "--seasons") {
      seasons = args[++i].split(",").map((s) => s.trim());
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Export / Replicate Production Data to Dev Database

Usage:
  PROD_URL='<url>' DEV_URL='<url>' npx tsx scripts/export-prod-db.ts [options]
  npx tsx scripts/export-prod-db.ts --from '<prod-url>' --to '<dev-url>' [options]

Options:
  --from, --prod, --source <url> Source production database URL (or PROD_URL env var)
  --to, --dev, --target <url>   Target dev database URL (or DEV_URL env var / DATABASE_URL in .env.local)
  --seasons <list>              Comma-separated season IDs (default: 2025-2026, 2026-summer, bash-2026-2027)
  --help, -h                    Show this help message
      `);
      process.exit(0);
    }
  }

  if (!prodUrl) {
    console.error(
      "Error: Missing production database URL. Provide via PROD_URL='...' or --from '<url>'."
    );
    process.exit(1);
  }
  if (!devUrl) {
    console.error(
      "Error: Missing target dev database URL. Provide via DEV_URL='...', --to '<url>', or DATABASE_URL in .env.local."
    );
    process.exit(1);
  }
  if (prodUrl.trim() === devUrl.trim()) {
    console.error(
      "Safety Error: Source (prod) and Target (dev) database URLs are identical! Aborting to prevent accidental data overwrite."
    );
    process.exit(1);
  }

  return { prodUrl, devUrl, seasons };
}

function maskUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    return `${parsed.protocol}//${parsed.username}:***@${parsed.host}${parsed.pathname}`;
  } catch {
    return "<custom-url>";
  }
}

async function main() {
  const { prodUrl, devUrl, seasons } = parseArgs();

  console.log("=== BASH: Export Prod DB -> Dev DB ===");
  console.log(`Source (Prod): ${maskUrl(prodUrl)}`);
  console.log(`Target (Dev):  ${maskUrl(devUrl)}`);
  console.log(`Seasons:       ${seasons.join(", ")}\n`);

  const prod = neon(prodUrl);
  const dev = neon(devUrl);

  // ─── Phase 1: Teams, Franchises & Player Alignment ────────────────────────
  console.log("1. Aligning Teams, Franchises & Players...");

  // Teams
  const prodTeams = await prod`SELECT slug, name FROM teams;`;
  for (const t of prodTeams) {
    await dev`
      INSERT INTO teams (slug, name)
      VALUES (${t.slug}, ${t.name})
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name;
    `;
  }

  // Franchises
  const prodFranchises = await prod`SELECT slug, name, color FROM franchises;`;
  for (const f of prodFranchises) {
    await dev`
      INSERT INTO franchises (slug, name, color)
      VALUES (${f.slug}, ${f.name}, ${f.color})
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color;
    `;
  }

  // Map players by unique name to preserve historical stats in target DB
  const prodPlayers = await prod`SELECT id, name FROM players;`;
  const devPlayers = await dev`SELECT id, name FROM players;`;
  const devByName = new Map(devPlayers.map((p) => [p.name.trim().toLowerCase(), p.id]));

  let newPlayersAdded = 0;
  for (const p of prodPlayers) {
    const key = p.name.trim().toLowerCase();
    if (!devByName.has(key)) {
      const [inserted] = await dev`
        INSERT INTO players (name) VALUES (${p.name.trim()})
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id;
      `;
      devByName.set(key, inserted.id);
      newPlayersAdded++;
    }
  }

  const devIdByProdId = new Map<number, number>();
  for (const p of prodPlayers) {
    const devId = devByName.get(p.name.trim().toLowerCase());
    if (devId) devIdByProdId.set(p.id, devId);
  }
  console.log(
    `   Teams: ${prodTeams.length}, Franchises: ${prodFranchises.length}, Players: ${devIdByProdId.size} aligned (${newPlayersAdded} newly created in dev).`
  );

  // ─── Phase 2: Seasons & Season Teams ──────────────────────────────────────
  console.log("2. Syncing Seasons & Season Teams...");
  const prodSeasons = await prod`
    SELECT * FROM seasons WHERE id = ANY(${seasons});
  `;
  for (const s of prodSeasons) {
    await dev`
      INSERT INTO seasons (
        id, name, league_id, is_current, season_type, status,
        standings_method, game_length, default_location, admin_notes,
        stats_only, playoff_teams, enable_sync
      ) VALUES (
        ${s.id}, ${s.name}, ${s.league_id}, ${s.is_current}, ${s.season_type}, ${s.status},
        ${s.standings_method}, ${s.game_length}, ${s.default_location}, ${s.admin_notes},
        ${s.stats_only}, ${s.playoff_teams}, ${s.enable_sync}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        league_id = EXCLUDED.league_id,
        is_current = EXCLUDED.is_current,
        season_type = EXCLUDED.season_type,
        status = EXCLUDED.status,
        standings_method = EXCLUDED.standings_method,
        game_length = EXCLUDED.game_length,
        default_location = EXCLUDED.default_location,
        admin_notes = EXCLUDED.admin_notes,
        stats_only = EXCLUDED.stats_only,
        playoff_teams = EXCLUDED.playoff_teams,
        enable_sync = EXCLUDED.enable_sync;
    `;
  }

  const prodSeasonTeams = await prod`
    SELECT * FROM season_teams WHERE season_id = ANY(${seasons});
  `;
  for (const st of prodSeasonTeams) {
    await dev`
      INSERT INTO season_teams (season_id, team_slug, franchise_slug, color)
      VALUES (${st.season_id}, ${st.team_slug}, ${st.franchise_slug}, ${st.color})
      ON CONFLICT (season_id, team_slug) DO UPDATE SET
        franchise_slug = EXCLUDED.franchise_slug,
        color = EXCLUDED.color;
    `;
  }
  console.log(`   Seasons: ${prodSeasons.length}, Season Teams: ${prodSeasonTeams.length}.`);

  // ─── Phase 3: Player Seasons & Draft Instances ────────────────────────────
  console.log("3. Syncing Player Seasons & Drafts...");
  const prodPS = await prod`
    SELECT * FROM player_seasons WHERE season_id = ANY(${seasons});
  `;
  await dev`DELETE FROM player_seasons WHERE season_id = ANY(${seasons});`;
  for (const ps of prodPS) {
    const devPlayerId = devIdByProdId.get(ps.player_id);
    if (!devPlayerId) continue;
    await dev`
      INSERT INTO player_seasons (player_id, season_id, team_slug, is_goalie, is_captain, is_rookie, registration_meta)
      VALUES (${devPlayerId}, ${ps.season_id}, ${ps.team_slug}, ${ps.is_goalie}, ${ps.is_captain}, ${ps.is_rookie}, ${ps.registration_meta ? JSON.stringify(ps.registration_meta) : null})
      ON CONFLICT (player_id, season_id, team_slug) DO UPDATE SET
        is_goalie = EXCLUDED.is_goalie,
        is_captain = EXCLUDED.is_captain,
        is_rookie = EXCLUDED.is_rookie,
        registration_meta = EXCLUDED.registration_meta;
    `;
  }

  const prodDrafts = await prod`
    SELECT * FROM draft_instances WHERE season_id = ANY(${seasons});
  `;
  for (const d of prodDrafts) {
    await dev`
      INSERT INTO draft_instances (
        id, season_id, season_type, name, status, rounds, draft_type,
        timer_seconds, max_keepers, draft_date, location, current_round,
        current_pick, timer_countdown, timer_running, timer_started_at, created_at, updated_at
      ) VALUES (
        ${d.id}, ${d.season_id}, ${d.season_type}, ${d.name}, ${d.status}, ${d.rounds}, ${d.draft_type},
        ${d.timer_seconds}, ${d.max_keepers}, ${d.draft_date}, ${d.location}, ${d.current_round},
        ${d.current_pick}, ${d.timer_countdown}, ${d.timer_running}, ${d.timer_started_at}, ${d.created_at}, ${d.updated_at}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        rounds = EXCLUDED.rounds,
        draft_type = EXCLUDED.draft_type,
        timer_seconds = EXCLUDED.timer_seconds,
        max_keepers = EXCLUDED.max_keepers,
        draft_date = EXCLUDED.draft_date,
        location = EXCLUDED.location,
        current_round = EXCLUDED.current_round,
        current_pick = EXCLUDED.current_pick,
        timer_countdown = EXCLUDED.timer_countdown,
        timer_running = EXCLUDED.timer_running,
        timer_started_at = EXCLUDED.timer_started_at,
        updated_at = EXCLUDED.updated_at;
    `;

    const teamOrders = await prod`SELECT * FROM draft_team_order WHERE draft_id = ${d.id};`;
    for (const to of teamOrders) {
      await dev`
        INSERT INTO draft_team_order (draft_id, team_slug, position)
        VALUES (${to.draft_id}, ${to.team_slug}, ${to.position})
        ON CONFLICT (draft_id, team_slug) DO UPDATE SET position = EXCLUDED.position;
      `;
    }

    const pool = await prod`SELECT * FROM draft_pool WHERE draft_id = ${d.id};`;
    for (const p of pool) {
      const devPlayerId = devIdByProdId.get(p.player_id);
      if (!devPlayerId) continue;
      await dev`
        INSERT INTO draft_pool (draft_id, player_id, is_keeper, keeper_team_slug, keeper_round, registration_meta)
        VALUES (${p.draft_id}, ${devPlayerId}, ${p.is_keeper}, ${p.keeper_team_slug}, ${p.keeper_round}, ${p.registration_meta ? JSON.stringify(p.registration_meta) : null})
        ON CONFLICT (draft_id, player_id) DO UPDATE SET
          is_keeper = EXCLUDED.is_keeper,
          keeper_team_slug = EXCLUDED.keeper_team_slug,
          keeper_round = EXCLUDED.keeper_round,
          registration_meta = EXCLUDED.registration_meta;
      `;
    }

    const picks = await prod`SELECT * FROM draft_picks WHERE draft_id = ${d.id};`;
    for (const pk of picks) {
      const devPlayerId = pk.player_id ? devIdByProdId.get(pk.player_id) ?? null : null;
      if (pk.player_id && !devPlayerId) {
        console.warn(`      ⚠️ Warning: Draft pick ${pk.id} has prod player_id=${pk.player_id} which was not mapped in dev.`);
      }
      await dev`
        INSERT INTO draft_picks (id, draft_id, round, pick_number, team_slug, original_team_slug, player_id, is_keeper, picked_at)
        VALUES (${pk.id}, ${pk.draft_id}, ${pk.round}, ${pk.pick_number}, ${pk.team_slug}, ${pk.original_team_slug}, ${devPlayerId}, ${pk.is_keeper}, ${pk.picked_at})
        ON CONFLICT (id) DO UPDATE SET
          team_slug = EXCLUDED.team_slug,
          original_team_slug = EXCLUDED.original_team_slug,
          player_id = EXCLUDED.player_id,
          is_keeper = EXCLUDED.is_keeper,
          picked_at = EXCLUDED.picked_at;
      `;
    }
  }
  console.log(`   Player Seasons: ${prodPS.length}, Draft Instances: ${prodDrafts.length}.`);

  // ─── Phase 4: Games, Officials, Boxscores & Awards ────────────────────────
  console.log("4. Syncing Games, Boxscores & Awards...");
  const prodGames = await prod`
    SELECT * FROM games WHERE season_id = ANY(${seasons}) ORDER BY date, id;
  `;
  const prodGameIds = prodGames.map((g) => g.id);

  // Clean up any obsolete games in dev that no longer exist in prod (e.g. from schedule rebalances)
  if (prodGameIds.length > 0) {
    const orphanGames = await dev`
      SELECT id FROM games WHERE season_id = ANY(${seasons}) AND NOT (id = ANY(${prodGameIds}));
    `;
    const orphanIds = orphanGames.map((g) => g.id);
    if (orphanIds.length > 0) {
      await dev`DELETE FROM game_officials WHERE game_id = ANY(${orphanIds});`;
      await dev`DELETE FROM player_game_stats WHERE game_id = ANY(${orphanIds});`;
      await dev`DELETE FROM goalie_game_stats WHERE game_id = ANY(${orphanIds});`;
      await dev`DELETE FROM adhoc_game_rosters WHERE game_id = ANY(${orphanIds});`;
      await dev`DELETE FROM game_live WHERE game_id = ANY(${orphanIds});`;
      await dev`DELETE FROM games WHERE id = ANY(${orphanIds});`;
      console.log(`   Cleaned up ${orphanIds.length} obsolete game(s) in dev.`);
    }
  }

  for (const g of prodGames) {
    await dev`
      INSERT INTO games (
        id, season_id, date, time, home_team, away_team,
        home_score, away_score, status, is_overtime, is_playoff, is_forfeit,
        location, has_boxscore, notes, title, game_type, has_shootout,
        away_notes, home_notes, home_placeholder, away_placeholder,
        next_game_id, next_game_slot, bracket_round, series_id, series_game_number
      ) VALUES (
        ${g.id}, ${g.season_id}, ${g.date}, ${g.time}, ${g.home_team}, ${g.away_team},
        ${g.home_score}, ${g.away_score}, ${g.status}, ${g.is_overtime}, ${g.is_playoff}, ${g.is_forfeit},
        ${g.location}, ${g.has_boxscore}, ${g.notes}, ${g.title}, ${g.game_type}, ${g.has_shootout},
        ${g.away_notes}, ${g.home_notes}, ${g.home_placeholder}, ${g.away_placeholder},
        ${g.next_game_id}, ${g.next_game_slot}, ${g.bracket_round}, ${g.series_id}, ${g.series_game_number}
      )
      ON CONFLICT (id) DO UPDATE SET
        season_id = EXCLUDED.season_id,
        date = EXCLUDED.date,
        time = EXCLUDED.time,
        home_team = EXCLUDED.home_team,
        away_team = EXCLUDED.away_team,
        home_score = EXCLUDED.home_score,
        away_score = EXCLUDED.away_score,
        status = EXCLUDED.status,
        is_overtime = EXCLUDED.is_overtime,
        is_playoff = EXCLUDED.is_playoff,
        is_forfeit = EXCLUDED.is_forfeit,
        location = EXCLUDED.location,
        has_boxscore = EXCLUDED.has_boxscore,
        notes = EXCLUDED.notes,
        title = EXCLUDED.title,
        game_type = EXCLUDED.game_type,
        has_shootout = EXCLUDED.has_shootout,
        away_notes = EXCLUDED.away_notes,
        home_notes = EXCLUDED.home_notes,
        home_placeholder = EXCLUDED.home_placeholder,
        away_placeholder = EXCLUDED.away_placeholder,
        next_game_id = EXCLUDED.next_game_id,
        next_game_slot = EXCLUDED.next_game_slot,
        bracket_round = EXCLUDED.bracket_round,
        series_id = EXCLUDED.series_id,
        series_game_number = EXCLUDED.series_game_number;
    `;
  }

  const gameIds = prodGames.map((g) => g.id);
  let officialsCount = 0;
  let pgsCount = 0;
  let ggsCount = 0;

  if (gameIds.length > 0) {
    const prodOfficials = await prod`SELECT * FROM game_officials WHERE game_id = ANY(${gameIds});`;
    await dev`DELETE FROM game_officials WHERE game_id = ANY(${gameIds});`;
    for (const o of prodOfficials) {
      await dev`
        INSERT INTO game_officials (game_id, name, role)
        VALUES (${o.game_id}, ${o.name}, ${o.role});
      `;
    }
    officialsCount = prodOfficials.length;

    const prodPGS = await prod`SELECT * FROM player_game_stats WHERE game_id = ANY(${gameIds});`;
    await dev`DELETE FROM player_game_stats WHERE game_id = ANY(${gameIds});`;
    for (let i = 0; i < prodPGS.length; i += 50) {
      const chunk = prodPGS.slice(i, i + 50);
      for (const stat of chunk) {
        const devPlayerId = devIdByProdId.get(stat.player_id);
        if (!devPlayerId) continue;
        await dev`
          INSERT INTO player_game_stats (
            player_id, game_id, goals, assists, points, gwg, ppg, shg, eng, hat_tricks, pen, pim, is_sub
          ) VALUES (
            ${devPlayerId}, ${stat.game_id}, ${stat.goals}, ${stat.assists}, ${stat.points},
            ${stat.gwg}, ${stat.ppg}, ${stat.shg}, ${stat.eng}, ${stat.hat_tricks},
            ${stat.pen}, ${stat.pim}, ${stat.is_sub}
          )
          ON CONFLICT (player_id, game_id) DO NOTHING;
        `;
        pgsCount++;
      }
    }

    const prodGGS = await prod`SELECT * FROM goalie_game_stats WHERE game_id = ANY(${gameIds});`;
    await dev`DELETE FROM goalie_game_stats WHERE game_id = ANY(${gameIds});`;
    for (const stat of prodGGS) {
      const devPlayerId = devIdByProdId.get(stat.player_id);
      if (!devPlayerId) continue;
      await dev`
        INSERT INTO goalie_game_stats (
          player_id, game_id, seconds, goals_against, shots_against, saves, shutouts, goalie_assists, result, is_sub
        ) VALUES (
          ${devPlayerId}, ${stat.game_id}, ${stat.seconds}, ${stat.goals_against}, ${stat.shots_against},
          ${stat.saves}, ${stat.shutouts}, ${stat.goalie_assists}, ${stat.result}, ${stat.is_sub}
        )
        ON CONFLICT (player_id, game_id) DO NOTHING;
      `;
      ggsCount++;
    }

    // Tryout exhibition attendance rosters
    const prodAdhoc = await prod`SELECT * FROM adhoc_game_rosters WHERE game_id = ANY(${gameIds});`;
    await dev`DELETE FROM adhoc_game_rosters WHERE game_id = ANY(${gameIds});`;
    for (const r of prodAdhoc) {
      const devPlayerId = devIdByProdId.get(r.player_id);
      if (!devPlayerId) continue;
      await dev`
        INSERT INTO adhoc_game_rosters (game_id, player_id, team_side, is_sub)
        VALUES (${r.game_id}, ${devPlayerId}, ${r.team_side}, ${r.is_sub ?? false})
        ON CONFLICT (game_id, player_id) DO UPDATE SET
          team_side = EXCLUDED.team_side,
          is_sub = EXCLUDED.is_sub;
      `;
    }
  }

  const prodAwards = await prod`SELECT * FROM player_awards WHERE season_id = ANY(${seasons});`;
  for (const a of prodAwards) {
    const devPlayerId = a.player_id ? devIdByProdId.get(a.player_id) ?? null : null;
    await dev`
      INSERT INTO player_awards (player_name, player_id, season_id, award_type)
      VALUES (${a.player_name}, ${devPlayerId}, ${a.season_id}, ${a.award_type})
      ON CONFLICT (player_name, season_id, award_type) DO UPDATE SET
        player_id = EXCLUDED.player_id;
    `;
  }

  console.log(
    `   Games: ${prodGames.length}, Officials: ${officialsCount}, Skater Stats: ${pgsCount}, Goalie Stats: ${ggsCount}, Awards: ${prodAwards.length}.`
  );

  // Synchronize games_gen_seq in dev DB with highest copied game ID
  await dev`
    DO $$
    DECLARE
      max_id bigint;
      cur_seq bigint;
    BEGIN
      CREATE SEQUENCE IF NOT EXISTS games_gen_seq START 1;
      SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM 2) AS bigint)), 0)
        INTO max_id
        FROM games
        WHERE id ~ '^g[0-9]+$';
      SELECT last_value INTO cur_seq FROM games_gen_seq;
      IF max_id >= cur_seq THEN
        PERFORM setval('games_gen_seq', max_id, true);
      END IF;
    END $$;
  `;

  console.log("\n=== Export & Sync Completed Successfully! ===");
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
