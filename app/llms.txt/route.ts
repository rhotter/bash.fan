import { getCurrentSeason } from "@/lib/seasons"

export async function GET() {
  const current = await getCurrentSeason()

  const content = `# bash.fan — Bay Area Street Hockey (BASH) League API

Public, read-only JSON API for BASH league data: games, standings, player/team stats, box scores, and live game state. Data syncs daily from Sportability.

Base URL: https://bash.fan

## Conventions

- All endpoints return JSON. GET only. No auth.
- Seasons are identified by id (e.g. \`${current.id}\`, \`2024-2025\`, \`2024-summer\`). The current season is \`${current.id}\`. Pass \`?season=all\` for all-time stats where supported.
- Player URLs use a name-derived slug (lowercase, special chars stripped). Team URLs use a team slug.
- \`status\` is one of \`final\`, \`upcoming\`, \`live\`.
- Standings points: W=3, OTW=2, OTL=1, L=0. Tiebreakers: points → goal differential → goals for. Playoff games excluded from standings.

## Endpoints

- \`GET /api/bash/seasons\` — List all seasons with \`hasGames\`/\`hasStats\` flags. Use this first to discover valid season ids.
- \`GET /api/bash?season={id}\` — Games + computed standings for one season. Default: current season.
- \`GET /api/bash/players?season={id}&playoff={true|false}\` — Season skater + goalie stat leaderboards.
- \`GET /api/bash/player/{slug}?season={id|all}\` — Player detail: regular + playoff stats (season/all-time/per-season), game logs, championships, awards, hall of fame.
- \`GET /api/bash/team/{slug}?season={id}\` — Team roster with per-player stats and team record.
- \`GET /api/bash/game/{id}\` — Game detail with box score (skaters + goalies per team).
- \`GET /api/bash/game/{id}/live\` — Live game state (clock, period, live stats). 404 if not live.
- \`GET /api/bash/players/search\` — Lightweight list of current-season players (name, slug, team). Use for name → slug lookup.
- \`GET /api/bash/refs\` — Referee stats (games officiated, penalties called).

## Tips for agents

- To answer "how is {player} doing this season", call \`/api/bash/players/search\` to resolve the slug, then \`/api/bash/player/{slug}\`.
- To answer "what's the score of {team}'s last game", call \`/api/bash\` (defaults to current season) and filter the \`games\` array — it's already sorted by date.
- Live games have \`status: "live"\` and \`hasLiveStats: true\` in the games list; fetch \`/api/bash/game/{id}/live\` for period/clock.
- Prefer the aggregate \`/api/bash\` endpoint over many per-game calls when building a season overview.
`

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  })
}
