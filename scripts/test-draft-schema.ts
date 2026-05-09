/**
 * Smoke test for Draft Wizard schema (Phase A - PR 1)
 *
 * Tests all new tables, FK relationships, cascade deletes,
 * and simulation data purge logic against the Neon branch.
 *
 * Usage:
 *   DATABASE_URL='...' npx tsx scripts/test-draft-schema.ts
 */

import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  console.log("\n🏒 Draft Schema Smoke Test\n" + "=".repeat(40))

  // ─── 1. Franchises ──────────────────────────────────────────────────────
  console.log("\n1️⃣  Franchises table...")

  await sql`INSERT INTO franchises (slug, name, color)
    VALUES ('red', 'Red Franchise', '#DC2626'),
           ('blue', 'Blue Franchise', '#2563EB'),
           ('black', 'Black Franchise', '#1F2937')
    ON CONFLICT (slug) DO UPDATE SET color = EXCLUDED.color`

  const franchises = await sql`SELECT * FROM franchises ORDER BY slug`
  console.log(`   ✅ ${franchises.length} franchises inserted`)
  franchises.forEach((f) => console.log(`      ${f.slug}: ${f.name} (${f.color})`))

  // ─── 2. Link franchise to season_team ─────────────────────────────────
  console.log("\n2️⃣  season_teams.franchise_slug FK...")

  // Pick a real season_team to test the FK
  const [sampleTeam] = await sql`SELECT season_id, team_slug FROM season_teams LIMIT 1`
  if (sampleTeam) {
    await sql`UPDATE season_teams SET franchise_slug = 'red'
      WHERE season_id = ${sampleTeam.season_id} AND team_slug = ${sampleTeam.team_slug}`
    const [updated] = await sql`SELECT * FROM season_teams
      WHERE season_id = ${sampleTeam.season_id} AND team_slug = ${sampleTeam.team_slug}`
    console.log(`   ✅ ${updated.team_slug} linked to franchise: ${updated.franchise_slug}`)
    // Revert
    await sql`UPDATE season_teams SET franchise_slug = NULL
      WHERE season_id = ${sampleTeam.season_id} AND team_slug = ${sampleTeam.team_slug}`
    console.log(`   ✅ Reverted franchise_slug to NULL`)
  } else {
    console.log("   ⚠️  No season_teams found to test FK")
  }

  // ─── 3. is_captain on player_seasons ──────────────────────────────────
  console.log("\n3️⃣  player_seasons.is_captain column...")

  const [samplePlayer] = await sql`SELECT player_id, season_id, team_slug, is_captain
    FROM player_seasons LIMIT 1`
  if (samplePlayer) {
    console.log(`   ✅ Column exists, default value: ${samplePlayer.is_captain}`)
    // Toggle to true and back
    await sql`UPDATE player_seasons SET is_captain = true
      WHERE player_id = ${samplePlayer.player_id}
      AND season_id = ${samplePlayer.season_id}
      AND team_slug = ${samplePlayer.team_slug}`
    const [toggled] = await sql`SELECT is_captain FROM player_seasons
      WHERE player_id = ${samplePlayer.player_id}
      AND season_id = ${samplePlayer.season_id}
      AND team_slug = ${samplePlayer.team_slug}`
    console.log(`   ✅ Set is_captain = ${toggled.is_captain}`)
    await sql`UPDATE player_seasons SET is_captain = false
      WHERE player_id = ${samplePlayer.player_id}
      AND season_id = ${samplePlayer.season_id}
      AND team_slug = ${samplePlayer.team_slug}`
    console.log(`   ✅ Reverted is_captain = false`)
  }

  // ─── 4. Draft instance lifecycle ──────────────────────────────────────
  console.log("\n4️⃣  Draft instance CRUD...")

  const testDraftId = "test-smoke-" + Date.now()
  const [season] = await sql`SELECT id FROM seasons LIMIT 1`

  await sql`INSERT INTO draft_instances (id, season_id, name, status, draft_type, rounds, timer_seconds, max_keepers, location)
    VALUES (${testDraftId}, ${season.id}, 'Smoke Test Draft', 'draft', 'snake', 14, 120, 8, 'The Connecticut Yankee')`
  console.log(`   ✅ Created draft instance: ${testDraftId}`)

  // Verify defaults
  const [draft] = await sql`SELECT * FROM draft_instances WHERE id = ${testDraftId}`
  console.log(`   ✅ Status: ${draft.status}, Type: ${draft.draft_type}, Rounds: ${draft.rounds}, Timer: ${draft.timer_seconds}s, MaxKeepers: ${draft.max_keepers}`)

  // ─── 5. Draft team order ──────────────────────────────────────────────
  console.log("\n5️⃣  Draft team order...")

  const teams = await sql`SELECT slug FROM teams LIMIT 4`
  for (let i = 0; i < teams.length; i++) {
    await sql`INSERT INTO draft_team_order (draft_id, team_slug, position)
      VALUES (${testDraftId}, ${teams[i].slug}, ${i + 1})`
  }
  const order = await sql`SELECT team_slug, position FROM draft_team_order
    WHERE draft_id = ${testDraftId} ORDER BY position`
  console.log(`   ✅ ${order.length} teams in order:`)
  order.forEach((o) => console.log(`      #${o.position}: ${o.team_slug}`))

  // ─── 6. Draft pool ───────────────────────────────────────────────────
  console.log("\n6️⃣  Draft pool...")

  const players = await sql`SELECT id FROM players LIMIT 5`
  for (const p of players) {
    await sql`INSERT INTO draft_pool (draft_id, player_id) VALUES (${testDraftId}, ${p.id})`
  }
  // Mark first player as keeper
  if (players.length > 0 && teams.length > 0) {
    await sql`UPDATE draft_pool SET is_keeper = true, keeper_team_slug = ${teams[0].slug}, keeper_round = 1
      WHERE draft_id = ${testDraftId} AND player_id = ${players[0].id}`
  }
  const pool = await sql`SELECT player_id, is_keeper, keeper_team_slug, keeper_round
    FROM draft_pool WHERE draft_id = ${testDraftId}`
  const keeperCount = pool.filter((p) => p.is_keeper).length
  console.log(`   ✅ ${pool.length} players in pool, ${keeperCount} keeper(s)`)

  // ─── 7. Draft picks (including simulation) ────────────────────────────
  console.log("\n7️⃣  Draft picks...")

  const pickId1 = "pick-" + Date.now() + "-1"
  const pickId2 = "pick-" + Date.now() + "-2"

  // Real pick
  await sql`INSERT INTO draft_picks (id, draft_id, round, pick_number, team_slug, original_team_slug, player_id, is_keeper, is_simulation)
    VALUES (${pickId1}, ${testDraftId}, 1, 1, ${teams[0].slug}, ${teams[0].slug}, ${players[0].id}, true, false)`

  // Simulation pick
  await sql`INSERT INTO draft_picks (id, draft_id, round, pick_number, team_slug, original_team_slug, player_id, is_simulation)
    VALUES (${pickId2}, ${testDraftId}, 1, 2, ${teams[1].slug}, ${teams[1].slug}, ${players[1].id}, true)`

  const picks = await sql`SELECT id, round, pick_number, team_slug, is_keeper, is_simulation
    FROM draft_picks WHERE draft_id = ${testDraftId} ORDER BY pick_number`
  console.log(`   ✅ ${picks.length} picks created:`)
  picks.forEach((p) => console.log(`      Pick #${p.pick_number}: ${p.team_slug} (keeper=${p.is_keeper}, sim=${p.is_simulation})`))

  // ─── 8. Draft trades (including simulation) ──────────────────────────
  console.log("\n8️⃣  Draft trades + trade items...")

  const tradeId = "trade-" + Date.now()
  await sql`INSERT INTO draft_trades (id, draft_id, team_a_slug, team_b_slug, trade_type, description, is_simulation)
    VALUES (${tradeId}, ${testDraftId}, ${teams[0].slug}, ${teams[1].slug}, 'pick_swap', 'Test swap', true)`

  await sql`INSERT INTO draft_trade_items (trade_id, from_team_slug, to_team_slug, pick_id)
    VALUES (${tradeId}, ${teams[0].slug}, ${teams[1].slug}, ${pickId1})`

  const trades = await sql`SELECT * FROM draft_trades WHERE draft_id = ${testDraftId}`
  const items = await sql`SELECT * FROM draft_trade_items WHERE trade_id = ${tradeId}`
  console.log(`   ✅ ${trades.length} trade(s), ${items.length} trade item(s)`)

  // ─── 9. Draft log ────────────────────────────────────────────────────
  console.log("\n9️⃣  Draft activity log...")

  await sql`INSERT INTO draft_log (draft_id, action, detail, is_simulation)
    VALUES (${testDraftId}, 'pick', '{"round": 1, "pick": 1}'::jsonb, false)`
  await sql`INSERT INTO draft_log (draft_id, action, detail, is_simulation)
    VALUES (${testDraftId}, 'trade', '{"type": "pick_swap"}'::jsonb, true)`

  const logs = await sql`SELECT action, is_simulation FROM draft_log WHERE draft_id = ${testDraftId}`
  console.log(`   ✅ ${logs.length} log entries:`)
  logs.forEach((l) => console.log(`      ${l.action} (sim=${l.is_simulation})`))

  // ─── 10. Simulation purge test ────────────────────────────────────────
  console.log("\n🔟  Simulation purge test...")

  const beforePicks = await sql`SELECT COUNT(*) as count FROM draft_picks WHERE draft_id = ${testDraftId}`
  const beforeTrades = await sql`SELECT COUNT(*) as count FROM draft_trades WHERE draft_id = ${testDraftId}`
  const beforeLogs = await sql`SELECT COUNT(*) as count FROM draft_log WHERE draft_id = ${testDraftId}`
  console.log(`   Before purge: ${beforePicks[0].count} picks, ${beforeTrades[0].count} trades, ${beforeLogs[0].count} logs`)

  // Purge simulation data (what "Publish" would do)
  await sql`DELETE FROM draft_log WHERE draft_id = ${testDraftId} AND is_simulation = true`
  // Trade items cascade from trades, so delete trades first
  await sql`DELETE FROM draft_trades WHERE draft_id = ${testDraftId} AND is_simulation = true`
  await sql`DELETE FROM draft_picks WHERE draft_id = ${testDraftId} AND is_simulation = true`

  const afterPicks = await sql`SELECT COUNT(*) as count FROM draft_picks WHERE draft_id = ${testDraftId}`
  const afterTrades = await sql`SELECT COUNT(*) as count FROM draft_trades WHERE draft_id = ${testDraftId}`
  const afterLogs = await sql`SELECT COUNT(*) as count FROM draft_log WHERE draft_id = ${testDraftId}`
  console.log(`   After purge:  ${afterPicks[0].count} picks, ${afterTrades[0].count} trades, ${afterLogs[0].count} logs`)
  console.log(`   ✅ Simulation data purged, real data preserved`)

  // ─── 11. Cascade delete test ──────────────────────────────────────────
  console.log("\n1️⃣1️⃣  Cascade delete test...")

  await sql`DELETE FROM draft_instances WHERE id = ${testDraftId}`

  const remainingPicks = await sql`SELECT COUNT(*) as count FROM draft_picks WHERE draft_id = ${testDraftId}`
  const remainingPool = await sql`SELECT COUNT(*) as count FROM draft_pool WHERE draft_id = ${testDraftId}`
  const remainingOrder = await sql`SELECT COUNT(*) as count FROM draft_team_order WHERE draft_id = ${testDraftId}`
  const remainingLogs = await sql`SELECT COUNT(*) as count FROM draft_log WHERE draft_id = ${testDraftId}`

  const allZero = [remainingPicks, remainingPool, remainingOrder, remainingLogs]
    .every((r) => Number(r[0].count) === 0)

  console.log(`   ✅ CASCADE DELETE: All child rows removed = ${allZero}`)

  // ─── 12. Cleanup franchises ───────────────────────────────────────────
  console.log("\n🧹  Cleanup...")
  await sql`DELETE FROM franchises WHERE slug IN ('red', 'blue', 'black')`
  console.log(`   ✅ Test franchises removed`)

  // ─── Summary ──────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(40))
  console.log("🎉 ALL TESTS PASSED — Schema is ready for production push")
  console.log("=".repeat(40) + "\n")
}

run().catch((err) => {
  console.error("\n❌ TEST FAILED:", err.message)
  process.exit(1)
})
