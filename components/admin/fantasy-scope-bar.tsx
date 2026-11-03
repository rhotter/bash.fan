"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parseContest } from "@/lib/fantasy/view-state"
import { cn } from "@/lib/utils"

const href = (seasonId: string, contest?: string) =>
  `/admin/fantasy?season=${encodeURIComponent(seasonId)}${contest ? `&contest=${encodeURIComponent(contest)}` : ""}`

/** Which season and which of its contests the page is showing. */
export function FantasyScopeBar({
  seasons,
  seasonId,
  contest,
  contests,
}: {
  seasons: { id: string; name: string }[]
  seasonId: string
  contest: string
  /** Contests already turned on for this season. */
  contests: string[]
}) {
  const router = useRouter()
  const [adding, setAdding] = useState<string | null>(null)
  const newKey = adding === null ? null : parseContest(adding)
  const shown = contests.includes(contest) ? contests : [...contests, contest]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          Season
          <select
            value={seasonId}
            onChange={(e) => router.push(href(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <nav aria-label="Contests" className="flex flex-wrap gap-1">
          {shown.map((key) => (
            <Button
              key={key}
              size="sm"
              variant={key === contest ? "default" : "outline"}
              className={cn(!contests.includes(key) && "border-dashed")}
              onClick={() => router.push(href(seasonId, key))}
            >
              {key}
            </Button>
          ))}
          {adding === null && (
            <Button size="sm" variant="ghost" onClick={() => setAdding("")}>
              + Add contest
            </Button>
          )}
        </nav>
      </div>
      {adding !== null && (
        <div className="flex max-w-md items-center gap-2">
          <Input
            aria-label="New contest name"
            placeholder="playoffs"
            maxLength={30}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
          />
          <Button
            size="sm"
            disabled={newKey === null}
            onClick={() => newKey && router.push(href(seasonId, newKey))}
          >
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
