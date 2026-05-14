import { cn } from "@/lib/utils"

const GAME_TYPE_CONFIG: Record<string, { label: string; className: string }> = {
  exhibition: {
    label: "Exhibition",
    className: "bg-[#7c3aed]/15 text-[#7c3aed] border-[#7c3aed]/20",
  },
  tryout: {
    label: "Tryout",
    className: "bg-[#0d9488]/15 text-[#0d9488] border-[#0d9488]/20",
  },
  playoff: {
    label: "Playoff",
    className: "bg-orange-500/15 text-orange-500 border-orange-500/20",
  },
  championship: {
    label: "Championship",
    className: "bg-yellow-500/15 text-yellow-600 border-yellow-500/20",
  },
  jamboree: {
    label: "Jamboree",
    className: "bg-pink-500/15 text-pink-500 border-pink-500/20",
  },
}

/**
 * Small pill badge for non-regular game types.
 * Returns null for regular games — no badge needed.
 */
export function GameTypeBadge({
  gameType,
  size = "sm",
  className,
}: {
  gameType: string
  size?: "xs" | "sm"
  className?: string
}) {
  const config = GAME_TYPE_CONFIG[gameType]
  if (!config) return null

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-semibold uppercase tracking-wider shrink-0",
        size === "xs" && "text-[7px] px-1.5 py-0.5",
        size === "sm" && "text-[9px] px-2 py-0.5",
        config.className,
        className,
      )}
    >
      {config.label}
    </span>
  )
}

/**
 * Returns true for game types that should NOT count in regular season stats/standings.
 */
export function isAdhocGameType(gameType: string): boolean {
  return gameType === "exhibition" || gameType === "tryout"
}
