import { z } from "zod"
import { findAdminTarget, type AdminManagerContext } from "@/lib/fantasy/admin-route"
import { adminSaveLineup, lineupRequestSchema } from "@/lib/fantasy/lineups"
import { refreshPublicPages, reply } from "@/lib/fantasy/reply"

const requestSchema = lineupRequestSchema.extend({ overrideCap: z.boolean().optional() })

/** Saves a Manager's Lineup for them, in a closed or open Week. */
export async function PUT(request: Request, context: AdminManagerContext) {
  try {
    const target = await findAdminTarget(context)
    if (target instanceof Response) return target

    const input = requestSchema.safeParse(await request.json().catch(() => null))
    if (!input.success) return reply({ error: "That Lineup couldn't be read." }, 400)

    const { weekId, lineup, overrideCap } = input.data
    const result = await adminSaveLineup(target.manager, target.season, weekId, lineup, { overrideCap })
    if (result.outcome === "no-games") return reply({ error: "That Week can't be edited.", ...result }, 409)
    if (result.outcome === "invalid") return reply({ error: "That Lineup can't be saved.", ...result }, 422)
    refreshPublicPages()
    return reply({ saved: true })
  } catch (error) {
    console.error("Admin Fantasy Lineup save failed:", error)
    return reply({ error: "The Lineup wasn't saved. Please try again." }, 500)
  }
}
