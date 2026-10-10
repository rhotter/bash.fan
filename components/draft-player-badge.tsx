"use client"

import { useRef, useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const playerBadges = {
  rookie: {
    letter: "R",
    label: "Rookie",
    description: "Rookie",
  },
  keeper: {
    letter: "K",
    label: "Keeper",
    description: "Keeper — Designated as a keeper for this season.",
  },
  captain: {
    letter: "C",
    label: "Captain",
    description: "Captain — Designated team captain for this season.",
  },
}

export function DraftPlayerBadge({
  kind,
  className,
}: {
  kind: keyof typeof playerBadges
  className?: string
}) {
  return <DraftBadge {...playerBadges[kind]} className={className} compactOnMobile />
}

export function DraftTradeBadge({
  originalTeamName,
}: {
  originalTeamName: string
}) {
  return (
    <DraftBadge
      letter="Traded pick"
      label="Traded pick"
      description={`Pick acquired from ${originalTeamName}.`}
      className="h-auto min-h-4 max-w-full whitespace-normal py-0.5 text-[9px] normal-case tracking-normal"
    />
  )
}

function DraftBadge({
  letter,
  label,
  description,
  className,
  compactOnMobile = false,
}: {
  letter: string
  label: string
  description: string
  className?: string
  compactOnMobile?: boolean
}) {
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
            "relative pointer-events-auto shrink-0 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-sm border border-foreground/40 text-foreground text-[9px] font-bold uppercase tracking-wider leading-none cursor-pointer touch-manipulation [@media(pointer:coarse)]:min-h-6 [@media(pointer:coarse)]:min-w-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2",
            // Keep a 24px tap target, but draw a small 12px status mark on phones.
            // The board reserves this target's own top row, clear of the name.
            compactOnMobile && "max-sm:h-6 max-sm:min-w-6 max-sm:border-0 max-sm:p-1.5",
            className,
          )}
        >
          <span
            aria-hidden="true"
            className={compactOnMobile ? "max-sm:inline-flex max-sm:h-3 max-sm:min-w-3 max-sm:items-center max-sm:justify-center max-sm:rounded-[2px] max-sm:border max-sm:border-foreground/40 max-sm:text-[8px] max-sm:tracking-normal" : undefined}
          >{letter}</span>
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
        {description}
      </TooltipContent>
    </Tooltip>
  )
}
