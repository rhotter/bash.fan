"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { errorMessage, fetchApi, readApiJson } from "@/lib/api-errors"
import type { LineupForm } from "@/lib/fantasy/lineups"
import { buildSelectionGroups, playersForSlot, type SelectionOption } from "@/lib/fantasy/selection-options"
import type { Lineup, LineupError } from "@/lib/fantasy/scoring"
import type { WeekOverview } from "@/lib/fantasy/week"

const usesLabel = (usesLeft: number) => `${usesLeft} ${usesLeft === 1 ? "use" : "uses"} left`

/**
 * Choose a Player for one Lineup slot. A bottom sheet on phones and a side panel from 768px up.
 * Players with no uses left stay listed, disabled, so a Manager sees why they can't be selected.
 */
export function SelectionSheet({
  open,
  onOpenChange,
  title,
  overview,
  players,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  overview: WeekOverview
  players: SelectionOption[]
  onSelect: (playerId: number) => void
}) {
  const [query, setQuery] = useState("")
  const groups = buildSelectionGroups(overview, players, query)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] md:inset-y-0 md:left-auto md:right-0 md:top-0 md:h-full md:max-h-none md:w-[28rem] md:border-l md:border-t-0"
      >
        <SheetHeader className="pb-0">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>Grouped by this Week's games.</SheetDescription>
        </SheetHeader>
        <div className="px-4">
          <Input
            type="search"
            aria-label="Search Players"
            placeholder="Search Players"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6">
          {groups.length === 0 && <p className="text-sm text-muted-foreground">No Players match.</p>}
          {groups.map((group) => (
            <section key={group.gameId} className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground">{group.label}</h3>
              {group.teams.map((team) => (
                <div key={team.slug}>
                  <h4 className="mb-1 text-sm font-semibold">{team.name}</h4>
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {team.players.map((player) => (
                      <li key={player.id}>
                        <button
                          type="button"
                          disabled={player.disabled}
                          onClick={() => onSelect(player.id)}
                          className="flex w-full items-center gap-3 p-2.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-secondary"
                        >
                          <span className="min-w-0 flex-1 truncate font-medium">{player.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {player.usesLeft !== null && <>{usesLabel(player.usesLeft)} · </>}
                            {player.pointsPerGame.toFixed(1)} pts/g
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}

type SlotGroup = keyof Lineup
type Selections = Record<SlotGroup, string[]>

const GROUPS: { group: SlotGroup; label: string; count: (s: LineupForm["slots"]) => number }[] = [
  { group: "skaters", label: "Skater", count: (s) => s.skaters },
  { group: "goalies", label: "Goalie", count: (s) => s.goalies },
  { group: "skaterBackups", label: "Skater Backup", count: (s) => s.skaterBackups },
  { group: "goalieBackups", label: "Goalie Backup", count: (s) => s.goalieBackups },
]

const ERRORS: Record<LineupError, string> = {
  "skater-slots": "Fill every skater slot.",
  "goalie-slot": "Fill the goalie slot.",
  "too-many-backups": "That's too many Backups.",
  "duplicate-player": "A Player can appear only once in a Lineup.",
  "not-rostered": "One of these Players isn't on a roster this season.",
  "wrong-kind": "A flagged goalie can't fill a skater slot.",
  "at-usage-cap": "One of these Players has no uses left.",
  "on-bye": "One of these Players has a Bye this Week.",
}

const isGoalieSlot = (group: SlotGroup) => group === "goalies" || group === "goalieBackups"

function initialSelections(form: LineupForm): Selections {
  const selections = {} as Selections
  for (const { group, count } of GROUPS) {
    selections[group] = Array.from({ length: count(form.slots) }, (_, i) => String(form.lineup?.[group][i] ?? ""))
  }
  return selections
}

export function LineupFormPanel({ form, token }: { form: LineupForm; token: string }) {
  const [selections, setSelections] = useState(() => initialSelections(form))
  const [everyGoalie, setEveryGoalie] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<{ group: SlotGroup; index: number } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null)

  const defaultGoalies = new Set(form.defaultGoalieIds)
  const chosen = new Set(Object.values(selections).flat().filter(Boolean))
  const lock = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: form.week.timeZone,
  }).format(new Date(form.week.lockAt))

  function select(group: SlotGroup, index: number, value: string) {
    setSelections({ ...selections, [group]: selections[group].map((old, i) => (i === index ? value : old)) })
    setMessage(null)
    setDirty(true)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    const lineup = Object.fromEntries(
      GROUPS.map(({ group }) => [group, selections[group].filter(Boolean).map(Number)])
    )
    try {
      const response = await fetchApi("/api/bash/fantasy/lineup", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ weekId: form.week.id, lineup }),
      })
      const body = await readApiJson(response)
      if (response.ok) {
        setDirty(false)
        setMessage({ text: "Saved. You can keep editing until it closes.", failed: false })
      }
      else if (response.status === 401) setMessage({ text: "This Manager Link is no longer valid. Ask an admin to reissue it.", failed: true })
      else if (body.errors) setMessage({ text: (body.errors as LineupError[]).map((e) => ERRORS[e] ?? "That Lineup isn’t valid.").join(" "), failed: true })
      else setMessage({ text: body.error ?? "Could not save the Lineup.", failed: true })
    } catch (err) {
      setMessage({ text: errorMessage(err), failed: true })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-6">
      <p className="text-sm">
        Lineup closes <span className="font-medium">{lock}</span>
      </p>
      <p className="text-sm text-muted-foreground">
        {dirty ? "Unsaved changes." : form.lineup ? "Your saved Lineup is shown." : "No Lineup saved for this Week yet."}
      </p>

      {GROUPS.map(({ group, label }) =>
        selections[group].map((value, index) => {
          const id = `${group}-${index}`
          const optional = group.endsWith("Backups") || (group === "goalies" && form.goalieSlotOptional)
          return (
            <div key={id} className="space-y-1.5">
              <Label htmlFor={id}>
                {label}
                {selections[group].length > 1 ? ` ${index + 1}` : ""}
                {optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
              </Label>
              <Button
                type="button"
                variant="outline"
                id={id}
                aria-label={`${label}${selections[group].length > 1 ? ` ${index + 1}` : ""}: ${
                  form.players.find((p) => String(p.id) === value)?.name ?? "Choose a Player"
                }`}
                onClick={() => setEditing({ group, index })}
                className="w-full justify-between font-normal"
              >
                {form.players.find((p) => String(p.id) === value)?.name ?? (
                  <span className="text-muted-foreground">Choose a Player</span>
                )}
              </Button>
            </div>
          )
        })
      )}

      {editing && (
        <SelectionSheet
          open
          onOpenChange={(open) => !open && setEditing(null)}
          title={`${GROUPS.find((g) => g.group === editing.group)!.label} ${editing.index + 1}`}
          overview={form.overview}
          players={playersForSlot({
            players: form.players,
            goalieSlot: isGoalieSlot(editing.group),
            chosen: new Set([...chosen].map(Number)),
            current: Number(selections[editing.group][editing.index]) || null,
            defaultGoalieIds: defaultGoalies,
            everyGoalie,
          })}
          onSelect={(playerId) => {
            select(editing.group, editing.index, String(playerId))
            setEditing(null)
          }}
        />
      )}

      <div className="flex items-center gap-2">
        <Checkbox
          id="every-goalie"
          checked={everyGoalie}
          onCheckedChange={(checked) => setEveryGoalie(checked === true)}
        />
        <Label htmlFor="every-goalie" className="font-normal">Show every rostered Player in goalie slots</Label>
      </div>

      {message && (
        <p role={message.failed ? "alert" : "status"} className={message.failed ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {message.text}
        </p>
      )}
      <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Lineup"}</Button>
    </form>
  )
}
