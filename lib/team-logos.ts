// Team logo mapping — developer-managed
//
// To add a logo:
//  1. Drop the image file in /public/team-logos/
//  2. Add the team slug → filename mapping below
//
// For season-specific overrides (e.g., a team gets a new logo for 2026-2027):
//  Add an entry to seasonLogoOverrides with key "seasonId::teamSlug"

// Default logos by team slug (substring match)
const logoMapping: Record<string, string> = {
  bash: "bash_orange_transparent_1024.png",
  bashers: "bashers_transparent_1024.png",
  dangleberries: "dangleberries_1024.png",
  landsharks: "landsharks_black_1024.png",
  loons: "loons_1024.png",
  regretzkys: "no_regretzkys_1024.png",
  reign: "reign_1024.png",
  rinkrats: "rinkrats_1024.png",
  "rink-rats": "rinkrats_1024.png",
  seals: "seals_1024.png",
  yetis: "yetis_1024.png",
  "last-licks": "last_licks_blue_1024.png",
  licks: "last_licks_blue_1024.png",
  "coxswain-bawls-hockey-club": "coxswain_bawls_1024.png",
  "team-usa": "team-usa_1024.png",
  "team-canada": "team-canada_1024.png",
}

// Season-specific logo overrides (takes priority over default)
// Key format: "seasonId::teamSlug" → filename
// Example: "2026-2027::rink-rats": "rinkrats_2026_v2.png"
const seasonLogoOverrides: Record<string, string> = {
  // Add season-specific logos here as teams update their branding
}

export function getTeamLogoUrl(slug: string, seasonId?: string): string | null {
  // 1. Season-specific override (exact match)
  if (seasonId) {
    const override = seasonLogoOverrides[`${seasonId}::${slug}`]
    if (override) return `/team-logos/${override}`
  }

  // 2. Default logo (substring match)
  const lower = slug.toLowerCase()
  for (const [key, filename] of Object.entries(logoMapping)) {
    if (lower.includes(key)) {
      return `/team-logos/${filename}`
    }
  }
  return null
}
