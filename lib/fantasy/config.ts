import { z } from "zod"

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

const fantasyConfigSchema: z.ZodType<FantasyConfig, z.ZodTypeDef, unknown> = z.object({
  gameTypes: z
    .array(z.string().trim().min(1).max(40))
    .min(1, "Score at least one game type")
    .max(10)
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
}).strict()

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
