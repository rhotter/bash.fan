// Pure, DB-free forfeit helpers. Safe to import from client components
// (e.g. the admin EditGameModal) because nothing here touches `@/lib/db`.

export type ForfeitingSide = "away" | "home" | "both"

export type ForfeitOutcome =
  | { kind: "not_forfeit" }
  | { kind: "double_forfeit" }
  | { kind: "single_forfeit"; winnerTeamSlug: string; loserTeamSlug: string }

export function resolveForfeitOutcome(input: {
  isForfeit: boolean
  status: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
}): ForfeitOutcome {
  if (!input.isForfeit || input.status !== "final") {
    return { kind: "not_forfeit" }
  }
  const homeScore = input.homeScore ?? 0
  const awayScore = input.awayScore ?? 0

  if (homeScore > awayScore) {
    return {
      kind: "single_forfeit",
      winnerTeamSlug: input.homeTeam,
      loserTeamSlug: input.awayTeam,
    }
  }
  if (awayScore > homeScore) {
    return {
      kind: "single_forfeit",
      winnerTeamSlug: input.awayTeam,
      loserTeamSlug: input.homeTeam,
    }
  }
  return { kind: "double_forfeit" }
}

export function applyForfeitPreset(forfeitingSide: ForfeitingSide): {
  isForfeit: true
  status: "final"
  homeScore: number
  awayScore: number
  isOvertime: false
  hasShootout: false
} {
  if (forfeitingSide === "away") {
    return {
      isForfeit: true,
      status: "final",
      homeScore: 5,
      awayScore: 0,
      isOvertime: false,
      hasShootout: false,
    }
  }
  if (forfeitingSide === "home") {
    return {
      isForfeit: true,
      status: "final",
      homeScore: 0,
      awayScore: 5,
      isOvertime: false,
      hasShootout: false,
    }
  }
  return {
    isForfeit: true,
    status: "final",
    homeScore: 0,
    awayScore: 0,
    isOvertime: false,
    hasShootout: false,
  }
}

export function inferForfeitingSide(input: {
  homeScore: number | null
  awayScore: number | null
  status?: string | null
}): ForfeitingSide {
  const { homeScore, awayScore, status } = input
  if (homeScore != null && awayScore != null) {
    if (homeScore > awayScore) return "away"
    if (awayScore > homeScore) return "home"
    if (status === "final" && homeScore === awayScore) return "both"
  }
  return "away"
}
