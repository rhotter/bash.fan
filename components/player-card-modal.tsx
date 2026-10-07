"use client"

import { useState, useEffect } from "react"
import useSWR from "swr"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Loader2, User, BarChart3, Trophy, ExternalLink } from "lucide-react"
import Link from "next/link"
import { playerSlug } from "@/lib/player-slug"
import { SectionHeader } from "@/components/stats-table"

// ─── Types ──────────────────────────────────────────────────────────────────

interface PoolPlayer {
  playerId: number
  playerName: string
  registrationMeta: Record<string, unknown> | null
}

type StatBlock = {
  type: "skater"
  gp: number
  goals: number
  assists: number
  points: number
  pim: number
} | {
  type: "goalie"
  gp: number
  goalsAgainst: number
  shotsAgainst: number
  saves: number
  shutouts: number
  savePct: string
} | null

interface SeasonStats {
  seasonId: string
  seasonName: string
  teamName: string
  teamSlug: string
  isGoalie: boolean
  isCaptain: boolean
  stats: StatBlock
  playoffStats: StatBlock
}

interface PlayerCardModalProps {
  player: PoolPlayer | null
  open: boolean
  onOpenChange: (open: boolean) => void
  seasonSlug: string
  teamName?: string | null
  teamColor?: string | null
  pickInfo?: { round: number; pickNumber: number; isKeeper: boolean } | null
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// ─── Atoms ──────────────────────────────────────────────────────────────────

function Row({
  label,
  value,
}: {
  label: string
  value: string | number | boolean | null | undefined
}) {
  if (value === null || value === undefined || value === "") return null
  const display = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)
  return (
    <>
      <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60 self-center py-1.5 border-b border-border/15">
        {label}
      </dt>
      <dd className="text-xs font-medium text-foreground text-right break-words py-1.5 border-b border-border/15">
        {display}
      </dd>
    </>
  )
}

function MetaLine({ pieces }: { pieces: Array<string | number | null | undefined> }) {
  const items = pieces.filter((p): p is string | number => p !== null && p !== undefined && p !== "")
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap items-center mt-1.5 text-[11px] text-muted-foreground">
      {items.map((item, i) => (
        <span key={i} className="inline-flex items-center">
          {i > 0 && <span className="text-muted-foreground/30 mx-1.5">|</span>}
          <span className={typeof item === "number" ? "tabular-nums" : ""}>{item}</span>
        </span>
      ))}
    </div>
  )
}

