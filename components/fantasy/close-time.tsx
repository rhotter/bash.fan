"use client"

import { Clock } from "lucide-react"
import { useEffect, useState } from "react"
import { instantLabel } from "@/lib/fantasy/view-state"

function timeLeft(ms: number) {
  if (ms <= 0) return "Closed. Reload to see your picks."
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return "Less than a minute left"
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days}d ${hours}h left`
  if (hours > 0) return `${hours}h ${minutes % 60}m left`
  return `${minutes}m left`
}

/** When the open Week's Lineup and Predictions close, with a countdown. */
export function CloseTime({ lockAt, timeZone }: { lockAt: string; timeZone: string }) {
  // The countdown waits for the browser, so the server's clock can't cause a hydration mismatch.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="text-sm sm:text-right">
      <p className="text-muted-foreground">
        Picks close <span className="font-medium text-foreground">{instantLabel(lockAt, timeZone)}</span>
      </p>
      {now !== null && (
        <p className="mt-0.5 flex items-center gap-1.5 font-semibold tabular-nums sm:justify-end">
          <Clock aria-hidden className="size-3.5" />
          {timeLeft(new Date(lockAt).getTime() - now)}
        </p>
      )}
    </div>
  )
}
