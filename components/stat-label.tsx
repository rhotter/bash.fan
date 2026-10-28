"use client"

import type { ReactElement } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const descriptions: Record<string, string> = {
  GP: "Games played",
  G: "Goals",
  A: "Assists",
  PTS: "Points",
  "PTS/G": "Points per game",
  GWG: "Game-winning goals",
  PPG: "Power-play goals",
  SHG: "Short-handed goals",
  ENG: "Empty-net goals",
  HAT: "Hat tricks",
  PIM: "Penalty minutes",
  W: "Wins",
  L: "Losses",
  OTW: "Overtime wins",
  OTL: "Overtime losses",
  GF: "Goals for",
  GA: "Goals against",
  "+/-": "Goal differential",
  "SV%": "Save percentage",
  GAA: "Goals-against average",
  SO: "Shutouts",
  SV: "Saves",
  SA: "Shots against",
  MIN: "Minutes played",
  DEC: "Decision (win or loss)",
  Opp: "Opponent",
}

export function StatLabel({ label, children }: { label: string; children?: ReactElement }) {
  const description = descriptions[label]
  if (!description) return children ?? label

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        {children ?? <span tabIndex={0} className="cursor-help" aria-label={`${label}: ${description}`}>{label}</span>}
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{description}</TooltipContent>
    </Tooltip>
  )
}
