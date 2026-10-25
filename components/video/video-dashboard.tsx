"use client"

import { useRef, useState } from "react"
import useSWR from "swr"
import { Camera, Circle, CloudUpload, Film, Flag, Link2, Play, Plus, Radio, RefreshCw, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LiveVideoPlayer } from "@/components/video/live-video-player"
import { findReplay, type CameraSide, type VideoDetail, type VideoMarker, type VideoSession } from "@/lib/video/types"

async function read<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? "Request failed")
  return data
}
type Index = { sessions: VideoSession[]; games: { id: string; date: string; home_team: string; away_team: string }[]; configured: { r2: boolean; stream: boolean } }
const formatDate = (date: string) => new Date(date).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
const size = (bytes: number) => bytes < 1e9 ? `${(bytes / 1e6).toFixed(1)} MB` : `${(bytes / 1e9).toFixed(2)} GB`

export function VideoDashboard() {
  const index = useSWR<Index>("/api/bash/video", read, { refreshInterval: 10000 })
  const [selected, setSelected] = useState<string | null>(null)
  const activeId = selected ?? index.data?.sessions[0]?.id
  const detail = useSWR<VideoDetail>(activeId ? `/api/bash/video/${activeId}` : null, read, { refreshInterval: 5000 })
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState("")
  const [gameId, setGameId] = useState("")
  const [side, setSide] = useState<CameraSide>("left")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [pairLink, setPairLink] = useState("")
  const [playback, setPlayback] = useState<{ url: string; seconds: number; label: string; live?: boolean } | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const data = detail.data
  const ended = !!data?.session.ended_at
  const totalBytes = data?.segments.filter(s => s.uploaded_at).reduce((sum, s) => sum + Number(s.bytes), 0) ?? 0
  const uploaded = data?.segments.filter(s => s.uploaded_at).length ?? 0

  async function run(fn: () => Promise<void>) {
    setError(""); setNotice(""); setBusy(true)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong") }
    finally { setBusy(false) }
  }
  async function action<T = { ok: boolean }>(body: unknown) {
    const result = await read<T>(`/api/bash/video/${activeId}`, body)
    await detail.mutate()
    return result
  }
  async function playMarker(marker: VideoMarker, cameraSide = side) {
    if (!data) return
    const offset = data.cameras.find(c => c.side === cameraSide)?.offset_ms ?? 0
    const replay = findReplay(data.segments, cameraSide, Date.parse(marker.occurred_at), offset)
    if (!replay) throw new Error("No uploaded footage covers this moment on this camera. Check its timing offset or wait for the upload.")
    const result = await action<{ url: string }>({ action: "playback", segmentId: replay.segment.id })
    setPlayback({ url: result.url, seconds: replay.seconds, label: marker.label })
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-xl font-bold tracking-tight md:text-2xl">Video</h1><p className="mt-1 text-xs text-muted-foreground">Game recordings, live views, and replays.</p></div>
      <Button size="sm" variant="outline" onClick={() => setCreating(!creating)}><Plus className="mr-2 size-4" /> New recording</Button>
    </div>
    {(error || index.error || detail.error) && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">{error || index.error?.message || detail.error?.message}<Button variant="ghost" size="sm" onClick={() => { void index.mutate(); void detail.mutate() }}><RefreshCw className="mr-1 size-3" /> Retry</Button></div>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    {index.data && (!index.data.configured.r2 || !index.data.configured.stream) && <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
      <span className="font-medium">Provider setup</span><span className={index.data.configured.r2 ? "text-green-700" : "text-muted-foreground"}>R2 {index.data.configured.r2 ? "configured" : "credentials needed"}</span>
      <span className={index.data.configured.stream ? "text-green-700" : "text-muted-foreground"}>Stream {index.data.configured.stream ? "configured" : "credentials needed"}</span>
      <span className="text-xs text-muted-foreground">You can create sessions and pair cameras now. Uploads and livestreams need provider setup.</span></div>}
    {creating && <form className="grid gap-3 rounded-lg border bg-card p-5 md:grid-cols-[1fr_1fr_auto]" onSubmit={e => { e.preventDefault(); void run(async () => {
      const result = await read<{ session: VideoSession }>("/api/bash/video", { title, gameId: gameId || null })
      setSelected(result.session.id); setCreating(false); setTitle(""); setPlayback(null); setPairLink(""); await index.mutate()
    }) }}>
      <label className="space-y-1 text-xs font-medium">Recording title<Input required maxLength={120} placeholder="Saturday at The Lick" value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label className="space-y-1 text-xs font-medium">Link a game<select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={gameId} onChange={e => setGameId(e.target.value)}><option value="">Practice / camera test</option>{index.data?.games.map(g => <option key={g.id} value={g.id}>{g.date} · {g.away_team} at {g.home_team}</option>)}</select></label>
      <Button className="self-end" disabled={busy || !title.trim()}>Create session</Button>
    </form>}
    {!index.data && !index.error && <p className="py-16 text-center text-muted-foreground">Loading recordings…</p>}
    {index.data?.sessions.length === 0 && <div className="rounded-lg border border-dashed py-20 text-center"><Film className="mx-auto mb-4 size-10 text-primary" /><h2 className="text-lg font-semibold">Your first game starts here</h2><p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">Create a recording, pair the two iPhones, and keep every play in view.</p><Button className="mt-5" onClick={() => setCreating(true)}>Set up a recording</Button></div>}
    {!!index.data?.sessions.length && <div className="space-y-5">
      <nav aria-label="Recordings" className="flex gap-1 overflow-x-auto border-b border-border/60 pb-3">
        {index.data.sessions.map(session => <button key={session.id} aria-current={activeId === session.id ? "true" : undefined} onClick={() => { setSelected(session.id); setPlayback(null); setPairLink(""); setError("") }} className={`shrink-0 max-w-72 truncate rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${activeId === session.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} title={`${session.title} · ${formatDate(session.created_at)}`}>
          {session.title}
        </button>)}
      </nav>
      {data && <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-bold tracking-tight md:text-lg">{data.session.title}</h2><p className="text-xs text-muted-foreground">{formatDate(data.session.created_at)} · {ended ? "Completed" : "Session open"} · {uploaded} {uploaded === 1 ? "clip" : "clips"} · {size(totalBytes)} saved</p></div>{!ended && <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async () => { await action({ action: "end" }); await index.mutate(); setNotice("Session ended. Connected cameras stop on their next check-in; pending uploads can finish.") })}>End session</Button>}</div>
        <section className="grid overflow-hidden rounded-lg border border-border/70 bg-card lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-3 py-2"><div className="flex gap-1">{(["left", "right"] as const).map(s => <Button key={s} size="sm" variant={side === s ? "secondary" : "ghost"} onClick={() => { setSide(s); setPlayback(null) }} aria-pressed={side === s} className="h-7 text-[11px] font-semibold capitalize">{s} view</Button>)}</div><Button size="sm" variant="outline" disabled={busy || !data.cameras.find(c => c.side === side)?.stream_input_id} onClick={() => void run(async () => { const result = await action<{ url: string }>({ action: "livePlayback", side }); setPlayback({ url: result.url, seconds: 0, label: "Live preview", live: true }) })}><Radio className="mr-2 size-3" /> Watch live</Button></div>
          <div className="relative flex aspect-video items-center justify-center bg-zinc-950 text-white">
            {playback ? playback.live ? <LiveVideoPlayer key={playback.url} label={`${side} livestream`} url={playback.url} /> : <video ref={video} key={playback.url} src={playback.url} controls playsInline className="h-full w-full" onLoadedMetadata={() => { if (video.current) { video.current.currentTime = playback.seconds; void video.current.play().catch(() => {}) } }} onError={() => setError("This recording could not play. Try Safari for HEVC recordings, or refresh its playback link.")} /> : <div className="px-5 text-center"><Film className="mx-auto mb-3 size-8 text-white/40" /><p className="text-sm font-medium">Game replay</p><p className="mt-1 text-xs text-white/50">Choose a moment below, or open the live view.</p></div>}
          </div>
          </div>
          <div className="border-t border-border/60 p-3 lg:border-l lg:border-t-0"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">Game moments</h3><Button size="sm" variant="outline" disabled={busy || ended} onClick={() => void run(async () => { await action({ action: "marker", label: "Highlight", occurredAt: new Date().toISOString() }) })}><Flag className="mr-1 size-3" /> Mark now</Button></div>
            {!data.markers.length && <p className="py-4 text-sm text-muted-foreground">Goals from the linked scorekeeper appear here. You can also mark a highlight as it happens.</p>}
            <div className="max-h-96 divide-y divide-border/60 overflow-y-auto">{data.markers.map(marker => <button key={marker.id} disabled={busy} onClick={() => void run(() => playMarker(marker))} className="flex w-full items-center gap-3 py-3 text-left hover:text-primary"><Play className="size-4 text-primary" /><div className="flex-1"><p className="text-sm font-medium">{marker.label}</p><p className="text-xs text-muted-foreground">{marker.source === "scorekeeper" ? "Goal" : "Highlight"}</p></div><span className="font-mono text-[10px] tabular-nums text-muted-foreground">{new Date(marker.occurred_at).toLocaleTimeString()}</span></button>)}</div>
          </div>
        </section>
        <details className="group rounded-lg border border-border/70 bg-card" open={!data.cameras.length}>
          <summary className="cursor-pointer px-3 py-3 text-xs font-semibold">Camera setup <span className="ml-2 font-normal text-muted-foreground">Pair phones and adjust timing</span></summary>
          <div className="space-y-3 border-t border-border/60 p-3">
        <div className="grid gap-3 sm:grid-cols-2">{(["left", "right"] as const).map(cameraSide => {
          const camera = data.cameras.find(c => c.side === cameraSide)
          const online = !!camera?.last_seen_at && Date.now() - Date.parse(camera.last_seen_at) < 25000
          return <div key={cameraSide} className="rounded-md border border-border/60 p-3">
            <div className="flex items-center justify-between"><div className="flex items-center gap-2 font-semibold"><Camera className="size-4 text-muted-foreground" /><span className="capitalize">{cameraSide} camera</span></div><span className={`flex items-center gap-1.5 text-xs ${online ? "text-green-700" : "text-muted-foreground"}`}><Circle className="size-2 fill-current" />{online ? "Connected" : camera ? "Offline" : "Not paired"}</span></div>
            <div className="my-3 text-xs"><p className="flex items-center gap-2"><Smartphone className="size-4 text-muted-foreground" />{camera?.device_name ?? "Waiting for an iPhone"}</p><p className="mt-2 text-xs text-muted-foreground">{online && camera?.recording ? "Recording locally" : "Not recording"} · {online && camera?.streaming ? "Publishing live" : "Stream offline"}{online && camera?.battery != null && camera.battery >= 0 ? ` · ${Math.round(camera.battery * 100)}% battery` : ""}</p></div>
            {camera?.error && <p className="mb-3 text-xs text-destructive">{camera.error}</p>}
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy || ended} onClick={() => void run(async () => {
              const result = await action<{ token: string }>({ action: "pair", side: cameraSide })
              const link = `bashcapture://pair?${new URLSearchParams({ server: window.location.origin, session: activeId!, side: cameraSide, token: result.token })}`
              setPairLink(link)
              try { await navigator.clipboard.writeText(link); setNotice(`${cameraSide} setup link copied. Paste it into BASH Capture on the phone. It replaces any previous pairing.`) } catch { setNotice("Copy the setup link below and paste it into BASH Capture.") }
            })}><Link2 className="mr-1 size-3" />{camera ? "Pair again" : "Pair camera"}</Button>
            <Button size="sm" variant="outline" disabled={busy || ended || !camera || !data.configured.stream} onClick={() => void run(async () => { await action({ action: "prepareStream", side: cameraSide }); setNotice("Livestream input ready. Start recording on the phone to publish.") })}>{camera?.stream_input_id ? "Stream ready" : "Prepare live"}</Button></div>
            {camera && <form className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" onSubmit={e => { e.preventDefault(); const input = new FormData(e.currentTarget).get("offset"); void run(async () => { await action({ action: "offset", side: cameraSide, offsetMs: Math.round(Number(input) * 1000) }); setNotice("Camera timing offset saved.") }) }}><label htmlFor={`offset-${cameraSide}`}>Timing offset (s)</label><input id={`offset-${cameraSide}`} name="offset" type="number" step="0.1" min="-3600" max="3600" required defaultValue={camera.offset_ms / 1000} className="w-20 rounded border bg-background p-1 text-foreground" /><button type="submit" className="font-medium text-primary" disabled={busy}>Save</button></form>}
          </div>
        })}</div>
        {pairLink && <div className="rounded-lg border bg-muted/30 p-3"><label className="text-xs font-medium" htmlFor="pair-link">Private camera setup link · expires in 7 days</label><Input id="pair-link" className="mt-2 font-mono text-xs" readOnly value={pairLink} onFocus={e => e.target.select()} /><p className="mt-2 text-xs text-muted-foreground">Use this website’s LAN address or HTTPS dev URL when pairing a physical phone; localhost refers to the phone itself.</p></div>}
          </div>
        </details>
        <section><h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"><CloudUpload className="size-4 text-primary" /> Recording library</h3><div className="max-h-64 divide-y overflow-y-auto rounded-lg border">{data.segments.length ? data.segments.map(segment => <div key={segment.id} className="flex flex-wrap items-center gap-3 p-3 text-xs"><span className="w-10 capitalize font-medium">{segment.side}</span><span>{formatDate(segment.started_at)}</span><span className="text-muted-foreground">{Math.round(segment.duration)}s · {size(Number(segment.bytes))}</span><span className="ml-auto text-muted-foreground">{segment.uploaded_at ? "Saved" : "Upload pending"}</span><button className="text-primary disabled:text-muted-foreground" disabled={!segment.uploaded_at || busy} onClick={() => void run(async () => { const result = await action<{ url: string }>({ action: "playback", segmentId: segment.id }); setSide(segment.side); setPlayback({ url: result.url, seconds: 0, label: "Recording" }) })}>Play</button></div>) : <p className="p-4 text-sm text-muted-foreground">Segments appear when a phone begins uploading. Originals are retained indefinitely.</p>}</div></section>
      </div>}
    </div>}
  </div>
}
