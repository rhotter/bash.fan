import type { CSSProperties, ReactNode } from "react"
import { TeamLogo } from "@/components/team-logo"
import { getTeamLogoColor } from "@/lib/team-logo-colors"
import type { TeamRef } from "@/lib/fantasy/week"
import { cn } from "@/lib/utils"

export type Side = "away" | "home"

/** Away first, matching the order of the score columns. */
export const SIDES: Side[] = ["away", "home"]

/** The side with the higher score, or none while the scores are incomplete or tied. */
export function pickedSide(awayScore: number, homeScore: number): Side | null {
  if (awayScore > homeScore) return "away"
  return homeScore > awayScore ? "home" : null
}

// A narrow list stacks each logo over its name. A wide one puts both beside the score, mirrored.
function PickTeam({ side, team, picked }: { side: Side; team: TeamRef; picked: boolean }) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col items-center gap-1 @min-[34rem]:gap-3",
        side === "away" ? "@min-[34rem]:flex-row-reverse" : "@min-[34rem]:flex-row"
      )}
    >
      <TeamLogo slug={team.slug} name={team.name} size={40} />
      <span
        className={cn(
          "min-w-0 border-b-4 pb-0.5 text-center text-xs break-words @min-[34rem]:text-sm",
          picked ? "border-(--pick-color) font-extrabold" : "border-transparent font-medium"
        )}
        style={{ "--pick-color": getTeamLogoColor(team.slug) } as CSSProperties}
      >
        {team.name}
      </span>
    </div>
  )
}

/**
 * One game of a pick list: the time, then the away team, both scores and the home team. The entry
 * form and the public Predictions share it. It sizes to its container, which needs `@container`.
 */
export function PickRow({
  game,
  picked,
  scores,
  action,
  children,
}: {
  game: { startLabel: string; home: TeamRef; away: TeamRef }
  /** The predicted winner, underlined in its team color. */
  picked: Side | null
  scores: Record<Side, ReactNode>
  /** Sits with the game's time. */
  action?: ReactNode
  /** Lines under the game, such as its result. */
  children?: ReactNode
}) {
  return (
    <div className="px-2.5 py-3 @min-[34rem]:px-4">
      <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 @min-[34rem]:grid-cols-[4.5rem_minmax(0,1fr)_3.5rem_3.5rem_minmax(0,1fr)] @min-[34rem]:gap-x-3">
        <div className="relative col-span-full flex min-h-6 items-center justify-center text-xs text-muted-foreground @min-[34rem]:col-span-1 @min-[34rem]:flex-col @min-[34rem]:items-start">
          <span>{game.startLabel}</span>
          {action && <span className="absolute right-0 @min-[34rem]:static">{action}</span>}
        </div>
        <PickTeam side="away" team={game.away} picked={picked === "away"} />
        {scores.away}
        {scores.home}
        <PickTeam side="home" team={game.home} picked={picked === "home"} />
      </div>
      {children}
    </div>
  )
}
