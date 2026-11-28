import { getSession } from "@/lib/admin-session"
import { parseManagerId, reissueManagerLink } from "@/lib/fantasy/managers"
import { reply } from "@/lib/fantasy/reply"

type Context = { params: Promise<{ id: string; managerId: string }> }

export async function POST(_request: Request, { params }: Context) {
  if (!(await getSession())) return reply({ error: "Unauthorized" }, 401)
  const { id, managerId: param } = await params
  const managerId = parseManagerId(param)
  if (managerId === null) return reply({ error: "Manager not found" }, 404)
  try {
    const managerPath = await reissueManagerLink(id, managerId)
    if (!managerPath) return reply({ error: "Manager not found" }, 404)
    return reply({ managerPath })
  } catch (error) {
    console.error("Failed to reissue Manager Link:", error)
    return reply({ error: "Could not reissue the link." }, 500)
  }
}
