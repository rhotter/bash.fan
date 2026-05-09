import { db } from "@/lib/db"
import * as schema from "@/lib/db/schema"
import { eq, inArray } from "drizzle-orm"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { PublicDraftBoard } from "@/components/public-draft-board"

interface Props {
  params: Promise<{ season: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { season: seasonSlug } = await params
  const seasonRow = await db.query.seasons.findFirst({
    where: eq(schema.seasons.id, seasonSlug),
  })

  const draft = seasonRow
    ? await db.query.draftInstances.findFirst({
        where: eq(schema.draftInstances.seasonId, seasonRow.id),
      })
    : null

  // Build description with date/time/location
  let description = "Bay Area Street Hockey draft board."
  if (draft) {
    const parts: string[] = [`BASH ${draft.name}`]
    if (draft.draftDate) {
      const d = new Date(draft.draftDate)
      parts.push(d.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'America/Los_Angeles',
      }))
      parts.push(d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Los_Angeles',
      }))
    }
    if (draft.location) parts.push(draft.location)
    description = parts.join(' · ')
  }

  const title = draft
    ? `BASH ${draft.name}`
    : seasonRow
      ? `${seasonRow.name} Draft — BASH`
      : "Draft — BASH"

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export default async function PublicDraftPage({ params }: Props) {
  const { season: seasonSlug } = await params

  // Resolve season
  const seasonRow = await db.query.seasons.findFirst({
    where: eq(schema.seasons.id, seasonSlug),
  })

  if (!seasonRow) notFound()

  // Find draft for this season
  const draft = await db.query.draftInstances.findFirst({
    where: eq(schema.draftInstances.seasonId, seasonRow.id),
  })

  if (!draft || draft.status === "draft") notFound()

  // Fetch teams with draft order
  const teamOrder = await db
    .select({
      teamSlug: schema.draftTeamOrder.teamSlug,
      teamName: schema.teams.name,
      position: schema.draftTeamOrder.position,
    })
    .from(schema.draftTeamOrder)
    .innerJoin(schema.teams, eq(schema.draftTeamOrder.teamSlug, schema.teams.slug))
    .where(eq(schema.draftTeamOrder.draftId, draft.id))
    .orderBy(schema.draftTeamOrder.position)

  // Fetch team colors — season_teams.color takes priority over franchise color
  const seasonTeams = await db
    .select({
      teamSlug: schema.seasonTeams.teamSlug,
      color: schema.seasonTeams.color,
      franchiseSlug: schema.seasonTeams.franchiseSlug,
    })
    .from(schema.seasonTeams)
    .where(eq(schema.seasonTeams.seasonId, seasonRow.id))

  const franchiseSlugs = [...new Set(
    seasonTeams
      .map((st) => st.franchiseSlug)
      .filter((s): s is string => s !== null)
  )]
  const franchises = franchiseSlugs.length > 0
    ? await db.query.franchises.findMany({
        where: inArray(schema.franchises.slug, franchiseSlugs),
      })
    : []
  const franchiseColorMap: Record<string, string> = {}
  for (const f of franchises) {
    if (f.color) franchiseColorMap[f.slug] = f.color
  }
  const teamColors: Record<string, string> = {}
  for (const st of seasonTeams) {
    if (st.color) {
      // Direct team color takes priority
      teamColors[st.teamSlug] = st.color
    } else if (st.franchiseSlug && franchiseColorMap[st.franchiseSlug]) {
      // Fall back to franchise color
      teamColors[st.teamSlug] = franchiseColorMap[st.franchiseSlug]
    }
  }

  // Fetch picks
  const picks = await db
    .select({
      id: schema.draftPicks.id,
      round: schema.draftPicks.round,
      pickNumber: schema.draftPicks.pickNumber,
      teamSlug: schema.draftPicks.teamSlug,
      originalTeamSlug: schema.draftPicks.originalTeamSlug,
      playerId: schema.draftPicks.playerId,
      playerName: schema.players.name,
      isKeeper: schema.draftPicks.isKeeper,
      pickedAt: schema.draftPicks.pickedAt,
    })
    .from(schema.draftPicks)
    .leftJoin(schema.players, eq(schema.draftPicks.playerId, schema.players.id))
    .where(eq(schema.draftPicks.draftId, draft.id))
    .orderBy(schema.draftPicks.pickNumber)

  // Fetch pool
  const pool = await db
    .select({
      playerId: schema.draftPool.playerId,
      playerName: schema.players.name,
      registrationMeta: schema.draftPool.registrationMeta,
    })
    .from(schema.draftPool)
    .innerJoin(schema.players, eq(schema.draftPool.playerId, schema.players.id))
    .where(eq(schema.draftPool.draftId, draft.id))

  // Fetch trades
  const trades = await db.query.draftTrades.findMany({
    where: eq(schema.draftTrades.draftId, draft.id),
  })

  const initialData = {
    draft: {
      id: draft.id,
      name: draft.name,
      status: draft.status,
      rounds: draft.rounds,
      draftDate: draft.draftDate?.toISOString() || null,
      location: draft.location,
      timerSeconds: draft.timerSeconds,
      timerCountdown: draft.timerCountdown,
      timerRunning: draft.timerRunning,
      timerStartedAt: draft.timerStartedAt?.toISOString() || null,
      updatedAt: draft.updatedAt?.toISOString() || null,
    },
    season: {
      id: seasonRow.id,
      name: seasonRow.name,
      slug: seasonRow.id,
    },
    teams: teamOrder.map((t) => ({
      ...t,
      color: teamColors[t.teamSlug] || null,
    })),
    picks: picks.map((p) => ({
      ...p,
      playerName: p.playerId ? p.playerName || "Unknown" : null,
      pickedAt: p.pickedAt?.toISOString() || null,
    })),
    pool: pool.map((p) => ({
      playerId: p.playerId,
      playerName: p.playerName,
      registrationMeta: (p.registrationMeta as Record<string, unknown>) || null,
    })),
    trades: trades.map((t) => ({
      id: t.id,
      teamASlug: t.teamASlug,
      teamBSlug: t.teamBSlug,
      description: t.description,
      tradedAt: t.tradedAt?.toISOString() || null,
    })),
  }

  return <PublicDraftBoard seasonSlug={seasonSlug} initialData={initialData} />
}
