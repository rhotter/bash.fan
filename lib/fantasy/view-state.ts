import { z } from "zod"

export type FantasyTab = "fantasy" | "pickem"

export interface FantasyView {
  tab: FantasyTab
  weekId: string | null
  /** Which contest of the season, when the URL names one. Otherwise the season's first. */
  contest?: string
}

/** The tab and Week live in the URL so a standings view can be shared. An unrecognised tab or Week falls back to the default. The contest is passed through for the caller to validate. */
export function parseFantasyView(
  params: { tab?: string; week?: string; contest?: string },
  weekIds: string[],
  defaultWeekId = weekIds.at(-1)
): FantasyView {
  const tab = params.tab === "pickem" ? "pickem" : "fantasy"
  const weekId = weekIds.find((id) => id === params.week) ?? defaultWeekId ?? null
  return { tab, weekId, ...(params.contest ? { contest: params.contest } : {}) }
}

export function fantasyHref({ tab, weekId, contest }: { tab: FantasyTab; weekId: string | null; contest?: string }) {
  const query = new URLSearchParams()
  if (contest) query.set("contest", contest)
  if (tab !== "fantasy") query.set("tab", tab)
  if (weekId) query.set("week", weekId)
  const string = query.toString()
  return string ? `/fantasy?${string}` : "/fantasy"
}

export const DEFAULT_CONTEST = "regular"

/** A contest is addressed by a short key in URLs and the admin: `regular`, `december-beta`. */
export const contestKeySchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,29}$/)

/** Returns null for anything that isn't a valid key. */
export function parseContest(value: unknown) {
  const parsed = contestKeySchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export const MAX_CONTEST_NAME = 30

/** The key a run's name makes, such as "December Beta" → `december-beta`, or null if the name has no letters or numbers. */
export function contestKeyFromName(name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, MAX_CONTEST_NAME).replace(/-+$/, "")
  return parseContest(slug)
}

/** A key read back as a name to show: `december-beta` → "December Beta". Only the key is stored. */
export function contestLabel(key: string) {
  return key
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/** An instant as people read it in the contest's zone, such as "Saturday, Jan 2, 8:00 AM PST". */
export function instantLabel(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(instant))
}
