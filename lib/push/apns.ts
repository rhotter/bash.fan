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
export async function sendPush(input: { token: string; environment: string; eventID: string; gameID: string; title: string; body: string; expires: number }) {
  const jwt = authorization()
  return new Promise<{ status: number; reason?: string }>((resolve, reject) => {
    const client = connect(input.environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com")
    const timer = setTimeout(() => { client.destroy(); reject(new Error("APNs timeout")) }, 10_000)
    const finish = () => { clearTimeout(timer); client.close() }
    client.on("error", error => { finish(); reject(error) })
    const request = client.request({ ":method": "POST", ":path": `/3/device/${input.token}`, authorization: `bearer ${jwt}`, "apns-topic": "fan.bash.league", "apns-push-type": "alert", "apns-priority": "10", "apns-collapse-id": input.eventID, "apns-expiration": String(input.expires) })
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
    request.end(JSON.stringify({ aps: { alert: { title: input.title, body: input.body }, sound: "default", "thread-id": input.gameID }, gameID: input.gameID }))
  })
}
