"use client"

import { Plus } from "lucide-react"
import { useId } from "react"
import { TeamLogo } from "@/components/team-logo"
import { usesLabel } from "@/lib/fantasy/selection-options"
import type { WeekForm } from "@/lib/fantasy/lineups"
import type { WeekOverview } from "@/lib/fantasy/week"
import { cn } from "@/lib/utils"

type Player = WeekForm["players"][number]

/** The Player's games this Week, from their side. A traded Player can have games for more than one team. */
function gamesFor(player: Player, overview: WeekOverview) {
  return overview.games.flatMap((game) =>
    (["home", "away"] as const)
      .filter((side) => player.teams.includes(game[side].slug))
      .map((side) => ({
        key: `${game.id}-${side}`,
        team: game[side],
        label: `${game.startLabel} vs ${game[side === "home" ? "away" : "home"].name}`,
      }))
  )
}

/** One Lineup slot. Tapping it chooses or changes the Player. */
export function LineupSlotCard({
  slot,
  title,
  backup,
  optional,
  player,
  missing,
  usesLeft,
  overview,
  onClick,
}: {
  /** The slot's full name, such as "Skater Backup". */
  slot: string
  /** The shorter name shown on the card, under its group's heading. */
  title: string
  backup: boolean
  optional: boolean
  player: Player | undefined
  /** The slot holds a Player who's no longer on a roster. */
  missing?: boolean
  /** Uses left for this kind of slot, or null when the Usage Cap doesn't apply. */
  usesLeft: number | null
  overview: WeekOverview
  onClick: () => void
}) {
  const detailsId = useId()
  const games = player ? gamesFor(player, overview) : []
  const team = games[0]?.team ?? (player && { slug: player.teams[0], name: player.team })

  const emptyLabel = missing ? "Player no longer on a roster" : "Choose a Player"

  return (
    <button
      type="button"
      aria-label={`${slot}: ${player?.name ?? emptyLabel}`}
      aria-describedby={detailsId}
      onClick={onClick}
      className={cn(
        "flex h-full min-h-36 w-full min-w-0 flex-col gap-2 rounded-lg border p-2.5 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        player
          ? cn("border-border hover:bg-secondary", backup ? "border-dashed bg-muted/50" : "bg-card")
          : cn("border-dashed", optional ? "border-muted-foreground/40 hover:bg-secondary" : "border-primary bg-primary/5 hover:bg-primary/10")
      )}
    >
      <span className="text-xs font-semibold text-muted-foreground">{title}</span>
      <span id={detailsId} className="flex flex-1 flex-col justify-between gap-2">
        {player && team ? (
          <>
            <span className="flex items-center gap-2">
              <TeamLogo slug={team.slug} name={team.name} size={28} />
              <span className="min-w-0 break-words text-sm font-semibold leading-tight">{player.name}</span>
            </span>
            <span className="space-y-0.5 text-xs text-muted-foreground">
              {games.length === 0 && <span className="block">Bye this Week</span>}
              {games.map((game) => (
                <span key={game.key} className="block">{game.label}</span>
              ))}
            </span>
            <span className="flex flex-wrap justify-between gap-x-2 border-t border-border pt-1.5 text-xs text-muted-foreground">
              <span><span className="font-semibold tabular-nums text-foreground">{player.pointsPerGame.toFixed(1)}</span> pts/g</span>
              {usesLeft !== null && <span>{usesLabel(usesLeft)}</span>}
            </span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1 text-sm font-semibold">
              <Plus aria-hidden className="size-4 shrink-0" />
              {emptyLabel}
            </span>
            <span className="text-xs text-muted-foreground">
              {missing ? "Tap to replace them" : optional ? "Optional" : "Required to save"}
              {backup && ". Plays if a starter is absent."}
            </span>
          </>
        )}
      </span>
    </button>
  )
}
