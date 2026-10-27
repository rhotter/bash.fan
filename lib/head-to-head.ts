import type { BashGame } from "@/app/api/bash/route"
import { isLegacyTeamSlug } from "@/lib/team-filters"

export interface HeadToHeadGame {
  id: string
  date: string
  time: string
  location: string
  status: "final" | "upcoming" | "live"
  isHome: boolean
  teamScore: number | null
  opponentScore: number | null
  result: "W" | "OTW" | "L" | "OTL" | "LIVE" | "UPCOMING" | "FINAL"
  isOvertime: boolean
  isForfeit: boolean
  hasShootout: boolean
}

export interface HeadToHeadOpponentRecord {
  opponentTeam: string
  opponentSlug: string
  gp: number
  w: number
  otw: number
  otl: number
  l: number
  pts: number
  gf: number
  ga: number
  gd: number
  streak: string
  games: HeadToHeadGame[]
}

export interface HeadToHeadSummary {
  team: string
  slug: string
  gp: number
  w: number
  otw: number
  otl: number
  l: number
  pts: number
  gf: number
  ga: number
  gd: number
}

export interface HeadToHeadData {
  selectedTeam: { slug: string; name: string }
  opponents: HeadToHeadOpponentRecord[]
  summary: HeadToHeadSummary
  allTeams: { slug: string; name: string }[]
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function formatGameDate(dateStr: string): string {
  if (!dateStr) return ""
  const clean = dateStr.split("T")[0]
  const parts = clean.split("-")
  if (parts.length === 3) {
    const month = parseInt(parts[1], 10) - 1
    const day = parseInt(parts[2], 10)
    if (month >= 0 && month < 12 && !isNaN(day)) {
      return `${MONTHS[month]} ${day}`
    }
  }
  return dateStr
}

export function parseGameTimeMinutes(timeStr?: string | null): number {
  if (!timeStr) return 23 * 60 + 59
  const trimmed = timeStr.trim().toLowerCase()
  if (trimmed === "tbd" || trimmed === "tba") return 23 * 60 + 59
  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm|a|p)?$/i)
  if (!match) return 23 * 60 + 59
  let hours = parseInt(match[1], 10)
  const minutes = match[2] ? parseInt(match[2], 10) : 0
  const meridiem = match[3]
  if (meridiem) {
    if (meridiem.startsWith("p") && hours < 12) hours += 12
    if (meridiem.startsWith("a") && hours === 12) hours = 0
  }
  return hours * 60 + minutes
}

export function compareGamesChronological(
  a: { date?: string | null; time?: string | null; id?: string | number },
  b: { date?: string | null; time?: string | null; id?: string | number }
): number {
  const dateA = a.date?.split("T")[0].trim() || ""
  const dateB = b.date?.split("T")[0].trim() || ""
  if (dateA !== dateB) {
    return dateA.localeCompare(dateB)
  }
  const timeA = parseGameTimeMinutes(a.time)
  const timeB = parseGameTimeMinutes(b.time)
  if (timeA !== timeB) {
    return timeA - timeB
  }
  return String(a.id ?? "").localeCompare(String(b.id ?? ""))
}

export function getStreakSortScore(streak: string): number {
  if (!streak || streak === "—") return 0
  const match = streak.match(/^([A-Z]+)(\d+)$/)
  if (!match) return 0
  const type = match[1]
  const count = parseInt(match[2], 10) || 0
  if (type === "W") return 1000 + count
  if (type === "OTW") return 500 + count
  if (type === "OTL") return -500 - count
  if (type === "L") return -1000 - count
  return 0
}

function computeStreak(completedGames: HeadToHeadGame[]): string {
  if (completedGames.length === 0) return "—"

  const lastGame = completedGames[completedGames.length - 1]
  const lastResult = lastGame.result

  if (lastResult === "W" || lastResult === "OTW") {
    let count = 0
    for (let i = completedGames.length - 1; i >= 0; i--) {
      const r = completedGames[i].result
      if (r === "W" || r === "OTW") {
        count++
      } else {
        break
      }
    }
    return `W${count}`
  }

  if (lastResult === "OTL") {
    let count = 0
    for (let i = completedGames.length - 1; i >= 0; i--) {
      if (completedGames[i].result === "OTL") {
        count++
      } else {
        break
      }
    }
    return `OTL${count}`
  }

  if (lastResult === "L") {
    let count = 0
    for (let i = completedGames.length - 1; i >= 0; i--) {
      if (completedGames[i].result === "L") {
        count++
      } else {
        break
      }
    }
    return `L${count}`
  }

  return "—"
}

