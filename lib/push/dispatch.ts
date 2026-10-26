import { sql } from "drizzle-orm"
import { rawSql } from "@/lib/db"
import { pushConfigured, sendPush } from "./apns"

// A short lease makes concurrent scorekeeper saves and the retry cron safe.
export async function dispatchGameAlerts() {
 if (!pushConfigured()) return { configured: false, sent: 0 }
 const jobs = await rawSql(sql`
  WITH pending AS (
   SELECT event_id,device_id FROM push_deliveries
   WHERE completed_at IS NULL AND next_attempt_at<=now()
   ORDER BY next_attempt_at LIMIT 40 FOR UPDATE SKIP LOCKED
  ) UPDATE push_deliveries d SET next_attempt_at=now()+interval '2 minutes',attempts=attempts+1
   FROM pending p WHERE d.event_id=p.event_id AND d.device_id=p.device_id
   RETURNING d.event_id,d.device_id,d.attempts
 `)
 let sent = 0
 await Promise.all(jobs.map(async job => {
  const complete = (reason: string | null) => rawSql(sql`UPDATE push_deliveries SET completed_at=now(),last_error=${reason} WHERE event_id=${job.event_id}::uuid AND device_id=${job.device_id}::uuid`)
  try {
   const [row] = await rawSql(sql`
    SELECT e.*,d.token,d.environment,d.enabled,d.teams,d.games,g.home_team,g.away_team,
     g.home_score,g.away_score,g.status,h.name home_name,a.name away_name,l.state
    FROM push_events e JOIN push_devices d ON d.id=${job.device_id}::uuid
    JOIN games g ON g.id=e.game_id JOIN teams h ON h.slug=g.home_team JOIN teams a ON a.slug=g.away_team
    LEFT JOIN game_live l ON l.game_id=g.id WHERE e.id=${job.event_id}::uuid
   `)
   if (!row) { await complete("missing"); return }
   const expired = Date.now() - new Date(row.created_at).getTime() > 15 * 60_000
   const following = row.games.includes(row.game_id) || row.teams.includes(row.home_team) || row.teams.includes(row.away_team)
   if (!row.enabled || !following || expired) { await complete("expired_or_unfollowed"); return }
   const goal = row.state?.goals?.find((g: { id: string }) => g.id === row.goal_id)
   if ((row.kind === "goal" && !goal) || (row.kind === "final" && (row.status !== "final" || row.state?.finalizationPending))) { await complete("event_retracted"); return }
   // Read the latest committed result so a queued goal never advertises an obsolete score.
   let title = row.kind === "final" ? "Final score" : "Game started"
   let detail = `${row.away_name} ${row.away_score ?? 0} · ${row.home_name} ${row.home_score ?? 0}`
   if (goal) {
    title = `${goal.team === row.home_team ? row.home_name : row.away_name} goal!`
    const [scorer] = await rawSql(sql`SELECT name FROM players WHERE id=${goal.scorerId}`)
    if (scorer) detail = `${scorer.name} · ${detail}`
   }
   const result = await sendPush({ token: row.token, environment: row.environment, eventID: row.id, gameID: row.game_id, title, body: detail, expires: Math.floor(new Date(row.created_at).getTime()/1000)+900 })
   if (result.status === 200) { sent++; await complete(null) }
   else if (result.status === 410 || result.reason === "BadDeviceToken" || result.reason === "DeviceTokenNotForTopic") {
    // Do not deactivate a token that was refreshed while this request was in flight.
    await rawSql(sql`UPDATE push_devices SET enabled=false WHERE id=${job.device_id}::uuid AND token=${row.token}`)
    await complete(result.reason ?? "invalid_token")
   } else if (job.attempts >= 5) { await complete(result.reason ?? "delivery_failed") }
   else { throw new Error(result.reason ?? `APNs ${result.status}`) }
  } catch (error) {
   const reason = error instanceof Error ? error.message : "delivery_failed"
   await rawSql(sql`UPDATE push_deliveries SET last_error=${reason.slice(0,150)},next_attempt_at=now()+interval '1 minute' * ${Math.min(8, 2 ** job.attempts)} WHERE event_id=${job.event_id}::uuid AND device_id=${job.device_id}::uuid`)
  }
 }))
 // Delete only this feature's expired delivery records; retain event keys to prevent replay.
 await rawSql(sql`DELETE FROM push_deliveries WHERE event_id IN (SELECT id FROM push_events WHERE created_at<now()-interval '7 days')`)
 return { configured: true, sent }
}
