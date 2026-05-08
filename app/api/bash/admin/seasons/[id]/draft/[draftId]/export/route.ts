import { db } from "@/lib/db"
import * as schema from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { getSession } from "@/lib/admin-session"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; draftId: string }> }
) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { draftId } = await params

  const draft = await db.query.draftInstances.findFirst({
    where: eq(schema.draftInstances.id, draftId),
  })

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 })
  }

  // Fetch picks with player and team names
  const picks = await db
    .select({
      round: schema.draftPicks.round,
      pickNumber: schema.draftPicks.pickNumber,
      teamSlug: schema.draftPicks.teamSlug,
      teamName: schema.teams.name,
      playerId: schema.draftPicks.playerId,
      playerName: schema.players.name,
      isKeeper: schema.draftPicks.isKeeper,
      originalTeamSlug: schema.draftPicks.originalTeamSlug,
    })
    .from(schema.draftPicks)
    .innerJoin(schema.teams, eq(schema.draftPicks.teamSlug, schema.teams.slug))
    .leftJoin(schema.players, eq(schema.draftPicks.playerId, schema.players.id))
    .where(eq(schema.draftPicks.draftId, draftId))
    .orderBy(schema.draftPicks.pickNumber)

  // Build CSV — escape embedded quotes per RFC 4180
  const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`
  const headers = ["Round", "Pick", "Team", "Player", "Keeper", "Traded From"]
  const rows = picks.map((p) => [
    p.round,
    p.pickNumber,
    esc(p.teamName),
    p.playerId ? esc(p.playerName || "Unknown") : "",
    p.isKeeper ? "Y" : "",
    p.teamSlug !== p.originalTeamSlug ? p.originalTeamSlug : "",
  ])

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n")

  const safeName = draft.name.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "draft-export"

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${safeName}-results.csv"`,
    },
  })
}
