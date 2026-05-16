import { db, schema } from "./lib/db"
import { eq } from "drizzle-orm"

async function main() {
  const allTeams = await db
    .select({
      teamSlug: schema.seasonTeams.teamSlug,
      teamName: schema.teams.name,
      franchiseSlug: schema.seasonTeams.franchiseSlug,
    })
    .from(schema.seasonTeams)
    .innerJoin(schema.teams, eq(schema.seasonTeams.teamSlug, schema.teams.slug))
    .where(eq(schema.seasonTeams.seasonId, "2026-summer---post-pickup-test"))
  
  console.log("Teams for 2026-summer:")
  console.table(allTeams)
  process.exit(0)
}
main()
