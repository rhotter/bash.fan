import { db } from "./lib/db"
import { games } from "./lib/db/schema"
import { eq } from "drizzle-orm"

async function main() {
  const data = await db.select().from(games).where(eq(games.gameType, "playoff"))
  console.log(JSON.stringify(data, null, 2))
}
main()