function StatsTable({ season }: { season: SeasonStats }) {
  const blocks: { label: string; block: NonNullable<StatBlock> }[] = []
  if (season.stats) blocks.push({ label: "Reg", block: season.stats })
  if (season.playoffStats) blocks.push({ label: "Playoffs", block: season.playoffStats })
  if (blocks.length === 0) return <p className="text-xs text-muted-foreground/50 py-1.5">No game stats recorded</p>

  const isGoalie = blocks[0].block.type === "goalie"
  const skaterCols = ["GP", "G", "A", "P", "PPG", "PIM"] as const
  const goalieCols = ["GP", "GA", "SV", "SV%", "SO"] as const
  const cols = isGoalie ? goalieCols : skaterCols

  function getValues(block: NonNullable<StatBlock>) {
    if (block.type === "skater") {
      const ppg = block.gp > 0 ? (block.points / block.gp).toFixed(2) : "0.00"
      return [block.gp, block.goals, block.assists, block.points, ppg, block.pim]
    }
    return [block.gp, block.goalsAgainst, block.saves, block.savePct, block.shutouts]
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border/15">
          <th className="text-left text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60 py-1.5 pr-2 w-10" />
          {cols.map((col) => (
            <th key={col} className="text-right text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60 py-1.5 px-1.5 tabular-nums">
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {blocks.map(({ label, block }) => (
          <tr key={label} className="border-b border-border/15">
            <td className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60 py-1.5 pr-2">{label}</td>
            {getValues(block).map((val, i) => (
              <td key={i} className="text-right font-medium text-foreground py-1.5 px-1.5 tabular-nums">
                {val}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PlayerCardModal({
  player,
  open,
  onOpenChange,
  seasonSlug,
  teamName,
  teamColor,
  pickInfo,
}: PlayerCardModalProps) {
  const [activeTab, setActiveTab] = useState("registration")

  // Reset tab when player changes
  useEffect(() => {
    setActiveTab("registration")
  }, [player?.playerId])

  // Fetch previous season stats as soon as modal is open to eliminate tab-switch delay
  const { data: statsData, isLoading: statsLoading } = useSWR(
    player && open
      ? `/api/bash/draft/player-stats/${player.playerId}?currentSeason=${seasonSlug}`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  if (!player) return null

  const meta = player.registrationMeta || {}
  const seasons: SeasonStats[] = statsData?.seasons || []

  // Parse registration metadata
  const skillLevel = meta.skillLevel as string | null
  const positions = meta.positions as string | null
  const gamesExpected = meta.gamesExpected as string | null
  const playoffAvail = meta.playoffAvail as string | null
  const goalieWilling = meta.goalieWilling as string | null
  const isRookie = meta.isRookie as boolean | undefined
  const isNewToBash = meta.isNewToBash as boolean | null | undefined
  const gender = meta.gender as string | null
  const age = meta.age as number | null
  const yearsPlayed = meta.yearsPlayed as number | string | null
  const lastLeague = meta.lastLeague as string | null
  const lastTeam = meta.lastTeam as string | null
  const captainPrev = meta.captainPrev as string | null
  const buddyReq = meta.buddyReq as string | null
  const miscNotes = meta.miscNotes as string | null

  const hasBackground =
    isNewToBash !== null && isNewToBash !== undefined
      ? true
      : Boolean(captainPrev || lastLeague || lastTeam || buddyReq)

  const dlClass = "grid grid-cols-[minmax(120px,auto)_1fr] gap-x-4"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px] max-h-[85vh] overflow-hidden flex flex-col p-0 gap-0">
        {/* Header */}
        <div className="px-6 pt-5">
          <div className="pr-6">
            <div className="min-w-0 flex-1">
              <DialogHeader>
                <DialogTitle className="text-xl font-black tracking-tight flex items-center gap-2">
                  <span className="truncate">{player.playerName}</span>
                  {isRookie && (
                    <span className="shrink-0 inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-border px-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground leading-none">
                      R
                    </span>
                  )}
                  <span className="text-muted-foreground/30 text-base font-normal">|</span>
                  <Link
                    href={`/player/${playerSlug(player.playerName)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground hover:text-primary transition-colors whitespace-nowrap"
                  >
                    All Stats
                    <ExternalLink className="h-2.5 w-2.5" />
                  </Link>
                </DialogTitle>
              </DialogHeader>

              {/* Drafted-to row */}
              {teamName && pickInfo && (
                <div className="flex items-center mt-1 text-xs">
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0 mr-1.5"
                    style={{ backgroundColor: teamColor || "#94a3b8" }}
                    aria-hidden
                  />
                  <span className="font-semibold text-foreground truncate">{teamName}</span>
                  <span className="text-muted-foreground/30 mx-1.5">|</span>
                  <span className="text-muted-foreground tabular-nums">
                    R{pickInfo.round}P{pickInfo.pickNumber}
                  </span>
                  {pickInfo.isKeeper && (
                    <>
                      <span className="text-muted-foreground/30 mx-1.5">|</span>
                      <span className="text-muted-foreground">Keeper</span>
                    </>
                  )}
                </div>
              )}

              {/* Quick-glance meta line */}
              <MetaLine
                pieces={[
                  positions,
                  skillLevel,
                  age ? `Age ${age}` : null,
                  gender,
                ]}
              />
            </div>
          </div>

          {/* Hairline — team color if present */}
          <div
            className="mt-4 -mx-6 h-px"
            style={teamColor ? { backgroundColor: teamColor } : undefined}
          />
        </div>

        {/* Tabbed Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="mx-6 mt-3 w-auto">
            <TabsTrigger value="registration" className="flex-1 gap-1.5">
              <User className="h-3.5 w-3.5" />
              Registration
            </TabsTrigger>
            <TabsTrigger value="stats" className="flex-1 gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />
              Past Stats
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto">
            {/* Registration Tab */}
            <TabsContent value="registration" className="mt-0 px-6 pb-6 pt-4">
              <section>
                <SectionHeader>Playing Profile</SectionHeader>
                <dl className={dlClass}>
                  <Row label="Position" value={positions} />
                  <Row label="Skill Level" value={skillLevel} />
                  <Row label="Goalie Willingness" value={goalieWilling} />
                  <Row label="Experience" value={yearsPlayed} />
                </dl>
              </section>

              {(gamesExpected || playoffAvail) && (
                <section className="mt-6">
                  <SectionHeader>Availability</SectionHeader>
                  <dl className={dlClass}>
                    <Row label="Expected Games" value={gamesExpected} />
                    <Row label="Playoffs" value={playoffAvail} />
                  </dl>
                </section>
              )}

              {hasBackground && (
                <section className="mt-6">
                  <SectionHeader>Background</SectionHeader>
                  <dl className={dlClass}>
                    <Row label="New to BASH" value={isNewToBash} />
                    <Row label="Captain (Prior)" value={captainPrev ? "Yes" : null} />
                    <Row label="Last League" value={lastLeague} />
                    <Row label="Last Team" value={lastTeam} />
                    <Row label="Buddy Request" value={buddyReq} />
                  </dl>
                </section>
              )}

              {miscNotes && (
                <section className="mt-6">
                  <SectionHeader>Notes</SectionHeader>
                  <p className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">
                    {miscNotes}
                  </p>
                </section>
              )}
            </TabsContent>

            {/* Past Stats Tab */}
            <TabsContent value="stats" className="mt-0 px-6 pb-6 pt-4">
              {statsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading stats…</span>
                </div>
              ) : seasons.length === 0 ? (
                <div className="text-center py-12 space-y-2">
                  <Trophy className="h-8 w-8 mx-auto text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No previous season stats found</p>
                  <p className="text-xs text-muted-foreground/60">
                    This player may be new to BASH or their prior stats haven&apos;t been imported yet.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {seasons.map((season) => (
                    <section key={season.seasonId}>
                      <div className="flex items-center gap-3 mb-3">
                        <h4 className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground whitespace-nowrap flex items-center gap-1.5">
                          {season.seasonName}
                          <span className="text-muted-foreground/30 font-normal">|</span>
                          <span className="font-medium normal-case tracking-normal text-muted-foreground/60">{season.teamName}</span>
                          <span className="text-muted-foreground/30 font-normal">|</span>
                          <span className="font-medium normal-case tracking-normal text-muted-foreground/60">{season.isGoalie ? "Goalie" : "Skater"}</span>
                          {season.isCaptain && (
                            <>
                              <span className="text-muted-foreground/30 font-normal">|</span>
                              <span className="font-medium normal-case tracking-normal text-muted-foreground/60">Captain</span>
                            </>
                          )}
                        </h4>
                        <div className="h-px flex-1 bg-border/60" />
                      </div>
                      <StatsTable season={season} />
                    </section>
                  ))}
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
