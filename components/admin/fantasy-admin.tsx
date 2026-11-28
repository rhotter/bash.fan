"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ErrorNotice } from "@/components/error-notice"
import { LoadingState } from "@/components/loading-state"
import { FantasyConfigForm } from "@/components/admin/fantasy-config-form"
import { FantasyOverviewPanel, type ManagerPerson } from "@/components/admin/fantasy-overview"
import { errorMessage, fetchApi, readApiJson } from "@/lib/api-errors"
import type { FantasyConfig } from "@/lib/fantasy/config"
import { startingConfig } from "@/lib/fantasy/config-draft"
import { contestLabel, instantLabel } from "@/lib/fantasy/view-state"
import type { RunStatus } from "@/lib/fantasy/week"
import type { FantasyOverview } from "@/lib/fetch-fantasy"

interface FantasyData {
  enabled: boolean
  status: RunStatus | null
  picksOpenAt: string | null
  config: FantasyConfig
  hasLineups: boolean
  hasPredictions: boolean
  /** Why the stored config can't be used, or null if it's fine. */
  configIssues: string[] | null
  storedConfig: unknown
  managers: ManagerPerson[]
  overview: FantasyOverview | null
}

const STATUS_LABELS: Record<RunStatus, string> = { upcoming: "Upcoming", active: "On", "final-week": "Final Week", ended: "Ended" }

export function FantasyAdmin({
  seasonId,
  contest,
  type,
}: {
  seasonId: string
  contest: string
  /** The kind of run being started. Passed for a run that was just created, whose settings open straight away. */
  type?: string
}) {
  const router = useRouter()
  const base = `/api/bash/admin/seasons/${seasonId}/fantasy`
  const name = contestLabel(contest)
  const [data, setData] = useState<FantasyData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // Null until opened or closed by hand, so a run that was just created can start open.
  const [settingsOpen, setSettingsOpen] = useState<boolean | null>(null)
  const unsaved = useRef(false)

  const load = useCallback(async () => {
    try {
      const body: FantasyData = await readApiJson(await fetchApi(`${base}?contest=${encodeURIComponent(contest)}`))
      setData(body)
      setLoadError(null)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }, [base, contest])

  useEffect(() => {
    void load()
  }, [load])

  /** A toast shows wherever the page is scrolled, and the message also stays at the top. */
  function fail(message: string) {
    setActionError(message)
    // At the top, because the default corner covers the settings window's Save button.
    toast.error(message, { position: "top-center" })
  }

  /** Runs a change, shows any failure, and returns the response body on success. */
  async function act(url: string, method: string, payload?: unknown) {
    setActionError(null)
    try {
      const response = await fetchApi(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      })
      const body = await readApiJson(response)
      if (!response.ok) {
        fail([body.error, ...(Array.isArray(body.issues) ? body.issues : [])].join(" "))
        return null
      }
      await load()
      return body
    } catch (err) {
      fail(errorMessage(err))
      return null
    }
  }

  async function saveSettings(config: FantasyConfig) {
    const turningOn = !data?.enabled
    if (!(await act(base, "PUT", { contest, config }))) return
    unsaved.current = false
    setSettingsOpen(false)
    toast.success(turningOn ? `${name} is turned on.` : `${name} settings saved.`)
    // The run tabs are rendered on the server, so a new run's tab only changes on a refresh.
    router.refresh()
  }

  function changeSettingsOpen(open: boolean) {
    if (!open && unsaved.current && !window.confirm("Discard your unsaved changes?")) return
    unsaved.current = false
    setActionError(null)
    setSettingsOpen(open)
  }

  if (loadError) return <ErrorNotice message={loadError} onRetry={load} />
  if (!data) return <LoadingState variant="list" label="Loading Fantasy…" />

  const showSettings = settingsOpen ?? (type !== undefined && !data.enabled)

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{name}</h2>
          <Badge variant="secondary">
            {data.configIssues ? "Settings invalid" : data.status ? STATUS_LABELS[data.status] : "Not saved"}
          </Badge>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => changeSettingsOpen(true)}>
            {data.enabled ? "Settings" : "Set up run"}
          </Button>
        </div>
        {data.configIssues && (
          <div role="alert" className="space-y-2 rounded-md border border-destructive p-3 text-sm">
            <p>
              {name}&apos;s stored settings are invalid, so it&apos;s hidden from the public pages. Open Settings and save to
              replace them. The form starts from the defaults, so copy over anything you want to keep.
            </p>
            <ul className="list-disc pl-5">
              {data.configIssues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
            <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">
              {JSON.stringify(data.storedConfig, null, 2)}
            </pre>
          </div>
        )}
        {!data.enabled && (
          <p role="note" className="rounded-md border border-border bg-muted p-3 text-sm">
            {name} isn&apos;t saved yet. Set it up, then click Turn on run.
          </p>
        )}
        {data.status === "upcoming" && data.picksOpenAt && (
          <p className="text-sm text-muted-foreground">
            People can join now. Picks open {instantLabel(data.picksOpenAt, data.config.lock.timeZone)}.
          </p>
        )}
        {/* While the settings are open, a failure shows inside them. */}
        {actionError && !showSettings && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
      </section>

      {data.overview && <FantasyOverviewPanel overview={data.overview} people={data.managers} />}

      <Dialog open={showSettings} onOpenChange={changeSettingsOpen}>
        <DialogContent
          className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-3xl"
          // A stray click outside, or on a toast, shouldn't throw away what's been typed.
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader className="border-b px-6 py-4 text-left">
            <DialogTitle>{name} settings</DialogTitle>
            <DialogDescription>
              These apply to this run only. Other runs keep their own.
              {data.hasLineups &&
                " Lineups exist: changes re-score every Week straight away, and the closing day can't change."}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-6 pt-4">
            {actionError && <p role="alert" className="mb-4 text-sm text-destructive">{actionError}</p>}
            <FantasyConfigForm
              // Starts the form again from what was stored whenever that changes.
              key={JSON.stringify(data.config)}
              initial={data.enabled ? data.config : startingConfig(type ?? contest, data.config)}
              enabled={data.enabled}
              hasLineups={data.hasLineups}
              hasPredictions={data.hasPredictions}
              // While repairing, the form's day is only a default, so it has to stay editable to match the Lineups.
              fixedClosingDay={data.hasLineups && !data.configIssues}
              onDirtyChange={(dirty) => {
                unsaved.current = dirty
              }}
              onSave={saveSettings}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
