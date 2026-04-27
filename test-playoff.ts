import { db } from "./lib/db";
import { schema } from "./lib/db";


async function run() {
  const seasonId = "2026-summer";
  const insertData = [
    {
      id: "playoff-1",
      seasonId,
      date: "2026-07-26",
      time: "11:00",
      homeTeam: "tbd",
      awayTeam: "tbd",
      homePlaceholder: "Seed 4",
      awayPlaceholder: "Seed 5",
      location: "James Lick Arena",
      gameType: "playoff" as const,
      isPlayoff: true,
      status: "upcoming" as const,
      bracketRound: "quarterfinal",
      seriesId: "qf-b",
      seriesGameNumber: 1,
      nextGameId: "playoff-3",
      nextGameSlot: "away"
    },
    {
      id: "playoff-3",
      seasonId,
      date: "2026-07-26",
      time: "12:00",
      homeTeam: "tbd",
      awayTeam: "tbd",
      homePlaceholder: "Seed 1",
      awayPlaceholder: null,
      location: "James Lick Arena",
      gameType: "playoff" as const,
      isPlayoff: true,
      status: "upcoming" as const,
      bracketRound: "semifinal",
      seriesId: "sf-a",
      seriesGameNumber: 1,
      nextGameId: null,
      nextGameSlot: null
    }
  ];

  try {
    const idSet = new Set(insertData.map(g => g.id));
    const sorted: typeof insertData = [];
    const remaining = [...insertData];

    while (remaining.length > 0) {
      const batch = remaining.filter(g => 
        !g.nextGameId || !idSet.has(g.nextGameId) || sorted.some(s => s.id === g.nextGameId)
      );
      if (batch.length === 0) {
        sorted.push(...remaining);
        break;
      }
      sorted.push(...batch);
      for (const b of batch) {
        remaining.splice(remaining.indexOf(b), 1);
      }
    }

    console.log("Sorted order:", sorted.map(g => g.id));
    await db.insert(schema.games).values(sorted);
    console.log("Success!");
  } catch (e) {
    console.error("DB Error:", e);
  }
  process.exit(0);
}
run();
