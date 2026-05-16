import fs from "fs";
import { parseCsv } from "./lib/csv-utils";
import { canonicalizePlayerName } from "./lib/player-name";

const file = "/Users/christorres/Downloads/Summary-of-Registrants (4)/Summary of Registrants-Table 1.csv";
const text = fs.readFileSync(file, "utf8");
const rawData = parseCsv(text);
console.log(`Raw rows: ${rawData.length}`);

const names = rawData.map(r => canonicalizePlayerName(`${r.FirstName} ${r.LastName}`.trim())).filter(n => n.length > 0);
console.log(`Names count: ${names.length}`);

const counts: Record<string, number> = {};
for (const n of names) {
  counts[n] = (counts[n] || 0) + 1;
}

let hasDupes = false;
for (const [n, c] of Object.entries(counts)) {
  if (c > 1) {
    console.log(`Duplicate: ${n} (${c} times)`);
    hasDupes = true;
  }
}
if (!hasDupes) console.log("No duplicates found.");

