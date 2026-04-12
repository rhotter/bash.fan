import { neon } from "@neondatabase/serverless"

const sql = neon(process.env.DATABASE_URL!)
const execute = process.argv.includes("--execute")

async function main() {
  // Orphan games: one side has an annotation suffix in its slug
  const orphanGames = await sql`
    SELECT id, season_id, home_team, away_team
    FROM games
    WHERE home_team LIKE '%-forfeit' OR away_team LIKE '%-forfeit'
       OR home_team LIKE '%-dbl-forfeit' OR away_team LIKE '%-dbl-forfeit'
       OR home_team LIKE '%-canceled' OR away_team LIKE '%-canceled'
       OR home_team LIKE '%-cancelled' OR away_team LIKE '%-cancelled'
  ` as { id: string; season_id: string; home_team: string; away_team: string }[]

  const gameIds = orphanGames.map((g) => g.id)
  const affectedSeasons = new Set<string>()
  for (const g of orphanGames) affectedSeasons.add(g.season_id)

  console.log(`Orphan games: ${orphanGames.length} across ${affectedSeasons.size} seasons`)

  if (execute && gameIds.length > 0) {
    await sql`DELETE FROM player_game_stats WHERE game_id = ANY(${gameIds})`
    await sql`DELETE FROM goalie_game_stats WHERE game_id = ANY(${gameIds})`
    await sql`DELETE FROM game_officials WHERE game_id = ANY(${gameIds})`
    await sql`DELETE FROM game_live WHERE game_id = ANY(${gameIds})`
    await sql`DELETE FROM games WHERE id = ANY(${gameIds})`
    console.log(`  deleted ${gameIds.length} games`)
  }

  // Any team with zero games + zero player associations is dead weight
  const zombieTeams = await sql`
    SELECT t.slug, t.name
    FROM teams t
    WHERE NOT EXISTS (SELECT 1 FROM games g WHERE g.home_team = t.slug OR g.away_team = t.slug)
      AND NOT EXISTS (SELECT 1 FROM player_seasons ps WHERE ps.team_slug = t.slug)
      AND NOT EXISTS (SELECT 1 FROM player_season_stats pss WHERE pss.team_slug = t.slug)
  ` as { slug: string; name: string }[]

  console.log(`Zombie teams (no games, no player links): ${zombieTeams.length}`)
  if (zombieTeams.length > 0 && zombieTeams.length <= 60) {
    console.log(zombieTeams.map((t) => `  ${t.slug}`).join("\n"))
  }

  if (execute && zombieTeams.length > 0) {
    const slugs = zombieTeams.map((t) => t.slug)
    await sql`DELETE FROM season_teams WHERE team_slug = ANY(${slugs})`
    await sql`DELETE FROM teams WHERE slug = ANY(${slugs})`
    console.log(`  deleted ${slugs.length} zombie teams`)
  }

  console.log(`\nAffected seasons: ${[...affectedSeasons].sort().join(", ")}`)
  if (!execute) console.log("\n[DRY RUN] Pass --execute to apply.")
}

main().catch((e) => { console.error(e); process.exit(1) })
