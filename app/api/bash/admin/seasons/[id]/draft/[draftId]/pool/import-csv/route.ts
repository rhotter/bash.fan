import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"
import { canonicalizePlayerName, normalizePlayerName } from "@/lib/player-name"
import { parseCsv, parseRegistrationMeta } from "@/lib/csv-utils"
import type { RegistrationMeta } from "@/lib/csv-utils"

interface RouteContext {
  params: Promise<{ id: string; draftId: string }>
}

/**
 * POST — Import Sportability CSV into draft pool.
 *
 * Two modes via `action` query param:
 *   ?action=preview  (default) — Parse CSV, return stats + preview data
 *   ?action=confirm  — Actually insert players into draft pool with registration_meta
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { draftId } = await context.params
  const action = request.nextUrl.searchParams.get("action") || "preview"

  // Verify draft exists and is in 'draft' status
  const [draft] = await db
    .select()
    .from(schema.draftInstances)
    .where(eq(schema.draftInstances.id, draftId))
    .limit(1)

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 })
  }

  if (draft.status !== "draft") {
    return NextResponse.json(
      { error: "Can only import players when draft is in 'draft' status" },
      { status: 400 }
    )
  }

  try {
    if (action === "confirm") {
      return handleConfirm(request, draftId)
    }
    return handlePreview(request, draftId)
  } catch (error: unknown) {
    console.error("Draft pool CSV import failed:", error)
    return NextResponse.json(
      { error: "Failed to process file. Ensure it is a valid Sportability CSV export." },
      { status: 500 }
    )
  }
}

// ─── Preview Mode ────────────────────────────────────────────────────────────

interface MappedPoolPlayer {
  playerName: string
  registrationMeta: RegistrationMeta
  existingPlayerId: number | null
  isNew: boolean
  alreadyInPool: boolean
}

async function handlePreview(request: NextRequest, draftId: string) {
  const formData = await request.formData()
  const file = formData.get("file") as File | null

  if (!file) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 })
  }

  const text = await file.text()
  const rawData = parseCsv(text)

  if (rawData.length === 0) {
    return NextResponse.json({ error: "CSV file is empty or has no data rows." }, { status: 400 })
  }

  // Fetch all existing players for name matching
  const allPlayers = await db
    .select({ id: schema.players.id, name: schema.players.name })
    .from(schema.players)

  const playersByNormalized = new Map<string, { id: number; name: string }>()
  for (const p of allPlayers) {
    const normalized = normalizePlayerName(p.name)
    if (!playersByNormalized.has(normalized)) {
      playersByNormalized.set(normalized, p)
    }
  }

  // Fetch existing pool for this draft
  const existingPool = await db
    .select({ playerId: schema.draftPool.playerId })
    .from(schema.draftPool)
    .where(eq(schema.draftPool.draftId, draftId))

  const poolPlayerIds = new Set(existingPool.map((p) => p.playerId))

  // Map CSV rows
  const mappedPlayers: MappedPoolPlayer[] = rawData
    .map((row) => {
      const firstName = row["FirstName"]?.trim() || ""
      const lastName = row["LastName"]?.trim() || ""
      if (!firstName && !lastName) return null

      const playerName = canonicalizePlayerName(`${firstName} ${lastName}`)
      const registrationMeta = parseRegistrationMeta(row)

      const normalized = normalizePlayerName(playerName)
      const existingPlayer = playersByNormalized.get(normalized)

      return {
        playerName,
        registrationMeta,
        existingPlayerId: existingPlayer?.id ?? null,
        isNew: !existingPlayer,
        alreadyInPool: existingPlayer ? poolPlayerIds.has(existingPlayer.id) : false,
      }
    })
    .filter((p): p is MappedPoolPlayer => p !== null)

  // Compute stats
  const totalParsed = mappedPlayers.length
  const existingPlayers = mappedPlayers.filter((p) => !p.isNew).length
  const newPlayers = mappedPlayers.filter((p) => p.isNew).length
  const alreadyInPool = mappedPlayers.filter((p) => p.alreadyInPool).length
  const willAdd = mappedPlayers.filter((p) => !p.alreadyInPool).length

  // Skill breakdown
  const skillBreakdown: Record<string, number> = {}
  for (const p of mappedPlayers) {
    const skill = p.registrationMeta.skillLevel || "Unknown"
    skillBreakdown[skill] = (skillBreakdown[skill] || 0) + 1
  }

  return NextResponse.json({
    stats: {
      totalParsed,
      existingPlayers,
      newPlayers,
      alreadyInPool,
      willAdd,
      skillBreakdown,
    },
    mappedPlayers,
  })
}

// ─── Confirm Mode ────────────────────────────────────────────────────────────

async function handleConfirm(request: NextRequest, draftId: string) {
  const body = await request.json() as {
    players: MappedPoolPlayer[]
    mode?: "append" | "overwrite"
  }

  const { players, mode = "append" } = body

  if (!players || !Array.isArray(players) || players.length === 0) {
    return NextResponse.json({ error: "No players to import" }, { status: 400 })
  }

  // Fetch existing pool
  const existingPool = await db
    .select({ playerId: schema.draftPool.playerId })
    .from(schema.draftPool)
    .where(eq(schema.draftPool.draftId, draftId))

  const poolPlayerIds = new Set(existingPool.map((p) => p.playerId))

  // Fetch all existing players for name matching
  const allPlayers = await db
    .select({ id: schema.players.id, name: schema.players.name })
    .from(schema.players)

  const playersByNormalized = new Map<string, { id: number; name: string }>()
  for (const p of allPlayers) {
    const normalized = normalizePlayerName(p.name)
    if (!playersByNormalized.has(normalized)) {
      playersByNormalized.set(normalized, p)
    }
  }

  let created = 0
  let added = 0
  let skipped = 0
  const processedPlayerIds = new Set<number>()

  for (const player of players) {
    const normalized = normalizePlayerName(player.playerName)
    let playerId = playersByNormalized.get(normalized)?.id ?? null

    // Create new player if needed
    if (!playerId) {
      const [newPlayer] = await db
        .insert(schema.players)
        .values({ name: player.playerName })
        .returning({ id: schema.players.id })

      playerId = newPlayer.id
      playersByNormalized.set(normalized, { id: playerId, name: player.playerName })
      created++
    }

    processedPlayerIds.add(playerId)

    // If already in pool → update registration_meta
    if (poolPlayerIds.has(playerId)) {
      await db
        .update(schema.draftPool)
        .set({ registrationMeta: player.registrationMeta })
        .where(
          and(
            eq(schema.draftPool.draftId, draftId),
            eq(schema.draftPool.playerId, playerId)
          )
        )
      skipped++
      continue
    }

    // Insert into pool
    await db.insert(schema.draftPool).values({
      draftId,
      playerId,
      registrationMeta: player.registrationMeta,
    })

    poolPlayerIds.add(playerId)
    added++
  }

  // In overwrite mode, remove pool entries not in the CSV
  let removed = 0
  if (mode === "overwrite") {
    const toRemove = existingPool.filter((p) => !processedPlayerIds.has(p.playerId))
    for (const entry of toRemove) {
      await db
        .delete(schema.draftPool)
        .where(
          and(
            eq(schema.draftPool.draftId, draftId),
            eq(schema.draftPool.playerId, entry.playerId)
          )
        )
    }
    removed = toRemove.length
  }

  return NextResponse.json({
    added,
    created,
    skipped,
    total: players.length,
    ...(mode === "overwrite" ? { removed } : {}),
  })
}
