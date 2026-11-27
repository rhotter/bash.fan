"use client"

import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
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
  managers: ManagerPerson[]
  overview: FantasyOverview | null
}

const STATUS_LABELS: Record<RunStatus, string> = { upcoming: "Upcoming", active: "On", "final-week": "Final Week", ended: "Ended" }

export function FantasyAdmin({
  seasonId,
  contest,
  type = contest,
}: {
  seasonId: string
  contest: string
  /** The kind of run being started, for one that isn't on yet. */
  type?: string
}) {
  const base = `/api/bash/admin/seasons/${seasonId}/fantasy`
  const [data, setData] = useState<FantasyData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

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
        setActionError([body.error, ...(Array.isArray(body.issues) ? body.issues : [])].join(" "))
        return null
      }
      await load()
      return body
    } catch (err) {
      setActionError(errorMessage(err))
      return null
    }
  }

  if (loadError) return <ErrorNotice message={loadError} onRetry={load} />
  if (!data) return <LoadingState variant="list" label="Loading Fantasy…" />

  return (
    <div className="space-y-8">
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}

      {data.overview && <FantasyOverviewPanel overview={data.overview} people={data.managers} />}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{contestLabel(contest)} settings</h2>
          <Badge variant="secondary">{data.status ? STATUS_LABELS[data.status] : "Off"}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">These apply to this run only. Other runs keep their own.</p>
        {data.status === "upcoming" && data.picksOpenAt && (
          <p className="text-sm text-muted-foreground">
            People can join now. Picks open {instantLabel(data.picksOpenAt, data.config.lock.timeZone)}.
          </p>
        )}
        {data.hasLineups && (
          <p className="text-sm text-muted-foreground">
            Lineups exist. Changes re-score every Week straight away, and changing the Lock day or time moves which Week each saved Lineup belongs to.
          </p>
        )}
        <FantasyConfigForm
          // Starts the form again from what was stored whenever that changes.
          key={JSON.stringify(data.config)}
          initial={data.enabled ? data.config : startingConfig(type, data.config)}
          enabled={data.enabled}
          hasLineups={data.hasLineups}
          onSave={async (config) => void (await act(base, "PUT", { contest, config }))}
        />
      </section>
    </div>
  )
}
