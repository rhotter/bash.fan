"use client"

import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ErrorNotice } from "@/components/error-notice"
import { LoadingState } from "@/components/loading-state"
import { FantasyOverviewPanel } from "@/components/admin/fantasy-overview"
import { errorMessage, fetchApi, readApiJson } from "@/lib/api-errors"
import type { FantasyOverview } from "@/lib/fetch-fantasy"

interface FantasyData {
  enabled: boolean
  config: unknown
  hasLineups: boolean
  overview: FantasyOverview | null
}

/** A new playoff contest starts from the defaults, but scoring playoff games instead of regular ones.
 * A contest counts as a playoff when its key starts with `playoff`. */
function startingConfig(contest: string, config: unknown) {
  return contest.startsWith("playoff") ? { ...(config as object), gameTypes: ["playoff", "championship"] } : config
}

export function FantasyAdmin({ seasonId, contest }: { seasonId: string; contest: string }) {
  const base = `/api/bash/admin/seasons/${seasonId}/fantasy`
  const [data, setData] = useState<FantasyData | null>(null)
  const [configText, setConfigText] = useState("")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const body: FantasyData = await readApiJson(await fetchApi(`${base}?contest=${encodeURIComponent(contest)}`))
      setData(body)
      setConfigText(JSON.stringify(body.enabled ? body.config : startingConfig(contest, body.config), null, 2))
      setLoadError(null)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }, [base, contest])

  useEffect(() => {
    load()
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

  async function saveConfig() {
    let config: unknown
    try {
      config = JSON.parse(configText)
    } catch (err) {
      setActionError(`The config isn't valid JSON: ${errorMessage(err)}`)
      return
    }
    await act(base, "PUT", { contest, config })
  }

  if (loadError) return <ErrorNotice message={loadError} onRetry={load} />
  if (!data) return <LoadingState variant="list" label="Loading Fantasy…" />

  return (
    <div className="space-y-8">
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}

      {data.overview && <FantasyOverviewPanel overview={data.overview} />}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Season config</h2>
          <Badge variant="secondary">{data.enabled ? "On" : "Off"}</Badge>
        </div>
        {data.hasLineups && (
          <p className="text-sm text-muted-foreground">
            Lineups exist. Changes re-score every Week straight away, and changing the Lock day or time moves which Week each saved Lineup belongs to.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="fantasy-config">Config</Label>
          <Textarea
            id="fantasy-config"
            rows={14}
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            className="font-mono text-xs"
          />
        </div>
        <Button onClick={saveConfig}>{data.enabled ? "Save config" : "Turn on Fantasy"}</Button>
      </section>
    </div>
  )
}
