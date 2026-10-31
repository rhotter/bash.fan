import { sql } from "drizzle-orm"
import { rawSql } from "@/lib/db"
import { pushConfigured, sendLiveScore } from "./apns"
import { liveScoreContent } from "./game-content"

export async function dispatchLiveScores() {
 if (!pushConfigured()) return { sent: 0 }
 // Lease subscriptions atomically. A retry always reads the latest committed game.
 const jobs = await rawSql(sql`
  WITH pending AS (
   SELECT p.installation_id,p.activity_id FROM push_activities p
   JOIN games g ON g.id=p.game_id LEFT JOIN game_live l ON l.game_id=g.id
   WHERE p.expires_at>now() AND p.next_attempt_at<=now()
    AND (p.last_signature IS DISTINCT FROM md5(concat(g.status,g.home_score,':',g.away_score,l.state::text))
     OR p.next_attempt_at<now()-interval '60 seconds')
   ORDER BY p.next_attempt_at LIMIT 30 FOR UPDATE OF p SKIP LOCKED
  ) UPDATE push_activities p SET next_attempt_at=now()+interval '30 seconds'
   FROM pending q WHERE p.installation_id=q.installation_id AND p.activity_id=q.activity_id
   RETURNING p.*
 `)
 let sent = 0
 await Promise.all(jobs.map(async job => {
  try {
   const [row] = await rawSql(sql`
    SELECT g.status,g.home_score,g.away_score,g.is_playoff,l.state,
     md5(concat(g.status,g.home_score,':',g.away_score,l.state::text)) AS signature,
     (SELECT json_object_agg(p.id,p.name) FROM players p WHERE p.id IN (
      SELECT (v->>'scorerId')::int FROM jsonb_array_elements(coalesce(l.state->'goals','[]')) v
      UNION SELECT (v->>'assist1Id')::int FROM jsonb_array_elements(coalesce(l.state->'goals','[]')) v
      UNION SELECT (v->>'assist2Id')::int FROM jsonb_array_elements(coalesce(l.state->'goals','[]')) v
     )) AS names
    FROM games g LEFT JOIN game_live l ON l.game_id=g.id WHERE g.id=${job.game_id}
   `)
   if (!row) return
   const content = liveScoreContent({ status: row.status, home_score: row.home_score, away_score: row.away_score, is_playoff: row.is_playoff, state: row.state }, row.names ?? {})
   const result = await sendLiveScore({ token: job.token, environment: job.environment, activityID: job.activity_id, content, final: content.final })
   if (result.status === 200) {
    sent++
    await rawSql(sql`UPDATE push_activities SET last_signature=${row.signature},next_attempt_at=now()+interval '5 seconds',
     expires_at=CASE WHEN ${content.final} THEN now() ELSE expires_at END
     WHERE installation_id=${job.installation_id}::uuid AND activity_id=${job.activity_id} AND token=${job.token}`)
   } else if (result.status === 410 || result.reason === "BadDeviceToken" || result.reason === "DeviceTokenNotForTopic") {
    await rawSql(sql`DELETE FROM push_activities WHERE installation_id=${job.installation_id}::uuid AND activity_id=${job.activity_id} AND token=${job.token}`)
   }
  } catch (error) { console.error("Live score update failed", error instanceof Error ? error.message : "unknown error") }
 }))
 await rawSql(sql`DELETE FROM push_activities WHERE expires_at<now()-interval '1 day'`)
 return { sent }
}
