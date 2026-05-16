import fs from "fs";
import { parseCsv } from "./lib/csv-utils";

function checkFile(file: string) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  const data = parseCsv(text);
  const names = data.map(r => `${r.FirstName} ${r.LastName}`.trim()).filter(n => n.length > 0);
  const counts: Record<string, number> = {};
  for (const n of names) {
    counts[n] = (counts[n] || 0) + 1;
  }
  for (const [n, c] of Object.entries(counts)) {
    if (c > 1) {
      console.log(`Duplicate in ${file}: ${n} (${c} times)`);
    }
  }
}

checkFile(".test-import.csv");
checkFile("BASH 2024-2025_Players-Extended.csv");
checkFile("BASH 2024 Summer_Players-Extended.csv");
