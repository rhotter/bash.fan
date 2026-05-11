"use client"

import { useState, useEffect } from "react"
import useSWR from "swr"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Loader2, User, BarChart3, Shield, Star, Calendar, Dumbbell, MapPin, Trophy, AlertCircle, ExternalLink } from "lucide-react"
import Link from "next/link"
import { playerSlug } from "@/lib/player-slug"
import { Button } from "@/components/ui/button"

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
  teamName?: string | null // team they were drafted to (if any)
  teamColor?: string | null
  pickInfo?: { round: number; pickNumber: number; isKeeper: boolean } | null
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// ─── Helpers ────────────────────────────────────────────────────────────────

function MetaRow({ label, value, icon }: { label: string; value: string | number | boolean | null | undefined; icon?: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null
  const display = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-medium text-right max-w-[60%] break-words">{display}</span>
    </div>
  )
}

function StatCell({ label, value, highlight, compact }: { label: string; value: string | number; highlight?: boolean; compact?: boolean }) {
  return (
    <div className="text-center">
      <div className={`${compact ? "text-sm" : "text-lg"} font-bold tabular-nums ${highlight ? "text-primary" : ""}`}>{value}</div>
      <div className={`${compact ? "text-[8px]" : "text-[10px]"} font-semibold uppercase tracking-wider text-muted-foreground`}>{label}</div>
    </div>
  )
}

