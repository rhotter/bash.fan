import { rawSql } from "@/lib/db"
import { sql } from "drizzle-orm"

const NICKNAMES: Record<string, string[]> = {
  william: ["will", "bill", "billy", "willy", "liam"],
  richard: ["rich", "rick", "dick", "richie"],
  robert: ["rob", "bob", "bobby", "robbie"],
  edward: ["ed", "eddie", "ted", "teddy", "ned"],
  michael: ["mike", "mikey"],
  james: ["jim", "jimmy", "jamie"],
  john: ["jon", "johnny", "jack", "jonathan"],
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
  jonathan: ["jon", "john"],
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
}

function getNicknameGroup(name: string): Set<string> {
  const group = new Set<string>([name])
  if (NICKNAMES[name]) {
    for (const n of NICKNAMES[name]) group.add(n)
  }
  for (const [canonical, nicks] of Object.entries(NICKNAMES)) {
    if (nicks.includes(name)) {
      group.add(canonical)
      for (const n of nicks) group.add(n)
    }
  }
  return group
}

function normalize(name: string): string {
  let trimmed = name.trim().toLowerCase()
  trimmed = trimmed.replace(/\s+/g, " ")
  if (trimmed.includes(",")) {
    const commaIdx = trimmed.indexOf(",")
    const last = trimmed.slice(0, commaIdx).trim()
    const first = trimmed.slice(commaIdx + 1).trim()
    return `${first} ${last}`
  }
  return trimmed
}

function fuzzyNormalize(name: string): string {
  return normalize(name)
    .replace(/['\u2019.-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

class UnionFind {
  parent: Map<number, number> = new Map()
  rank: Map<number, number> = new Map()

  makeSet(x: number) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x)
      this.rank.set(x, 0)
    }
  }

  find(x: number): number {
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)!))
    }
    return this.parent.get(x)!
  }

  union(a: number, b: number) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    const rankA = this.rank.get(ra)!
    const rankB = this.rank.get(rb)!
    if (rankA < rankB) {
      this.parent.set(ra, rb)
    } else if (rankA > rankB) {
      this.parent.set(rb, ra)
    } else {
      this.parent.set(rb, ra)
      this.rank.set(ra, rankA + 1)
    }
  }
}

function toTitleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => {
      if (!w) return w
      if (/^[a-zA-Z]\.([a-zA-Z]\.)*$/.test(w)) {
        return w.toUpperCase()
      }
      if (w === w.toUpperCase() || w === w.toLowerCase()) {
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      }
      return w
    })
    .join(" ")
}

function pickBestName(names: string[]): string {
  const normalized = names.map((n) => {
    let name = n.trim().replace(/\s+/g, " ")
    if (name.includes(",")) {
      const commaIdx = name.indexOf(",")
      const last = name.slice(0, commaIdx).trim()
      const first = name.slice(commaIdx + 1).trim()
      name = `${first} ${last}`
    }
    return name
  })
  normalized.sort((a, b) => b.length - a.length)
  return toTitleCase(normalized[0])
}

