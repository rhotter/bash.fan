import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

// --- Nickname mappings (same as find-duplicates.ts) ---
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

function fuzzyNormalize(name: string): string {
  return normalize(name)
    .replace(/['\u2019.\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Union-Find ---
class UnionFind {
  parent: Map<number, number> = new Map();
  rank: Map<number, number> = new Map();

  makeSet(x: number) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
  }

  find(x: number): number {
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)!));
    }
    return this.parent.get(x)!;
  }

  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra)!;
    const rankB = this.rank.get(rb)!;
    if (rankA < rankB) {
      this.parent.set(ra, rb);
    } else if (rankA > rankB) {
      this.parent.set(rb, ra);
    } else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }
}

// --- Best canonical name formatting ---
function toTitleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => {
      if (!w) return w;
      // Preserve internal capitalization for names like "McDonald", "O'Brien"
      // But fix ALL-CAPS or all-lowercase
      if (w === w.toUpperCase() || w === w.toLowerCase()) {
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      }
      return w;
    })
    .join(" ");
}

function pickBestName(names: string[]): string {
  // Prefer "First Last" format (no comma), then pick the longest variant
  // (more complete name), title-cased
  const normalized = names.map((n) => {
    let name = n.trim().replace(/\s+/g, " ");
    // Convert "Last, First" to "First Last"
    if (name.includes(",")) {
      const commaIdx = name.indexOf(",");
      const last = name.slice(0, commaIdx).trim();
      const first = name.slice(commaIdx + 1).trim();
      name = `${first} ${last}`;
    }
    return name;
  });

  // Pick the longest normalized name (more complete/formal first name)
  normalized.sort((a, b) => b.length - a.length);
  return toTitleCase(normalized[0]);
}

