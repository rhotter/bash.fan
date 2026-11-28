import { getSession } from "@/lib/admin-session"
import { findManagerById, parseManagerId } from "./managers"
import { reply } from "./reply"
import { getFantasySeason } from "./season"

export type AdminManagerContext = { params: Promise<{ id: string; managerId: string }> }

/** Checks the admin session, then finds the Manager within the season. Returns the error response if either fails. */
export async function findAdminTarget({ params }: AdminManagerContext) {
  if (!(await getSession())) return reply({ error: "Unauthorized" }, 401)
  const { id, managerId: param } = await params
  const managerId = parseManagerId(param)
  const manager = managerId === null ? null : await findManagerById(managerId)
  if (!manager || manager.seasonId !== id) return reply({ error: "Manager not found" }, 404)
  const season = await getFantasySeason(id, manager.contest)
  if (!season) return reply({ error: "Manager not found" }, 404)
  return { manager, season }
}
