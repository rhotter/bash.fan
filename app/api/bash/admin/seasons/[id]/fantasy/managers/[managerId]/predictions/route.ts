import { findAdminTarget, type AdminManagerContext } from "@/lib/fantasy/admin-route"
import { adminSavePredictions, predictionsRequestSchema } from "@/lib/fantasy/predictions"
import { refreshPublicPages, reply } from "@/lib/fantasy/reply"

/** Saves a Manager's Predictions for them, in a closed or open Week. */
export async function PUT(request: Request, context: AdminManagerContext) {
  try {
    const target = await findAdminTarget(context)
    if (target instanceof Response) return target

    const input = predictionsRequestSchema.safeParse(await request.json().catch(() => null))
    if (!input.success) {
      return reply({ error: "Predictions need whole scores from 0 to 30.", errors: ["bad-score"] }, 400)
    }

    const result = await adminSavePredictions(target.manager, target.season, input.data.weekId, input.data.predictions)
    if (result.outcome === "no-games") return reply({ error: "That Week can't be edited.", ...result }, 409)
    if (result.outcome === "invalid") {
      return reply({ error: "Those Predictions can't be saved.", ...result }, 422)
    }
    refreshPublicPages()
    return reply({ saved: true })
  } catch (error) {
    console.error("Admin Fantasy Predictions save failed:", error)
    return reply({ error: "The Predictions weren't saved. Please try again." }, 500)
  }
}