async function mergeDuplicates() {
  const players = (await sql`SELECT id, name FROM players ORDER BY id`) as {
    id: number;
    name: string;
  }[];

  console.log(`Total players: ${players.length}`);

  const playerMap = new Map<number, string>();
  for (const p of players) {
    playerMap.set(p.id, p.name);
  }

  // --- Build fuzzy groups (exact match after normalization) ---
  const fuzzyGroups = new Map<string, number[]>();
  for (const p of players) {
    const key = fuzzyNormalize(p.name);
    if (!fuzzyGroups.has(key)) fuzzyGroups.set(key, []);
    fuzzyGroups.get(key)!.push(p.id);
  }

  // --- Union-Find to merge all related players ---
  const uf = new UnionFind();
  for (const p of players) {
    uf.makeSet(p.id);
  }

  // Pass 1: Exact duplicates (same fuzzyNormalize key)
  for (const [, ids] of fuzzyGroups) {
    if (ids.length > 1) {
      for (let i = 1; i < ids.length; i++) {
        uf.union(ids[0], ids[i]);
      }
    }
  }

  // Pass 2: Near-duplicates (nickname/prefix matching)
  const normalizedList = [...fuzzyGroups.entries()].map(([key, ids]) => ({
    key,
    ids,
  }));

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

      // Prefix match (min 3 chars)
      if (
        aFirst.length >= 3 &&
        bFirst.length >= 3 &&
        (aFirst.startsWith(bFirst) || bFirst.startsWith(aFirst))
      ) {
        match = true;
      }

      // Nickname match
      if (!match) {
        const aGroup = getNicknameGroup(aFirst);
        if (aGroup.has(bFirst)) {
          match = true;
        }
      }

      if (match) {
        // Union all IDs from both groups
        const allIds = [...normalizedList[i].ids, ...normalizedList[j].ids];
        for (let k = 1; k < allIds.length; k++) {
          uf.union(allIds[0], allIds[k]);
        }
      }
    }
  }

  // --- Collect merge groups ---
  const groups = new Map<number, number[]>();
  for (const p of players) {
    const root = uf.find(p.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(p.id);
  }

  // Filter to groups with actual duplicates
  const mergeGroups = [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([, ids]) => {
      ids.sort((a, b) => a - b);
      return ids;
    });

  console.log(`Found ${mergeGroups.length} duplicate groups to merge`);

  if (mergeGroups.length === 0) {
    console.log("No duplicates to merge!");
    return;
  }

  // --- Process each merge group ---
  let totalMerged = 0;

  for (const ids of mergeGroups) {
    const canonicalId = ids[0]; // lowest ID
    const dupeIds = ids.slice(1);
    const names = ids.map((id) => playerMap.get(id)!);
    const bestName = pickBestName(names);

    console.log(
      `\nMerging group: ${names.map((n) => `"${n}"`).join(", ")} -> id=${canonicalId} name="${bestName}"`
    );

    for (const dupeId of dupeIds) {
      // --- player_seasons: move references, skip conflicts ---
      // First, find which (season_id) entries the canonical player already has
      const existingSeasons =
        await sql`SELECT season_id FROM player_seasons WHERE player_id = ${canonicalId}`;
      const existingSeasonIds = new Set(
        existingSeasons.map((r: { season_id: string }) => r.season_id)
      );

      // Get the dupe's seasons
      const dupeSeasons =
        await sql`SELECT season_id, team_slug, is_goalie FROM player_seasons WHERE player_id = ${dupeId}`;

      for (const ds of dupeSeasons) {
        if (existingSeasonIds.has(ds.season_id)) {
          // Conflict: canonical already has this season, just delete the dupe's entry
          await sql`DELETE FROM player_seasons WHERE player_id = ${dupeId} AND season_id = ${ds.season_id}`;
        } else {
          // No conflict: reassign to canonical
          await sql`UPDATE player_seasons SET player_id = ${canonicalId} WHERE player_id = ${dupeId} AND season_id = ${ds.season_id}`;
        }
      }

      // --- player_game_stats: move references, sum on conflict ---
      const existingGameStats =
        await sql`SELECT game_id FROM player_game_stats WHERE player_id = ${canonicalId}`;
      const existingGameIds = new Set(
        existingGameStats.map((r: { game_id: string }) => r.game_id)
      );

      const dupeGameStats =
        await sql`SELECT * FROM player_game_stats WHERE player_id = ${dupeId}`;

      for (const dgs of dupeGameStats) {
        if (existingGameIds.has(dgs.game_id)) {
          // Conflict: sum stats into canonical's entry
          await sql`UPDATE player_game_stats SET
            goals = goals + ${dgs.goals},
            assists = assists + ${dgs.assists},
            points = points + ${dgs.points},
            gwg = gwg + ${dgs.gwg},
            ppg = ppg + ${dgs.ppg},
            shg = shg + ${dgs.shg},
            eng = eng + ${dgs.eng},
            hat_tricks = hat_tricks + ${dgs.hat_tricks},
            pen = pen + ${dgs.pen},
            pim = pim + ${dgs.pim}
          WHERE player_id = ${canonicalId} AND game_id = ${dgs.game_id}`;
          await sql`DELETE FROM player_game_stats WHERE player_id = ${dupeId} AND game_id = ${dgs.game_id}`;
        } else {
          // No conflict: reassign to canonical
          await sql`UPDATE player_game_stats SET player_id = ${canonicalId} WHERE player_id = ${dupeId} AND game_id = ${dgs.game_id}`;
        }
      }

      // --- goalie_game_stats: move references, keep the one with more minutes on conflict ---
      const existingGoalieStats =
        await sql`SELECT game_id, minutes FROM goalie_game_stats WHERE player_id = ${canonicalId}`;
      const existingGoalieGameMap = new Map<string, number>();
      for (const r of existingGoalieStats) {
        existingGoalieGameMap.set(
          r.game_id as string,
          r.minutes as number
        );
      }

      const dupeGoalieStats =
        await sql`SELECT * FROM goalie_game_stats WHERE player_id = ${dupeId}`;

      for (const dgg of dupeGoalieStats) {
        if (existingGoalieGameMap.has(dgg.game_id)) {
          const canonicalMinutes = existingGoalieGameMap.get(dgg.game_id)!;
          if ((dgg.minutes as number) > canonicalMinutes) {
            // Dupe has more minutes - replace canonical's entry
            await sql`DELETE FROM goalie_game_stats WHERE player_id = ${canonicalId} AND game_id = ${dgg.game_id}`;
            await sql`UPDATE goalie_game_stats SET player_id = ${canonicalId} WHERE player_id = ${dupeId} AND game_id = ${dgg.game_id}`;
          } else {
            // Canonical has more or equal minutes - just delete dupe's entry
            await sql`DELETE FROM goalie_game_stats WHERE player_id = ${dupeId} AND game_id = ${dgg.game_id}`;
          }
        } else {
          // No conflict: reassign to canonical
          await sql`UPDATE goalie_game_stats SET player_id = ${canonicalId} WHERE player_id = ${dupeId} AND game_id = ${dgg.game_id}`;
        }
      }

      // --- Delete the duplicate player row ---
      await sql`DELETE FROM players WHERE id = ${dupeId}`;
      totalMerged++;
    }

    // --- Update canonical player's name ---
    await sql`UPDATE players SET name = ${bestName} WHERE id = ${canonicalId}`;
  }

  console.log(
    `\nDone! Merged ${totalMerged} duplicate players into ${mergeGroups.length} canonical entries.`
  );
}

mergeDuplicates().catch(console.error);
