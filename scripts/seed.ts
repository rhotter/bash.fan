import "./env"
import { rawSql } from "../lib/db"
import { sql } from "drizzle-orm"
import { execSync } from "child_process"

async function seed() {
  console.log("Pushing schema via drizzle-kit...")
  execSync("npx drizzle-kit push", { stdio: "inherit" })
  console.log("Schema applied.")

  // Insert season
  await rawSql(sql`
    INSERT INTO seasons (id, name, league_id, is_current, season_type)
    VALUES ('2025-2026', 'BASH 2025-2026', '50562', true, 'fall')
    ON CONFLICT (id) DO UPDATE SET season_type = EXCLUDED.season_type
  `)

  // Insert teams
  const teams = [
    { slug: "seals", name: "Seals" },
    { slug: "rink-rats", name: "Rink Rats" },
    { slug: "yetis", name: "Yetis" },
    { slug: "landsharks", name: "Landsharks" },
    { slug: "reign", name: "Reign" },
    { slug: "loons", name: "Loons" },
    { slug: "no-regretzkys", name: "No ReGretzkys" },
  ]

  for (const t of teams) {
    await rawSql(sql`INSERT INTO teams (slug, name) VALUES (${t.slug}, ${t.name}) ON CONFLICT (slug) DO NOTHING`)
    await rawSql(sql`INSERT INTO season_teams (season_id, team_slug) VALUES ('2025-2026', ${t.slug}) ON CONFLICT DO NOTHING`)
  }
  console.log("Teams inserted.")

  // All 73 games from Sportability schedule
  const games: {
    id: string
    date: string
    time: string
    away: string
    home: string
    awayScore: number | null
    homeScore: number | null
    status: string
    isOT: boolean
    isPlayoff: boolean
  }[] = [
    { id: "1708562", date: "2025-10-04", time: "9:00a", away: "loons", home: "no-regretzkys", awayScore: 8, homeScore: 1, status: "final", isOT: false, isPlayoff: false },
    { id: "1708563", date: "2025-10-04", time: "11:00a", away: "yetis", home: "rink-rats", awayScore: 3, homeScore: 5, status: "final", isOT: false, isPlayoff: false },
    { id: "1708564", date: "2025-10-04", time: "1:00p", away: "landsharks", home: "seals", awayScore: 1, homeScore: 2, status: "final", isOT: false, isPlayoff: false },
    { id: "1708652", date: "2025-10-11", time: "9:00a", away: "landsharks", home: "loons", awayScore: 7, homeScore: 1, status: "final", isOT: false, isPlayoff: false },
    { id: "1708653", date: "2025-10-11", time: "11:00a", away: "seals", home: "reign", awayScore: 5, homeScore: 2, status: "final", isOT: false, isPlayoff: false },
    { id: "1708654", date: "2025-10-11", time: "1:00p", away: "rink-rats", home: "no-regretzkys", awayScore: 11, homeScore: 2, status: "final", isOT: false, isPlayoff: false },
    { id: "1708655", date: "2025-10-18", time: "9:00a", away: "yetis", home: "reign", awayScore: 5, homeScore: 2, status: "final", isOT: false, isPlayoff: false },
    { id: "1708656", date: "2025-10-18", time: "11:00a", away: "landsharks", home: "no-regretzkys", awayScore: 6, homeScore: 1, status: "final", isOT: false, isPlayoff: false },
    { id: "1708657", date: "2025-10-18", time: "1:00p", away: "seals", home: "rink-rats", awayScore: 8, homeScore: 5, status: "final", isOT: false, isPlayoff: false },
    { id: "1708658", date: "2025-10-25", time: "9:00a", away: "reign", home: "rink-rats", awayScore: 4, homeScore: 5, status: "final", isOT: true, isPlayoff: false },
    { id: "1708659", date: "2025-10-25", time: "11:00a", away: "loons", home: "seals", awayScore: 1, homeScore: 5, status: "final", isOT: false, isPlayoff: false },
    { id: "1708660", date: "2025-10-25", time: "1:00p", away: "yetis", home: "landsharks", awayScore: 2, homeScore: 4, status: "final", isOT: false, isPlayoff: false },
    { id: "1708661", date: "2025-11-01", time: "9:00a", away: "seals", home: "yetis", awayScore: 2, homeScore: 1, status: "final", isOT: false, isPlayoff: false },
    { id: "1708662", date: "2025-11-01", time: "11:00a", away: "rink-rats", home: "loons", awayScore: 8, homeScore: 7, status: "final", isOT: true, isPlayoff: false },
    { id: "1708663", date: "2025-11-01", time: "1:00p", away: "no-regretzkys", home: "reign", awayScore: 2, homeScore: 10, status: "final", isOT: false, isPlayoff: false },
    { id: "1708664", date: "2025-11-08", time: "9:00a", away: "no-regretzkys", home: "seals", awayScore: 6, homeScore: 5, status: "final", isOT: false, isPlayoff: false },
    { id: "1708665", date: "2025-11-08", time: "11:00a", away: "reign", home: "landsharks", awayScore: 3, homeScore: 2, status: "final", isOT: false, isPlayoff: false },
    { id: "1708666", date: "2025-11-08", time: "1:00p", away: "loons", home: "yetis", awayScore: 1, homeScore: 4, status: "final", isOT: false, isPlayoff: false },
    { id: "1708667", date: "2025-11-15", time: "9:00a", away: "rink-rats", home: "landsharks", awayScore: 6, homeScore: 1, status: "final", isOT: false, isPlayoff: false },
    { id: "1708668", date: "2025-11-15", time: "11:00a", away: "no-regretzkys", home: "yetis", awayScore: 2, homeScore: 4, status: "final", isOT: false, isPlayoff: false },
    { id: "1708669", date: "2025-11-15", time: "1:00p", away: "reign", home: "loons", awayScore: 8, homeScore: 5, status: "final", isOT: false, isPlayoff: false },
    { id: "1708670", date: "2025-11-22", time: "9:00a", away: "seals", home: "landsharks", awayScore: 3, homeScore: 0, status: "final", isOT: false, isPlayoff: false },
    { id: "1708671", date: "2025-11-22", time: "11:00a", away: "no-regretzkys", home: "loons", awayScore: 0, homeScore: 13, status: "final", isOT: false, isPlayoff: false },
    { id: "1708672", date: "2025-11-22", time: "1:00p", away: "rink-rats", home: "yetis", awayScore: 3, homeScore: 2, status: "final", isOT: false, isPlayoff: false },
    { id: "1708673", date: "2025-12-06", time: "9:00a", away: "no-regretzkys", home: "rink-rats", awayScore: 0, homeScore: 9, status: "final", isOT: false, isPlayoff: false },
    { id: "1708674", date: "2025-12-06", time: "11:00a", away: "loons", home: "landsharks", awayScore: 6, homeScore: 4, status: "final", isOT: false, isPlayoff: false },
    { id: "1708675", date: "2025-12-06", time: "1:00p", away: "reign", home: "seals", awayScore: 5, homeScore: 9, status: "final", isOT: false, isPlayoff: false },
    { id: "1708676", date: "2025-12-13", time: "9:00a", away: "rink-rats", home: "seals", awayScore: 3, homeScore: 4, status: "final", isOT: true, isPlayoff: false },
    { id: "1708677", date: "2025-12-13", time: "11:00a", away: "reign", home: "yetis", awayScore: 1, homeScore: 6, status: "final", isOT: false, isPlayoff: false },
    { id: "1708678", date: "2025-12-13", time: "1:00p", away: "no-regretzkys", home: "landsharks", awayScore: 3, homeScore: 8, status: "final", isOT: false, isPlayoff: false },
    { id: "1708682", date: "2025-12-20", time: "9:00a", away: "landsharks", home: "yetis", awayScore: 2, homeScore: 1, status: "final", isOT: true, isPlayoff: false },
    { id: "1708683", date: "2025-12-20", time: "11:00a", away: "rink-rats", home: "reign", awayScore: 4, homeScore: 6, status: "final", isOT: false, isPlayoff: false },
    { id: "1708684", date: "2025-12-20", time: "1:00p", away: "seals", home: "loons", awayScore: 13, homeScore: 1, status: "final", isOT: false, isPlayoff: false },
    { id: "1708679", date: "2026-01-10", time: "9:00a", away: "reign", home: "no-regretzkys", awayScore: 3, homeScore: 4, status: "final", isOT: true, isPlayoff: false },
    { id: "1708680", date: "2026-01-10", time: "11:00a", away: "yetis", home: "seals", awayScore: 4, homeScore: 0, status: "final", isOT: false, isPlayoff: false },
    { id: "1708681", date: "2026-01-10", time: "1:00p", away: "loons", home: "rink-rats", awayScore: 3, homeScore: 4, status: "final", isOT: true, isPlayoff: false },
    { id: "1708685", date: "2026-01-24", time: "9:00a", away: "yetis", home: "loons", awayScore: 4, homeScore: 1, status: "final", isOT: false, isPlayoff: false },
    { id: "1708686", date: "2026-01-24", time: "11:00a", away: "seals", home: "no-regretzkys", awayScore: 7, homeScore: 3, status: "final", isOT: false, isPlayoff: false },
    { id: "1708687", date: "2026-01-24", time: "1:00p", away: "landsharks", home: "reign", awayScore: 4, homeScore: 3, status: "final", isOT: true, isPlayoff: false },
    { id: "1708688", date: "2026-01-31", time: "9:00a", away: "loons", home: "reign", awayScore: 6, homeScore: 1, status: "final", isOT: false, isPlayoff: false },
    { id: "1708689", date: "2026-01-31", time: "11:00a", away: "landsharks", home: "rink-rats", awayScore: 2, homeScore: 4, status: "final", isOT: false, isPlayoff: false },
    { id: "1708690", date: "2026-01-31", time: "1:00p", away: "yetis", home: "no-regretzkys", awayScore: 5, homeScore: 0, status: "final", isOT: false, isPlayoff: false },
    { id: "1708691", date: "2026-02-07", time: "9:00a", away: "yetis", home: "rink-rats", awayScore: 6, homeScore: 3, status: "final", isOT: false, isPlayoff: false },
    { id: "1708692", date: "2026-02-07", time: "11:00a", away: "landsharks", home: "seals", awayScore: 4, homeScore: 3, status: "final", isOT: false, isPlayoff: false },
    { id: "1708693", date: "2026-02-07", time: "1:00p", away: "loons", home: "no-regretzkys", awayScore: 6, homeScore: 3, status: "final", isOT: false, isPlayoff: false },
    { id: "1708694", date: "2026-02-21", time: "9:00a", away: "seals", home: "reign", awayScore: 5, homeScore: 7, status: "final", isOT: false, isPlayoff: false },
    { id: "1708695", date: "2026-02-21", time: "11:00a", away: "rink-rats", home: "no-regretzkys", awayScore: 7, homeScore: 1, status: "final", isOT: false, isPlayoff: false },
    { id: "1708696", date: "2026-02-21", time: "1:00p", away: "landsharks", home: "loons", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: false },
    { id: "1708697", date: "2026-02-28", time: "9:00a", away: "landsharks", home: "no-regretzkys", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: false },
    { id: "1708698", date: "2026-02-28", time: "11:00a", away: "seals", home: "rink-rats", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: false },
    { id: "1708699", date: "2026-02-28", time: "1:00p", away: "yetis", home: "reign", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: false },
    { id: "1708700", date: "2026-03-07", time: "9:00a", away: "reign", home: "landsharks", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: false },
    { id: "1708701", date: "2026-03-07", time: "11:00a", away: "loons", home: "yetis", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: false },
    { id: "1708702", date: "2026-03-07", time: "1:00p", away: "no-regretzkys", home: "seals", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: false },
    { id: "1708703", date: "2026-03-14", time: "9:00a", away: "rink-rats", home: "loons", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: false },
    { id: "1708704", date: "2026-03-14", time: "11:00a", away: "no-regretzkys", home: "reign", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: false },
    { id: "1708705", date: "2026-03-14", time: "1:00p", away: "seals", home: "yetis", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: false },
    { id: "1708706", date: "2026-03-21", time: "9:00a", away: "no-regretzkys", home: "yetis", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: false },
    { id: "1708707", date: "2026-03-21", time: "11:00a", away: "reign", home: "loons", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: false },
    { id: "1708708", date: "2026-03-21", time: "1:00p", away: "rink-rats", home: "landsharks", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: false },
    { id: "1708709", date: "2026-03-28", time: "9:00a", away: "loons", home: "seals", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: false },
    { id: "1708710", date: "2026-03-28", time: "11:00a", away: "yetis", home: "landsharks", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: false },
    { id: "1708711", date: "2026-03-28", time: "1:00p", away: "reign", home: "rink-rats", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: false },
    { id: "1708712", date: "2026-03-29", time: "11:00a", away: "landsharks", home: "landsharks", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: true },
    { id: "1708713", date: "2026-04-11", time: "10:00a", away: "landsharks", home: "landsharks", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: true },
    { id: "1708714", date: "2026-04-11", time: "12:00p", away: "landsharks", home: "landsharks", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: true },
    { id: "1708715", date: "2026-04-12", time: "10:00a", away: "landsharks", home: "landsharks", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: true },
    { id: "1708716", date: "2026-04-12", time: "12:00p", away: "landsharks", home: "landsharks", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: true },
    { id: "1708717", date: "2026-04-18", time: "10:00a", away: "landsharks", home: "landsharks", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: true },
    { id: "1708718", date: "2026-04-18", time: "12:00p", away: "landsharks", home: "landsharks", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: true },
    { id: "1708719", date: "2026-04-19", time: "11:00a", away: "landsharks", home: "landsharks", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: true },
    { id: "1708720", date: "2026-04-25", time: "11:00a", away: "landsharks", home: "landsharks", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: true },
    { id: "1708721", date: "2026-04-26", time: "11:00a", away: "landsharks", home: "landsharks", awayScore: null, homeScore: null, status: "upcoming", isOT: false, isPlayoff: true },
  ]

  console.log(`Inserting ${games.length} games...`)
  for (const g of games) {
    await rawSql(sql`
      INSERT INTO games (id, season_id, date, time, away_team, home_team, away_score, home_score, status, is_overtime, is_playoff, location, has_boxscore)
      VALUES (${g.id}, '2025-2026', ${g.date}, ${g.time}, ${g.away}, ${g.home}, ${g.awayScore}, ${g.homeScore}, ${g.status}, ${g.isOT}, ${g.isPlayoff}, 'James Lick Arena', false)
      ON CONFLICT (id) DO UPDATE SET
        away_score = EXCLUDED.away_score,
        home_score = EXCLUDED.home_score,
        status = EXCLUDED.status,
        is_overtime = EXCLUDED.is_overtime
    `)
  }
  console.log("Games inserted.")

  console.log("Seed complete!")
}

seed().catch(console.error)
