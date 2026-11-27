"use client"

import { ChevronRight } from "lucide-react"
import { useId, useState, type FormEvent } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { checkFantasyConfig, GAME_TYPES, type FantasyConfig } from "@/lib/fantasy/config"
import {
  DAYS,
  describeConfigChanges,
  fitsForm,
  GOALIE_WEIGHTS,
  LINEUP_SLOTS,
  SKATER_WEIGHTS,
  toNumberDraft,
  type ConfigDraft,
  type NumberDraft,
} from "@/lib/fantasy/config-draft"

const stringify = (value: unknown) => JSON.stringify(value, null, 2)
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm"

/** What the JSON box holds, and why the fields can't show it, if they can't. */
function readJson(text: string): { draft: ConfigDraft; problem?: never } | { draft?: never; problem: string } {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return { problem: `The config isn't valid JSON: ${error.message}` }
  }
  if (fitsForm(value)) return { draft: value }
  const check = checkFantasyConfig(value)
  return { problem: `The fields can't show this config. ${check.ok ? "" : check.issues.join("; ")}` }
}

/** The first rule broken at `path` or inside it, in words for the field. */
function issueAt(issues: string[], path: string) {
  const issue = issues.find((i) => i.startsWith(`${path}:`) || i.startsWith(`${path}.`))
  if (!issue) return null
  const message = issue.slice(issue.indexOf(": ") + 2)
  if (message === "Expected number, received string") return "Enter a number"
  if (message === "Expected integer, received float") return "Enter a whole number"
  return message
}

function FieldError({ id, message }: { id?: string; message: string | null }) {
  return message ? <p id={id} className="text-xs text-destructive">{message}</p> : null
}

function NumberField({
  label,
  caption,
  value,
  error,
  disabled,
  onChange,
}: {
  label: string
  caption: string
  value: NumberDraft | null
  error: string | null
  disabled?: boolean
  onChange: (value: NumberDraft) => void
}) {
  const errorId = useId()
  return (
    <label className="space-y-1 text-sm">
      <span className="block text-muted-foreground">{caption}</span>
      <Input
        // Text, not number: a number input reports a half-typed value such as "-" as empty.
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        disabled={disabled}
        value={value ?? ""}
        onChange={(event) => onChange(toNumberDraft(event.target.value))}
        onBlur={() => {
          if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) onChange(Number(value))
        }}
        className="tabular-nums"
      />
      <FieldError id={errorId} message={error} />
    </label>
  )
}

function DateField({
  label,
  value,
  error,
  onChange,
}: {
  label: string
  value: string | null
  error: string | null
  onChange: (value: string | null) => void
}) {
  return (
    <div className="space-y-1">
      <label className="block space-y-1 text-sm">
        <span className="block text-muted-foreground">{label}</span>
        <Input
          type="date"
          aria-label={label}
          aria-invalid={error !== null}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-44"
        />
      </label>
      {value !== null && (
        <Button type="button" size="sm" variant="ghost" className="-ml-3" onClick={() => onChange(null)}>
          Clear {label.toLowerCase()}
        </Button>
      )}
      <FieldError message={error} />
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={title} className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  )
}

const grid = "grid grid-cols-2 items-start gap-3 sm:grid-cols-4 lg:grid-cols-5"

/**
 * Edits one run's config. The fields and the JSON under Advanced are two views of one draft.
 * Mount it afresh (with a `key`) to start again from a newly saved config.
 */
