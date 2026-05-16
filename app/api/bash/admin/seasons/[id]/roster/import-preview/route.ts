import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { getSession } from "@/lib/admin-session"
import { inArray, eq, and } from "drizzle-orm"
import { canonicalizePlayerName, normalizePlayerName } from "@/lib/player-name"
import { parseCsv, parsePositionTags, parseRegistrationMeta } from "@/lib/csv-utils"

interface RouteContext {
  params: Promise<{ id: string }>
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




    // Fetch all existing team slugs to validate team assignments
    const allTeams = await db.select({ slug: schema.teams.slug }).from(schema.teams)
    const validTeamSlugs = new Set(allTeams.map((t) => t.slug))

    // 1. Data Mapping
    const mappedPlayers = rawData.map((row) => {
      // Name
      const firstName = row["FirstName"]?.trim() || ""
      const lastName = row["LastName"]?.trim() || ""
      const playerName = canonicalizePlayerName(`${firstName} ${lastName}`)

      // Team
      const rawTeam = row["Team"]?.trim() || ""
      let teamSlug = rawTeam.toLowerCase().replace(/\s+/g, '-')
      if (!validTeamSlugs.has(teamSlug)) {
        teamSlug = "tbd"
      }

      // Position — use shared tokenizer from csv-utils
      const positionRaw = row["ExpPos"] || row["Position"] || ""
      const positionTags = parsePositionTags(positionRaw)
      const isGoalie = positionTags.includes("G")

      // Roles
      const rookieStr = (row["Rookie"] || "").toLowerCase()
      const captainStr = (row["Captain"] || "").toLowerCase()
      const isRookie = rookieStr === "1" || rookieStr === "yes" || rookieStr === "true"
      const isCaptain = captainStr === "1" || captainStr === "yes" || captainStr === "true" || captainStr === "asst"

      // Full registration metadata for draft player cards
      const registrationMeta = parseRegistrationMeta(row)

      return {
        playerName,
        teamSlug,
        isGoalie,
        isRookie,
        isCaptain,
        positionTags,
        registrationMeta,
      }
    }).filter(p => p.playerName.length > 0) // filter out empty rows

    const deduplicatedPlayers = []
    const seenNames = new Set<string>()
    for (const player of mappedPlayers) {
      const normalized = normalizePlayerName(player.playerName)
      if (!seenNames.has(normalized)) {
        seenNames.add(normalized)
        deduplicatedPlayers.push(player)
      }
    }
    const finalMappedPlayers = deduplicatedPlayers

    if (finalMappedPlayers.length === 0) {
      return NextResponse.json({ error: "Unable to find valid player names. Ensure the CSV has 'FirstName' and 'LastName' columns (Sportability export format)." }, { status: 400 })
    }

    // 2. Database Comparison (Stats)
    const { id: seasonId } = await context.params
    const allPlayers = await db
      .select({ id: schema.players.id, name: schema.players.name })
      .from(schema.players)

    const existingPlayersByNormalized = new Map<string, { id: number; name: string }>()
    for (const player of allPlayers) {
      const normalizedName = normalizePlayerName(player.name)
      if (!existingPlayersByNormalized.has(normalizedName)) {
        existingPlayersByNormalized.set(normalizedName, player)
      }
    }

    const existingPlayerIds = Array.from(
      new Set(
        finalMappedPlayers
          .map((player) => existingPlayersByNormalized.get(normalizePlayerName(player.playerName))?.id)
          .filter((playerId): playerId is number => typeof playerId === "number")
      )
    )

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
    
    const totalInImport = finalMappedPlayers.length
    
    // Global stats
    const globalExisting = finalMappedPlayers.filter((player) =>
      existingPlayersByNormalized.has(normalizePlayerName(player.playerName))
    ).length
    const globalNew = totalInImport - globalExisting

    // Season stats
    let seasonExisting = 0
    finalMappedPlayers.forEach((player) => {
      const dbPlayer = existingPlayersByNormalized.get(normalizePlayerName(player.playerName))
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
      mappedPlayers: finalMappedPlayers
    })

  } catch (error: unknown) {
    console.error("Failed to parse Sportability file:", error)
    return NextResponse.json({ error: "Failed to process file. Ensure it is a valid Sportability CSV export." }, { status: 500 })
  }
}
