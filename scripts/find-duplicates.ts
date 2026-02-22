import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

// Common nickname mappings
const NICKNAMES: Record<string, string[]> = {
  william: ["will", "bill", "billy", "willy", "liam"],
  richard: ["rich", "rick", "dick", "richie"],
  robert: ["rob", "bob", "bobby", "robbie"],
  edward: ["ed", "eddie", "ted", "teddy", "ned"],
  michael: ["mike", "mikey"],
  james: ["jim", "jimmy", "jamie"],
  john: ["jon", "johnny", "jack"],
  joseph: ["joe", "joey"],
  thomas: ["tom", "tommy"],
  daniel: ["dan", "danny"],
  stephen: ["steve", "steven"],
  steven: ["steve", "stephen"],
  peter: ["pete"],
  christopher: ["chris"],
  nicholas: ["nick", "nic", "nicolas"],
  nicolas: ["nick", "nic", "nicholas"],
  alexander: ["alex"],
  andrew: ["andy", "drew"],
  benjamin: ["ben"],
  charles: ["charlie", "chuck"],
  david: ["dave"],
  donald: ["don", "donnie"],
  douglas: ["doug"],
  eugene: ["gene"],
  francis: ["fran", "frank"],
  frederick: ["fred", "freddy"],
  gregory: ["greg"],
  harold: ["harry", "hal"],
  henry: ["hank", "harry"],
  jeffrey: ["jeff"],
  jonathan: ["jon"],
  joshua: ["josh"],
  kenneth: ["ken", "kenny"],
  lawrence: ["larry"],
  leonard: ["len", "lenny"],
  matthew: ["matt"],
  patrick: ["pat"],
  philip: ["phil"],
  raymond: ["ray"],
  ronald: ["ron", "ronnie"],
  samuel: ["sam", "sammy"],
  theodore: ["theo", "ted", "teddy"],
  timothy: ["tim", "timmy"],
  vincent: ["vince", "vinny"],
  walter: ["walt"],
  zachary: ["zach", "zack"],
  elizabeth: ["liz", "beth", "lizzy"],
  margaret: ["maggie", "meg", "peggy"],
  katherine: ["kate", "kathy", "kat"],
  gerald: ["gerry", "jerry"],
  glen: ["glenn"],
  glenn: ["glen"],
};

// Build nickname group: all names that could refer to the same person
function getNicknameGroup(name: string): Set<string> {
  const group = new Set<string>([name]);
  if (NICKNAMES[name]) {
    for (const n of NICKNAMES[name]) group.add(n);
  }
  for (const [canonical, nicks] of Object.entries(NICKNAMES)) {
    if (nicks.includes(name)) {
      group.add(canonical);
      for (const n of nicks) group.add(n);
    }
  }
  return group;
}

// Normalize: collapse spaces, flip "Last, First" -> "first last", lowercase
function normalize(name: string): string {
  let trimmed = name.trim().toLowerCase();
  trimmed = trimmed.replace(/\s+/g, " ");
  if (trimmed.includes(",")) {
    const commaIdx = trimmed.indexOf(",");
    const last = trimmed.slice(0, commaIdx).trim();
    const first = trimmed.slice(commaIdx + 1).trim();
    return `${first} ${last}`;
  }
  return trimmed;
}

// Further normalize: strip apostrophes, periods, hyphens
function fuzzyNormalize(name: string): string {
  return normalize(name)
    .replace(/['\u2019.\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function findDuplicates() {
  const players = await sql`SELECT id, name FROM players ORDER BY name`;

  // --- Pass 1: Exact match after full normalization ---
  const fuzzyGroups = new Map<string, Array<{ id: number; name: string }>>();
  for (const p of players) {
    const key = fuzzyNormalize(p.name);
    if (!fuzzyGroups.has(key)) fuzzyGroups.set(key, []);
    fuzzyGroups.get(key)!.push({ id: p.id, name: p.name });
  }

  const exactDupes = [...fuzzyGroups.entries()].filter(
    ([_, v]) => v.length > 1
  );
  console.log(`=== EXACT DUPLICATES (${exactDupes.length} groups) ===\n`);
  for (const [normalized, entries] of exactDupes) {
    console.log(`  "${normalized}":`);
    for (const e of entries) {
      console.log(`    id=${e.id}  name="${e.name}"`);
    }
  }

  // --- Pass 2: Nickname / prefix matches across groups ---
  console.log(`\n=== NEAR-DUPLICATES (nickname/prefix matches) ===\n`);
  const normalizedList = [...fuzzyGroups.entries()].map(([key, entries]) => ({
    key,
    entries,
  }));
  const seen = new Set<string>();

  for (let i = 0; i < normalizedList.length; i++) {
    for (let j = i + 1; j < normalizedList.length; j++) {
      const a = normalizedList[i].key;
      const b = normalizedList[j].key;
      const aParts = a.split(" ").filter(Boolean);
      const bParts = b.split(" ").filter(Boolean);

      if (aParts.length < 2 || bParts.length < 2) continue;

      const aFirst = aParts[0];
      const bFirst = bParts[0];
      const aLast = aParts.slice(1).join(" ");
      const bLast = bParts.slice(1).join(" ");

      if (aLast !== bLast) continue;
      if (aFirst === bFirst) continue;

      let match = false;
      let reason = "";

      // Check prefix (min 3 chars to avoid false positives like "E" matching "Ed")
      if (
        aFirst.length >= 3 &&
        bFirst.length >= 3 &&
        (aFirst.startsWith(bFirst) || bFirst.startsWith(aFirst))
      ) {
        match = true;
        reason = "prefix";
      }

      // Check nickname mapping
      if (!match) {
        const aGroup = getNicknameGroup(aFirst);
        if (aGroup.has(bFirst)) {
          match = true;
          reason = "nickname";
        }
      }

      if (match) {
        const pairKey = [a, b].sort().join("|");
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        console.log(`  [${reason}] "${a}" <-> "${b}":`);
        for (const e of normalizedList[i].entries)
          console.log(`    id=${e.id}  name="${e.name}"`);
        for (const e of normalizedList[j].entries)
          console.log(`    id=${e.id}  name="${e.name}"`);
        console.log();
      }
    }
  }
}

findDuplicates().catch(console.error);
