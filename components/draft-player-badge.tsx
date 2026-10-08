"use client"

import { useRef, useState } from "react"
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
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          onPointerDown={(event) => {
            // Keep an open explanation in place until click can toggle it closed.
            // Radix otherwise closes on pointer-down, then our click reopens it.
            if (open) event.preventDefault()
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setOpen((previous) => !previous)
          }}
          className={cn(
            "relative pointer-events-auto shrink-0 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-sm border border-foreground/40 text-foreground text-[9px] font-bold uppercase tracking-wider leading-none cursor-help touch-manipulation [@media(pointer:coarse)]:min-h-6 [@media(pointer:coarse)]:min-w-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2",
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
        {label} — {description}
      </TooltipContent>
    </Tooltip>
  )
}
