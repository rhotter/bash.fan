// Keep the badge palette aligned with iOS ScoreCardBackground.swift.
const teamColors: Record<string, string> = {
  "coxswain-bawls-hockey-club": "#FA9B2B",
  "lazy-skater-dangle": "#EBEBEB",
  "mitch-a-palooza": "#FBFF30",
  dangleberries: "#227EFD",
  "dolo-minions": "#080808",
  "money-shots": "#00A010",
  regretzkys: "#F11616",
  landsharks: "#252525",
  "land-sharks": "#000000",
  "rink-rats": "#365DA6",
  rinkrats: "#365DA6",
  "team-canada": "#E60000",
  "team-usa": "#0004DB",
  "team-dark": "#303030",
  "team-light": "#D1D1D1",
  "cherry-bomb": "#F82020",
  "red-army": "#F82020",
  "red-leafs": "#F82020",
  roadrunners: "#F9FAFB",
  bruins: "#F9D806",
  kings: "#F9D806",
  yetis: "#D3D3D3",
  loons: "#E5D500",
  seals: "#95B893",
  reign: "#7F1DEE",
  haze: "#F88F16",
  bash: "#F36527",
}

export function getTeamLogoColor(slug: string): string {
  const lower = slug.toLowerCase()
  return Object.entries(teamColors).find(([key]) => lower.includes(key))?.[1] ?? "#737A85"
}
