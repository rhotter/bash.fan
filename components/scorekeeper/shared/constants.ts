export const INFRACTIONS = [
  "Holding", "Hooking", "Tripping", "Slashing", "Interference",
  "High-Sticking", "Roughing", "Elbowing", "Cross-Checking", "Boarding",
  "Delay of Game", "Too Many Players", "Unsportsmanlike", "Fighting",
]

export function fullPeriodLabel(period: number): string {
  if (period === 0) return "Pre-Game"
  if (period <= 3) return `Period ${period}`
  if (period === 4) return "Overtime"
  if (period === 5) return "Shootout"
  return `Period ${period}`
}
