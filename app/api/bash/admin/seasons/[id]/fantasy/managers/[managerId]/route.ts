import { z } from "zod"
import { getSession } from "@/lib/admin-session"
import { parseManagerId, removeManager, renameManager, teamNameSchema } from "@/lib/fantasy/managers"
import { refreshPublicPages, reply } from "@/lib/fantasy/reply"

type Context = { params: Promise<{ id: string; managerId: string }> }

const renameSchema = z.object({ teamName: teamNameSchema })

export async function PATCH(request: Request, { params }: Context) {
  if (!(await getSession())) return reply({ error: "Unauthorized" }, 401)
  const { id, managerId: param } = await params
  const managerId = parseManagerId(param)
  if (managerId === null) return reply({ error: "Manager not found" }, 404)
  try {
    const input = renameSchema.safeParse(await request.json().catch(() => null))
    if (!input.success) return reply({ error: "Enter a Team Name of up to 40 characters." }, 400)

    const result = await renameManager(id, managerId, input.data.teamName)
    if (result === "not-found") return reply({ error: "Manager not found" }, 404)
    if (result === "taken") return reply({ error: "That Team Name is taken." }, 409)
    // The public pages are cached, and a removed or renamed Manager should not linger on them.
    refreshPublicPages()
    return reply({ teamName: input.data.teamName })
  } catch (error) {
    console.error("Failed to rename Manager:", error)
    return reply({ error: "Could not rename the Manager." }, 500)
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  if (!(await getSession())) return reply({ error: "Unauthorized" }, 401)
  const { id, managerId: param } = await params
  const managerId = parseManagerId(param)
  if (managerId === null) return reply({ error: "Manager not found" }, 404)
  try {
    if (!(await removeManager(id, managerId))) return reply({ error: "Manager not found" }, 404)
    refreshPublicPages()
    return reply({ removed: true })
  } catch (error) {
    console.error("Failed to remove Manager:", error)
    return reply({ error: "Could not remove the Manager." }, 500)
  }
}