export function FantasyConfigForm({
  initial,
  enabled,
  hasLineups,
  onSave,
  onDirtyChange,
}: {
  initial: FantasyConfig
  /** Whether the run is already on. */
  enabled: boolean
  hasLineups: boolean
  onSave: (config: FantasyConfig) => void | Promise<void>
  /** Told whether the draft, as fields or JSON, differs from where it started. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [{ draft, text }, setState] = useState(() => ({ draft: initial as ConfigDraft, text: stringify(initial) }))
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState<{ config: FantasyConfig; changes: string[] } | null>(null)
  // The last cap typed for each kind, so unticking No limit brings it back.
  const [lastCap, setLastCap] = useState<Partial<ConfigDraft["usageCap"]>>({})
  // `draft` is the last config the fields could show. `text` may be ahead of it while the JSON is being typed.
  const { problem } = readJson(text)
  const check = checkFantasyConfig(draft)
  const issues = check.ok ? [] : check.issues

  const update = (state: { draft: ConfigDraft; text: string }) => {
    setState(state)
    onDirtyChange?.(state.text !== stringify(initial))
  }
  const change = (next: ConfigDraft) => update({ draft: next, text: stringify(next) })
  const changeJson = (next: string) => {
    const read = readJson(next)
    update({ draft: read.draft ?? draft, text: next })
    if (read.problem !== undefined) setAdvancedOpen(true)
  }

  async function save(config: FantasyConfig) {
    setSaving(true)
    try {
      await onSave(config)
    } finally {
      setSaving(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (saving || problem !== undefined || !check.ok) return
    const changes = describeConfigChanges(initial, check.config)
    if (enabled && hasLineups && changes.length > 0) setConfirming({ config: check.config, changes })
    else void save(check.config)
  }

  const timeZones = Intl.supportedValuesOf("timeZone")
  const movesWeeks =
    confirming !== null &&
    (["dayOfWeek", "time", "timeZone"] as const).some((key) => confirming.config.lock[key] !== initial.lock[key])

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <fieldset disabled={problem !== undefined} className="min-w-0 space-y-6 disabled:opacity-50">
        <Group title="Games that count">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {GAME_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 text-sm">
                <Checkbox
                  aria-label={capitalize(type)}
                  checked={draft.gameTypes.includes(type)}
                  onCheckedChange={(checked) =>
                    change({
                      ...draft,
                      // Kept in one order, so ticking and unticking a box isn't a change.
                      gameTypes: GAME_TYPES.filter((t) => (t === type ? checked === true : draft.gameTypes.includes(t))),
                    })
                  }
                />
                {capitalize(type)}
              </label>
            ))}
          </div>
          <FieldError message={issueAt(issues, "gameTypes")} />
        </Group>

        <Group title="Lineup spots">
          <div className={grid}>
            {LINEUP_SLOTS.map(([key, label, caption]) => (
              <NumberField
                key={key}
                label={label}
                caption={caption}
                value={draft.lineup[key]}
                error={issueAt(issues, `lineup.${key}`)}
                onChange={(value) => change({ ...draft, lineup: { ...draft.lineup, [key]: value } })}
              />
            ))}
          </div>
        </Group>

        <Group title="Usage limits (uses per Player)">
          <div className="grid grid-cols-2 items-start gap-3 sm:max-w-md">
            {(["skater", "goalie"] as const).map((kind) => (
              <div key={kind} className="space-y-2">
                <NumberField
                  label={`${capitalize(kind)} uses per Player`}
                  caption={`${capitalize(kind)}s`}
                  value={draft.usageCap[kind]}
                  disabled={draft.usageCap[kind] === null}
                  error={issueAt(issues, `usageCap.${kind}`)}
                  onChange={(value) => change({ ...draft, usageCap: { ...draft.usageCap, [kind]: value } })}
                />
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    aria-label={`No limit on ${kind} uses`}
                    checked={draft.usageCap[kind] === null}
                    onCheckedChange={(checked) => {
                      if (checked === true) setLastCap({ ...lastCap, [kind]: draft.usageCap[kind] })
                      const cap = checked === true ? null : (lastCap[kind] ?? "")
                      change({ ...draft, usageCap: { ...draft.usageCap, [kind]: cap } })
                    }}
                  />
                  No limit
                </label>
              </div>
            ))}
          </div>
        </Group>

        <Group title="Skater scoring (points each)">
          <div className={grid}>
            {SKATER_WEIGHTS.map(([key, name]) => (
              <NumberField
                key={key}
                label={`Points per ${name}`}
                caption={capitalize(name)}
                value={draft.weights.skater[key]}
                error={issueAt(issues, `weights.skater.${key}`)}
                onChange={(value) =>
                  change({ ...draft, weights: { ...draft.weights, skater: { ...draft.weights.skater, [key]: value } } })
                }
              />
            ))}
          </div>
        </Group>

        <Group title="Goalie scoring (points each)">
          <div className={grid}>
            {GOALIE_WEIGHTS.map(([key, name]) => (
              <NumberField
                key={key}
                label={`Points per ${name}`}
                caption={capitalize(name)}
                value={draft.weights.goalie[key]}
                error={issueAt(issues, `weights.goalie.${key}`)}
                onChange={(value) =>
                  change({ ...draft, weights: { ...draft.weights, goalie: { ...draft.weights.goalie, [key]: value } } })
                }
              />
            ))}
          </div>
        </Group>

        <Group title="Run dates (optional)">
          <div className="flex flex-wrap items-start gap-4">
            <DateField
              label="Start date"
              value={draft.startsOn}
              error={issueAt(issues, "startsOn")}
              onChange={(startsOn) => change({ ...draft, startsOn })}
            />
            <DateField
              label="End date"
              value={draft.endsOn}
              error={issueAt(issues, "endsOn")}
              onChange={(endsOn) => change({ ...draft, endsOn })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            The run includes each Week closing from the start date to the end date, with all of that Week&apos;s games.
            People can join before it starts, and picks open at the weekly close before its first Week. After its last Week
            closes, no one can join or make picks, and standings stay up. With no start date it begins at the first weekly
            close after you turn it on. With no end date it keeps going.
          </p>
        </Group>

        <Group title="Weekly closing time">
          <div className="grid items-start gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="block text-muted-foreground">Day</span>
              <select
                aria-label="Closing day"
                className={selectClass}
                value={draft.lock.dayOfWeek}
                onChange={(e) => change({ ...draft, lock: { ...draft.lock, dayOfWeek: Number(e.target.value) } })}
              >
                {DAYS.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block text-muted-foreground">Time (noon at the latest)</span>
              <Input
                type="time"
                aria-label="Closing time"
                aria-invalid={issueAt(issues, "lock.time") !== null}
                value={draft.lock.time}
                onChange={(e) => change({ ...draft, lock: { ...draft.lock, time: e.target.value } })}
              />
              <FieldError message={issueAt(issues, "lock.time")} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="block text-muted-foreground">Time zone</span>
              <select
                aria-label="Time zone"
                className={selectClass}
                value={draft.lock.timeZone}
                onChange={(e) => change({ ...draft, lock: { ...draft.lock, timeZone: e.target.value } })}
              >
                {/* A saved zone can be a valid alias, such as UTC, that the browser doesn't list. */}
                {!timeZones.includes(draft.lock.timeZone) && (
                  <option value={draft.lock.timeZone}>{draft.lock.timeZone}</option>
                )}
                {timeZones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <FieldError message={issueAt(issues, "lock.timeZone")} />
            </label>
          </div>
        </Group>
      </fieldset>

      {problem !== undefined && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">{problem}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => change(draft)}>
            Discard JSON changes
          </Button>
        </div>
      )}

      {/* Unreadable JSON can only be fixed here, so it stays open. */}
      <Collapsible open={advancedOpen || problem !== undefined} onOpenChange={setAdvancedOpen} className="space-y-2">
        <CollapsibleTrigger asChild>
          <Button type="button" size="sm" variant="ghost" className="group -ml-3 text-muted-foreground">
            <ChevronRight aria-hidden className="size-4 transition-transform group-data-[state=open]:rotate-90" />
            Advanced: edit as JSON
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Textarea
            aria-label="Config JSON"
            rows={14}
            spellCheck={false}
            value={text}
            onChange={(e) => changeJson(e.target.value)}
            className="font-mono text-xs md:text-xs"
          />
        </CollapsibleContent>
      </Collapsible>

      {/* Stays in view while a long form scrolls inside its window. */}
      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t bg-background py-3">
        {problem === undefined && !check.ok && (
          <p className="text-sm text-destructive">Fix the highlighted settings to save.</p>
        )}
        <Button type="submit" disabled={saving || problem !== undefined || !check.ok}>
          {saving && <Spinner aria-hidden />}
          {saving ? "Saving…" : enabled ? "Save settings" : "Turn on run"}
        </Button>
      </div>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change a run that has Lineups?</AlertDialogTitle>
            <AlertDialogDescription>
              Every Week is scored again with the new settings straight away. Saved Lineups aren&apos;t rechecked against new
              Lineup spots or usage limits.
              {(confirming?.config.startsOn !== initial.startsOn || confirming?.config.endsOn !== initial.endsOn) &&
                " Weeks outside the run's dates don't count."}
              {movesWeeks && " Changing the closing day, time or time zone can move a saved Lineup into a different Week."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-sm">
            {confirming?.changes.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirming && void save(confirming.config)}>Save changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}
