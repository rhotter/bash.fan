"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import Image from "next/image"
import useSWR from "swr"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Search, Maximize2, Minimize2, Clock, MapPin, Users, ArrowUpDown, ArrowUp, ArrowDown, Volume2, VolumeX, CalendarPlus, Layers, X, ChevronsRight, Eye, EyeOff } from "lucide-react"
import { PlayerCardModal } from "@/components/player-card-modal"

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
  const [positionFilter, setPositionFilter] = useState<string[]>([])
  const [sidebarTab, setSidebarTab] = useState<"recent" | "available">("recent")
  const [mobileTab, setMobileTab] = useState(() =>
    initialData.draft.status === "completed" ? "byteam" : "board"
  )
  const containerRef = useRef<HTMLDivElement>(null)

  // Player card modal state
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null)
  const [playerCardOpen, setPlayerCardOpen] = useState(false)

  const openPlayerCard = useCallback((playerId: number) => {
    setSelectedPlayerId(playerId)
    setPlayerCardOpen(true)
  }, [])

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

  const isAnimationsMutedRef = useRef(false)
  const [isAnimationsMuted, setIsAnimationsMuted] = useState(() => {
    if (typeof window === "undefined") return false
    const stored = localStorage.getItem("bash-draft-animations-muted") === "true"
    isAnimationsMutedRef.current = stored
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

  const toggleAnimationsMute = useCallback(() => {
    setIsAnimationsMuted((prev) => {
      const next = !prev
      isAnimationsMutedRef.current = next
      localStorage.setItem("bash-draft-animations-muted", String(next))
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

  const { draft, season, teams, picks, pool, trades, captainPlayerIds } = (data?.draft ? data : initialData)

  // Captain set for badge rendering
  const captainSet = useMemo(() => {
    const set = new Set(captainPlayerIds || [])
    pool?.forEach((p) => {
      const meta = p.registrationMeta as Record<string, unknown> | null
      if (meta?.isCaptain === true || meta?.captain === "Yes") {
        set.add(p.playerId)
      }
    })
    return set
  }, [captainPlayerIds, pool])

  // ─── Timer ──────────────────────────────────────────────────────────────

  // Initialize timer to static server-safe value to avoid hydration mismatch
  const [timerRemaining, setTimerRemaining] = useState<number>(
    draft.timerCountdown ?? draft.timerSeconds
  )

  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)

    if (draft.timerRunning && draft.timerStartedAt) {
      const tick = () => {
        const elapsed = Math.floor((Date.now() - new Date(draft.timerStartedAt!).getTime()) / 1000)
        const remaining = Math.max(0, (draft.timerCountdown ?? draft.timerSeconds) - elapsed)
        setTimerRemaining(remaining)
      }
      tick() // sync immediately on mount / when timer state changes
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
    if (draft.status === 'completed') return null
    // If all available players have been picked, there's no current pick
    const pickedCount = picks.filter((p) => p.playerId !== null).length
    if (pool.length > 0 && pickedCount >= pool.length) return null
    return picks.find((p) => p.playerId === null && !p.isKeeper) || null
  }, [picks, draft.status, pool])

  const currentTeam = useMemo(() => {
    if (!currentPick) return null
    return teams.find((t) => t.teamSlug === currentPick.teamSlug) || null
  }, [currentPick, teams])

  // Next picks after current (for "on deck" display)
  const onDeckTeams = useMemo(() => {
    if (!currentPick) return []
    const currentIdx = picks.findIndex((p) => p.id === currentPick.id)
    if (currentIdx < 0) return []
    const upcoming: { teamName: string; teamSlug: string; color: string | null; pickNumber: number }[] = []
    for (let i = currentIdx + 1; i < picks.length && upcoming.length < 5; i++) {
      const p = picks[i]
      if (p.playerId === null && !p.isKeeper) {
        const team = teams.find((t) => t.teamSlug === p.teamSlug)
        if (team) upcoming.push({ teamName: team.teamName, teamSlug: team.teamSlug, color: team.color, pickNumber: p.pickNumber })
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
      .filter((p) => {
        if (positionFilter.length === 0) return true
        const pos = typeof p.registrationMeta?.positions === "string" ? p.registrationMeta.positions.toLowerCase() : ""
        if (!pos) return false

        // Tokenize: split on commas, slashes, hyphens, whitespace; strip non-alpha chars
        const tokens = pos.split(/[,/\s-]+/).map((t) => t.replace(/[^a-z]/g, "")).filter(Boolean)

        // Wildcard positions match every filter
        const wildcards = ["all", "any", "whatever", "both"]
        if (tokens.some((t) => wildcards.includes(t))) return true

        // Map filter buttons to keywords that indicate that position
        const filterKeywords: Record<string, string[]> = {
          "G": ["goalie", "goal", "g", "goalkeeper", "backup goalie"],
          "D": ["defense", "defence", "def", "d", "rd", "ld", "defensemen", "defenseman"],
          "C": ["center", "centre", "c"],
          "F": ["forward", "forwards", "f", "fwd", "wing", "winger", "w", "lw", "rw", "rf",
                "offense", "left wing", "right wing", "not goalie", "anywhere but goalie", "any but goalie"],
        }

        return positionFilter.some((filterKey) => {
          const keywords = filterKeywords[filterKey] || [filterKey.toLowerCase()]
          return keywords.some((kw) =>
            tokens.includes(kw) || (kw.includes(" ") && pos.includes(kw))
          )
        })
      })
      .sort((a, b) => a.playerName.localeCompare(b.playerName))
  }, [pool, draftedPlayerIds, playerSearch, positionFilter])

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
          if (!isAnimationsMutedRef.current) {
            // Trigger banner
            setAnnouncement({
              teamName: team.teamName,
              teamColor: team.color || "#f97316",
              playerName: newest.playerName || "Unknown",
              round: newest.round,
              pickNumber: newest.pickNumber,
            })
            setAnnouncementVisible(true)

            // Trigger golden highlight on the cell
            setHighlightedPickIds(new Set([newest.id]))
          }

          // Play NHL draft chime
          playChime()

          if (!isAnimationsMutedRef.current) {
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

  const totalSlots = picks.length
  const madePicks = picks.filter((p) => p.playerId !== null).length
  // Use pool size as denominator when pool is smaller than total slots (not enough players for all rounds)
  const totalPicks = pool.length > 0 && pool.length < totalSlots ? pool.length : totalSlots
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

  // Mounted guard for client-only date computations (avoids hydration mismatch)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  if (draft.status === "published") {
    const draftDate = draft.draftDate ? new Date(draft.draftDate) : null
    const now = mounted ? new Date() : (draftDate ?? new Date())
    const diffMs = draftDate ? draftDate.getTime() - now.getTime() : 0
    const daysUntil = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))

    // Build Google Calendar URL
    const calendarUrl = draftDate ? (() => {
      const start = draftDate.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
      const endDate = new Date(draftDate.getTime() + 3 * 60 * 60 * 1000) // 3 hours
      const end = endDate.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
      const params = new URLSearchParams({
        action: "TEMPLATE",
        text: `BASH ${draft.name}`,
        dates: `${start}/${end}`,
        details: `BASH ${draft.name}.${teams.length > 0 ? ` ${draft.rounds} rounds, ${teams.length} teams.` : ""}`,
        location: draft.location ? `${draft.location}, San Francisco, CA` : "",
      })
      return `https://calendar.google.com/calendar/render?${params.toString()}`
    })() : null

    return (
      <div className="min-h-screen bg-background relative overflow-hidden">
        {/* Background watermark — BASH logo */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Image
            src="/logo.png"
            alt=""
            width={600}
            height={600}
            className="opacity-[0.06] select-none"
            aria-hidden="true"
          />
        </div>

        {/* Content overlay */}
        <div className="relative z-10 max-w-3xl mx-auto px-4 py-12 sm:py-16 text-center space-y-8">
          {/* Hero — Draft Logo + Title */}
          <div className="space-y-3">
            <Image
              src="/images/draft-logo.jpg"
              alt={draft.name}
              width={280}
              height={280}
              className="mx-auto"
              priority
            />
            <Badge variant="outline" className="text-xs uppercase tracking-widest bg-background/80 backdrop-blur-sm">Upcoming Draft</Badge>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{draft.name}</h1>
          </div>

          {/* Countdown */}
          {draftDate && (
            <div className="space-y-1">
              <div className="text-6xl sm:text-7xl font-bold tabular-nums text-primary">
                {daysUntil}
              </div>
              <div className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                {daysUntil === 1 ? "day" : "days"} until draft day
              </div>
            </div>
          )}

          {/* Date & Location — stacked rows */}
          {(draftDate || draft.location) && (
            <div className="inline-flex flex-col gap-2 text-sm">
              {draftDate && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4 shrink-0 text-primary" />
                  <span className="font-medium text-foreground">
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
                </div>
              )}
              {draft.location && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0 text-primary" />
                  <a
                    href={`https://www.google.com/maps/search/${encodeURIComponent(draft.location + " San Francisco")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-foreground hover:text-primary transition-colors underline underline-offset-2 decoration-muted-foreground/40 hover:decoration-primary"
                  >
                    {draft.location}, San Francisco
                  </a>
                </div>
              )}
            </div>
          )}

          {/* CTA — Add to Calendar */}
          {calendarUrl && (
            <div>
              <a href={calendarUrl} target="_blank" rel="noopener noreferrer">
                <Button size="lg" className="gap-2">
                  <CalendarPlus className="h-4 w-4" />
                  Add to Calendar
                </Button>
              </a>
            </div>
          )}

          {/* Participating Teams */}
          <div className="space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center justify-center gap-2">
              <Users className="h-3.5 w-3.5" />
              Participating Teams
            </h2>
            {teams.length > 0 ? (
              <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
                {teams.map((team) => (
                  <div key={team.teamSlug} className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: team.color || "#94a3b8" }}
                    />
                    <span className="text-sm font-medium">{team.teamName}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">Teams will be announced on draft day</p>
            )}
          </div>

          {/* Draft Format Card */}
          <Card className="bg-background/80 backdrop-blur-sm text-left">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="h-4 w-4 text-primary" />
                Draft Format
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {teams.length > 0 && pool.length > 0 ? (
                  <>{draft.rounds}-round {season.name.toLowerCase().includes("summer") ? "summer" : ""} snake draft. Captains will select from a pool of {pool.length} players. Each team enters the draft with their captain as a keeper.</>
                ) : teams.length > 0 ? (
                  <>{draft.rounds}-round {season.name.toLowerCase().includes("summer") ? "summer" : ""} snake draft with {teams.length} teams. Player pool details will be finalized closer to draft day.</>
                ) : (
                  <>Snake draft format. Teams, rounds, and player pool details will be finalized closer to draft day.</>
                )}
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-xs text-muted-foreground">
                <span>{pool.length} players in the pool</span>
                <span>{draft.rounds} rounds</span>
                <span>{teams.length} teams</span>
              </div>
            </CardContent>
          </Card>
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
          <div className="flex flex-wrap items-center justify-between gap-y-1">
            <div className="flex items-center gap-2">
              <Image src="/logo.png" alt="BASH" width={28} height={28} className="shrink-0" />
              <span className="text-lg font-extrabold tracking-tight">BASH</span>
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground hidden sm:inline">Draft Board</span>
            </div>
            <div className="flex items-center gap-2">
              {isLive && (
                !draft.timerRunning && timerRemaining > 0 && timerRemaining < (draft.timerCountdown ?? draft.timerSeconds) ? (
                  <Badge className="bg-amber-500 text-white text-[10px] px-2 py-0.5">PAUSED</Badge>
                ) : (
                  <Badge className="bg-green-500 text-white animate-pulse text-[10px] px-2 py-0.5">LIVE</Badge>
                )
              )}
              {isCompleted && (
                <Badge className="bg-green-600 text-white text-[10px] px-2 py-0.5">COMPLETE</Badge>
              )}
              <span className="text-xs text-muted-foreground tabular-nums font-medium">
                {madePicks}/{totalPicks} picks ({progress}%)
              </span>
              {isLive && (
                <div className="flex gap-1.5">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={toggleAnimationsMute}
                    className="h-8 w-8"
                    title={isAnimationsMuted ? "Show pick animations" : "Hide pick animations"}
                  >
                    {isAnimationsMuted ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={toggleMute}
                    className="h-8 w-8"
                    title={isMuted ? "Unmute pick sound" : "Mute pick sound"}
                  >
                    {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              )}
              <Button variant="outline" size="icon" onClick={toggleFullscreen} className="hidden md:flex h-8 w-8">
                {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
          {/* Orange accent separator */}
          <div className="w-full h-1 bg-primary rounded-full" />
          <h1 className="text-xl font-bold tracking-tight">{season.name} Draft{isCompleted ? " Results" : ""}</h1>
        </div>

        {/* Main content + Desktop sidebar grid */}
        <div className={`grid grid-cols-1 ${!isCompleted ? "md:grid-cols-[1fr_280px]" : ""} gap-4 items-start`}>

        {/* Left column: On the Clock + Board */}
        <div className="space-y-4 min-w-0">

        {/* On the Clock Hero (live only) */}
        {isLive && currentPick && currentTeam && (
          <div className="relative">
            {/* "THE PICK IS IN" Full-Screen Overlay */}
            {announcement && (
              <div
                className={`fixed inset-0 z-50 transition-all duration-500 ease-out ${
                  announcementVisible
                    ? "opacity-100"
                    : "opacity-0 pointer-events-none"
                }`}
              >
                {/* Desktop: dark vignette backdrop */}
                <div className="hidden md:flex absolute inset-0 bg-black/70 items-center justify-center p-8" onClick={() => setAnnouncementVisible(false)}>
                  <div
                    className="relative w-full max-w-2xl rounded-xl px-8 py-10 text-white text-center shadow-2xl"
                    style={{ backgroundColor: announcement.teamColor }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Draft logo */}
                    <div className="flex justify-center mb-4">
                      <div className="w-16 h-16 bg-white rounded-xl flex items-center justify-center shadow-md">
                        <Image src="/images/draft-logo.jpg" alt="BASH Draft" width={48} height={48} className="object-contain" />
                      </div>
                    </div>
                    <div className="text-lg font-extrabold uppercase tracking-[0.2em] text-white/90 mb-1">The Pick Is In</div>
                    <div className="text-sm uppercase tracking-[0.1em] text-white/60 mb-4">{announcement.teamName} select</div>
                    <div className="text-4xl font-extrabold tracking-tight mb-5">{announcement.playerName}</div>
                    <div className="inline-block border border-white/40 rounded-full px-5 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-white/80">
                      Round {announcement.round}, Pick {announcement.pickNumber - (announcement.round - 1) * teams.length} (#{announcement.pickNumber} overall)
                    </div>
                  </div>
                </div>

                {/* Mobile: full-screen orange overlay */}
                <div
                  className="md:hidden absolute inset-0 flex flex-col items-center justify-center px-6 text-white text-center"
                  style={{ backgroundColor: announcement.teamColor }}
                >
                  {/* Close button */}
                  <button
                    onClick={() => setAnnouncementVisible(false)}
                    className="absolute top-4 left-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/20 text-white/80 hover:bg-white/30 transition-colors"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>

                  {/* Draft logo */}
                  <div className="mb-4">
                    <div className="w-16 h-16 bg-white rounded-xl flex items-center justify-center shadow-md mx-auto">
                      <Image src="/images/draft-logo.jpg" alt="BASH Draft" width={48} height={48} className="object-contain" />
                    </div>
                  </div>

                  <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/70 mb-2">BASH Summer Draft</div>
                  <div className="text-base font-extrabold uppercase tracking-[0.2em] text-white/90 mb-3">The Pick Is In</div>
                  <div className="text-sm uppercase tracking-[0.1em] text-white/60 mb-2 border border-white/30 rounded-full px-4 py-1">{announcement.teamName} select</div>
                  <div className="text-4xl font-extrabold tracking-tight leading-tight mb-5">{announcement.playerName}</div>
                  <div className="flex items-center gap-2">
                    <span className="border border-white/40 rounded-md px-3 py-1 text-xs font-bold uppercase tracking-wider text-white/80">
                      R{announcement.round}P{announcement.pickNumber - (announcement.round - 1) * teams.length}
                    </span>
                    <span className="border border-white/40 rounded-md px-3 py-1 text-xs font-bold uppercase tracking-wider text-white/80">
                      #{announcement.pickNumber} overall
                    </span>
                  </div>
                </div>
              </div>
            )}

            <Card className="border border-border overflow-hidden">
              <CardContent className="py-4 px-5 relative">
                {/* Colored left accent bar */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-1 rounded-l-md"
                  style={{ backgroundColor: currentTeam.color || "#94a3b8" }}
                />
                <div className="flex items-center justify-between pl-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full animate-pulse shrink-0"
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
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-0.5 md:hidden">
                        <span className="font-semibold uppercase tracking-wide text-[10px]">Up next:</span>
                        {onDeckTeams.slice(0, 3).map((t, i) => (
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
                  {/* Timer — desktop: inline right side */}
                  <div className="text-right shrink-0 hidden md:block">
                    {announcementVisible ? (
                      <div className="text-sm font-semibold text-muted-foreground/50 uppercase tracking-wide">Awaiting Pick</div>
                    ) : !draft.timerRunning && timerRemaining === (draft.timerCountdown ?? draft.timerSeconds) && timerRemaining > 0 ? (
                      <div className="text-sm font-semibold text-muted-foreground/50 uppercase tracking-wide">Awaiting Pick</div>
                    ) : (
                      <>
                        <div className={`text-5xl font-mono font-extrabold tabular-nums ${
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
                </div>

                {/* Timer — mobile: full-width row below the team info */}
                <div className="md:hidden mt-3 ml-3">
                  {announcementVisible ? (
                    <div className="text-center py-2 text-sm font-semibold text-muted-foreground/50 uppercase tracking-wide">Awaiting Pick</div>
                  ) : !draft.timerRunning && timerRemaining === (draft.timerCountdown ?? draft.timerSeconds) && timerRemaining > 0 ? (
                    <div className="text-center py-2 text-sm font-semibold text-muted-foreground/50 uppercase tracking-wide">Awaiting Pick</div>
                  ) : (
                    <div className={`flex items-center gap-3 rounded-lg px-4 py-2.5 ${
                      timerRemaining === 0
                        ? "bg-red-50 dark:bg-red-950/30"
                        : timerRemaining <= 10
                          ? "bg-red-50/60 dark:bg-red-950/20"
                          : "bg-muted/40"
                    }`}>
                      <div className={`text-3xl font-mono font-extrabold tabular-nums ${
                        timerRemaining === 0
                          ? "text-red-600 animate-pulse"
                          : timerRemaining <= 10
                            ? "text-red-500"
                            : ""
                      }`}>
                        {Math.floor(timerRemaining / 60)}:{(timerRemaining % 60).toString().padStart(2, "0")}
                      </div>
                      {timerRemaining === 0 && (
                        <span className="text-xs font-bold uppercase tracking-[0.1em] text-red-500 animate-pulse">Time&apos;s Up</span>
                      )}
                      {!draft.timerRunning && timerRemaining > 0 && timerRemaining < (draft.timerCountdown ?? draft.timerSeconds) && (
                        <span className="text-xs font-bold uppercase tracking-[0.1em] text-amber-500">Paused</span>
                      )}
                      {draft.timerRunning && timerRemaining > 10 && (
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Time Remaining</span>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Recent Picks Ticker (live only) */}
        {isLive && recentPicks.length > 0 && (
          <div className="overflow-x-auto scrollbar-hide md:hidden">
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
              { label: trades.length === 1 ? "Trade" : "Trades", value: String(trades.length) },
            ].map((stat) => (
              <Card key={stat.label}>
                <CardContent className="py-2 px-3 md:py-3 md:px-4 text-center">
                  <div className="text-xl md:text-2xl font-mono font-bold tabular-nums">{stat.value}</div>
                  <div className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground mt-0.5">{stat.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Tabs: Board + Available Players / By Team */}
        <Tabs id="draft-board-tabs" value={mobileTab} onValueChange={setMobileTab}>
          <TabsList className={isCompleted ? "w-full md:w-auto" : "md:hidden w-full"}>
            {isCompleted && (
              <TabsTrigger value="byteam" className="flex-1 md:flex-none">By Team</TabsTrigger>
            )}
            <TabsTrigger value="board" className="flex-1 md:flex-none">{isCompleted ? "Full Board" : "Draft Board"}</TabsTrigger>
            {!isCompleted && (
              <>
                <TabsTrigger value="players" className="flex-1 md:flex-none">Available ({availablePlayers.length})</TabsTrigger>
                <TabsTrigger value="recent" className="flex-1 md:hidden">Recent ({recentPicks.length})</TabsTrigger>
              </>
            )}
          </TabsList>

          <div className="grid grid-cols-1 gap-4">

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
                            <SortHeader label="Skill" sortKey="skill" className="hidden md:flex w-14 md:w-20 justify-center text-[10px]" />
                            <SortHeader label="Pos" sortKey="pos" className="w-14 justify-center text-[10px]" />
                            <SortHeader label="Playoffs?" sortKey="playoffs" className="hidden md:flex w-14 justify-center text-[10px]" />
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
                                  className={`flex items-center gap-2 py-1.5 px-2 text-xs rounded-sm cursor-pointer hover:bg-muted/50 transition-colors ${pick.isKeeper ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}
                                  onClick={() => pick.playerId && openPlayerCard(pick.playerId)}
                                >
                                  <span className="text-muted-foreground font-mono tabular-nums w-6 text-right shrink-0">#{pick.pickNumber}</span>
                                  <div className="flex items-center gap-1 flex-1 min-w-0">
                                    <span className="font-medium truncate hover:underline hover:text-primary transition-colors">{pick.playerName}</span>
                                    {pick.playerId && captainSet.has(pick.playerId) && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 shrink-0 border-blue-400 text-blue-600">C</Badge>
                                    )}
                                    {isRookie && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 shrink-0 border-green-400 text-green-600">R</Badge>
                                    )}
                                  </div>
                                  <span title={skillLevel} className="hidden md:inline w-14 md:w-20 text-center text-[10px] text-muted-foreground font-mono truncate cursor-default">{skillLevel}</span>
                                  <span title={position} className="w-14 text-center text-[10px] text-muted-foreground font-mono truncate cursor-default">{position}</span>
                                  <span title={playoffAvail} className={`hidden md:inline w-14 text-center text-[10px] font-mono cursor-default ${playoffShort === "Y" ? "text-green-600" : playoffShort === "N" ? "text-red-500" : "text-muted-foreground"}`}>{playoffShort}</span>
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
                        <th className="px-2 py-2 text-left font-bold text-[10px] uppercase tracking-[0.06em] text-muted-foreground w-10 sticky left-0 bg-muted z-20" style={{ boxShadow: '2px 0 4px -2px rgba(0,0,0,0.1)' }}>Rd</th>
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
                          <td className="px-2 py-1.5 font-mono font-medium text-muted-foreground sticky left-0 bg-background z-20 tabular-nums" style={{ boxShadow: '2px 0 4px -2px rgba(0,0,0,0.1)' }}>
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
                                    <button
                                      className="truncate max-w-[100px] text-left hover:underline hover:text-primary transition-colors"
                                      onClick={() => pick.playerId && openPlayerCard(pick.playerId)}
                                    >{formatPlayerName(pick.playerName)}</button>
                                    {pick.playerId && captainSet.has(pick.playerId) && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 shrink-0 border-blue-400 text-blue-600">C</Badge>
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


            {/* Mobile-only: Available Players tab content */}
            {!isCompleted && (
              <TabsContent value="players" className="mt-0 md:hidden">
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
                    {/* Position filter toggles */}
                    <div className="flex flex-wrap gap-1">
                      {["G", "D", "C", "F"].map((pos) => {
                        const isActive = positionFilter.includes(pos)
                        return (
                          <button
                            key={pos}
                            onClick={() => setPositionFilter((prev) =>
                              isActive ? prev.filter((p) => p !== pos) : [...prev, pos]
                            )}
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors ${
                              isActive
                                ? pos === "G" ? "bg-purple-100 border-purple-300 text-purple-700"
                                : pos === "D" ? "bg-blue-100 border-blue-300 text-blue-700"
                                : pos === "C" ? "bg-red-100 border-red-300 text-red-700"
                                : "bg-amber-100 border-amber-300 text-amber-700"
                                : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
                            }`}
                          >
                            {pos}
                          </button>
                        )
                      })}
                      {positionFilter.length > 0 && (
                        <button
                          onClick={() => setPositionFilter([])}
                          className="text-[10px] px-2 py-0.5 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="max-h-[600px] overflow-y-auto space-y-0.5">
                      {availablePlayers.map((player) => {
                        const positions = typeof player.registrationMeta?.positions === "string"
                          ? player.registrationMeta.positions
                          : null

                        return (
                          <div
                            key={player.playerId}
                            className="flex items-center justify-between py-1.5 px-2 rounded-sm hover:bg-muted/50 text-xs cursor-pointer"
                            onClick={() => openPlayerCard(player.playerId)}
                          >
                            <span className="truncate hover:underline hover:text-primary transition-colors" title={player.playerName}>{player.playerName}</span>
                            {positions && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0 ml-2" title={positions}>
                                {positions}
                              </Badge>
                            )}
                          </div>
                        )
                      })}
                      {availablePlayers.length === 0 && (
                        <div className="text-center py-8 text-xs text-muted-foreground">
                          {playerSearch || positionFilter.length > 0 ? "No players match your filters" : "All players have been drafted"}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {/* Mobile-only: Recent Picks tab content */}
            {!isCompleted && (
              <TabsContent value="recent" className="mt-0 md:hidden">
                <Card className="h-fit">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center justify-between">
                      <span>Recent Picks</span>
                      <Badge variant="secondary" className="text-[10px] font-mono">{recentPicks.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 pb-2">
                    <div className="space-y-0">
                      {recentPicks.length === 0 ? (
                        <div className="text-center py-6 text-xs text-muted-foreground">No picks yet</div>
                      ) : (
                        recentPicks.map((p, i) => {
                          const team = teams.find((t) => t.teamSlug === p.teamSlug)
                          const playerInPool = p.playerId ? pool.find((pl) => pl.playerId === p.playerId) : null
                          const position = typeof playerInPool?.registrationMeta?.positions === "string"
                            ? playerInPool.registrationMeta.positions
                            : null
                          const nameParts = (p.playerName || "").split(" ")
                          const abbrevName = nameParts.length >= 2
                            ? `${nameParts[0][0]}. ${nameParts.slice(1).join(" ")}`
                            : p.playerName

                          return (
                            <div
                              key={p.id}
                              className={`flex items-center py-2 px-2.5 text-xs cursor-pointer hover:bg-muted/30 transition-colors ${i > 0 ? "border-t border-border/50" : ""}`}
                              style={i === 0 ? { backgroundColor: `${team?.color || '#f97316'}10` } : undefined}
                              onClick={() => p.playerId && openPlayerCard(p.playerId)}
                            >
                              <div
                                className="w-0.5 h-8 rounded-full shrink-0"
                                style={{ backgroundColor: team?.color || '#94a3b8' }}
                              />
                              <span className="font-mono tabular-nums text-muted-foreground text-[11px] shrink-0 w-6 text-right ml-0.5">{p.pickNumber}</span>
                              <div className="flex-1 min-w-0 ml-1.5">
                                <div className="font-semibold text-sm truncate" title={p.playerName || undefined}>{abbrevName}</div>
                                <div className="text-muted-foreground text-[11px]">{team?.teamName}</div>
                              </div>
                              {position && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0 ml-1" title={position}>
                                  {position}
                                </Badge>
                              )}
                            </div>
                          )
                        })
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            )}
          </div>
        </Tabs>

        </div>{/* End left column */}

        {/* Right column: Desktop Sidebar — Up Next + Recent Picks + Available Players */}
        {!isCompleted && (
          <div className="hidden md:flex flex-col gap-4 sticky top-4 self-start">

            {/* Up Next Widget */}
            {isLive && currentPick && (
              <Card className="h-fit">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                    <ChevronsRight className="h-4 w-4 text-muted-foreground" />
                    Up Next
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 pb-3 space-y-0">
                  {/* Current pick - highlighted */}
                  <div
                    className="flex items-center gap-2.5 py-2 px-2.5 rounded-md text-sm"
                    style={{ backgroundColor: `${currentTeam?.color || '#f97316'}15` }}
                  >
                    <span className="font-mono tabular-nums text-xs font-bold text-muted-foreground w-5 text-right">{currentPick.pickNumber}</span>
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: currentTeam?.color || '#94a3b8' }}
                    />
                    <span className="font-semibold flex-1 truncate">{currentTeam?.teamName}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600">On Clock</span>
                  </div>
                  {/* Upcoming picks */}
                  {onDeckTeams.map((t, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2.5 py-2 px-2.5 text-sm border-t border-border/50"
                    >
                      <span className="font-mono tabular-nums text-xs font-medium text-muted-foreground w-5 text-right">{t.pickNumber}</span>
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: t.color || '#94a3b8' }}
                      />
                      <span className="font-medium text-muted-foreground flex-1 truncate">{t.teamName}</span>
                    </div>
                  ))}
                  {onDeckTeams.length === 0 && (
                    <div className="text-center py-3 text-xs text-muted-foreground">Last pick!</div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Tabbed: Recent Picks / Available Players */}
            <Card className="h-fit">
              <CardHeader className="pb-2 space-y-2">
                <div className="flex rounded-lg bg-muted p-0.5">
                  <button
                    onClick={() => setSidebarTab("recent")}
                    className={`flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors ${
                      sidebarTab === "recent"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Recent ({recentPicks.length})
                  </button>
                  <button
                    onClick={() => setSidebarTab("available")}
                    className={`flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors ${
                      sidebarTab === "available"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Available ({availablePlayers.length})
                  </button>
                </div>
              </CardHeader>
              <CardContent className="pt-0 pb-2">

                {/* Recent Picks Tab */}
                {sidebarTab === "recent" && (
                  <div className="space-y-0">
                    {recentPicks.length === 0 ? (
                      <div className="text-center py-6 text-xs text-muted-foreground">No picks yet</div>
                    ) : (
                      recentPicks.slice(0, 8).map((p, i) => {
                        const team = teams.find((t) => t.teamSlug === p.teamSlug)
                        const playerInPool = p.playerId ? pool.find((pl) => pl.playerId === p.playerId) : null
                        const position = typeof playerInPool?.registrationMeta?.positions === "string"
                          ? playerInPool.registrationMeta.positions
                          : null

                        const posColor = position === "G" ? "text-purple-600 border-purple-300"
                          : position === "D" ? "text-blue-600 border-blue-300"
                          : position === "C" ? "text-red-600 border-red-300"
                          : position === "W" ? "text-green-600 border-green-300"
                          : "text-muted-foreground border-border"

                        const nameParts = (p.playerName || "").split(" ")
                        const abbrevName = nameParts.length >= 2
                          ? `${nameParts[0][0]}. ${nameParts.slice(1).join(" ")}`
                          : p.playerName

                        return (
                          <div
                            key={p.id}
                            className={`flex items-center py-2 px-2.5 text-xs cursor-pointer hover:bg-muted/30 transition-colors ${i > 0 ? "border-t border-border/50" : ""}`}
                            style={i === 0 ? { backgroundColor: `${team?.color || '#f97316'}10` } : undefined}
                            onClick={() => p.playerId && openPlayerCard(p.playerId)}
                          >
                            <div
                              className="w-0.5 h-8 rounded-full shrink-0"
                              style={{ backgroundColor: team?.color || '#94a3b8' }}
                            />
                            <span className="font-mono tabular-nums text-muted-foreground text-[11px] shrink-0 w-6 text-right ml-0.5">{p.pickNumber}</span>
                            <div className="flex-1 min-w-0 ml-1.5">
                              <div className="font-semibold text-sm truncate" title={p.playerName || undefined}>{abbrevName}</div>
                              <div className="text-muted-foreground text-[11px]">{team?.teamName}</div>
                            </div>
                            {position && (
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 shrink-0 font-bold ml-1 ${posColor}`} title={position}>
                                {position}
                              </Badge>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                )}

                {/* Available Players Tab */}
                {sidebarTab === "available" && (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search players..."
                        className="pl-8 h-8 text-xs"
                        value={playerSearch}
                        onChange={(e) => setPlayerSearch(e.target.value)}
                      />
                    </div>
                    {/* Position filter toggles */}
                    <div className="flex flex-wrap gap-1">
                      {["G", "D", "C", "F"].map((pos) => {
                        const isActive = positionFilter.includes(pos)
                        return (
                          <button
                            key={pos}
                            onClick={() => setPositionFilter((prev) =>
                              isActive ? prev.filter((p) => p !== pos) : [...prev, pos]
                            )}
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors ${
                              isActive
                                ? pos === "G" ? "bg-purple-100 border-purple-300 text-purple-700"
                                : pos === "D" ? "bg-blue-100 border-blue-300 text-blue-700"
                                : pos === "C" ? "bg-red-100 border-red-300 text-red-700"
                                : "bg-amber-100 border-amber-300 text-amber-700"
                                : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
                            }`}
                          >
                            {pos}
                          </button>
                        )
                      })}
                      {positionFilter.length > 0 && (
                        <button
                          onClick={() => setPositionFilter([])}
                          className="text-[10px] px-2 py-0.5 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="max-h-[400px] overflow-y-auto space-y-0.5">
                      {availablePlayers.map((player) => {
                        const positions = typeof player.registrationMeta?.positions === "string"
                          ? player.registrationMeta.positions
                          : null

                        return (
                          <div
                            key={player.playerId}
                            className="flex items-center justify-between py-1.5 px-2 rounded-sm hover:bg-muted/50 text-xs cursor-pointer"
                            onClick={() => openPlayerCard(player.playerId)}
                          >
                            <span className="truncate hover:underline hover:text-primary transition-colors">{player.playerName}</span>
                            {positions && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0 ml-2" title={positions}>
                                {positions}
                              </Badge>
                            )}
                          </div>
                        )
                      })}
                      {availablePlayers.length === 0 && (
                        <div className="text-center py-8 text-xs text-muted-foreground">
                          {playerSearch || positionFilter.length > 0 ? "No players match your filters" : "All players have been drafted"}
                        </div>
                      )}
                    </div>
                  </div>
                )}

              </CardContent>
            </Card>
          </div>
        )}

        </div>{/* End top-level grid */}

      </div>

      {/* Player Card Modal */}
      {(() => {
        const selectedPlayer = selectedPlayerId ? pool.find((p) => p.playerId === selectedPlayerId) || null : null
        const selectedPick = selectedPlayerId ? picks.find((p) => p.playerId === selectedPlayerId) : null
        const selectedTeam = selectedPick ? teams.find((t) => t.teamSlug === selectedPick.teamSlug) : null
        return (
          <PlayerCardModal
            player={selectedPlayer}
            open={playerCardOpen}
            onOpenChange={setPlayerCardOpen}
            seasonSlug={seasonSlug}
            teamName={selectedTeam?.teamName}
            teamColor={selectedTeam?.color}
            pickInfo={selectedPick ? {
              round: selectedPick.round,
              pickNumber: selectedPick.pickNumber - (selectedPick.round - 1) * teams.length,
              isKeeper: selectedPick.isKeeper,
            } : null}
          />
        )
      })()}
    </div>
  )
}
