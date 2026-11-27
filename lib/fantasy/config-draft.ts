import { DEFAULT_FANTASY_CONFIG, GAME_TYPES, type FantasyConfig } from "./config"

/** Helpers for editing a config in the admin form. Plain functions, safe to run in the browser. */

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/** The kinds of run an admin can start. The kind only picks the game types a new run starts with, so it isn't stored. */
export const RUN_TYPES = [
  { value: "regular", label: "Regular season" },
  { value: "playoffs", label: "Playoffs" },
]

/** A new playoffs run starts from the defaults, but scoring playoff games instead of regular ones. */
export function startingConfig(type: string, config: FantasyConfig): FantasyConfig {
  return type.startsWith("playoff") ? { ...config, gameTypes: ["playoff", "championship"] } : config
}

/** A number box holds its text until the text is a number, so a blank or a lone "-" never becomes zero. */
export type NumberDraft = number | string

type Drafted<T> = { [Key in keyof T]: T[Key] extends number ? NumberDraft : T[Key] extends number | null ? NumberDraft | null : T[Key] }

export interface ConfigDraft {
  gameTypes: string[]
  lineup: Drafted<FantasyConfig["lineup"]>
  usageCap: Drafted<FantasyConfig["usageCap"]>
  weights: { skater: Drafted<FantasyConfig["weights"]["skater"]>; goalie: Drafted<FantasyConfig["weights"]["goalie"]> }
  lock: FantasyConfig["lock"]
  startsOn: FantasyConfig["startsOn"]
  endsOn: FantasyConfig["endsOn"]
}

/** Only text that reads back the same is converted, so "1." or "-0" can still be typed on from. */
export function toNumberDraft(text: string): NumberDraft {
  const value = Number(text)
  return text.trim() !== "" && Number.isFinite(value) && String(value) === text ? value : text
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isNumberDraft = (value: unknown) => typeof value === "number" || typeof value === "string"

/** Whether `value` has exactly the template's settings, each of a kind its field can show. */
function matches(value: unknown, template: unknown, path: string): boolean {
  if (path === "gameTypes") {
    return Array.isArray(value) && value.every((type) => GAME_TYPES.includes(type)) && new Set(value).size === value.length
  }
  if (path === "lock.dayOfWeek") return Number.isInteger(value) && DAYS[value as number] !== undefined
  if (path === "startsOn" || path === "endsOn") return value === null || typeof value === "string"
  if (path.startsWith("usageCap.")) return value === null || isNumberDraft(value)
  if (typeof template === "number") return isNumberDraft(value)
  if (!isRecord(template)) return typeof value === typeof template
  const keys = Object.keys(template)
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value && matches(value[key], template[key], path ? `${path}.${key}` : key))
  )
}

/**
 * Whether the form's fields can show everything in `value`. The values may still break a rule,
 * which `checkFantasyConfig` reports. Anything else can only be fixed as JSON.
 */
export function fitsForm(value: unknown): value is ConfigDraft {
  return matches(value, DEFAULT_FANTASY_CONFIG, "")
}

export const SKATER_WEIGHTS = [
  ["goal", "goal"],
  ["assist", "assist"],
  ["ppg", "power-play goal"],
  ["shg", "short-handed goal"],
  ["pim", "penalty minute"],
] as const

export const GOALIE_WEIGHTS = [
  ["save", "save"],
  ["goalAgainst", "goal against"],
  ["win", "win"],
  ["shutout", "shutout"],
] as const

export const LINEUP_SLOTS = [
  ["skaters", "Skaters in a Lineup", "Skaters"],
  ["goalies", "Goalies in a Lineup", "Goalies"],
  ["skaterBackups", "Skater Backups in a Lineup", "Skater Backups"],
  ["goalieBackups", "Goalie Backups in a Lineup", "Goalie Backups"],
] as const

const capLabel = (cap: number | null) => (cap === null ? "No limit" : String(cap))

/** Every setting as a label and the value a person would read. */
function settings({ gameTypes, lineup, usageCap, weights, lock, startsOn, endsOn }: FantasyConfig): [string, string][] {
  return [
    ["Game types", gameTypes.join(", ")],
    ...LINEUP_SLOTS.map(([key, label]): [string, string] => [label, String(lineup[key])]),
    ["Skater uses per Player", capLabel(usageCap.skater)],
    ["Goalie uses per Player", capLabel(usageCap.goalie)],
    ...SKATER_WEIGHTS.map(([key, name]): [string, string] => [`Points per ${name}`, String(weights.skater[key])]),
    ...GOALIE_WEIGHTS.map(([key, name]): [string, string] => [`Points per ${name}`, String(weights.goalie[key])]),
    ["Closing day", DAYS[lock.dayOfWeek]],
    ["Closing time", lock.time],
    ["Time zone", lock.timeZone],
    ["Start date", startsOn ?? "None"],
    ["End date", endsOn ?? "None"],
  ]
}

/** One line per changed setting, such as "Points per goal: 10 → 12". */
export function describeConfigChanges(before: FantasyConfig, after: FantasyConfig) {
  const next = new Map(settings(after))
  return settings(before).flatMap(([label, value]) =>
    next.get(label) === value ? [] : [`${label}: ${value} → ${next.get(label)}`]
  )
}
