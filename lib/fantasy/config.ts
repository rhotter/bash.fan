import { z } from "zod"

/** The `games.game_type` values the schedule admin offers. A contest can only score these. */
export const GAME_TYPES = ["regular", "playoff", "championship", "exhibition", "tryout"]

/** Rules for one Contest. The engine reads these rather than hardcoding them. */
export interface FantasyConfig {
  /** The `games.game_type` values this contest scores, such as `["regular"]` or `["playoff", "championship"]`. */
  gameTypes: string[]
  lineup: {
    skaters: number
    goalies: number
    skaterBackups: number
    goalieBackups: number
  }
  /** Most uses of one Player per Manager per Contest. `null` means no cap. */
  usageCap: { skater: number | null; goalie: number | null }
  weights: {
    skater: { goal: number; assist: number; ppg: number; shg: number; pim: number }
    goalie: { save: number; goalAgainst: number; win: number; shutout: number }
  }
  lock: {
    /** 0 is Sunday, as in `Date.getDay()`. */
    dayOfWeek: number
    /** 24-hour local time, `HH:MM`. */
    time: string
    /** IANA zone, so the Lock follows daylight saving. */
    timeZone: string
  }
  /**
   * The run includes each Week closing from `startsOn` to `endsOn` inclusive, with all of that Week's games,
   * so a Week is never split. Both are `YYYY-MM-DD`. With no `startsOn` it begins after it's turned on,
   * and with no `endsOn` it keeps going.
   */
  startsOn: string | null
  endsOn: string | null
}

export const DEFAULT_FANTASY_CONFIG: FantasyConfig = {
  gameTypes: ["regular"],
  lineup: { skaters: 3, goalies: 1, skaterBackups: 1, goalieBackups: 1 },
  usageCap: { skater: 3, goalie: 4 },
  weights: {
    skater: { goal: 10, assist: 3, ppg: 2, shg: 3, pim: 2 },
    goalie: { save: 1, goalAgainst: -3, win: 5, shutout: 10 },
  },
  lock: { dayOfWeek: 6, time: "08:00", timeZone: "America/Los_Angeles" },
  startsOn: null,
  endsOn: null,
}

const count = z.number().int().min(0).max(20)
const cap = z.number().int().min(1, "A cap is at least 1, or null for no cap").nullable()
const weight = z.number().finite()

function isTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone })
    return true
  } catch (error) {
    if (error instanceof RangeError) return false
    throw error
  }
}

/** A real calendar date: `Date` would roll 30 February over into March. */
function isCalendarDate(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

/** Optional, so configs stored before runs had dates still load. */
const runDate = z
  .string()
  .refine((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && isCalendarDate(date), "Use a real date, YYYY-MM-DD, or null")
  .nullable()
  .default(null)

/** The first closing day on or after a calendar date. 0 is Sunday. */
export function closingDayOnOrAfter(date: string, dayOfWeek: number) {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + ((dayOfWeek - day.getUTCDay() + 7) % 7))
  return day.toISOString().slice(0, 10)
}

const fantasyConfigSchema: z.ZodType<FantasyConfig, z.ZodTypeDef, unknown> = z.object({
  gameTypes: z
    .array(
      z
        .string()
        .trim()
        .refine((type) => GAME_TYPES.includes(type), `Use one of: ${GAME_TYPES.join(", ")}`)
    )
    .min(1, "Score at least one game type")
    .refine((types) => new Set(types).size === types.length, "Game types can't repeat"),
  lineup: z
    .object({
      skaters: count.min(1, "A Lineup needs at least one skater"),
      goalies: count,
      skaterBackups: count,
      goalieBackups: count,
    })
    .strict(),
  usageCap: z.object({ skater: cap, goalie: cap }).strict(),
  weights: z
    .object({
      skater: z.object({ goal: weight, assist: weight, ppg: weight, shg: weight, pim: weight }).strict(),
      goalie: z.object({ save: weight, goalAgainst: weight, win: weight, shutout: weight }).strict(),
    })
    .strict(),
  lock: z
    .object({
      dayOfWeek: z.number().int().min(0, "0 is Sunday").max(6, "6 is Saturday"),
      // Games with no time yet count as midday, so the Lock has to come before that.
      time: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM, such as 08:00")
        .refine((time) => time <= "12:00", "The Lock must be at or before 12:00"),
      timeZone: z.string().refine(isTimeZone, "Use an IANA time zone, such as America/Los_Angeles"),
    })
    .strict(),
  startsOn: runDate,
  endsOn: runDate,
}).strict().superRefine(({ startsOn, endsOn, lock }, context) => {
  if (startsOn !== null && endsOn !== null && closingDayOnOrAfter(startsOn, lock.dayOfWeek) > endsOn) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsOn"], message: "No Week closes between the start and end dates" })
  }
})

export type ConfigCheck = { ok: true; config: FantasyConfig } | { ok: false; issues: string[] }

/** Checks a config from outside the code, saying which fields are wrong. */
export function checkFantasyConfig(input: unknown): ConfigCheck {
  const parsed = fantasyConfigSchema.safeParse(input)
  if (parsed.success) return { ok: true, config: parsed.data }
  return {
    ok: false,
    issues: parsed.error.issues.map(({ path, message }) => (path.length ? `${path.join(".")}: ${message}` : message)),
  }
}

/** Checks a config from outside the code. Returns null if it isn't valid. */
export function parseFantasyConfig(input: unknown) {
  const check = checkFantasyConfig(input)
  return check.ok ? check.config : null
}
