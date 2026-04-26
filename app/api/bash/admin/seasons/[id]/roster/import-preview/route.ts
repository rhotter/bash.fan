import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { getSession } from "@/lib/admin-session"
import { inArray, eq, and } from "drizzle-orm"

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * Parse a CSV string into an array of objects keyed by header names.
 * Handles quoted fields (including fields with commas and newlines inside quotes).
 */
function parseCsv(text: string): Record<string, string>[] {
  const lines: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"'
        i++ // skip escaped quote
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === "\n" && !inQuotes) {
      lines.push(current)
      current = ""
    } else if (ch === "\r" && !inQuotes) {
      // skip carriage return
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

function splitCsvRow(line: string): string[] {
  const fields: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
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

export async function POST(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 })
    }

    const text = await file.text()
    const rawData = parseCsv(text)

    if (rawData.length === 0) {
      return NextResponse.json({ error: "CSV file is empty or has no data rows." }, { status: 400 })
    }

    // Log available headers for debugging if expected columns are missing
    const headers = Object.keys(rawData[0])

    // Fetch all existing team slugs to validate team assignments
    const allTeams = await db.select({ slug: schema.teams.slug }).from(schema.teams)
    const validTeamSlugs = new Set(allTeams.map((t) => t.slug))

    // 1. Data Mapping
    const mappedPlayers = rawData.map((row) => {
      // Name
      const firstName = row["FirstName"]?.trim() || ""
      const lastName = row["LastName"]?.trim() || ""
      const playerName = `${firstName} ${lastName}`.trim()

      // Team
      const rawTeam = row["Team"]?.trim() || ""
      let teamSlug = rawTeam.toLowerCase().replace(/\s+/g, '-')
      if (!validTeamSlugs.has(teamSlug)) {
        teamSlug = "tbd"
      }

      // Position
      const positionStr = (row["ExpPos"] || row["Position"] || "").toLowerCase()
      const isGoalie = positionStr.includes("goalie")

      // Rookie (trust sportability)
      const rookieStr = row["Rookie"] || "0"
      const isRookie = rookieStr === "1" || rookieStr.toLowerCase() === "true" || rookieStr.toLowerCase() === "yes"

      return {
        playerName,
        teamSlug,
        isGoalie,
        isRookie
      }
    }).filter(p => p.playerName.length > 0) // filter out empty rows

    if (mappedPlayers.length === 0) {
      console.log("DEBUG: No mapped players found. Available headers:", headers)
      return NextResponse.json({ error: "Unable to find valid player names. Ensure the CSV has 'FirstName' and 'LastName' columns (Sportability export format)." }, { status: 400 })
    }

    // 2. Database Comparison (Stats)
    const { id: seasonId } = await context.params
    const playerNames = mappedPlayers.map((p) => p.playerName)
    let existingPlayers: { id: number, name: string }[] = []
    
    if (playerNames.length > 0) {
      existingPlayers = await db
        .select({ id: schema.players.id, name: schema.players.name })
        .from(schema.players)
        .where(inArray(schema.players.name, playerNames))
    }

    const existingNamesSet = new Set(existingPlayers.map((p) => p.name))
    const existingPlayerIds = existingPlayers.map(p => p.id)

    // Check season roster
    let existingSeasonAssignments: { playerId: number }[] = []
    if (existingPlayerIds.length > 0) {
      existingSeasonAssignments = await db
        .select({ playerId: schema.playerSeasons.playerId })
        .from(schema.playerSeasons)
        .where(
          and(
            eq(schema.playerSeasons.seasonId, seasonId),
            inArray(schema.playerSeasons.playerId, existingPlayerIds)
          )
        )
    }
    const seasonAssignedIdsSet = new Set(existingSeasonAssignments.map(a => a.playerId))
    
    const totalInImport = mappedPlayers.length
    
    // Global stats
    const globalExisting = mappedPlayers.filter(p => existingNamesSet.has(p.playerName)).length
    const globalNew = totalInImport - globalExisting

    // Season stats
    let seasonExisting = 0
    mappedPlayers.forEach(p => {
      const dbPlayer = existingPlayers.find(ep => ep.name === p.playerName)
      if (dbPlayer && seasonAssignedIdsSet.has(dbPlayer.id)) {
        seasonExisting++
      }
    })
    const seasonNew = totalInImport - seasonExisting

    return NextResponse.json({
      stats: {
        totalInImport,
        globalExisting,
        globalNew,
        seasonExisting,
        seasonNew
      },
      mappedPlayers
    })

  } catch (error: unknown) {
    console.error("Failed to parse Sportability file:", error)
    return NextResponse.json({ error: "Failed to process file. Ensure it is a valid Sportability CSV export." }, { status: 500 })
  }
}