export function computeHeadToHead(
  games: BashGame[],
  selectedTeamSlug?: string,
  providedTeams?: { slug: string; name?: string; team?: string }[]
): HeadToHeadData | null {
  const teamMap = new Map<string, string>()

  if (providedTeams) {
    for (const t of providedTeams) {
      if (!isLegacyTeamSlug(t.slug)) {
        const slug = t.slug.trim().toLowerCase()
        teamMap.set(slug, t.name?.trim() ?? t.team?.trim() ?? t.slug)
      }
    }
  }

  const regularGames = games.filter(
    (g) =>
      g.gameType === "regular" &&
      !g.isPlayoff &&
      !isLegacyTeamSlug(g.homeSlug) &&
      !isLegacyTeamSlug(g.awaySlug)
  )

  for (const game of regularGames) {
    const hSlug = (game.homeSlug || "").trim().toLowerCase()
    const aSlug = (game.awaySlug || "").trim().toLowerCase()
    if (hSlug && !teamMap.has(hSlug)) {
      teamMap.set(hSlug, game.homeTeam?.trim() || game.homeSlug)
    }
    if (aSlug && !teamMap.has(aSlug)) {
      teamMap.set(aSlug, game.awayTeam?.trim() || game.awaySlug)
    }
  }

  if (teamMap.size === 0) {
    return null
  }

  const allTeams = [...teamMap.entries()].map(([slug, name]) => ({ slug, name }))

  // Determine active selected team
  const normalizedSlug = selectedTeamSlug?.trim().toLowerCase()
  const activeSlug = normalizedSlug && teamMap.has(normalizedSlug) ? normalizedSlug : allTeams[0].slug
  const activeName = teamMap.get(activeSlug) ?? activeSlug

  const opponents: HeadToHeadOpponentRecord[] = []

  for (const [oppSlug, oppName] of teamMap.entries()) {
    if (oppSlug === activeSlug) continue

    const matchupGames = regularGames
      .filter((g) => {
        const gHome = (g.homeSlug || "").trim().toLowerCase()
        const gAway = (g.awaySlug || "").trim().toLowerCase()
        return (
          (gHome === activeSlug && gAway === oppSlug) ||
          (gAway === activeSlug && gHome === oppSlug)
        )
      })
      .sort(compareGamesChronological)

    let gp = 0
    let w = 0
    let otw = 0
    let otl = 0
    let l = 0
    let pts = 0
    let gf = 0
    let ga = 0

    const h2hGames: HeadToHeadGame[] = []

    for (const g of matchupGames) {
      const isHome = (g.homeSlug || "").trim().toLowerCase() === activeSlug
      const teamScore = isHome ? g.homeScore : g.awayScore
      const oppScore = isHome ? g.awayScore : g.homeScore

      let result: HeadToHeadGame["result"]

      if (g.status === "final" && teamScore !== null && oppScore !== null) {
        gp++
        gf += teamScore
        ga += oppScore

        const won = teamScore > oppScore
        const overtime = g.isOvertime || g.hasShootout

        if (won) {
          if (overtime) {
            otw++
            pts += 2
            result = "OTW"
          } else {
            w++
            pts += 3
            result = "W"
          }
        } else {
          if (overtime) {
            otl++
            pts += 1
            result = "OTL"
          } else {
            l++
            result = "L"
          }
        }
      } else if (g.status === "live") {
        result = "LIVE"
      } else if (g.status === "final") {
        result = "FINAL"
      } else {
        result = "UPCOMING"
      }

      h2hGames.push({
        id: g.id,
        date: g.date,
        time: g.time,
        location: g.location,
        status: g.status,
        isHome,
        teamScore,
        opponentScore: oppScore,
        result,
        isOvertime: g.isOvertime,
        isForfeit: g.isForfeit,
        hasShootout: g.hasShootout,
      })
    }

    const completed = h2hGames.filter((g) => g.status === "final" && (g.result === "W" || g.result === "OTW" || g.result === "L" || g.result === "OTL"))
    const streak = computeStreak(completed)

    opponents.push({
      opponentTeam: oppName,
      opponentSlug: oppSlug,
      gp,
      w,
      otw,
      otl,
      l,
      pts,
      gf,
      ga,
      gd: gf - ga,
      streak,
      games: h2hGames,
    })
  }

  // Summary row aggregating all opponents
  const summary: HeadToHeadSummary = {
    team: activeName,
    slug: activeSlug,
    gp: opponents.reduce((acc, o) => acc + o.gp, 0),
    w: opponents.reduce((acc, o) => acc + o.w, 0),
    otw: opponents.reduce((acc, o) => acc + o.otw, 0),
    otl: opponents.reduce((acc, o) => acc + o.otl, 0),
    l: opponents.reduce((acc, o) => acc + o.l, 0),
    pts: opponents.reduce((acc, o) => acc + o.pts, 0),
    gf: opponents.reduce((acc, o) => acc + o.gf, 0),
    ga: opponents.reduce((acc, o) => acc + o.ga, 0),
    gd: 0,
  }
  summary.gd = summary.gf - summary.ga

  return {
    selectedTeam: { slug: activeSlug, name: activeName },
    opponents,
    summary,
    allTeams,
  }
}
