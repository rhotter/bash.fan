"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import useSWR from "swr"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Search, Maximize2, Minimize2, Clock, MapPin, Users } from "lucide-react"

// ─── Types ──────────────────────────────────────────────────────────────────

interface Team {
  teamSlug: string
  teamName: string
  position: number
  color: string | null
}

interface Pick {
  id: string
  round: number
  pickNumber: number
  teamSlug: string
  originalTeamSlug: string
  playerId: number | null
  playerName: string | null
  isKeeper: boolean
  pickedAt: string | null
}

interface PoolPlayer {
  playerId: number
  playerName: string
  registrationMeta: Record<string, unknown> | null
}

interface Trade {
  id: string
  teamASlug: string
  teamBSlug: string
  description: string | null
  tradedAt: string | null
}

interface DraftState {
  id: string
  name: string
  status: string
  rounds: number
  draftDate: string | null
  location: string | null
  timerSeconds: number
  timerCountdown: number | null
  timerRunning: boolean
  timerStartedAt: string | null
  updatedAt: string | null
}

interface DraftData {
  draft: DraftState
  season: { id: string; name: string; slug: string }
  teams: Team[]
  picks: Pick[]
  pool: PoolPlayer[]
  trades: Trade[]
}

interface PublicDraftBoardProps {
  seasonSlug: string
  initialData: DraftData
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPlayerName(name: string | null) {
  if (!name) return "—"
  if (name.length <= 16) return name
  const parts = name.split(" ")
  if (parts.length < 2) return name
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// ─── Component ──────────────────────────────────────────────────────────────

export function PublicDraftBoard({ seasonSlug, initialData }: PublicDraftBoardProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [playerSearch, setPlayerSearch] = useState("")
  const [mobileTab, setMobileTab] = useState("board")
  const containerRef = useRef<HTMLDivElement>(null)

  // SWR polling — 5s for live, 30s otherwise
  const { data } = useSWR<DraftData>(
    `/api/bash/draft/${seasonSlug}`,
    fetcher,
    {
      fallbackData: initialData,
      refreshInterval: initialData.draft.status === "live" ? 5000 : 30000,
      revalidateOnFocus: true,
      dedupingInterval: 3000,
    }
  )

  const { draft, season, teams, picks, pool, trades: _trades } = data || initialData

  // ─── Timer ──────────────────────────────────────────────────────────────

  const [timerRemaining, setTimerRemaining] = useState<number>(() => {
    if (!draft.timerRunning || !draft.timerStartedAt) {
      return draft.timerCountdown ?? draft.timerSeconds
    }
    const elapsed = Math.floor((Date.now() - new Date(draft.timerStartedAt).getTime()) / 1000)
    return Math.max(0, (draft.timerCountdown ?? draft.timerSeconds) - elapsed)
  })

  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)

    if (draft.timerRunning && draft.timerStartedAt) {
      const tick = () => {
        const elapsed = Math.floor((Date.now() - new Date(draft.timerStartedAt!).getTime()) / 1000)
        const remaining = Math.max(0, (draft.timerCountdown ?? draft.timerSeconds) - elapsed)
        setTimerRemaining(remaining)
      }
      tick()
      timerIntervalRef.current = setInterval(tick, 1000)
    } else {
      setTimerRemaining(draft.timerCountdown ?? draft.timerSeconds)
    }

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    }
  }, [draft.timerRunning, draft.timerStartedAt, draft.timerCountdown, draft.timerSeconds])

  // ─── Board Grid ─────────────────────────────────────────────────────────

  const boardGrid = useMemo(() => {
    const grid: Record<number, Record<string, Pick>> = {}
    for (let r = 1; r <= draft.rounds; r++) {
      grid[r] = {}
    }
    for (const pick of picks) {
      if (pick.round && grid[pick.round]) {
        grid[pick.round][pick.originalTeamSlug] = pick
      }
    }
    return grid
  }, [picks, draft.rounds])

  const currentPick = useMemo(() => {
    return picks.find((p) => p.playerId === null && !p.isKeeper) || null
  }, [picks])

  const currentTeam = useMemo(() => {
    if (!currentPick) return null
    return teams.find((t) => t.teamSlug === currentPick.teamSlug) || null
  }, [currentPick, teams])

  // ─── Available Players ──────────────────────────────────────────────────

  const draftedPlayerIds = useMemo(() => {
    return new Set(picks.filter((p) => p.playerId !== null).map((p) => p.playerId))
  }, [picks])

  const availablePlayers = useMemo(() => {
    return pool
      .filter((p) => !draftedPlayerIds.has(p.playerId))
      .filter((p) => {
        if (!playerSearch) return true
        return p.playerName.toLowerCase().includes(playerSearch.toLowerCase())
      })
      .sort((a, b) => a.playerName.localeCompare(b.playerName))
  }, [pool, draftedPlayerIds, playerSearch])

  // ─── Recent Picks Ticker ───────────────────────────────────────────────

  const recentPicks = useMemo(() => {
    return picks
      .filter((p) => p.playerId !== null && !p.isKeeper && p.pickedAt)
      .sort((a, b) => new Date(b.pickedAt!).getTime() - new Date(a.pickedAt!).getTime())
      .slice(0, 10)
  }, [picks])

  // ─── Fullscreen Toggle ─────────────────────────────────────────────────

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", handler)
    return () => document.removeEventListener("fullscreenchange", handler)
  }, [])

  // ─── Completion Stats ──────────────────────────────────────────────────

  const totalPicks = picks.length
  const madePicks = picks.filter((p) => p.playerId !== null).length
  const progress = totalPicks > 0 ? Math.round((madePicks / totalPicks) * 100) : 0

  // ═══════════════════════════════════════════════════════════════════════════
  // PRE-DRAFT VIEW
  // ═══════════════════════════════════════════════════════════════════════════

  if (draft.status === "published") {
    const draftDate = draft.draftDate ? new Date(draft.draftDate) : null
    const now = new Date()
    const diffMs = draftDate ? draftDate.getTime() - now.getTime() : 0
    const daysUntil = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))

    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-8">
          <div className="space-y-2">
            <Badge variant="outline" className="text-sm">Upcoming Draft</Badge>
            <h1 className="text-4xl font-bold tracking-tight">{season.name} Draft</h1>
            <p className="text-lg text-muted-foreground">{draft.name}</p>
          </div>

          {draftDate && (
            <div className="space-y-6">
              <div className="text-7xl font-bold tabular-nums text-primary">
                {daysUntil}
              </div>
              <div className="text-xl text-muted-foreground">
                {daysUntil === 1 ? "day" : "days"} until draft day
              </div>
              <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />
                  {draftDate.toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                  {" at "}
                  {draftDate.toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                {draft.location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-4 w-4" />
                    {draft.location}
                  </span>
                )}
              </div>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-center gap-2 text-base">
                <Users className="h-4 w-4" />
                Participating Teams
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {teams.map((team) => (
                  <div
                    key={team.teamSlug}
                    className="flex items-center gap-2 rounded-md border p-3"
                  >
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: team.color || "#94a3b8" }}
                    />
                    <span className="text-sm font-medium truncate">{team.teamName}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="text-sm text-muted-foreground">
            {pool.length} players in the draft pool • {draft.rounds} rounds
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIVE + COMPLETED VIEW
  // ═══════════════════════════════════════════════════════════════════════════

  const isLive = draft.status === "live"
  const isCompleted = draft.status === "completed"

  return (
    <div ref={containerRef} className={`min-h-screen bg-background ${isFullscreen ? "p-4" : ""}`}>
      <div className={`${isFullscreen ? "" : "max-w-[1400px] mx-auto px-4 py-6"} space-y-4`}>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">{season.name} Draft</h1>
              {isLive && (
                <Badge className="bg-red-500 text-white animate-pulse">LIVE</Badge>
              )}
              {isCompleted && (
                <Badge variant="secondary">Complete</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {madePicks}/{totalPicks} picks made ({progress}%)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={toggleFullscreen} className="hidden md:flex">
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* On the clock + Timer (live only) */}
        {isLive && currentPick && currentTeam && (
          <Card className="border-2" style={{ borderColor: currentTeam.color || undefined }}>
            <CardContent className="py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: currentTeam.color || "#94a3b8" }}
                />
                <div>
                  <div className="text-sm text-muted-foreground">On the Clock</div>
                  <div className="text-lg font-semibold">{currentTeam.teamName}</div>
                </div>
                <Badge variant="outline" className="ml-2">
                  R{currentPick.round} P{currentPick.pickNumber}
                </Badge>
              </div>
              <div className={`text-3xl font-mono font-semibold tabular-nums ${
                timerRemaining === 0
                  ? "text-red-600 dark:text-red-400 animate-pulse"
                  : timerRemaining <= 10
                    ? "text-red-500"
                    : ""
              }`}>
                {Math.floor(timerRemaining / 60)}:{(timerRemaining % 60).toString().padStart(2, "0")}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent picks ticker (live only) */}
        {isLive && recentPicks.length > 0 && (
          <div className="overflow-x-auto scrollbar-hide">
            <div className="flex gap-2 pb-1">
              {recentPicks.map((p) => {
                const team = teams.find((t) => t.teamSlug === p.teamSlug)
                return (
                  <Badge
                    key={p.id}
                    variant="outline"
                    className="whitespace-nowrap shrink-0 py-1.5 px-3 text-xs"
                  >
                    <span
                      className="w-2 h-2 rounded-full mr-1.5 inline-block"
                      style={{ backgroundColor: team?.color || "#94a3b8" }}
                    />
                    R{p.round}P{p.pickNumber}: {team?.teamName} → {formatPlayerName(p.playerName)}
                  </Badge>
                )
              })}
            </div>
          </div>
        )}

        {/* Tabs: Board + Available Players */}
        <Tabs defaultValue="board" value={mobileTab} onValueChange={setMobileTab}>
          <TabsList className="md:hidden w-full">
            <TabsTrigger value="board" className="flex-1">Draft Results</TabsTrigger>
            <TabsTrigger value="players" className="flex-1">Available Players</TabsTrigger>
          </TabsList>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-4">
            {/* Board */}
            <TabsContent value="board" className="mt-0 md:!block">
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-2 py-2 text-left font-medium text-muted-foreground w-12 sticky left-0 bg-muted/50 z-10">Rd</th>
                        {teams.map((team) => (
                          <th key={team.teamSlug} className="px-2 py-2 text-left font-medium min-w-[120px]">
                            <div className="flex items-center gap-1.5">
                              <div
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: team.color || "#94a3b8" }}
                              />
                              <span className="truncate">{team.teamName}</span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: draft.rounds }, (_, i) => i + 1).map((round) => (
                        <tr key={round} className="border-b last:border-b-0 hover:bg-muted/20">
                          <td className="px-2 py-1.5 font-medium text-muted-foreground sticky left-0 bg-background z-10">
                            {round}
                          </td>
                          {teams.map((team) => {
                            const pick = boardGrid[round]?.[team.teamSlug]
                            if (!pick) {
                              return <td key={team.teamSlug} className="px-2 py-1.5 text-muted-foreground/30">—</td>
                            }

                            const isTradedSlot = pick.teamSlug !== pick.originalTeamSlug
                            const newOwner = isTradedSlot ? teams.find((t) => t.teamSlug === pick.teamSlug) : null

                            // Look up registration meta for badges
                            const playerInPool = pick.playerId ? pool.find((p) => p.playerId === pick.playerId) : null
                            const isRookie = playerInPool?.registrationMeta?.isRookie === true
                            const isGoalie = typeof playerInPool?.registrationMeta?.positions === "string" && playerInPool.registrationMeta.positions.includes("G")

                            const isOnTheClock = currentPick?.id === pick.id

                            return (
                              <td
                                key={team.teamSlug}
                                className={`px-2 py-1.5 ${isOnTheClock ? "bg-primary/5 ring-1 ring-primary/20" : ""}`}
                              >
                                {pick.playerId ? (
                                  <div className="flex items-center gap-1">
                                    <span className="truncate max-w-[100px]">{formatPlayerName(pick.playerName)}</span>
                                    {pick.isKeeper && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-amber-400 text-amber-600">K</Badge>
                                    )}
                                    {isRookie && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-green-400 text-green-600">R</Badge>
                                    )}
                                    {isGoalie && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-purple-400 text-purple-600">G</Badge>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground/40">
                                    {isTradedSlot && newOwner ? (
                                      <span className="text-blue-500 text-[10px]">→ {newOwner.teamName}</span>
                                    ) : (
                                      "—"
                                    )}
                                  </span>
                                )}
                                {pick.playerId && isTradedSlot && newOwner && (
                                  <div className="text-[10px] text-blue-500">→ {newOwner.teamName}</div>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Available Players - sidebar on desktop, tab on mobile */}
            <TabsContent value="players" className="mt-0 md:!block">
              <Card className="h-fit">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    Available Players ({availablePlayers.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search players..."
                      className="pl-8 h-8 text-xs"
                      value={playerSearch}
                      onChange={(e) => setPlayerSearch(e.target.value)}
                    />
                  </div>
                  <div className="max-h-[600px] overflow-y-auto space-y-0.5">
                    {availablePlayers.map((player) => {
                      const positions = typeof player.registrationMeta?.positions === "string"
                        ? player.registrationMeta.positions
                        : null

                      return (
                        <div
                          key={player.playerId}
                          className="flex items-center justify-between py-1.5 px-2 rounded-sm hover:bg-muted/50 text-xs"
                        >
                          <span className="truncate">{player.playerName}</span>
                          {positions && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0 ml-2">
                              {positions}
                            </Badge>
                          )}
                        </div>
                      )
                    })}
                    {availablePlayers.length === 0 && (
                      <div className="text-center py-8 text-xs text-muted-foreground">
                        {playerSearch ? "No players match your search" : "All players have been drafted"}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  )
}
