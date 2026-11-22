import { getTeamLogoColor } from "@/lib/team-logo-colors"

function hexToRgb(hex: string): [number, number, number] | null {
  if (!/^#?[0-9a-f]{6}$/i.test(hex)) return null
  const clean = hex.startsWith("#") ? hex.slice(1) : hex
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("")}`
}

function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/**
 * Ensures team chart lines meet WCAG 1.4.11 non-text contrast (>= 3.2:1 against white)
 * by darkening light yellow/gray/white brand hexes while keeping hue recognizable.
 */
export function ensureChartLineContrast(hex: string | undefined): string {
  const rgb = hex ? hexToRgb(hex) : null
  if (!rgb) return "#1f2937"
  let [r, g, b] = rgb
  // Contrast against white (#ffffff, L = 1.0) is (1.05) / (L + 0.05). Target >= 3.2 -> L <= 0.278.
  let guard = 0
  while (relativeLuminance(r, g, b) > 0.27 && guard < 12) {
    r = Math.round(r * 0.78)
    g = Math.round(g * 0.78)
    b = Math.round(b * 0.78)
    guard++
  }
  return rgbToHex(r, g, b)
}

/**
 * Resolves a team's true color: DB season/franchise color first, then the static logo palette.
 */
export function resolveTeamColor(slug: string, teamColors?: Record<string, string>): string {
  const fromDb = teamColors?.[slug]
  if (fromDb && hexToRgb(fromDb)) return fromDb.startsWith("#") ? fromDb : `#${fromDb}`
  return getTeamLogoColor(slug)
}

/**
 * True when a color is too light to read as a thin line on a white/light background
 * (e.g., Yetis white/gray, Loons yellow). Such lines get a subtle darker outline.
 */
export function needsLineOutline(hex: string): boolean {
  const rgb = hexToRgb(hex)
  if (!rgb) return false
  return relativeLuminance(rgb[0], rgb[1], rgb[2]) > 0.4
}

export interface TeamChartColor {
  /** Exact franchise/team color used for the line itself */
  stroke: string
  /** Darker same-hue outline drawn under light-colored lines; null when not needed */
  outline: string | null
}

export function getTeamChartColor(slug: string, teamColors?: Record<string, string>): TeamChartColor {
  const stroke = resolveTeamColor(slug, teamColors)
  return { stroke, outline: needsLineOutline(stroke) ? ensureChartLineContrast(stroke) : null }
}
