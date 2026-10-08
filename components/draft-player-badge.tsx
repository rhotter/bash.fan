"use client"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const playerBadges = {
  rookie: {
    letter: "R",
    label: "Rookie",
    description: "Designated as a rookie for this season.",
  },
  captain: {
    letter: "C",
    label: "Captain",
    description: "Designated team captain for this season.",
  },
}

export function DraftPlayerBadge({
  kind,
  className,
}: {
  kind: keyof typeof playerBadges
  className?: string
}) {
  const { letter, label, description } = playerBadges[kind]

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "shrink-0 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-sm border text-[9px] font-bold uppercase tracking-wider leading-none cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            kind === "captain" ? "border-primary/50 text-primary" : "border-border text-muted-foreground",
            className,
          )}
        >
          <span aria-hidden="true">{letter}</span>
          <span className="sr-only">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent sideOffset={4}>
        {label} — {description}
      </TooltipContent>
    </Tooltip>
  )
}
