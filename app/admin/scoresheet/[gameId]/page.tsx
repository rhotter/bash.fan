import { db, schema, rawSql } from "@/lib/db"
import { eq, sql } from "drizzle-orm"
import { notFound } from "next/navigation"
import { AutoPrint } from "./auto-print"
import { GameScoresheet, type ScoresheetGameData, type ScoresheetRosterPlayer } from "@/components/admin/game-scoresheet"
import { mergeScoresheetRosters } from "@/lib/fetch-scoresheets"

/* ─── Data Fetching ─────────────────────────────────────────────────── */

async function getGameData(gameId: string) {
  const rows = await rawSql(sql`
    SELECT
      g.id, g.date, g.time, g.location, g.is_playoff,
      g.game_type, g.status, g.notes,
      g.home_team AS home_slug, g.away_team AS away_slug,
      COALESCE(ht.name, g.home_placeholder, g.home_team, 'TBD') AS home_name,
      COALESCE(at.name, g.away_placeholder, g.away_team, 'TBD') AS away_name,
      COALESCE(s.name, 'Season') AS season_name,
      COALESCE(s.id, g.season_id) AS season_id
    FROM games g
    LEFT JOIN teams ht ON ht.slug = g.home_team
    LEFT JOIN teams at ON at.slug = g.away_team
    LEFT JOIN seasons s ON s.id = g.season_id
    WHERE g.id = ${gameId}
    LIMIT 1
  `)
  return (rows[0] as ScoresheetGameData) || null
}

async function getRoster(seasonId: string | null | undefined, teamSlug: string | null | undefined, gameId: string, teamSide: "home" | "away") {
  const seasonRowsPromise = teamSlug && seasonId
    ? rawSql(sql`
        SELECT
          p.name,
          ps.is_captain,
          ps.is_goalie,
          false AS is_sub
        FROM player_seasons ps
        JOIN players p ON p.id = ps.player_id
        WHERE ps.season_id = ${seasonId}
          AND ps.team_slug = ${teamSlug}
        ORDER BY p.name ASC
      `)
    : Promise.resolve([])

  const adhocRowsPromise = rawSql(sql`
    SELECT
      p.name,
      false AS is_captain,
      false AS is_goalie,
      agr.is_sub
    FROM adhoc_game_rosters agr
    JOIN players p ON p.id = agr.player_id
    WHERE agr.game_id = ${gameId}
      AND agr.team_side = ${teamSide}
    ORDER BY p.name ASC
  `)

  const [seasonRows, adhocRows] = await Promise.all([seasonRowsPromise, adhocRowsPromise])

  return mergeScoresheetRosters(
    seasonRows as ScoresheetRosterPlayer[],
    adhocRows as ScoresheetRosterPlayer[]
  )
}

async function getOfficials(gameId: string) {
  const rows = await db
    .select({ name: schema.gameOfficials.name, role: schema.gameOfficials.role })
    .from(schema.gameOfficials)
    .where(eq(schema.gameOfficials.gameId, gameId))
  return rows
}

/* ─── Page Component ────────────────────────────────────────────────── */

export default async function ScoresheetPage({
  params,
}: {
  params: Promise<{ gameId: string }>
}) {
  const { gameId } = await params

  const game = await getGameData(gameId)
  if (!game) notFound()

  const [homeRoster, awayRoster, officials] = await Promise.all([
    getRoster(game.season_id, game.home_slug, gameId, "home"),
    getRoster(game.season_id, game.away_slug, gameId, "away"),
    getOfficials(gameId),
  ])

  return (
    <>
      <AutoPrint />
      <style>{`
        @page {
          size: letter;
          margin: 0.25in;
        }

        @media print {
          /* Hide non-printable admin UI */
          header,
          nav,
          aside,
          [data-sidebar],
          [data-sidebar="sidebar"],
          [data-sidebar="rail"],
          [data-sonner-toaster],
          .no-print {
            display: none !important;
          }

          html,
          body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
            display: block !important;
            min-height: 0 !important;
            height: auto !important;
            overflow: visible !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          main,
          [data-slot="sidebar-wrapper"],
          [data-slot="sidebar-inset"],
          [data-sidebar="inset"],
          .min-h-screen {
            min-height: 0 !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            display: block !important;
            overflow: visible !important;
          }

          #scoresheet,
          .scoresheet-page {
            box-shadow: none !important;
            margin: 0 !important;
            padding: 4px 6px !important;
            width: 100% !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            box-sizing: border-box !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }

        @media screen {
          body {
            background: #f0f0f0;
          }
          .scoresheet-page {
            max-width: 210mm;
            margin: 20px auto;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          }
        }
      `}</style>

      <GameScoresheet
        id="scoresheet"
        game={game}
        homeRoster={homeRoster}
        awayRoster={awayRoster}
        officials={officials}
        showBackButton={true}
      />
    </>
  )
}
