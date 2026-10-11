"use client"

import { useRef, useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const playerBadges = {
  rookie: {
    letter: "R",
    label: "Rookie",
  },
  keeper: {
    letter: "K",
    label: "Keeper",
  },
  goalie: {
    letter: "G",
    label: "Goalie",
  },
  captain: {
    letter: "C",
    label: "Captain",
  },
}

export function DraftPlayerBadge({
  kind,
  className,
}: {
  kind: keyof typeof playerBadges
  className?: string
}) {
  const { letter, label } = playerBadges[kind]
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const openOnPointerDown = useRef<boolean | null>(null)

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          onPointerDown={(event) => {
            openOnPointerDown.current = open
            // Keep an open explanation in place until click can toggle it closed.
            // Radix otherwise closes on pointer-down, then our click reopens it.
            if (open) event.preventDefault()
          }}
          onPointerCancel={() => { openOnPointerDown.current = null }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            // Mobile focus events can change open between pointer-down and click.
            const wasOpen = event.detail > 0 ? openOnPointerDown.current : null
            openOnPointerDown.current = null
            setOpen((previous) => !(wasOpen ?? previous))
          }}
          className={cn(
            "relative pointer-events-auto shrink-0 inline-flex items-center justify-center h-3 min-w-3 px-0.5 rounded-[2px] border border-border text-muted-foreground text-[8px] font-medium uppercase tracking-normal leading-none cursor-help touch-manipulation after:absolute after:inset-x-0 after:-inset-y-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2",
            className,
          )}
        >
          <span aria-hidden="true">{letter}</span>
          <span className="sr-only">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent
        sideOffset={4}
        collisionPadding={8}
        className="max-w-[calc(100vw-1rem)]"
        onClick={(event) => event.stopPropagation()}
        onPointerDownOutside={(event) => {
          if (triggerRef.current?.contains(event.target as Node)) event.preventDefault()
        }}
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
