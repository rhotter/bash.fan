import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq, and, inArray } from "drizzle-orm"
import { z } from "zod"
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
  const schemaValidation = z.object({
    players: z.array(z.any()),
    mode: z.enum(["append", "overwrite"]).optional()
  }).safeParse(await request.json())

  if (!schemaValidation.success) {
    return NextResponse.json({ error: "Invalid payload format" }, { status: 400 })
  }

  const { players, mode = "append" } = schemaValidation.data as {
    players: MappedPoolPlayer[]
    mode?: "append" | "overwrite"
  }

  if (!players || players.length === 0) {
    return NextResponse.json({ error: "No players to import" }, { status: 400 })
  }

  // No transaction support with neon-http — each operation is idempotent
  // so partial failure is recoverable by re-importing the CSV.

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

  const updatePromises = []
  const insertPoolValues = []

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
      updatePromises.push(
        db.update(schema.draftPool)
          .set({ registrationMeta: player.registrationMeta })
          .where(
            and(
              eq(schema.draftPool.draftId, draftId),
              eq(schema.draftPool.playerId, playerId)
            )
          )
      )
      skipped++
    } else {
      // Insert into pool
      insertPoolValues.push({
        draftId,
        playerId,
        registrationMeta: player.registrationMeta,
      })
      poolPlayerIds.add(playerId)
      added++
    }
  }

  if (updatePromises.length > 0) {
    await Promise.all(updatePromises)
  }
  if (insertPoolValues.length > 0) {
    await db.insert(schema.draftPool).values(insertPoolValues)
  }

  // In overwrite mode, remove pool entries not in the CSV
  let removed = 0
  if (mode === "overwrite") {
    const toRemove = existingPool.filter((p) => !processedPlayerIds.has(p.playerId))
    if (toRemove.length > 0) {
      await db.delete(schema.draftPool).where(
        and(
          eq(schema.draftPool.draftId, draftId),
          inArray(schema.draftPool.playerId, toRemove.map((p) => p.playerId))
        )
      )
      removed = toRemove.length
    }
  }

  // Recalculate rounds based on the new pool size
  const [draft] = await db
    .select()
    .from(schema.draftInstances)
    .where(eq(schema.draftInstances.id, draftId))
    .limit(1)

  if (draft) {
    const updatedPool = await db
      .select({ playerId: schema.draftPool.playerId })
      .from(schema.draftPool)
      .where(eq(schema.draftPool.draftId, draftId))

    const teamOrder = await db
      .select({ teamSlug: schema.draftTeamOrder.teamSlug })
      .from(schema.draftTeamOrder)
      .where(eq(schema.draftTeamOrder.draftId, draftId))

    const newPoolCount = updatedPool.length
    const teamCount = teamOrder.length

    if (teamCount > 0) {
      const newSuggestedRounds = Math.max(1, Math.ceil(newPoolCount / teamCount))
      const oldSuggestedRounds = Math.max(1, Math.ceil(existingPool.length / teamCount))

      if (draft.rounds === oldSuggestedRounds && newSuggestedRounds !== draft.rounds) {
        await db
          .update(schema.draftInstances)
          .set({ rounds: newSuggestedRounds, updatedAt: new Date() })
          .where(eq(schema.draftInstances.id, draftId))
      }
    }
  }

  return NextResponse.json({
    added,
    created,
    skipped,
    total: players.length,
    ...(mode === "overwrite" ? { removed } : {}),
  })
}
