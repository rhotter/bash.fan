"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import Image from "next/image"
import Link from "next/link"
import useSWR, { preload } from "swr"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Search, Clock, Users, Volume2, VolumeX, CalendarPlus, Layers, X, ChevronsRight, Eye, EyeOff, Trophy, LayoutList, LayoutGrid, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react"
import { PlayerCardModal } from "@/components/player-card-modal"
import { DraftPlayerBadge } from "@/components/draft-player-badge"
import { TeamLogo } from "@/components/team-logo"
import { isPlayerGoalie, matchesPositionFilter, getPositionChips } from "@/lib/draft-helpers"

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
  draftType?: string | null
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

/** Last name only — used when badges (C/K) eat into the column width */
function formatPlayerNameCompact(name: string | null) {
  if (!name) return "—"
  const parts = name.split(" ")
  if (parts.length < 2) return name
  return parts.slice(1).join(" ")
}

function PositionBadges({ raw }: { raw?: string | null }) {
  if (!raw) return null
  const chips = getPositionChips(raw)
  if (chips.length === 0) {
    return (
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0 ml-2" title={raw}>
        {raw}
      </Badge>
    )
  }

  return (
    <div className="flex items-center gap-1 shrink-0 ml-1.5" title={raw}>
      {chips.map((tag) => {
        const colorClass =
          tag === "G"
            ? "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-purple-300 dark:border-purple-700"
            : tag === "D"
              ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-300 dark:border-blue-700"
              : tag === "C"
                ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-300 dark:border-red-700"
                : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300 dark:border-amber-700"
        return (
          <span
            key={tag}
            className={`inline-flex items-center justify-center text-[9px] font-bold h-4 min-w-4 px-1 rounded-full border leading-none ${colorClass}`}
          >
            {tag}
          </span>
        )
      })}
    </div>
  )
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// "The Pick Is In" banner data
interface PickAnnouncement {
  teamName: string
  teamSlug: string
  teamColor: string
  playerName: string
  round: number
  pickNumber: number
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PublicDraftBoard({ seasonSlug, initialData }: PublicDraftBoardProps) {
  const [playerSearch, setPlayerSearch] = useState("")
  const [positionFilter, setPositionFilter] = useState<string[]>([])
  const [sidebarTab, setSidebarTab] = useState<"recent" | "available">("recent")
  const [mobileTab, setMobileTab] = useState(() =>
    (initialData.draft.status === "completed" || initialData.draft.status === "archived") ? "byteam" : "board"
  )

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
  const [isMuted, setIsMuted] = useState(false)

  const isAnimationsMutedRef = useRef(false)
  const [isAnimationsMuted, setIsAnimationsMuted] = useState(false)

  // By-team sort state
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


  // Sync persisted preferences from localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    const muted = localStorage.getItem("bash-draft-muted") === "true"
    isMutedRef.current = muted
    setIsMuted(muted)

    const animMuted = localStorage.getItem("bash-draft-animations-muted") === "true"
    isAnimationsMutedRef.current = animMuted
    setIsAnimationsMuted(animMuted)
  }, [])

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

  const { draft, season, teams, picks, pool, captainPlayerIds } = (data?.draft ? data : initialData)

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
        return matchesPositionFilter(p.registrationMeta?.positions, positionFilter)
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

  const keeperPicks = useMemo(() => {
    return picks.filter((p) => p.playerId !== null && p.isKeeper)
  }, [picks])

  const prefetchPlayerStats = useCallback((playerId: number) => {
    preload(`/api/bash/draft/player-stats/${playerId}?currentSeason=${seasonSlug}`, fetcher)
  }, [seasonSlug])

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
              teamSlug: team.teamSlug,
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

  // ─── Completion Stats ──────────────────────────────────────────────────

  const totalSlots = picks.length
  const madePicks = picks.filter((p) => p.playerId !== null).length
  // Use pool size as denominator when pool is smaller than total slots (not enough players for all rounds)
  const totalPicks = pool.length > 0 && pool.length < totalSlots ? pool.length : totalSlots
  const progress = totalPicks > 0 ? Math.round((madePicks / totalPicks) * 100) : 0

  // ═══════════════════════════════════════════════════════════════════════════
  // PRE-DRAFT VIEW
  // ═══════════════════════════════════════════════════════════════════════════

  // Mounted guard for client-only date computations (avoids hydration mismatch)
  const [mounted, setMounted] = useState(false)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { setMounted(true) }, [])

  // Live countdown tick — update every second when < 24h away
  useEffect(() => {
    if (!mounted) return
    const draftDate = draft.draftDate ? new Date(draft.draftDate) : null
    if (!draftDate) return
    const diffMs = draftDate.getTime() - Date.now()
    if (diffMs <= 0 || diffMs > 24 * 60 * 60 * 1000) return
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [mounted, draft.draftDate])

  if (draft.status === "published") {
    const draftDate = draft.draftDate ? new Date(draft.draftDate) : null
    const currentTime = mounted ? now : (draftDate ?? new Date())
    const diffMs = draftDate ? draftDate.getTime() - currentTime.getTime() : 0
    const isUnder24h = diffMs > 0 && diffMs <= 24 * 60 * 60 * 1000
    const isPast = diffMs <= 0
    const isSameDay = draftDate && currentTime.toDateString() === draftDate.toDateString()
    const daysUntil = isSameDay ? 0 : Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))

    // HH:MM:SS for < 24h countdown
    const countdownH = Math.floor(diffMs / (1000 * 60 * 60))
    const countdownM = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
    const countdownS = Math.floor((diffMs % (1000 * 60)) / 1000)

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
        location: "",
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
              {!mounted ? (
                <div className="text-6xl sm:text-7xl font-bold tabular-nums text-primary">-</div>
              ) : isPast ? (
                <div className="text-4xl sm:text-5xl font-bold text-primary">Draft Day! 🏒</div>
              ) : isUnder24h ? (
                <>
                  <div className="text-6xl sm:text-7xl font-bold tabular-nums text-primary">
                    {String(countdownH).padStart(2, "0")}:{String(countdownM).padStart(2, "0")}:{String(countdownS).padStart(2, "0")}
                  </div>
                  <div className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                    until draft
                  </div>
                </>
              ) : (
                <>
                  <div className="text-6xl sm:text-7xl font-bold tabular-nums text-primary">
                    {daysUntil}
                  </div>
                  <div className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                    {daysUntil === 1 ? "day" : "days"} until draft day
                  </div>
                </>
              )}
            </div>
          )}

          {/* Date & Location — stacked rows */}
          {draftDate && (
            <div className="inline-flex flex-col gap-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-4 w-4 shrink-0 text-primary" />
                <span className="font-medium text-foreground">
                  {mounted ? (
                    <>
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
                    </>
                  ) : (
                    <span className="inline-block w-48 h-5 bg-muted rounded animate-pulse" />
                  )}
                </span>
              </div>
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
              <div 
                className="grid items-start justify-items-center gap-x-2 sm:gap-x-4 md:gap-x-6 max-w-3xl mx-auto w-full"
                style={{ gridTemplateColumns: `repeat(${teams.length}, minmax(0, 1fr))` }}
              >
                {teams.map((team) => (
                  <div key={team.teamSlug} className="flex flex-col items-center gap-1.5 w-full">
                    <TeamLogo 
                      slug={team.teamSlug} 
                      name={team.teamName} 
                      size={96} 
                      className="w-12 h-12 sm:w-20 sm:h-20 md:w-24 md:h-24 object-contain" 
                    />
                    <span className="text-[10px] sm:text-[11px] font-medium text-center leading-tight break-words max-w-full">
                      {team.teamName}
                    </span>
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
                  <>{draft.rounds}-round {season.name.toLowerCase().includes("summer") ? "summer " : ""}{draft.draftType === "linear" ? "linear" : "snake"} draft. Captains will select from a pool of {pool.length} players. Each team enters the draft with their captain as a keeper.</>
                ) : teams.length > 0 ? (
                  <>{draft.rounds}-round {season.name.toLowerCase().includes("summer") ? "summer " : ""}{draft.draftType === "linear" ? "linear" : "snake"} draft with {teams.length} teams. Player pool details will be finalized closer to draft day.</>
                ) : (
                  <>{draft.draftType === "linear" ? "Linear" : "Snake"} draft format. Teams, rounds, and player pool details will be finalized closer to draft day.</>
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
  const isCompleted = draft.status === "completed" || draft.status === "archived"

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-6 space-y-4">

        {/* Branded Header */}
        <div className="space-y-2">
          {isCompleted ? (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h1 className="text-2xl font-black tracking-tight">{season.name} Draft Results</h1>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] px-2 py-0.5 gap-1 font-semibold">
                  <Trophy className="h-3 w-3" />
                  Complete
                </Badge>
                <span className="text-xs text-muted-foreground tabular-nums font-medium">
                  {madePicks}/{totalPicks} picks ({progress}%)
                </span>
              </div>
            </div>
          ) : (
            <>
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
                  <span className="text-xs text-muted-foreground tabular-nums font-medium">
                    {madePicks}/{totalPicks} picks ({progress}%)
                  </span>
                  {isLive && (
                    <div className="flex gap-1.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={toggleAnimationsMute}
                            className="h-8 w-8"
                            aria-label={isAnimationsMuted ? "Show pick animations" : "Hide pick animations"}
                          >
                            {isAnimationsMuted ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          {isAnimationsMuted ? "Show pick animations" : "Hide pick animations"}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={toggleMute}
                            className="h-8 w-8"
                            aria-label={isMuted ? "Unmute pick sound" : "Mute pick sound"}
                          >
                            {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          {isMuted ? "Unmute pick sound" : "Mute pick sound"}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </div>
              </div>
              {/* Orange accent separator */}
              <div className="w-full h-1 bg-primary rounded-full" />
              <h1 className="text-xl font-bold tracking-tight">{season.name} Draft</h1>
            </>
          )}
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
                    className="relative w-full max-w-2xl rounded-xl px-8 py-10 text-white text-center shadow-2xl overflow-hidden"
                    style={{ backgroundColor: announcement.teamColor }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Team logo — hero centerpiece */}
                    <div className="flex justify-center mb-5">
                      <div className="w-24 h-24 bg-white rounded-2xl flex items-center justify-center shadow-lg ring-4 ring-white/30">
                        <TeamLogo slug={announcement.teamSlug} name={announcement.teamName} size={80} />
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

                {/* Mobile: full-screen team color overlay */}
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

                  {/* Team logo — hero centerpiece */}
                  <div className="mb-5">
                    <div className="w-24 h-24 bg-white rounded-2xl flex items-center justify-center shadow-lg ring-4 ring-white/30 mx-auto">
                      <TeamLogo slug={announcement.teamSlug} name={announcement.teamName} size={80} />
                    </div>
                  </div>

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



        {/* Tabs: Board + Available Players / By Team */}
        <Tabs id="draft-board-tabs" value={mobileTab} onValueChange={setMobileTab}>
          {isCompleted ? (
            /* View toggle: By Team / Full Board */
            <div
              role="tablist"
              aria-label="Draft view"
              className="inline-flex items-center p-1 rounded-lg bg-muted/60 border border-border/40 mb-4"
            >
              <button
                role="tab"
                aria-selected={mobileTab === "byteam"}
                onClick={() => setMobileTab("byteam")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                  mobileTab === "byteam"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <LayoutList className="h-3.5 w-3.5" />
                By Team
              </button>
              <button
                role="tab"
                aria-selected={mobileTab === "board"}
                onClick={() => setMobileTab("board")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                  mobileTab === "board"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Full Board
              </button>
            </div>
          ) : (
            <TabsList className="md:hidden w-full">
              <TabsTrigger value="board" className="flex-1 md:flex-none">Draft Board</TabsTrigger>
              <TabsTrigger value="players" className="flex-1 md:flex-none">Available ({availablePlayers.length})</TabsTrigger>
              <TabsTrigger value="recent" className="flex-1 md:hidden">Recent ({recentPicks.length})</TabsTrigger>
            </TabsList>
          )}

          <div className="grid grid-cols-1 gap-4">

            {/* By Team View (completed only) — flat sections, no Cards, site-style */}
            {isCompleted && (
              <TabsContent value="byteam" className="mt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                  {teams.map((team) => {
                    const teamPicks = sortTeamPicks(
                      picks.filter((p) => p.teamSlug === team.teamSlug && p.playerId !== null)
                    )

                    return (
                      <div key={team.teamSlug}>
                        {/* Team header */}
                        <div
                          className="flex items-center gap-2.5 mb-2 pb-1.5 border-b-2"
                          style={{ borderBottomColor: team.color || "#94a3b8" }}
                        >
                          <div className="shrink-0 w-7 h-7 md:w-14 md:h-14">
                            <TeamLogo slug={team.teamSlug} name={team.teamName} size={56} className="!w-full !h-full object-contain" />
                          </div>
                          <Link
                            href={`/team/${team.teamSlug}`}
                            className="text-sm font-bold tracking-tight hover:text-primary transition-colors truncate"
                          >
                            {team.teamName}
                          </Link>
                          <span className="ml-auto text-[10px] text-muted-foreground/50 tabular-nums">
                            {teamPicks.length} picks
                          </span>
                        </div>

                        {/* Column headers (desktop) */}
                        <div className="hidden md:flex items-center gap-2 sm:gap-3 px-2 py-1 text-[10px] border-b border-border/30 mb-0.5">
                          <span className="w-7 shrink-0" />
                          <span className="flex-1 font-semibold text-muted-foreground">Player</span>
                          <button onClick={() => toggleTeamSort("pos")} className="flex items-center gap-0.5 font-semibold text-muted-foreground hover:text-foreground transition-colors w-12 sm:w-16 justify-end">
                            Pos {teamSortKey === "pos" ? (teamSortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                          </button>
                          <button onClick={() => toggleTeamSort("skill")} className="flex items-center gap-0.5 font-semibold text-muted-foreground hover:text-foreground transition-colors w-16 justify-end">
                            Skill {teamSortKey === "skill" ? (teamSortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                          </button>
                          <button onClick={() => toggleTeamSort("playoffs")} className="flex items-center gap-0.5 font-semibold text-muted-foreground hover:text-foreground transition-colors w-8 justify-center">
                            PO {teamSortKey === "playoffs" ? (teamSortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                          </button>
                        </div>

                        {/* Roster rows */}
                        <div className="flex flex-col">
                          {teamPicks.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground/50 px-2 py-3">No picks made.</p>
                          ) : (
                            teamPicks.map((pick, i) => {
                              const playerInPool = pick.playerId ? pool.find((p) => p.playerId === pick.playerId) : null
                              const meta = playerInPool?.registrationMeta as Record<string, unknown> | null
                              const isCaptain = pick.playerId != null && captainSet.has(pick.playerId)
                              const isRookie = meta?.isRookie === true
                              const position = (meta?.positions as string) || ""
                              const skillLevel = (meta?.skillLevel as string) || ""
                              const playoffAvail = (meta?.playoffAvail as string) || ""
                              const playoffShort = playoffAvail.toLowerCase().startsWith("yes") ? "Y" : playoffAvail.toLowerCase().startsWith("no") ? "N" : "?"

                              return (
                                <div
                                  key={pick.id}
                                  onClick={() => pick.playerId && openPlayerCard(pick.playerId)}
                                  onMouseEnter={() => pick.playerId && prefetchPlayerStats(pick.playerId)}
                                  onFocus={() => pick.playerId && prefetchPlayerStats(pick.playerId)}
                                  className={cn(
                                    "relative group w-full text-left flex items-baseline gap-2 sm:gap-3 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors",
                                    i % 2 === 0 && "bg-card/15"
                                  )}
                                >
                                  <button
                                    type="button"
                                    aria-label={`View ${pick.playerName}`}
                                    className="absolute inset-0 rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                                  />
                                  <span className="pointer-events-none text-muted-foreground/40 tabular-nums text-[10px] shrink-0 w-7 text-right">#{pick.pickNumber}</span>
                                  <span className="pointer-events-none flex-1 min-w-0 flex items-center gap-1.5">
                                    <span className="truncate text-xs font-semibold group-hover:text-primary transition-colors">
                                      {pick.playerName}
                                    </span>
                                    {isCaptain && (
                                      <DraftPlayerBadge kind="captain" />
                                    )}
                                    {pick.isKeeper && !isCaptain && (
                                      <span className="shrink-0 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-sm border border-border text-[9px] font-bold uppercase tracking-wider text-muted-foreground leading-none">K</span>
                                    )}
                                    {isRookie && (
                                      <DraftPlayerBadge kind="rookie" />
                                    )}
                                  </span>
                                  {position && (
                                    <span className="relative shrink-0 text-[10px] font-medium text-muted-foreground tabular-nums w-12 sm:w-16 text-right truncate" title={position}>
                                      {position}
                                    </span>
                                  )}
                                  <span className="relative hidden md:inline shrink-0 text-[10px] font-medium text-muted-foreground tabular-nums w-16 text-right truncate" title={skillLevel}>
                                    {skillLevel || "—"}
                                  </span>
                                  <span className={`relative hidden md:inline shrink-0 text-[10px] font-medium tabular-nums w-8 text-center ${playoffShort === "Y" ? "text-green-600" : playoffShort === "N" ? "text-red-500" : "text-muted-foreground"}`} title={playoffAvail}>
                                    {playoffShort}
                                  </span>
                                </div>
                              )
                            })
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Legend — matches the standings/stats footer-note pattern */}
                <div className="mt-4 pt-3 border-t border-border/20">
                  <p className="text-[10px] text-muted-foreground/50">
                    C=Captain, K=Keeper, R=Rookie
                  </p>
                </div>
              </TabsContent>
            )}

            {/* Full Board */}
            <TabsContent value="board" className={`mt-0 ${!isCompleted ? "md:!block" : ""}`}>
              {isCompleted ? (
                /* Flat grid table, site-style with visible cell structure */
                <div className="overflow-x-auto -mx-4 sm:mx-0">
                  <table className="w-full min-w-[720px] text-[11px] table-fixed border-collapse">
                    <thead>
                      <tr className="text-muted-foreground/50 text-[9px] uppercase tracking-wider">
                        <th className="text-center font-medium py-2.5 sticky left-0 z-10 bg-background pl-4 sm:pl-0 w-12 border-b border-border/50 after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none">
                          Rd
                        </th>
                        {teams.map((team) => (
                          <th
                            key={team.teamSlug}
                            className="text-left font-medium py-2.5 px-3 align-bottom normal-case tracking-tight border-b border-border/50 border-l border-border/20 border-t-2"
                            style={{ borderTopColor: team.color || "#94a3b8" }}
                          >
                            <div className="flex items-center gap-1.5">
                              <TeamLogo slug={team.teamSlug} name={team.teamName} size={20} className="shrink-0" />
                              <Link
                                href={`/team/${team.teamSlug}`}
                                className="text-[11px] font-semibold text-foreground hover:text-primary transition-colors truncate"
                              >
                                {team.teamName}
                              </Link>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: draft.rounds }, (_, i) => i + 1).map((round, rIdx) => (
                        <tr
                          key={round}
                          className={cn(
                            "group hover:bg-muted/50",
                            rIdx % 2 === 0 && "bg-card/15"
                          )}
                        >
                          <td className="text-center tabular-nums py-2 px-3 text-muted-foreground/70 font-medium sticky left-0 z-10 bg-background pl-4 sm:pl-0 group-hover:bg-muted/50 border-b border-border/20 after:absolute after:right-0 after:top-0 after:bottom-0 after:w-4 after:bg-gradient-to-r after:from-background/80 after:to-transparent after:pointer-events-none group-hover:after:from-muted/50">
                            {round}
                          </td>
                          {teams.map((team) => {
                            const pick = boardGrid[round]?.[team.teamSlug]
                            if (!pick) {
                              return (
                                <td key={team.teamSlug} className="px-3 py-2 text-muted-foreground/30 text-center border-b border-border/20 border-l border-border/20">—</td>
                              )
                            }
                            const isTradedSlot = pick.teamSlug !== pick.originalTeamSlug
                            const newOwner = isTradedSlot ? teams.find((t) => t.teamSlug === pick.teamSlug) : null
                            const playerInPool = pick.playerId ? pool.find((p) => p.playerId === pick.playerId) : null
                            const meta = playerInPool?.registrationMeta as Record<string, unknown> | null
                            const isCaptain = pick.playerId != null && captainSet.has(pick.playerId)
                            const isRookie = meta?.isRookie === true

                            return (
                              <td key={team.teamSlug} className="px-3 py-2 align-middle border-b border-border/20 border-l border-border/20">
                                {pick.playerId ? (
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <button
                                      className="truncate text-left text-xs text-foreground hover:text-primary transition-colors min-w-0 cursor-pointer"
                                      onClick={() => pick.playerId && openPlayerCard(pick.playerId)}
                                      onMouseEnter={() => pick.playerId && prefetchPlayerStats(pick.playerId)}
                                      onFocus={() => pick.playerId && prefetchPlayerStats(pick.playerId)}
                                      title={pick.playerName || undefined}
                                    >
                                      {(isCaptain || pick.isKeeper) ? formatPlayerNameCompact(pick.playerName) : formatPlayerName(pick.playerName)}
                                    </button>
                                    {isCaptain && (
                                      <DraftPlayerBadge kind="captain" />
                                    )}
                                    {pick.isKeeper && !isCaptain && (
                                      <span className="shrink-0 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-sm border border-border text-[9px] font-bold uppercase tracking-wider text-muted-foreground leading-none">K</span>
                                    )}
                                    {isRookie && (
                                      <DraftPlayerBadge kind="rookie" />
                                    )}
                                    {newOwner && (
                                      <span className="shrink-0 text-[9px] italic text-muted-foreground/50" title={`Acquired via trade from ${pick.originalTeamSlug}`}>↔</span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground/40 text-[10px]">
                                    {newOwner ? `→ ${newOwner.teamName}` : "—"}
                                  </span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                /* LIVE BOARD — unchanged */
                <Card>
                  <CardContent className="p-0 overflow-x-auto">
                    <table className="w-full min-w-[700px] text-xs md:table-fixed">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="px-2 py-2 text-left font-bold text-[10px] uppercase tracking-[0.06em] text-muted-foreground w-10 sticky left-0 bg-muted z-20" style={{ boxShadow: '2px 0 4px -2px rgba(0,0,0,0.1)' }}>Rd</th>
                          {teams.map((team) => (
                            <th
                              key={team.teamSlug}
                              className="px-2 py-2 text-left font-semibold min-w-[100px] border-t-[3px] overflow-hidden"
                              style={{ borderTopColor: team.color || "#94a3b8" }}
                            >
                              <div className="flex items-center gap-1.5">
                                <TeamLogo slug={team.teamSlug} name={team.teamName} size={18} />
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
                              const isCaptain = pick.playerId != null && captainSet.has(pick.playerId)
                              const isKeeper = pick.isKeeper && !isCaptain
                              const isRookie = playerInPool?.registrationMeta?.isRookie === true
                              const isGoalie = isPlayerGoalie(playerInPool?.registrationMeta?.positions)
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
                                    <div className="flex flex-nowrap items-center gap-1 min-w-0">
                                      <button
                                        className="truncate min-w-0 flex-1 text-left text-xs hover:underline hover:text-primary transition-colors cursor-pointer"
                                        onClick={() => pick.playerId && openPlayerCard(pick.playerId)}
                                        onMouseEnter={() => pick.playerId && prefetchPlayerStats(pick.playerId)}
                                        onFocus={() => pick.playerId && prefetchPlayerStats(pick.playerId)}
                                        title={pick.playerName || undefined}
                                      >
                                        {(isCaptain || pick.isKeeper) ? formatPlayerNameCompact(pick.playerName) : formatPlayerName(pick.playerName)}
                                      </button>
                                      <div className="flex items-center gap-0.5 shrink-0">
                                        {isCaptain && (
                                          <DraftPlayerBadge kind="captain" className="h-3.5 min-w-3 px-0.5 rounded-[2px] text-[8.5px] tracking-normal" />
                                        )}
                                        {isKeeper && (
                                          <span className="shrink-0 inline-flex items-center justify-center h-3.5 min-w-3 px-0.5 rounded-[2px] border border-amber-400/70 bg-amber-50/60 dark:bg-amber-950/40 text-[8.5px] font-bold text-amber-600 dark:text-amber-400 leading-none" title="Keeper">K</span>
                                        )}
                                        {isRookie && (
                                          <DraftPlayerBadge kind="rookie" className="h-3.5 min-w-3 px-0.5 rounded-[2px] text-[8.5px] tracking-normal" />
                                        )}
                                        {isGoalie && (
                                          <span className="shrink-0 inline-flex items-center justify-center h-3.5 min-w-3 px-0.5 rounded-[2px] border border-purple-400/70 bg-purple-50/60 dark:bg-purple-950/40 text-[8.5px] font-bold text-purple-600 dark:text-purple-400 leading-none" title="Goalie">G</span>
                                        )}
                                      </div>
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
                    <div className="flex flex-wrap items-center justify-end gap-3 px-3 py-2 text-[10px] text-muted-foreground/70 border-t border-border/40 bg-muted/10">
                      <span className="flex items-center gap-1"><span className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-[3px] border border-blue-400/70 bg-blue-50/60 dark:bg-blue-950/40 text-[8.5px] font-bold text-blue-600 dark:text-blue-400">C</span> Captain</span>
                      <span className="flex items-center gap-1"><span className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-[3px] border border-amber-400/70 bg-amber-50/60 dark:bg-amber-950/40 text-[8.5px] font-bold text-amber-600 dark:text-amber-400">K</span> Keeper</span>
                      <span className="flex items-center gap-1"><span className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-[3px] border border-green-400/70 bg-green-50/60 dark:bg-green-950/40 text-[8.5px] font-bold text-green-600 dark:text-green-400">R</span> Rookie</span>
                      <span className="flex items-center gap-1"><span className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-[3px] border border-purple-400/70 bg-purple-50/60 dark:bg-purple-950/40 text-[8.5px] font-bold text-purple-600 dark:text-purple-400">G</span> Goalie</span>
                    </div>
                  </CardContent>
                </Card>
              )}
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
                          <button
                            type="button"
                            key={player.playerId}
                            className="w-full flex items-center justify-between py-1.5 px-2 rounded-sm hover:bg-muted/50 text-xs text-left cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                            onClick={() => openPlayerCard(player.playerId)}
                            onMouseEnter={() => prefetchPlayerStats(player.playerId)}
                            onFocus={() => prefetchPlayerStats(player.playerId)}
                          >
                            <span className="truncate hover:underline hover:text-primary transition-colors" title={player.playerName}>{player.playerName}</span>
                            <PositionBadges raw={positions} />
                          </button>
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
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        {recentPicks.length > 0 ? recentPicks.length : keeperPicks.length}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 pb-2">
                    <div className="space-y-0">
                      {recentPicks.length === 0 ? (
                        <div className="text-center py-5 px-3 text-xs text-muted-foreground">
                          {keeperPicks.length > 0 ? (
                            <div className="space-y-3">
                              <div className="border rounded-md p-3 bg-muted/20 border-border/40">
                                <p className="font-semibold text-foreground text-xs">{keeperPicks.length} Keepers Placed</p>
                                <p className="text-[11px] text-muted-foreground mt-0.5">Live draft picks will appear here as they are made.</p>
                              </div>
                              <div className="text-left">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 px-1">Keeper Roster</span>
                                <div className="mt-1 space-y-0.5 max-h-[50vh] overflow-y-auto">
                                  {keeperPicks.map((kp) => {
                                    const team = teams.find((t) => t.teamSlug === kp.teamSlug)
                                    const playerInPool = pool.find((pl) => pl.playerId === kp.playerId)
                                    const positions = typeof playerInPool?.registrationMeta?.positions === "string"
                                      ? playerInPool.registrationMeta.positions
                                      : null
                                    return (
                                      <button
                                        type="button"
                                        key={kp.id}
                                        className="w-full flex items-center justify-between py-1.5 px-2 rounded-sm hover:bg-muted/50 text-xs text-left cursor-pointer border-t border-border/30 first:border-t-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                                        onClick={() => kp.playerId && openPlayerCard(kp.playerId)}
                                        onMouseEnter={() => kp.playerId && prefetchPlayerStats(kp.playerId)}
                                        onFocus={() => kp.playerId && prefetchPlayerStats(kp.playerId)}
                                      >
                                        <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                                          <div
                                            className="w-1 h-7 rounded-full shrink-0"
                                            style={{ backgroundColor: team?.color || "#94a3b8" }}
                                          />
                                          <div className="min-w-0 flex-1">
                                            <div className="truncate font-semibold hover:underline hover:text-primary transition-colors">
                                              {kp.playerName}
                                            </div>
                                            <div className="text-[10px] text-muted-foreground truncate">
                                              {team?.teamName}
                                            </div>
                                          </div>
                                        </div>
                                        <PositionBadges raw={positions} />
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            </div>
                          ) : (
                            "No picks yet"
                          )}
                        </div>
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
                            <button
                              type="button"
                              key={p.id}
                              className={`w-full flex items-center py-2 px-2.5 text-xs text-left cursor-pointer hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 ${i > 0 ? "border-t border-border/50" : ""}`}
                              style={i === 0 ? { backgroundColor: `${team?.color || '#f97316'}10` } : undefined}
                              onClick={() => p.playerId && openPlayerCard(p.playerId)}
                              onMouseEnter={() => p.playerId && prefetchPlayerStats(p.playerId)}
                              onFocus={() => p.playerId && prefetchPlayerStats(p.playerId)}
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
                              <PositionBadges raw={position} />
                            </button>
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
                      <div className="text-center py-5 px-3 text-xs text-muted-foreground">
                        {keeperPicks.length > 0 ? (
                          <div className="space-y-3">
                            <div className="border rounded-md p-3 bg-muted/20 border-border/40">
                              <p className="font-semibold text-foreground text-xs">{keeperPicks.length} Keepers Placed</p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">Live draft picks will appear here as they are made.</p>
                            </div>
                            <div className="text-left">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 px-1">Keeper Roster</span>
                              <div className="mt-1 space-y-0.5 max-h-[calc(100vh-420px)] min-h-[160px] overflow-y-auto">
                                {keeperPicks.map((kp) => {
                                  const team = teams.find((t) => t.teamSlug === kp.teamSlug)
                                  const playerInPool = pool.find((pl) => pl.playerId === kp.playerId)
                                  const positions = typeof playerInPool?.registrationMeta?.positions === "string"
                                    ? playerInPool.registrationMeta.positions
                                    : null
                                  return (
                                    <button
                                      type="button"
                                      key={kp.id}
                                      className="w-full flex items-center justify-between py-1.5 px-2 rounded-sm hover:bg-muted/50 text-xs text-left cursor-pointer border-t border-border/30 first:border-t-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                                      onClick={() => kp.playerId && openPlayerCard(kp.playerId)}
                                      onMouseEnter={() => kp.playerId && prefetchPlayerStats(kp.playerId)}
                                      onFocus={() => kp.playerId && prefetchPlayerStats(kp.playerId)}
                                    >
                                      <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                                        <div
                                          className="w-1 h-7 rounded-full shrink-0"
                                          style={{ backgroundColor: team?.color || "#94a3b8" }}
                                        />
                                        <div className="min-w-0 flex-1">
                                          <div className="truncate font-semibold hover:underline hover:text-primary transition-colors">
                                            {kp.playerName}
                                          </div>
                                          <div className="text-[10px] text-muted-foreground truncate">
                                            {team?.teamName}
                                          </div>
                                        </div>
                                      </div>
                                      <PositionBadges raw={positions} />
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                        ) : (
                          "No picks yet"
                        )}
                      </div>
                    ) : (
                      recentPicks.slice(0, 10).map((p, i) => {
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
                          <button
                            type="button"
                            key={p.id}
                            className={`w-full flex items-center py-2 px-2.5 text-xs text-left cursor-pointer hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 ${i > 0 ? "border-t border-border/50" : ""}`}
                            style={i === 0 ? { backgroundColor: `${team?.color || '#f97316'}10` } : undefined}
                            onClick={() => p.playerId && openPlayerCard(p.playerId)}
                            onMouseEnter={() => p.playerId && prefetchPlayerStats(p.playerId)}
                            onFocus={() => p.playerId && prefetchPlayerStats(p.playerId)}
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
                            <PositionBadges raw={position} />
                          </button>
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
                    <div className="max-h-[calc(100vh-320px)] min-h-[350px] overflow-y-auto space-y-0.5 pr-1">
                      {availablePlayers.map((player) => {
                        const positions = typeof player.registrationMeta?.positions === "string"
                          ? player.registrationMeta.positions
                          : null

                        return (
                          <button
                            type="button"
                            key={player.playerId}
                            className="w-full flex items-center justify-between py-1.5 px-2 rounded-sm hover:bg-muted/50 text-xs text-left cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                            onClick={() => openPlayerCard(player.playerId)}
                            onMouseEnter={() => prefetchPlayerStats(player.playerId)}
                            onFocus={() => prefetchPlayerStats(player.playerId)}
                          >
                            <span className="truncate hover:underline hover:text-primary transition-colors">{player.playerName}</span>
                            <PositionBadges raw={positions} />
                          </button>
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
