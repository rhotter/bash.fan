"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import Image from "next/image"
import useSWR from "swr"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Search, Maximize2, Minimize2, Clock, MapPin, Users, ArrowUpDown, ArrowUp, ArrowDown, Volume2, VolumeX } from "lucide-react"

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
  captainPlayerIds?: number[]
}

interface PublicDraftBoardProps {
  seasonSlug: string
  initialData: DraftData
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPlayerName(name: string | null) {
  if (!name) return "—"
  if (name.length <= 13) return name
  const parts = name.split(" ")
  if (parts.length < 2) return name
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// "The Pick Is In" banner data
interface PickAnnouncement {
  teamName: string
  teamColor: string
  playerName: string
  round: number
  pickNumber: number
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PublicDraftBoard({ seasonSlug, initialData }: PublicDraftBoardProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [playerSearch, setPlayerSearch] = useState("")
  const [mobileTab, setMobileTab] = useState(() =>
    initialData.draft.status === "completed" ? "byteam" : "board"
  )
  const containerRef = useRef<HTMLDivElement>(null)

  // "The Pick Is In" state
  const [announcement, setAnnouncement] = useState<PickAnnouncement | null>(null)
  const [announcementVisible, setAnnouncementVisible] = useState(false)
  const prevPickCountRef = useRef<number>(
    initialData.picks.filter((p) => p.playerId !== null && !p.isKeeper).length
  )
  // Track newly filled pick IDs for golden highlight
  const [highlightedPickIds, setHighlightedPickIds] = useState<Set<string>>(new Set())

  // ─── Draft Chime Sound ──────────────────────────────────────────────────
  const chimeRef = useRef<HTMLAudioElement | null>(null)
  const isMutedRef = useRef(false)
  const [isMuted, setIsMuted] = useState(() => {
    if (typeof window === "undefined") return false
    const stored = localStorage.getItem("bash-draft-muted") === "true"
    isMutedRef.current = stored
    return stored
  })

  useEffect(() => {
    chimeRef.current = new Audio("/sounds/nhl-draft-chime.mp3")
    chimeRef.current.preload = "auto"
    return () => {
      chimeRef.current?.pause()
      chimeRef.current = null
    }
  }, [])

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev
      isMutedRef.current = next
      localStorage.setItem("bash-draft-muted", String(next))
      return next
    })
  }, [])

  const playChime = useCallback(() => {
    if (isMutedRef.current || !chimeRef.current) return
    // Reset to start in case it's still playing from a previous pick
    chimeRef.current.currentTime = 0
    chimeRef.current.play().catch(() => {
      // Browser may block autoplay until user interaction — silently ignore
    })
  }, [])

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

  const { draft, season, teams, picks, pool, trades, captainPlayerIds } = data || initialData

  // Captain set for badge rendering
  const captainSet = useMemo(() => new Set(captainPlayerIds || []), [captainPlayerIds])

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

  // Next picks after current (for "on deck" display)
  const onDeckTeams = useMemo(() => {
    if (!currentPick) return []
    const currentIdx = picks.findIndex((p) => p.id === currentPick.id)
    if (currentIdx < 0) return []
    const upcoming: { teamName: string; color: string | null }[] = []
    for (let i = currentIdx + 1; i < picks.length && upcoming.length < 3; i++) {
      const p = picks[i]
      if (p.playerId === null && !p.isKeeper) {
        const team = teams.find((t) => t.teamSlug === p.teamSlug)
        if (team) upcoming.push({ teamName: team.teamName, color: team.color })
      }
    }
    return upcoming
  }, [currentPick, picks, teams])

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

  // ─── "The Pick Is In" Detection ──────────────────────────────────────────

  useEffect(() => {
    const currentNonKeeperPicks = picks.filter((p) => p.playerId !== null && !p.isKeeper)
    const currentCount = currentNonKeeperPicks.length
    const prevCount = prevPickCountRef.current

    if (currentCount > prevCount && draft.status === "live") {
      // Find the newest pick(s)
      const sorted = [...currentNonKeeperPicks].sort(
        (a, b) => new Date(b.pickedAt!).getTime() - new Date(a.pickedAt!).getTime()
      )
      const newest = sorted[0]
      if (newest) {
        const team = teams.find((t) => t.teamSlug === newest.teamSlug)
        if (team) {
          // Trigger banner
          setAnnouncement({
            teamName: team.teamName,
            teamColor: team.color || "#f97316",
            playerName: newest.playerName || "Unknown",
            round: newest.round,
            pickNumber: newest.pickNumber,
          })
          setAnnouncementVisible(true)

          // Play NHL draft chime
          playChime()

          // Trigger golden highlight on the cell
          setHighlightedPickIds(new Set([newest.id]))

          // Dismiss banner after 5s
          const timer = setTimeout(() => setAnnouncementVisible(false), 5000)
          // Clear highlight after 5s
          const hlTimer = setTimeout(() => setHighlightedPickIds(new Set()), 5000)
          prevPickCountRef.current = currentCount
          return () => {
            clearTimeout(timer)
            clearTimeout(hlTimer)
          }
        }
      }
    }
    prevPickCountRef.current = currentCount
  }, [picks, teams, draft.status, playChime])

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

  // ─── Team Roster Sort (completed view) ──────────────────────────────────
  type TeamSortKey = "pick" | "skill" | "pos" | "playoffs"
  const [teamSortKey, setTeamSortKey] = useState<TeamSortKey>("pick")
  const [teamSortDir, setTeamSortDir] = useState<"asc" | "desc">("asc")

  const toggleTeamSort = useCallback((key: TeamSortKey) => {
    if (teamSortKey === key) {
      setTeamSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setTeamSortKey(key)
      setTeamSortDir("asc")
    }
  }, [teamSortKey])

  const sortTeamPicks = useCallback((teamPicks: typeof picks) => {
    return [...teamPicks].sort((a, b) => {
      const poolA = a.playerId ? pool.find((p) => p.playerId === a.playerId) : null
      const poolB = b.playerId ? pool.find((p) => p.playerId === b.playerId) : null
      const metaA = poolA?.registrationMeta as Record<string, unknown> | null
      const metaB = poolB?.registrationMeta as Record<string, unknown> | null
      const cmp =
        teamSortKey === "skill"
          ? ((metaA?.skillLevel as string) || "").localeCompare((metaB?.skillLevel as string) || "")
          : teamSortKey === "pos"
            ? ((metaA?.positions as string) || "").localeCompare((metaB?.positions as string) || "")
            : teamSortKey === "playoffs"
              ? ((metaA?.playoffAvail as string) || "").localeCompare((metaB?.playoffAvail as string) || "")
              : a.pickNumber - b.pickNumber
      return teamSortDir === "desc" ? -cmp : cmp
    })
  }, [teamSortKey, teamSortDir, pool])

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
            <Image src="/logo.png" alt="BASH" width={56} height={56} className="mx-auto" />
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
      <div className={`${isFullscreen ? "" : "mx-auto px-4 py-6"} space-y-4`}>

        {/* Branded Header */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Image src="/logo.png" alt="BASH" width={28} height={28} className="shrink-0" />
                <span className="text-lg font-extrabold tracking-tight">BASH</span>
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Live Draft Board</span>
              </div>
              {isLive && (
                !draft.timerRunning && timerRemaining > 0 && timerRemaining < (draft.timerCountdown ?? draft.timerSeconds) ? (
                  <Badge className="bg-amber-500 text-white text-[10px] px-2 py-0.5">PAUSED</Badge>
                ) : (
                  <Badge className="bg-red-500 text-white animate-pulse text-[10px] px-2 py-0.5">LIVE</Badge>
                )
              )}
              {isCompleted && (
                <Badge className="bg-green-600 text-white text-[10px] px-2 py-0.5">COMPLETE</Badge>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground tabular-nums font-medium">
                {madePicks}/{totalPicks} picks ({progress}%)
              </span>
              {isLive && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={toggleMute}
                  className="h-8 w-8"
                  title={isMuted ? "Unmute pick sound" : "Mute pick sound"}
                >
                  {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                </Button>
              )}
              <Button variant="outline" size="icon" onClick={toggleFullscreen} className="hidden md:flex h-8 w-8">
                {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
          {/* Orange accent separator */}
          <div className="w-full h-1 bg-primary rounded-full" />
          <h1 className="text-xl font-bold tracking-tight">{season.name} Draft</h1>
        </div>

        {/* On the Clock Hero (live only) */}
        {isLive && currentPick && currentTeam && (
          <div className="relative">
            {/* "THE PICK IS IN" Banner */}
            {announcement && (
              <div
                className={`absolute inset-x-0 -top-1 z-20 transition-all duration-500 ease-out ${
                  announcementVisible
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 -translate-y-4 pointer-events-none"
                }`}
              >
                <div
                  className="rounded-lg px-5 py-4 text-white shadow-lg"
                  style={{ backgroundColor: announcement.teamColor }}
                >
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/70">The Pick Is In</div>
                      <div className="text-lg md:text-xl font-extrabold uppercase tracking-tight">
                        {announcement.teamName} <span className="font-normal text-white/80">select</span>
                      </div>
                      <div className="text-xl md:text-2xl font-extrabold">{announcement.playerName}</div>
                    </div>
                    <div className="text-right text-sm text-white/70">
                      <div className="font-mono tabular-nums">R{announcement.round}P{announcement.pickNumber}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <Card
              className={`border border-border overflow-hidden transition-opacity duration-300 ${
                announcementVisible ? "opacity-30" : "opacity-100"
              }`}
            >
              <CardContent className="py-4 px-5 flex items-center justify-between relative">
                {/* Colored left accent bar */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-1 rounded-l-md"
                  style={{ backgroundColor: currentTeam.color || "#94a3b8" }}
                />
                <div className="space-y-1 pl-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full animate-pulse"
                      style={{ backgroundColor: currentTeam.color || "#94a3b8" }}
                    />
                    <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">On the Clock</span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="text-2xl md:text-3xl font-extrabold tracking-tight uppercase">{currentTeam.teamName}</div>
                    <Badge variant="outline" className="text-xs">
                      Round {currentPick.round} · Pick {currentPick.pickNumber - (currentPick.round - 1) * teams.length}
                    </Badge>
                    <span className="text-xs text-muted-foreground/50">#{currentPick.pickNumber} overall</span>
                  </div>
                  {onDeckTeams.length > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-0.5">
                      <span className="font-semibold uppercase tracking-wide text-[10px]">Up next:</span>
                      {onDeckTeams.map((t, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <span className="text-muted-foreground/40">→</span>}
                          <span
                            className="w-2 h-2 rounded-full inline-block"
                            style={{ backgroundColor: t.color || "#94a3b8" }}
                          />
                          <span className="font-medium">{t.teamName}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {/* Timer with state labels */}
                <div className="text-right shrink-0">
                  {announcementVisible ? (
                    /* Freeze timer during "Pick Is In" celebration */
                    <div className="text-sm font-semibold text-muted-foreground/50 uppercase tracking-wide">Awaiting Pick</div>
                  ) : !draft.timerRunning && timerRemaining === (draft.timerCountdown ?? draft.timerSeconds) && timerRemaining > 0 ? (
                    /* Timer hasn't started yet */
                    <div className="text-sm font-semibold text-muted-foreground/50 uppercase tracking-wide">Awaiting Pick</div>
                  ) : (
                    <>
                      <div className={`text-4xl md:text-5xl font-mono font-extrabold tabular-nums ${
                        timerRemaining === 0
                          ? "text-red-600 animate-pulse"
                          : timerRemaining <= 10
                            ? "text-red-500"
                            : ""
                      }`}>
                        {Math.floor(timerRemaining / 60)}:{(timerRemaining % 60).toString().padStart(2, "0")}
                      </div>
                      {timerRemaining === 0 && (
                        <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-red-500 animate-pulse mt-0.5">Time&apos;s Up</div>
                      )}
                      {!draft.timerRunning && timerRemaining > 0 && timerRemaining < (draft.timerCountdown ?? draft.timerSeconds) && (
                        <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-amber-500 mt-0.5">Paused</div>
                      )}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Recent Picks Ticker (live only) */}
        {isLive && recentPicks.length > 0 && (
          <div className="overflow-x-auto scrollbar-hide">
            <div className="flex items-center gap-2 pb-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground shrink-0">Recent Picks</span>
              {recentPicks.map((p) => {
                const team = teams.find((t) => t.teamSlug === p.teamSlug)
                return (
                  <Badge
                    key={p.id}
                    variant="outline"
                    className="whitespace-nowrap shrink-0 py-1 px-2.5 text-[11px]"
                  >
                    <span
                      className="w-2 h-2 rounded-full mr-1.5 inline-block"
                      style={{ backgroundColor: team?.color || "#94a3b8" }}
                    />
                    R{p.round}P{p.pickNumber - (p.round - 1) * teams.length}: {team?.teamName} → {formatPlayerName(p.playerName)}
                  </Badge>
                )
              })}
            </div>
          </div>
        )}

        {/* Completed: Summary Stats Row */}
        {isCompleted && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Total Picks", value: String(madePicks) },
              { label: "Rounds", value: String(draft.rounds) },
              { label: "Teams", value: String(teams.length) },
              { label: "Trades", value: String(trades.length) },
            ].map((stat) => (
              <Card key={stat.label}>
                <CardContent className="py-3 px-4 text-center">
                  <div className="text-2xl font-mono font-bold tabular-nums">{stat.value}</div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground mt-0.5">{stat.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Tabs: Board + Available Players / By Team */}
        <Tabs id="draft-board-tabs" defaultValue={isCompleted ? "byteam" : "board"} value={mobileTab} onValueChange={setMobileTab}>
          <TabsList className={isCompleted ? "w-full md:w-auto" : "md:hidden w-full"}>
            {isCompleted && (
              <TabsTrigger value="byteam" className="flex-1 md:flex-none">By Team</TabsTrigger>
            )}
            <TabsTrigger value="board" className="flex-1 md:flex-none">{isCompleted ? "Full Board" : "Draft Board"}</TabsTrigger>
            {!isCompleted && (
              <TabsTrigger value="players" className="flex-1 md:flex-none">Available ({availablePlayers.length})</TabsTrigger>
            )}
          </TabsList>

          <div className={`grid grid-cols-1 ${!isCompleted ? "md:grid-cols-[1fr_280px]" : ""} gap-4`}>

            {/* By Team View (completed only) */}
            {isCompleted && (
              <TabsContent value="byteam" className="mt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {teams.map((team) => {
                    const teamPicks = sortTeamPicks(
                      picks.filter((p) => p.teamSlug === team.teamSlug && p.playerId !== null)
                    )
                    const SortHeader = ({ label, sortKey, className }: { label: string; sortKey: TeamSortKey; className?: string }) => (
                      <button
                        onClick={() => toggleTeamSort(sortKey)}
                        className={`flex items-center gap-0.5 font-semibold text-muted-foreground hover:text-foreground transition-colors ${className || ""}`}
                      >
                        {label}
                        {teamSortKey === sortKey ? (
                          teamSortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-40" />
                        )}
                      </button>
                    )
                    return (
                      <Card key={team.teamSlug} className="overflow-hidden">
                        <div
                          className="h-[3px] w-full"
                          style={{ backgroundColor: team.color || "#94a3b8" }}
                        />
                        <CardHeader className="pb-2 pt-3">
                          <CardTitle className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: team.color || "#94a3b8" }}
                              />
                              <span className="font-semibold">{team.teamName}</span>
                            </div>
                            <Badge variant="secondary" className="text-[10px]">{teamPicks.length} picks</Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-0 pb-3">
                          {/* Table header */}
                          <div className="flex items-center gap-2 py-1 px-2 text-[10px] border-b border-border mb-0.5">
                            <span className="w-6 shrink-0 text-right font-semibold text-muted-foreground">#</span>
                            <span className="flex-1 font-semibold text-muted-foreground">Player</span>
                            <SortHeader label="Skill" sortKey="skill" className="w-14 md:w-20 justify-center text-[10px]" />
                            <SortHeader label="Pos" sortKey="pos" className="w-14 justify-center text-[10px]" />
                            <SortHeader label="Playoffs?" sortKey="playoffs" className="w-14 justify-center text-[10px]" />
                            <span className="w-10 shrink-0" />
                          </div>
                          <div className="space-y-0">
                            {teamPicks.map((pick) => {
                              const playerInPool = pick.playerId ? pool.find((p) => p.playerId === pick.playerId) : null
                              const meta = playerInPool?.registrationMeta as Record<string, unknown> | null
                              const isRookie = meta?.isRookie === true
                              const isGoalie = typeof meta?.positions === "string" && (meta.positions as string).includes("G")
                              const skillLevel = (meta?.skillLevel as string) || "—"
                              const position = (meta?.positions as string) || "—"
                              const playoffAvail = (meta?.playoffAvail as string) || "—"
                              // Shorten playoff value for display
                              const playoffShort = playoffAvail.toLowerCase().startsWith("yes") ? "Y" : playoffAvail.toLowerCase().startsWith("no") ? "N" : playoffAvail === "—" ? "—" : "?"
                              return (
                                <div
                                  key={pick.id}
                                  className={`flex items-center gap-2 py-1.5 px-2 text-xs rounded-sm ${pick.isKeeper ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}
                                >
                                  <span className="text-muted-foreground font-mono tabular-nums w-6 text-right shrink-0">#{pick.pickNumber}</span>
                                  <div className="flex items-center gap-1 flex-1 min-w-0">
                                    <span className="font-medium truncate">{pick.playerName}</span>
                                    {pick.playerId && captainSet.has(pick.playerId) && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 shrink-0 border-blue-400 text-blue-600">C</Badge>
                                    )}
                                    {isRookie && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 shrink-0 border-green-400 text-green-600">R</Badge>
                                    )}
                                  </div>
                                  <span title={skillLevel} className="w-14 md:w-20 text-center text-[10px] text-muted-foreground font-mono truncate cursor-default">{skillLevel}</span>
                                  <span title={position} className="w-14 text-center text-[10px] text-muted-foreground font-mono truncate cursor-default">{position}</span>
                                  <span title={playoffAvail} className={`w-14 text-center text-[10px] font-mono cursor-default ${playoffShort === "Y" ? "text-green-600" : playoffShort === "N" ? "text-red-500" : "text-muted-foreground"}`}>{playoffShort}</span>
                                  <div className="flex flex-nowrap gap-0.5 shrink-0 w-10 justify-end">
                                    {pick.isKeeper && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-amber-400 text-amber-600">K</Badge>
                                    )}
                                    {isGoalie && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-purple-400 text-purple-600">G</Badge>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                            {teamPicks.length === 0 && (
                              <div className="text-center py-4 text-xs text-muted-foreground">No picks yet</div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </TabsContent>
            )}

            {/* Full Board */}
            <TabsContent value="board" className={`mt-0 ${!isCompleted ? "md:!block" : ""}`}>
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-2 py-2 text-left font-bold text-[10px] uppercase tracking-[0.06em] text-muted-foreground w-12 sticky left-0 bg-muted/50 z-10">Rd</th>
                        {teams.map((team) => (
                          <th
                            key={team.teamSlug}
                            className="px-2 py-2 text-left font-semibold min-w-[120px] border-t-[3px]"
                            style={{ borderTopColor: team.color || "#94a3b8" }}
                          >
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
                          <td className="px-2 py-1.5 font-mono font-medium text-muted-foreground sticky left-0 bg-background z-10 tabular-nums">
                            {round}
                          </td>
                          {teams.map((team) => {
                            const pick = boardGrid[round]?.[team.teamSlug]
                            if (!pick) {
                              return <td key={team.teamSlug} className="px-2 py-1.5 text-muted-foreground/30">—</td>
                            }

                            const isTradedSlot = pick.teamSlug !== pick.originalTeamSlug
                            const newOwner = isTradedSlot ? teams.find((t) => t.teamSlug === pick.teamSlug) : null
                            const playerInPool = pick.playerId ? pool.find((p) => p.playerId === pick.playerId) : null
                            const isRookie = playerInPool?.registrationMeta?.isRookie === true
                            const isGoalie = typeof playerInPool?.registrationMeta?.positions === "string" && playerInPool.registrationMeta.positions.includes("G")
                            const isOnTheClock = currentPick?.id === pick.id
                            const isHighlighted = highlightedPickIds.has(pick.id)

                            return (
                              <td
                                key={team.teamSlug}
                                className={`px-2 py-1.5 transition-colors duration-1000 ${
                                  isHighlighted
                                    ? "bg-amber-100"
                                    : isOnTheClock
                                      ? "bg-primary/5 ring-1 ring-primary/20 ring-inset"
                                      : ""
                                }`}
                              >
                                {pick.playerId ? (
                                  <div className="flex flex-nowrap items-center gap-1">
                                    <span className="truncate max-w-[100px]">{formatPlayerName(pick.playerName)}</span>
                                    {pick.playerId && captainSet.has(pick.playerId) && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-blue-400 text-blue-600">C</Badge>
                                    )}
                                    {isRookie && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-green-400 text-green-600">R</Badge>
                                    )}
                                    {pick.isKeeper && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-amber-400 text-amber-600">K</Badge>
                                    )}
                                    {isGoalie && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-purple-400 text-purple-600">G</Badge>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground/40">
                                    {isOnTheClock ? (
                                      <span className="text-primary/60 text-[10px] font-medium animate-pulse">On the Clock</span>
                                    ) : isTradedSlot && newOwner ? (
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

            {/* Available Players - sidebar on desktop, tab on mobile (live only) */}
            {!isCompleted && (
              <TabsContent value="players" className="mt-0 md:!block">
                <Card className="h-fit">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center justify-between">
                      <span>Available Players</span>
                      <Badge variant="secondary" className="text-[10px] font-mono">{availablePlayers.length}</Badge>
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
            )}
          </div>
        </Tabs>


      </div>
    </div>
  )
}
