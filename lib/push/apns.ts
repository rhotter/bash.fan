import { createPrivateKey, sign } from "node:crypto"
import { connect } from "node:http2"

let cached: { token: string; expires: number } | undefined
export function pushConfigured() {
  return Boolean(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_PRIVATE_KEY)
}
function authorization() {
  if (cached && cached.expires > Date.now()) return cached.token
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const body = encode({ alg: "ES256", kid: process.env.APNS_KEY_ID }) + "." + encode({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) })
  const key = createPrivateKey(process.env.APNS_PRIVATE_KEY!.replace(/\\n/g, "\n"))
  const token = body + "." + sign("sha256", Buffer.from(body), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")
  cached = { token, expires: Date.now() + 40 * 60_000 }
  return token
}
export async function sendPush(input: { token: string; environment: string; eventID: string; gameID: string; title: string; body: string; expires: number; goal?: { teamSlug: string; scoreLine: string; scorerLine: string; assistLine: string } }) {
  return sendAPNs({ ...input, topic: "fan.bash.league", type: "alert", priority: "10",
    payload: { aps: { alert: { title: input.title, body: input.body }, sound: "default", "thread-id": input.gameID, ...(input.goal ? { "mutable-content": 1, category: "BASH_GOAL" } : {}) }, gameID: input.gameID, ...input.goal } })
}

export function sendLiveScore(input: { token: string; environment: string; activityID: string; content: object; final: boolean }) {
  const now = Math.floor(Date.now() / 1000)
  return sendAPNs({ ...input, eventID: input.activityID, expires: now + 300,
    topic: "fan.bash.league.push-type.liveactivity", type: "liveactivity", priority: input.final ? "10" : "5",
    payload: { aps: { timestamp: now, event: input.final ? "end" : "update", "content-state": input.content,
      "stale-date": now + 180, ...(input.final ? { "dismissal-date": now + 900 } : {}) } } })
}

async function sendAPNs(input: { token: string; environment: string; eventID: string; expires: number; topic: string; type: string; priority: string; payload: object }) {
  const jwt = authorization()
  return new Promise<{ status: number; reason?: string }>((resolve, reject) => {
    const client = connect(input.environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com")
    const timer = setTimeout(() => { client.destroy(); reject(new Error("APNs timeout")) }, 10_000)
    const finish = () => { clearTimeout(timer); client.close() }
    client.on("error", error => { finish(); reject(error) })
    const request = client.request({ ":method": "POST", ":path": `/3/device/${input.token}`, authorization: `bearer ${jwt}`, "apns-topic": input.topic, "apns-push-type": input.type, "apns-priority": input.priority, "apns-collapse-id": input.eventID, "apns-expiration": String(input.expires) })
    let status = 0, body = ""
    request.on("response", headers => { status = Number(headers[":status"]) })
    request.on("data", chunk => { body += chunk })
    request.on("error", error => { finish(); reject(error) })
    request.on("end", () => {
      finish()
      let reason: string | undefined
      try { reason = JSON.parse(body).reason } catch { /* success has no body */ }
      resolve({ status, reason })
    })
    request.end(JSON.stringify(input.payload))
  })
}
