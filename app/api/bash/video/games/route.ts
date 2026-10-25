import { randomBytes, randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { rawSql } from "@/lib/db"
import { adminVideo, digestToken, fail, videoHandler } from "@/lib/video/server"
export const runtime = "nodejs"

export async function GET() { return videoHandler(async () => {
  await adminVideo()
  const games = await rawSql(sql`SELECT g.id, g.date, g.time, g.status, g.location,
    home.name AS "homeTeam", away.name AS "awayTeam"
    FROM games g JOIN seasons s ON s.id = g.season_id
    JOIN teams home ON home.slug = g.home_team JOIN teams away ON away.slug = g.away_team
    WHERE s.is_current = true
    ORDER BY (g.status = 'live') DESC,
      (g.date >= to_char(now() AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD') AND g.status <> 'final') DESC,
      CASE WHEN g.date >= to_char(now() AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD') THEN g.date END ASC,
      g.date DESC, g.time ASC LIMIT 100`)
  return Response.json({ games })
}) }

export async function POST(request: Request) { return videoHandler(async () => {
  await adminVideo()
  const { gameId, side } = z.object({ gameId: z.string().min(1).max(100), side: z.enum(["left", "right"]) }).parse(await request.json())
  const [game] = await rawSql(sql`SELECT g.id, home.name AS home, away.name AS away FROM games g
    JOIN teams home ON home.slug = g.home_team JOIN teams away ON away.slug = g.away_team WHERE g.id = ${gameId}`)
  if (!game) fail("Game not found", 404)
  // The partial unique index makes concurrent phone joins converge on one open session.
  const [session] = await rawSql(sql`INSERT INTO video_sessions (id, title, game_id)
    VALUES (${randomUUID()}, ${`${game.away} at ${game.home}`}, ${gameId})
    ON CONFLICT (game_id) WHERE ended_at IS NULL AND game_id IS NOT NULL
    DO UPDATE SET game_id = EXCLUDED.game_id RETURNING id`)
  const token = randomBytes(32).toString("base64url")
  const claimed = await rawSql(sql`INSERT INTO video_cameras (session_id, side, token_hash, token_expires_at)
    VALUES (${session.id}, ${side}, ${digestToken(token)}, now() + interval '7 days')
    ON CONFLICT (session_id, side) DO UPDATE SET token_hash = EXCLUDED.token_hash, token_expires_at = EXCLUDED.token_expires_at
    WHERE video_cameras.token_hash IS NULL OR video_cameras.token_expires_at <= now()
    RETURNING side`)
  if (!claimed.length) fail("That camera is already paired. Choose the other side, or use Pair again on the game's website page to replace it.", 409)
  return Response.json({ sessionId: session.id, side, token }, { status: 201 })
}) }
