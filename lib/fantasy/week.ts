import { TZDate } from "@date-fns/tz"
import { addDays, format, getDay, set, subDays } from "date-fns"
import type { FantasyConfig } from "./config"
import type { SeasonGame } from "./lineups"

type LockRule = FantasyConfig["lock"]

const GAME_TIME = /^(\d{1,2}):(\d{2})\s*([ap])?m?$/i

export interface FantasyWeek {
  /** The local date of the Week's Lock, `YYYY-MM-DD`. */
  id: string
  lockAt: Date
  nextLockAt: Date
}

/** The Week an instant falls in. A Week includes its Lock and excludes the next one. */
export function weekContaining(instant: Date, rule: LockRule): FantasyWeek {
  const [hours, minutes] = rule.time.split(":").map(Number)
  const local = new TZDate(instant, rule.timeZone)
  const daysSinceLockDay = (getDay(local) - rule.dayOfWeek + 7) % 7

  let lockAt = set(subDays(local, daysSinceLockDay), {
    hours,
    minutes,
    seconds: 0,
    milliseconds: 0,
  })
  if (lockAt > instant) lockAt = subDays(lockAt, 7)

  return {
    id: format(lockAt, "yyyy-MM-dd"),
    lockAt: new Date(lockAt.getTime()),
    // Adding days on a TZDate keeps the local time, so this stays right across DST.
    nextLockAt: new Date(addDays(lockAt, 7).getTime()),
  }
}

/**
 * Only games starting at or after the first Lock following launch count (by `scheduledStart`, so a game
 * with no readable time counts as starting at midday). Which game types a contest scores is
 * decided when the games are read, from the config's `gameTypes`.
 */
export function countsForGame(game: { date: string; time: string }, launchedAt: Date, rule: LockRule) {
  const firstLock = weekContaining(launchedAt, rule).nextLockAt
  return scheduledStart(game, rule) >= firstLock
}

/** The Week taking Lineups now: the one whose Lock comes next. A Lock moves this on. */
export function openWeek(now: Date, rule: LockRule) {
  return weekContaining(weekContaining(now, rule).nextLockAt, rule)
}

/** The Week a game belongs to, from its scheduled start. */
export function gameWeekId(game: { date: string; time: string }, rule: LockRule) {
  return weekContaining(scheduledStart(game, rule), rule).id
}

// A game whose time can't be read (such as TBD) still belongs to its date. Midday is after the Lock,
// which the config keeps at or before 12:00.
export function scheduledStart(game: { date: string; time: string }, rule: LockRule) {
  const time = GAME_TIME.test(game.time.trim()) ? game.time : "12:00"
  return gameStartsAt(game.date, time, rule.timeZone)
}

/** The instant a game starts, from the `games` table's local date and a `H:MM[a|p][m]` or 24-hour time. Throws if the time is unreadable. */
export function gameStartsAt(date: string, time: string, timeZone: string) {
  const match = GAME_TIME.exec(time.trim())
  if (!match) throw new Error(`Unreadable game time: ${time}`)

  const clockHours = Number(match[1])
  const meridiem = match[3]?.toLowerCase()
  const hours =
    meridiem === undefined
      ? clockHours
      : (clockHours % 12) + (meridiem === "p" ? 12 : 0)

  const [year, month, day] = date.split("-").map(Number)
  return new Date(
    new TZDate(year, month - 1, day, hours, Number(match[2]), timeZone).getTime()
  )
}

export interface TeamRef {
  slug: string
  name: string
}

export interface WeekOverviewGame {
  id: string
  home: TeamRef
  away: TeamRef
  /** The day and time the game starts, such as "Sat 9:00a". */
  startLabel: string
  result: { homeScore: number; awayScore: number } | null
}

export interface WeekOverview {
  weekId: string
  games: WeekOverviewGame[]
  /** Teams with no game this Week. Empty when the Week has no games. */
  byeTeams: TeamRef[]
}

interface Input {
  weekId: string
  games: SeasonGame[]
  teams: TeamRef[]
  config: FantasyConfig
  launchedAt: Date
}

/** The shared Week view: its counting games, ordered by start. Plain data for the page cache. */
export function buildWeekOverview({ weekId, games, teams, config, launchedAt }: Input): WeekOverview {
  const names = new Map(teams.map((team) => [team.slug, team]))
  const ref = (slug: string): TeamRef => names.get(slug) ?? { slug, name: slug }

  const weekGames = games
    .filter((game) => countsForGame(game, launchedAt, config.lock) && gameWeekId(game, config.lock) === weekId)
    .sort((a, b) => scheduledStart(a, config.lock).getTime() - scheduledStart(b, config.lock).getTime())
    .map((game) => ({
      id: game.id,
      home: ref(game.homeTeam),
      away: ref(game.awayTeam),
      startLabel: `${format(new Date(`${game.date}T12:00:00`), "EEE")} ${game.time}`,
      result:
        game.status === "final" && game.homeScore !== null && game.awayScore !== null
          ? { homeScore: game.homeScore, awayScore: game.awayScore }
          : null,
    }))
  const playing = new Set(weekGames.flatMap(({ home, away }) => [home.slug, away.slug]))
  return { weekId, games: weekGames, byeTeams: weekGames.length === 0 ? [] : teams.filter((team) => !playing.has(team.slug)) }
}

// Week ids are calendar dates, so they're formatted without shifting through a time zone.
export const weekLabel = (weekId: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${weekId}T12:00:00Z`)
  )