function StatBlockView({ block, label }: { block: NonNullable<StatBlock>; label: string }) {
  const compact = true
  if (block.type === "skater") {
    const ppg = block.gp > 0 ? (block.points / block.gp).toFixed(2) : "0.00"
    return (
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 text-center">{label}</div>
        <div className="grid grid-cols-5 sm:grid-cols-6 gap-0.5">
          <StatCell label="GP" value={block.gp} compact={compact} />
          <StatCell label="G" value={block.goals} highlight compact={compact} />
          <StatCell label="A" value={block.assists} highlight compact={compact} />
          <StatCell label="P" value={block.points} highlight compact={compact} />
          <StatCell label="PPG" value={ppg} compact={compact} />
          <div className="hidden sm:block">
            <StatCell label="PIM" value={block.pim} compact={compact} />
          </div>
        </div>
      </div>
    )
  }
  // goalie
  const gaa = block.gp > 0 ? (block.goalsAgainst / block.gp).toFixed(2) : "0.00"
  return (
    <div className="flex-1 min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 text-center">{label}</div>
      <div className="grid grid-cols-4 sm:grid-cols-5 gap-0.5">
        <StatCell label="GP" value={block.gp} compact={compact} />
        <div className="hidden sm:block">
          <StatCell label="GA" value={block.goalsAgainst} compact={compact} />
        </div>
        <StatCell label="GAA" value={gaa} highlight compact={compact} />
        <StatCell label="SV%" value={block.savePct} highlight compact={compact} />
        <StatCell label="SO" value={block.shutouts} compact={compact} />
      </div>
    </div>
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

  // Fetch previous season stats on demand
  const { data: statsData, isLoading: statsLoading } = useSWR(
    player && activeTab === "stats"
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

  // Skill level color
  const skillColor = skillLevel
    ? skillLevel.toLowerCase().includes("advanced")
      ? "bg-red-100 text-red-700 border-red-200"
      : skillLevel.toLowerCase().includes("intermediate +") || skillLevel.toLowerCase().includes("intermediate+")
        ? "bg-orange-100 text-orange-700 border-orange-200"
        : skillLevel.toLowerCase().includes("intermediate")
          ? "bg-amber-100 text-amber-700 border-amber-200"
          : "bg-green-100 text-green-700 border-green-200"
    : ""

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] max-h-[85vh] overflow-hidden flex flex-col p-0">
        {/* Header */}
        <div
          className="px-6 pt-5 pb-4 relative"
          style={teamColor ? { borderBottom: `3px solid ${teamColor}` } : undefined}
        >
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2 pr-6">
              {player.playerName}
              {isRookie && (
                <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700 border-green-200">
                  Rookie
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Quick-glance badges */}
          <div className="flex flex-wrap items-center gap-2 mt-2 pr-4">
            {skillLevel && (
              <Badge variant="outline" className={`text-xs ${skillColor}`}>
                {skillLevel}
              </Badge>
            )}
            {positions && (
              <Badge variant="secondary" className="text-xs">
                {positions}
              </Badge>
            )}
            {age && (
              <Badge variant="outline" className="text-xs">
                Age {age}
              </Badge>
            )}
            {gender && (
              <Badge variant="outline" className="text-xs">
                {gender}
              </Badge>
            )}
            
            <Button asChild variant="outline" size="sm" className="h-6 text-[10px] px-2 ml-auto shadow-sm">
              <Link href={`/player/${playerSlug(player.playerName)}`} target="_blank" rel="noopener noreferrer">
                All Stats <ExternalLink className="ml-1 h-3 w-3 opacity-70" />
              </Link>
            </Button>
          </div>

          {/* Drafted-to info */}
          {teamName && pickInfo && (
            <div className="mt-3 flex items-center gap-2 text-xs">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: teamColor || "#94a3b8" }}
              />
              <span className="font-semibold">{teamName}</span>
              <span className="text-muted-foreground">
                — R{pickInfo.round}P{pickInfo.pickNumber}
                {pickInfo.isKeeper && " (Keeper)"}
              </span>
            </div>
          )}
        </div>

        {/* Tabbed Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="mx-6 w-auto">
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
              <div className="space-y-4">
                {/* Playing Profile */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Dumbbell className="h-3.5 w-3.5" />
                    Playing Profile
                  </h4>
                  <div className="rounded-lg border bg-card divide-y">
                    <div className="px-3">
                      <MetaRow label="Skill Level" value={skillLevel} />
                    </div>
                    <div className="px-3">
                      <MetaRow label="Position" value={positions} />
                    </div>
                    <div className="px-3">
                      <MetaRow label="Goalie Willingness" value={goalieWilling} />
                    </div>
                    <div className="px-3">
                      <MetaRow label="Experience (Years)" value={yearsPlayed} />
                    </div>
                  </div>
                </div>

                {/* Availability */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    Availability
                  </h4>
                  <div className="rounded-lg border bg-card divide-y">
                    <div className="px-3">
                      <MetaRow label="Expected Games" value={gamesExpected} />
                    </div>
                    <div className="px-3">
                      <MetaRow label="Playoff Availability" value={playoffAvail} />
                    </div>
                  </div>
                </div>

                {/* Background */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5" />
                    Background
                  </h4>
                  <div className="rounded-lg border bg-card divide-y">
                    <div className="px-3">
                      <MetaRow label="New to BASH" value={isNewToBash} />
                    </div>
                    <div className="px-3">
                      <MetaRow label="Rookie" value={isRookie} />
                    </div>
                    <div className="px-3">
                      <MetaRow label="Captain (Prior)" value={captainPrev ? "Yes" : null} />
                    </div>
                    <div className="px-3">
                      <MetaRow label="Last League" value={lastLeague} />
                    </div>
                    <div className="px-3">
                      <MetaRow label="Last Team" value={lastTeam} />
                    </div>
                    <div className="px-3">
                      <MetaRow label="Buddy Request" value={buddyReq} />
                    </div>
                  </div>
                </div>

                {/* Notes — free-form */}
                {miscNotes && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Notes
                    </h4>
                    <div className="rounded-lg border bg-card p-3 text-sm text-muted-foreground whitespace-pre-wrap">
                      {miscNotes}
                    </div>
                  </div>
                )}
              </div>
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
                <div className="space-y-4">
                  {seasons.map((season) => (
                    <div key={season.seasonId} className="rounded-lg border bg-card overflow-hidden">
                      {/* Season header */}
                      <div className="px-4 py-2.5 bg-muted/50 flex items-center justify-between">
                        <div>
                          <span className="text-sm font-semibold">{season.seasonName}</span>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                            <MapPin className="h-3 w-3" />
                            {season.teamName}
                            {season.isCaptain && (
                              <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 ml-1">
                                <Star className="h-2.5 w-2.5 mr-0.5" />C
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          {season.isGoalie ? "Goalie" : "Skater"}
                        </Badge>
                      </div>

                      <Separator />

                      {/* Stats grid — regular season + playoff side by side */}
                      {season.stats || season.playoffStats ? (
                        <div className="px-4 py-3">
                          <div className="flex gap-3">
                            {season.stats && (
                              <StatBlockView block={season.stats} label={season.playoffStats ? "Regular Season" : "Regular Season"} />
                            )}
                            {season.stats && season.playoffStats && (
                              <div className="w-px bg-border shrink-0" />
                            )}
                            {season.playoffStats && (
                              <StatBlockView block={season.playoffStats} label="Playoffs" />
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="px-4 py-3 text-center text-xs text-muted-foreground">
                          No game stats recorded
                        </div>
                      )}
                    </div>
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
