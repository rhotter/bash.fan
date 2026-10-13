import { fetchApi as fetch, readApiJson } from "@/lib/api-errors"
/** Authenticate without autosaving: finished games reject live-state writes,
 * and a stale open tab must not overwrite newer scores merely to sign in. */
export async function authenticateScorekeeper(gameId: string, status: string, pin: string): Promise<string> {
  const normalizedPin = pin.trim()
  async function post(url: string, fallback: string) {
    let response: Response
    try {
      response = await fetch(url, { method: "POST", headers: { "x-pin": normalizedPin } })
    } catch {
      throw new Error("Network error — try again")
    }
    if (!response.ok) {
      const body = await readApiJson(response).catch(() => null)
      throw new Error(response.status === 401 ? "Invalid PIN" :
        typeof body?.error === "string" ? body.error : fallback)
    }
  }
  await post("/api/bash/admin/validate-pin", "Could not validate PIN. Please try again.")
  if (status !== "live" && status !== "final") {
    await post(`/api/bash/scorekeeper/${gameId}/start`, "Could not open this game. Please try again.")
  }
  return normalizedPin
}
