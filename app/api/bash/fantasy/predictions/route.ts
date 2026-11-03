import { findManagerByToken } from "@/lib/fantasy/managers"
import { predictionsRequestSchema, savePredictions } from "@/lib/fantasy/predictions"
import { reply } from "@/lib/fantasy/reply"
import { getFantasySeason } from "@/lib/fantasy/season"

const INVALID_LINK = "This Manager Link isn't valid. Ask an admin to reissue it."

export async function PUT(request: Request) {
  try {
    const token = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1]
    const manager = token ? await findManagerByToken(token) : null
    if (!manager) return reply({ error: INVALID_LINK }, 401)

    const input = predictionsRequestSchema.safeParse(await request.json().catch(() => null))
    if (!input.success) {
      return reply({ error: "Predictions need whole scores from 0 to 30.", errors: ["bad-score"] }, 400)
    }

    const season = await getFantasySeason(manager.seasonId, manager.contest)
    if (!season) return reply({ error: INVALID_LINK }, 401)

    const result = await savePredictions(manager, season, input.data.weekId, input.data.predictions)
    if (result.outcome === "locked") {
      return reply({ error: "This Week has closed. Reload to predict the next Week.", ...result }, 409)
    }
    if (result.outcome === "no-games") {
      return reply({ error: "There are no games this Week.", ...result }, 409)
    }
    if (result.outcome === "invalid") {
      return reply({ error: "Those Predictions can't be saved.", errors: result.errors }, 422)
    }
    return reply({ saved: true })
  } catch (error) {
    console.error("Fantasy Predictions save failed:", error)
    return reply({ error: "Your Predictions weren't saved. Please try again." }, 500)
  }
}
