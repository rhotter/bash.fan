/**
 * Shared CSV parsing utilities for Sportability exports.
 * Used by both the roster import and draft pool import endpoints.
 */

/**
 * Normalize a raw Sportability position string into canonical tags.
 *
 * Sportability's `ExpPos` column uses varied formats:
 *   "G, D, F"  "Forward"  "defense or forward"  "Wing"  "Center"
 *   "LW/RW"    "D/F"      "All"  "All, badly"  "Centre, LW"  etc.
 *
 * Returns a deduplicated array of tags from the set ["G", "F", "D"].
 */
export function parsePositionTags(raw: string | null | undefined): ("G" | "F" | "D")[] {
  if (!raw) return []

  // Split on commas, slashes, spaces, and common conjunctions
  const tokens = raw
    .replace(/\band\b/gi, ",")
    .replace(/\bor\b/gi, ",")
    .split(/[,/\s]+/)
    .map(t => t.toLowerCase().trim())
    .filter(Boolean)

  const tags = new Set<"G" | "F" | "D">()

  for (const t of tokens) {
    // Goalie
    if (t === "g" || t === "goalie" || t === "goal" || t === "goalkeeper" || t === "netminder") {
      tags.add("G")
    }
    // Forward
    if (t === "f" || t === "forward" || t === "fw" || t === "fwd"
      || t === "wing" || t === "winger" || t === "lw" || t === "rw"
      || t === "center" || t === "centre" || t === "c") {
      tags.add("F")
    }
    // Defense
    if (t === "d" || t === "defense" || t === "defence" || t === "defenseman" || t === "defenceman") {
      tags.add("D")
    }
    // "All" → all three
    if (t === "all") {
      tags.add("G")
      tags.add("F")
      tags.add("D")
    }
  }

  return Array.from(tags)
}
export function splitCsvRow(line: string): string[] {
  const fields: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++ // skip escaped quote
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current)
      current = ""
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

/**
 * Parse a CSV string into an array of header-keyed row objects.
 *
 * This function handles two concerns:
 *   1. Splitting the raw text into logical lines (respecting quoted fields
 *      that may contain newlines).
 *   2. Delegating per-line field parsing to `splitCsvRow`.
 *
 * IMPORTANT — Quote Preservation (2025-05 fix):
 * The line splitter MUST preserve quote characters (`"`) in the output.
 * Previously, this loop consumed `"` chars to track `inQuotes` state but
 * did NOT emit them into `current`. That stripped quotes from lines before
 * `splitCsvRow` could see them. The result: any field containing a comma
 * inside quotes (e.g. `"Yes, I am new to BASH"`) was silently split into
 * multiple fields, shifting ALL subsequent column values by 1+. This caused
 * Sportability CSV imports to map `ExpSkill` → league names and `ExpPos` →
 * skill levels instead of the correct values.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const lines: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      // Toggle quote tracking for multi-line field detection.
      // Crucially, we emit the quote into `current` so that splitCsvRow
      // can still identify quoted fields and protect interior commas.
      if (inQuotes && text[i + 1] === '"') {
        // Escaped quote ("") — keep both so splitCsvRow can unescape.
        current += '""'
        i++
      } else {
        inQuotes = !inQuotes
        current += '"'
      }
    } else if (ch === "\n" && !inQuotes) {
      lines.push(current)
      current = ""
    } else if (ch === "\r" && !inQuotes) {
      // skip carriage returns
    } else {
      current += ch
    }
  }
  if (current.trim()) lines.push(current)

  if (lines.length < 2) return []

  const headers = splitCsvRow(lines[0])
  return lines.slice(1).map((line) => {
    const values = splitCsvRow(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h.trim()] = (values[i] || "").trim()
    })
    return row
  })
}

/**
 * Parse Sportability registration fields into a normalized RegistrationMeta object.
 * Field names are aligned with the registrations table from prd-registration.md §2.3.
 */
export interface RegistrationMeta {
  // Primary (above the fold in player card)
  age: number | null
  birthdate: string | null
  skillLevel: string | null
  positions: string | null
  gamesExpected: string | null
  playoffAvail: string | null

  // Secondary (below the fold in player card)
  goalieWilling: string | null
  isRookie: boolean
  isNewToBash: boolean | null
  gender: string | null
  buddyReq: string | null
  captainPrev: string | null

  // Context (expanded detail)
  yearsPlayed: number | null
  lastLeague: string | null
  lastTeam: string | null
  miscNotes: string | null
  tshirtSize: string | null
}

function parseBirthdate(raw: string): { birthdate: string | null; age: number | null } {
  if (!raw) return { birthdate: null, age: null }

  // Try MM/DD/YYYY format first (Sportability standard)
  const parts = raw.split("/")
  let date: Date

  if (parts.length === 3) {
    const [month, day, year] = parts.map(Number)
    date = new Date(year, month - 1, day)
  } else {
    // Try ISO format
    date = new Date(raw)
  }

  if (!date || isNaN(date.getTime())) return { birthdate: null, age: null }

  const birthdate = date.toISOString().split("T")[0] // "YYYY-MM-DD"
  const now = new Date()
  let age = now.getFullYear() - date.getFullYear()
  const monthDiff = now.getMonth() - date.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < date.getDate())) {
    age--
  }

  return { birthdate, age }
}

function parseBool(val: string): boolean {
  return ["1", "yes", "true"].includes(val.toLowerCase())
}

export function parseRegistrationMeta(row: Record<string, string>): RegistrationMeta {
  const birthdateResult = parseBirthdate(row["Birthdate"] || "")

  // If CSV has Age column directly, prefer it; otherwise compute from Birthdate
  const csvAge = row["Age"] ? parseInt(row["Age"], 10) : null
  const computedAge = csvAge && !isNaN(csvAge) ? csvAge : birthdateResult.age

  // CustomRestr: "Yes, I am new to BASH" → true, "No, I have played BASH previously" → false
  const customRestr = (row["CustomRestr"] || "").trim()
  let isNewToBash: boolean | null = null
  if (customRestr.toLowerCase().startsWith("yes")) isNewToBash = true
  else if (customRestr.toLowerCase().startsWith("no")) isNewToBash = false

  // ExpYrs parsing
  const expYrsRaw = row["ExpYrs"] || ""
  const expYrs = parseInt(expYrsRaw, 10)

  return {
    age: computedAge,
    birthdate: birthdateResult.birthdate,
    skillLevel: row["ExpSkill"] || null,
    positions: row["ExpPos"] || null,
    gamesExpected: row["CustomQ1"] || null,
    playoffAvail: row["CustomQ3"] || null,
    goalieWilling: row["CustomQ2"] || null,
    isRookie: parseBool(row["Rookie"] || ""),
    isNewToBash,
    gender: row["Gender"] || null,
    buddyReq: row["Buddy Req"] || null,
    captainPrev: row["Captain"] || null,
    yearsPlayed: !isNaN(expYrs) ? expYrs : null,
    lastLeague: row["ExpLeague"] || null,
    lastTeam: row["ExpTeam"] || null,
    miscNotes: row["Notes"] || null,
    tshirtSize: row["TShirt"] || null,
  }
}
