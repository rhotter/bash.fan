import { createHash, timingSafeEqual } from "node:crypto"

export type OperatorRole = "admin" | "scorekeeper"
export function secretMatches(value: unknown, secret: string | undefined): boolean {
  if (typeof value !== "string" || !secret || value.length > 256) return false
  return timingSafeEqual(createHash("sha256").update(value).digest(), createHash("sha256").update(secret).digest())
}
export function scorekeeperDateAllowed(gameDate: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) return false
  const parsed = new Date(`${gameDate}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== gameDate) return false
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${gameDate}T00:00:00Z`)) / 86400000
  return days >= 0 && days <= 7
}