export async function mergeDuplicatePlayers() {
  const players = (await rawSql(sql`SELECT id, name FROM players ORDER BY id`)) as {
    id: number
    name: string
  }[]

  const playerMap = new Map<number, string>()
  for (const p of players) {
    playerMap.set(p.id, p.name)
  }

  const fuzzyGroups = new Map<string, number[]>()
  for (const p of players) {
    const key = fuzzyNormalize(p.name)
    if (!fuzzyGroups.has(key)) fuzzyGroups.set(key, [])
    fuzzyGroups.get(key)!.push(p.id)
  }

  const uf = new UnionFind()
  for (const p of players) {
    uf.makeSet(p.id)
  }

  // Pass 1: Exact duplicates (same fuzzyNormalize key)
  for (const [, ids] of fuzzyGroups) {
    if (ids.length > 1) {
      for (let i = 1; i < ids.length; i++) {
        uf.union(ids[0], ids[i])
      }
    }
  }

  // Pass 2: Near-duplicates (nickname/prefix matching)
  const normalizedList = [...fuzzyGroups.entries()].map(([key, ids]) => ({
    key,
    ids,
  }))

  for (let i = 0; i < normalizedList.length; i++) {
    for (let j = i + 1; j < normalizedList.length; j++) {
      const a = normalizedList[i].key
      const b = normalizedList[j].key
      const aParts = a.split(" ").filter(Boolean)
      const bParts = b.split(" ").filter(Boolean)

      if (aParts.length < 2 || bParts.length < 2) continue

      const aFirst = aParts[0]
      const bFirst = bParts[0]
      const aLast = aParts.slice(1).join(" ")
      const bLast = bParts.slice(1).join(" ")

      if (aLast !== bLast) continue
      if (aFirst === bFirst) continue

      let match = false

      if (
        aFirst.length >= 3 &&
        bFirst.length >= 3 &&
        (aFirst.startsWith(bFirst) || bFirst.startsWith(aFirst))
      ) {
        match = true
      }

      if (!match) {
        const aGroup = getNicknameGroup(aFirst)
        if (aGroup.has(bFirst)) {
          match = true
        }
      }

      if (match) {
        const allIds = [...normalizedList[i].ids, ...normalizedList[j].ids]
        for (let k = 1; k < allIds.length; k++) {
          uf.union(allIds[0], allIds[k])
        }
      }
    }
  }

  const groups = new Map<number, number[]>()
  for (const p of players) {
    const root = uf.find(p.id)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(p.id)
  }

  const mergeGroups = [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([, ids]) => {
      ids.sort((a, b) => a - b)
      return ids
    })

  if (mergeGroups.length === 0) {
    return { merged: 0, groups: 0 }
  }

  let totalMerged = 0
  const CONCURRENCY = 20

  async function mergeGroup(ids: number[]) {
    const canonicalId = ids[0]
    const dupeIds = ids.slice(1)
    const names = ids.map((id) => playerMap.get(id)!)
    const bestName = pickBestName(names)

    for (const dupeId of dupeIds) {
      await rawSql(sql`
        DELETE FROM player_seasons
        WHERE player_id = ${dupeId}
          AND (season_id, team_slug) IN (
            SELECT season_id, team_slug FROM player_seasons WHERE player_id = ${canonicalId}
          )
      `)
      await rawSql(sql`UPDATE player_seasons SET player_id = ${canonicalId} WHERE player_id = ${dupeId}`)

      await rawSql(sql`
        DELETE FROM player_game_stats
        WHERE player_id = ${dupeId}
          AND game_id IN (SELECT game_id FROM player_game_stats WHERE player_id = ${canonicalId})
      `)
      await rawSql(sql`UPDATE player_game_stats SET player_id = ${canonicalId} WHERE player_id = ${dupeId}`)

      await rawSql(sql`
        DELETE FROM goalie_game_stats d
        USING goalie_game_stats c
        WHERE d.player_id = ${dupeId} AND c.player_id = ${canonicalId}
          AND d.game_id = c.game_id AND c.seconds >= d.seconds
      `)
      await rawSql(sql`
        DELETE FROM goalie_game_stats
        WHERE player_id = ${canonicalId}
          AND game_id IN (SELECT game_id FROM goalie_game_stats WHERE player_id = ${dupeId})
      `)
      await rawSql(sql`UPDATE goalie_game_stats SET player_id = ${canonicalId} WHERE player_id = ${dupeId}`)

      await rawSql(sql`
        DELETE FROM player_season_stats
        WHERE player_id = ${dupeId}
          AND (season_id, team_slug, is_playoff) IN (
            SELECT season_id, team_slug, is_playoff FROM player_season_stats WHERE player_id = ${canonicalId}
          )
      `)
      await rawSql(sql`UPDATE player_season_stats SET player_id = ${canonicalId} WHERE player_id = ${dupeId}`)

      await rawSql(sql`UPDATE player_awards SET player_id = ${canonicalId} WHERE player_id = ${dupeId}`)
      await rawSql(sql`UPDATE hall_of_fame SET player_id = ${canonicalId} WHERE player_id = ${dupeId}`)

      await rawSql(sql`DELETE FROM players WHERE id = ${dupeId}`)
      totalMerged++
    }

    await rawSql(sql`UPDATE players SET name = ${bestName} WHERE id = ${canonicalId}`)
    console.log(
      `Merged: ${names.map((n) => `"${n}"`).join(", ")} -> id=${canonicalId} name="${bestName}"`
    )
  }

  let i = 0
  async function worker() {
    while (i < mergeGroups.length) {
      const idx = i++
      await mergeGroup(mergeGroups[idx])
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  return { merged: totalMerged, groups: mergeGroups.length }
}
