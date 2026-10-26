"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { fetchApi, readApiJson } from "@/lib/api-errors"
import { IntentLink } from "@/components/intent-link"

type Entry = { id: string; phase: string; recorded_at: string; restored_from: string | null; restorable: boolean;
  game: { home_score: number | null; away_score: number | null; status: string } | null }
export function GameScoreHistory({ gameId }: { gameId: string }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [latestId, setLatestId] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<Entry | null>(null)
  const load = useCallback(async (cursor?: string) => {
    setBusy(true); setError("")
    try {
      const response = await fetchApi(`/api/bash/admin/games/${gameId}/history${cursor ? `?before=${cursor}` : ""}`)
      if (!response.ok) throw new Error((await readApiJson(response)).error)
      const data = await response.json()
      setEntries(previous => cursor ? [...previous, ...data.entries] : data.entries)
      if (!cursor) setLatestId(data.latestId)
      setHasMore(data.entries.length === 50)
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load history") }
    finally { setBusy(false) }
  }, [gameId])
  useEffect(() => { void load() }, [load])
  async function restore() {
    if (!selected || !latestId) return
    setBusy(true); setError("")
    try {
      const response = await fetchApi(`/api/bash/admin/games/${gameId}/history`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ historyId: selected.id, expectedLatestId: latestId }) })
      if (!response.ok) throw new Error((await readApiJson(response)).error)
      window.location.assign(`/game/${gameId}`)
    } catch (e) { setError(e instanceof Error ? e.message : "Could not restore this version"); setBusy(false) }
  }
  return <main className="mx-auto w-full max-w-2xl space-y-5 p-4 sm:p-6">
    <IntentLink href={`/game/${gameId}`} className="text-sm text-muted-foreground underline">Back to game</IntentLink>
    <div><h1 className="text-xl font-semibold">Score history</h1>
      <p className="mt-2 text-sm text-muted-foreground">Saved scores, scoring events, player and goalie stats, officials, and game rosters. Times are Pacific. Restoring creates a new history entry and requires other editors to reload.</p></div>
    <Button variant="outline" disabled={busy} onClick={() => { setSelected(null); void load() }}>Refresh history</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {selected && <section aria-label="Confirm score restoration" className="space-y-3 rounded-lg border border-border bg-muted p-4">
      <h2 className="font-medium">Restore version {selected.id}?</h2>
      <p className="text-sm">This will replace the current score and boxscore with this saved version: away {selected.game?.away_score ?? "–"}, home {selected.game?.home_score ?? "–"} ({selected.game?.status}). The current version remains in history.</p>
      <div className="flex gap-2"><Button disabled={busy} onClick={() => void restore()}>{busy ? "Restoring…" : "Restore version"}</Button>
        <Button variant="outline" disabled={busy} onClick={() => setSelected(null)}>Cancel</Button></div>
    </section>}
    {!entries.length && <p className="text-sm text-muted-foreground">{busy ? "Loading history…" : "No saved changes yet. History starts when this protection is installed."}</p>}
    <ol className="space-y-3">{entries.map(entry => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
      <div className="space-y-1"><p className="text-sm font-medium">Away {entry.game?.away_score ?? "–"} · Home {entry.game?.home_score ?? "–"} <span className="text-muted-foreground">({entry.game?.status ?? "No game"})</span></p>
        <p className="text-xs text-muted-foreground">{new Date(entry.recorded_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} · {entry.phase === "before" ? "Before change" : "After change"} · Version {entry.id}</p>
        {entry.restored_from && <p className="text-xs text-muted-foreground">Restoration of version {entry.restored_from}</p>}
        {!entry.restorable && <p className="text-xs text-muted-foreground">Incomplete snapshot — cannot restore</p>}
      </div><Button variant="outline" size="sm" disabled={busy || !entry.restorable} onClick={() => setSelected(entry)}>Restore…</Button>
    </li>)}</ol>
    {hasMore && <Button variant="outline" disabled={busy} onClick={() => void load(entries.at(-1)?.id)}>Older changes</Button>}
  </main>
}
