"use client"

import { Button } from "@/components/ui/button"
import { Printer, ArrowLeft } from "lucide-react"

export function BatchScoresheetToolbar({
  seasonName,
  seasonId,
  gameCount,
}: {
  seasonName: string
  seasonId?: string
  gameCount: number
}) {
  return (
    <div className="no-print bg-background/95 backdrop-blur-sm border-b px-4 py-2.5 sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 shadow-xs">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            window.close()
            setTimeout(() => {
              if (seasonId) {
                window.location.href = `/admin/seasons/${encodeURIComponent(seasonId)}`
              } else {
                history.back()
              }
            }, 150)
          }}
          aria-label="Back to schedule"
          title="Back to schedule"
        >
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Close
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            {seasonName}
          </span>
          <span className="text-xs text-muted-foreground">
            Scoresheet Batch
          </span>
          <span className="text-xs font-medium text-muted-foreground bg-muted border px-2 py-0.5 rounded-full">
            {gameCount} {gameCount === 1 ? "upcoming game" : "upcoming games"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={gameCount === 0}
          onClick={() => window.print()}
          className="shadow-xs"
          aria-label="Print or Save as PDF"
          title="Print or Save as PDF"
        >
          <Printer className="h-4 w-4 mr-1.5" />
          Print / Save as PDF
        </Button>
      </div>
    </div>
  )
}
