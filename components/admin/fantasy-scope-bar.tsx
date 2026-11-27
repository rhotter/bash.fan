"use client"

import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RUN_TYPES } from "@/lib/fantasy/config-draft"
import { contestKeyFromName, contestLabel, MAX_CONTEST_NAME } from "@/lib/fantasy/view-state"
import { cn } from "@/lib/utils"

const href = (seasonId: string, contest?: string, type?: string) => {
  const query = new URLSearchParams({ season: seasonId, ...(contest ? { contest } : {}), ...(type ? { type } : {}) })
  return `/admin/fantasy?${query}`
}

const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm"

/** Names a new run. Nothing is stored until the run is turned on. */
function NewRunForm({ taken, onCreate, onCancel }: { taken: string[]; onCreate: (key: string, type: string) => void; onCancel: () => void }) {
  const [type, setType] = useState(RUN_TYPES[0].value)
  const [name, setName] = useState("")
  const key = contestKeyFromName(name)
  const exists = key !== null && taken.includes(key)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (key !== null && !exists) onCreate(key, type)
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">Type</span>
          <select aria-label="Run type" value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
            {RUN_TYPES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-40 flex-1 space-y-1 text-sm">
          <span className="block text-muted-foreground">Name</span>
          <Input
            aria-label="Run name"
            placeholder="e.g. December Beta"
            maxLength={MAX_CONTEST_NAME}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <Button type="submit" size="sm" disabled={key === null || exists}>
          Create
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className={cn("text-xs", exists ? "text-destructive" : "text-muted-foreground")}>
        {exists
          ? "This season already has a run with that name."
          : key === null
            ? "The name makes the run's link, and can't be changed later."
            : `Shown as “${contestLabel(key)}” at /fantasy?contest=${key}. The name can't be changed later.`}
      </p>
    </form>
  )
}

/** Which season and which of its runs the page is showing. */
export function FantasyScopeBar({
  seasons,
  seasonId,
  contest,
  contests,
}: {
  seasons: { id: string; name: string }[]
  seasonId: string
  contest: string
  /** Runs already turned on for this season. */
  contests: string[]
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const shown = contests.includes(contest) ? contests : [...contests, contest]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          Season
          <select value={seasonId} onChange={(e) => router.push(href(e.target.value))} className={selectClass}>
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
              aria-current={key === contest ? "page" : undefined}
              // Reopening the current run would drop the type a new one was started with.
              onClick={() => key !== contest && router.push(href(seasonId, key))}
            >
              {contestLabel(key)}
            </Button>
          ))}
          {!adding && (
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
              + New run
            </Button>
          )}
        </nav>
      </div>
      {adding && (
        <NewRunForm
          taken={shown}
          onCancel={() => setAdding(false)}
          onCreate={(key, type) => {
            setAdding(false)
            // Nothing is stored yet, so say what's left to do.
            toast.info(`${contestLabel(key)} isn't saved yet.`, {
              description: "Check its settings, then click Turn on run.",
              // The new run's settings open next, with Save in the default corner.
              position: "top-center",
            })
            router.push(href(seasonId, key, type))
          }}
        />
      )}
    </div>
  )
}
