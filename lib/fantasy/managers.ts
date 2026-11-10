import { createHash, randomBytes } from "node:crypto"
import { and, asc, eq } from "drizzle-orm"
import { z } from "zod"
import { db, schema } from "@/lib/db"

const { fantasyManagers } = schema

/** What public code may know about a Manager. Real names stay out on purpose. */
export interface ManagerIdentity {
  id: number
  seasonId: string
  contest: string
  teamName: string
}

const identity = {
  id: fantasyManagers.id,
  seasonId: fantasyManagers.seasonId,
  contest: fantasyManagers.contest,
  teamName: fantasyManagers.teamName,
}

const collapsed = (value: string) => value.trim().replace(/\s+/g, " ")
export const teamNameSchema = z.string().transform(collapsed).pipe(z.string().min(1).max(40))
const realName = z.string().transform(collapsed).pipe(z.string().min(1).max(60))

export const registrationSchema = z.object({
  teamName: teamNameSchema,
  firstName: realName,
  lastName: realName,
})

function issueToken() {
  const token = randomBytes(32).toString("base64url")
  return { tokenHash: hashToken(token), managerPath: `/fantasy/m/${token}` }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

/** Returns null if the Team Name is taken. The link is shown only when issued, here or by `reissueManagerLink`. Only its hash is stored. */
export async function createManager(seasonId: string, contest: string, input: z.output<typeof registrationSchema>) {
  const { tokenHash, managerPath } = issueToken()
  try {
    const [row] = await db
      .insert(fantasyManagers)
      .values({ seasonId, contest, tokenHash, ...input })
      .returning({ teamName: fantasyManagers.teamName })
    return { teamName: row.teamName, managerPath }
  } catch (error) {
    // Only the Team Name index means "taken". Any other violation (such as a token hash clash) is a real error.
    if (isUniqueViolation(error) && violatedConstraint(error) === "fantasy_managers_contest_team_name") return null
    throw error
  }
}

export async function findManagerByToken(token: string): Promise<ManagerIdentity | null> {
  const [row] = await db
    .select(identity)
    .from(fantasyManagers)
    .where(eq(fantasyManagers.tokenHash, hashToken(token)))
  return row ?? null
}

/** One Manager's identity wherever they are, for pages that start from the id. */
export async function findManagerById(managerId: number): Promise<ManagerIdentity | null> {
  const [row] = await db.select(identity).from(fantasyManagers).where(eq(fantasyManagers.id, managerId))
  return row ?? null
}

/** Team Names only, for public standings. */
export async function listPublicManagers(seasonId: string, contest: string) {
  return db
    .select({ id: fantasyManagers.id, teamName: fantasyManagers.teamName })
    .from(fantasyManagers)
    .where(inContest(seasonId, contest))
}

function realNameKey(manager: { firstName: string; lastName: string }) {
  return `${collapsed(manager.firstName)}|${collapsed(manager.lastName)}`.toLowerCase()
}

/** Admin-only: includes real names. Same real name flags as a duplicate but isn't blocked. */
export async function listManagers(seasonId: string, contest: string) {
  const rows = await db
    .select({
      id: fantasyManagers.id,
      teamName: fantasyManagers.teamName,
      firstName: fantasyManagers.firstName,
      lastName: fantasyManagers.lastName,
      createdAt: fantasyManagers.createdAt,
    })
    .from(fantasyManagers)
    .where(inContest(seasonId, contest))
    .orderBy(asc(fantasyManagers.createdAt), asc(fantasyManagers.id))

  const counts = new Map<string, number>()
  for (const row of rows) counts.set(realNameKey(row), (counts.get(realNameKey(row)) ?? 0) + 1)
  return rows.map((row) => ({ ...row, duplicate: counts.get(realNameKey(row))! > 1 }))
}

/** Route params are text. An id that isn't a whole number matches no Manager. */
export function parseManagerId(param: string) {
  return /^\d{1,9}$/.test(param) ? Number(param) : null
}

const inContest = (seasonId: string, contest: string) =>
  and(eq(fantasyManagers.seasonId, seasonId), eq(fantasyManagers.contest, contest))

const inSeason = (seasonId: string, managerId: number) =>
  and(eq(fantasyManagers.id, managerId), eq(fantasyManagers.seasonId, seasonId))

export type RenameResult = "renamed" | "not-found" | "taken"

function violatedConstraint(error: unknown) {
  const { constraint, cause } = error as { constraint?: string; cause?: { constraint?: string } }
  return constraint ?? cause?.constraint
}

function isUniqueViolation(error: unknown) {
  const { code, cause } = error as { code?: string; cause?: { code?: string } }
  return code === "23505" || cause?.code === "23505"
}

export async function renameManager(seasonId: string, managerId: number, teamName: string): Promise<RenameResult> {
  try {
    const rows = await db
      .update(fantasyManagers)
      .set({ teamName })
      .where(inSeason(seasonId, managerId))
      .returning({ id: fantasyManagers.id })
    return rows.length > 0 ? "renamed" : "not-found"
  } catch (error) {
    if (isUniqueViolation(error)) return "taken"
    throw error
  }
}

/** Deletes the Manager. Their Lineups and Predictions go with them through the foreign keys. */
export async function removeManager(seasonId: string, managerId: number) {
  const rows = await db
    .delete(fantasyManagers)
    .where(inSeason(seasonId, managerId))
    .returning({ id: fantasyManagers.id })
  return rows.length > 0
}

/** Rotates the token, which invalidates the old link. Returns null if there's no such Manager. */
export async function reissueManagerLink(seasonId: string, managerId: number) {
  const { tokenHash, managerPath } = issueToken()
  const rows = await db
    .update(fantasyManagers)
    .set({ tokenHash })
    .where(inSeason(seasonId, managerId))
    .returning({ id: fantasyManagers.id })
  return rows.length > 0 ? managerPath : null
}
