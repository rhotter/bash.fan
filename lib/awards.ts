export const AWARD_LABELS: Record<string, string> = {
  mvp: "MVP",
  conn_smythe: "Conn Smythe (Playoff MVP)",
  scoring_title: "Scoring Title",
  best_gaa: "Best GAA",
  vezina: "Vezina (Best Goalie)",
  norris: "Norris (Best Defenseman)",
  calder: "Calder (Rookie of the Year)",
  selke: "Selke (Best Two-Way Forward)",
  lady_bing: "Lady Bing (Sportsmanship)",
  most_improved: "Most Improved",
}

export function getAwardLabel(awardType: string): string {
  return AWARD_LABELS[awardType] ?? awardType
}
