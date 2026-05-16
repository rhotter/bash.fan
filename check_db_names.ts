import { parseCsv } from "./lib/csv-utils";
import { canonicalizePlayerName, normalizePlayerName } from "./lib/player-name";
import fs from "fs";
import { db, schema } from "./lib/db";
import { inArray } from "drizzle-orm";

async function run() {
  const file = "/Users/christorres/Downloads/Summary-of-Registrants (4)/Summary of Registrants-Table 1.csv";
  const text = fs.readFileSync(file, "utf8");
  const rawData = parseCsv(text);
  const players = rawData.map(r => canonicalizePlayerName(`${r.FirstName} ${r.LastName}`.trim())).filter(n => n.length > 0);

  const existingPlayers = await db
      .select({ id: schema.players.id, name: schema.players.name })
      .from(schema.players);

  const existingPlayersByNormalized = new Map<string, { id: number; name: string }>();
  for (const player of existingPlayers) {
    const normalizedName = normalizePlayerName(player.name)
    if (!existingPlayersByNormalized.has(normalizedName)) {
      existingPlayersByNormalized.set(normalizedName, player)
    }
  }

  const uniqueNamesByNormalized = new Map<string, string>()
  for (const p of players) {
    uniqueNamesByNormalized.set(normalizePlayerName(p), p)
  }

  const dbPlayers = await db
      .select({ id: schema.players.id, name: schema.players.name })
      .from(schema.players)
      .where(inArray(schema.players.name, Array.from(uniqueNamesByNormalized.values())))

  const nameToIdMap = new Map(
      dbPlayers.map((player) => [normalizePlayerName(player.name), player.id])
  );

  let missing = 0;
  for (const p of players) {
    const pId = nameToIdMap.get(normalizePlayerName(p));
    if (!pId) {
      console.log(`Missing ID for player: ${p}`);
      const dbMatch = existingPlayersByNormalized.get(normalizePlayerName(p));
      console.log(`  -> Exists in DB as: ${dbMatch?.name}`);
      missing++;
    }
  }
  console.log(`Total missing: ${missing}`);
  process.exit(0);
}

run().catch(console.error);
