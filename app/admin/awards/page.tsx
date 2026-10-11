import { formatSeasonName } from "@/lib/season-name"
import { AwardsClient } from "./awards-client"
import { db, schema } from "@/lib/db"
import { desc } from "drizzle-orm"

export const metadata = {
  title: "Awards & HOF | Admin",
}

export default async function AwardsPage() {
  // Pass down seasons so we can construct a season selector in the client
  const allSeasons = await db.query.seasons.findMany({
    orderBy: [desc(schema.seasons.id)],
  })

  // Also get the players to pass as a lookup dictionary for the assignment UI
  const players = await db.query.players.findMany({
    orderBy: [desc(schema.players.id)],
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Awards & Hall of Fame</h1>
          <p className="text-muted-foreground mt-1">Manage seasonal awards and inductees to the BASH Hall of Fame.</p>
        </div>
      </div>
      <AwardsClient seasons={allSeasons.map(season => ({ ...season, name: formatSeasonName(season.name) }))} allPlayers={players} />
    </div>
  )
}
