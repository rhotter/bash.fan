"use client"

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import useSWR from "swr"
import { Play, Radio } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LiveVideoPlayer } from "@/components/video/live-video-player"
import { findReplay, type CameraSide, type GameVideoData, type VideoMarker } from "@/lib/video/types"

async function read(url: string, body?: unknown) {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? "Video could not load")
  return data
}
type Playback = { url: string; seconds: number; live?: boolean; label: string }
type VideoContext = {
  enabled: boolean; gameId: string; gameTitle: string; data?: GameVideoData;
  side: CameraSide; setSide: (side: CameraSide) => void; selectSession: (id: string) => void;
  playback: Playback | null; busy: boolean; error: string; refresh: () => void;
  play: (marker?: VideoMarker) => void; watchLive: () => void;
}
const Context = createContext<VideoContext | null>(null)

export function GameVideoProvider({ gameId, gameTitle, enabled, children }: { gameId: string; gameTitle: string; enabled: boolean; children: ReactNode }) {
  const [sessionId, setSessionId] = useState("")
  const endpoint = `/api/bash/game/${encodeURIComponent(gameId)}/video`
  const { data, error: loadError, mutate } = useSWR<GameVideoData>(enabled ? `${endpoint}${sessionId ? `?session=${encodeURIComponent(sessionId)}` : ""}` : null, read, { refreshInterval: 15000 })
  const [side, setSide] = useState<CameraSide>("left")
  const [playback, setPlayback] = useState<Playback | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const requestId = useRef(0)
  useEffect(() => () => { requestId.current++ }, [])
  const selectSide = (value: CameraSide) => { requestId.current++; setBusy(false); setSide(value); setPlayback(null); setError("") }
  const selectSession = (value: string) => { requestId.current++; setBusy(false); setSessionId(value); setPlayback(null); setError("") }
  async function open(live: boolean, marker?: VideoMarker) {
    if (!data?.session) return
    const request = ++requestId.current
    setBusy(true); setError("")
    try {
      let chosenSide = side
      let seconds = 0
      let segmentId: string | undefined
      if (!live) {
        const replayFor = (s: CameraSide) => marker ? findReplay(data.segments, s, Date.parse(marker.occurred_at), data.cameras.find(c => c.side === s)?.offset_ms ?? 0) : null
        const replay = replayFor(side) ?? replayFor(side === "left" ? "right" : "left")
        const segment = marker ? replay?.segment : data.segments.find(s => s.side === side) ?? data.segments[0]
        if (!segment) throw new Error("No uploaded recording covers this moment yet.")
        chosenSide = segment.side; segmentId = segment.id; seconds = replay?.seconds ?? 0
      }
      const result = await read(endpoint, live
        ? { action: "livePlayback", sessionId: data.session.id, side }
        : { action: "playback", sessionId: data.session.id, segmentId })
      if (request !== requestId.current) return
      setSide(chosenSide)
      setPlayback({ url: result.url, seconds, live, label: marker?.label ?? (live ? "Live game" : "Game recording") })
    } catch (e) { if (request === requestId.current) setError(e instanceof Error ? e.message : "Video could not load") }
    finally { if (request === requestId.current) setBusy(false) }
  }
  return <Context.Provider value={{ enabled, gameId, gameTitle, data, side, setSide: selectSide, selectSession,
    playback, busy, error: error || loadError?.message || "", refresh: () => { void mutate() },
    play: marker => { void open(false, marker) }, watchLive: () => { void open(true) } }}>{children}</Context.Provider>
}

export function GoalReplayButton({ goalId }: { goalId: string }) {
  const video = useContext(Context)
  const marker = video?.data?.markers.find(m => m.goalId === goalId)
  const covered = marker && video?.data?.cameras.some(c => findReplay(video.data!.segments, c.side, Date.parse(marker.occurred_at), c.offset_ms))
  if (!video || !marker || !covered) return null
  return <button aria-label="Watch goal replay" title="Watch goal replay" disabled={video.busy} onClick={() => video.play(marker)} className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold text-primary hover:bg-muted disabled:opacity-50"><Play className="size-3" /><span className="hidden sm:inline">Replay</span></button>
}

export function GameVideo() {
  const context = useContext(Context)
  const section = useRef<HTMLElement>(null)
  const playback = context?.playback
  useEffect(() => {
    if (playback) section.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [playback])
  if (!context?.enabled) return null
  const { data, side, busy, error } = context
  if (!data?.session) return null
  const live = data?.cameras.find(c => c.side === side)?.live
  return <section ref={section} id="game-video" aria-label="Game video" className="mt-4 space-y-3 rounded-lg border border-border/60 p-3">
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="mr-auto text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Game video</h2>
      {data && data.sessions.length > 1 && <select aria-label="Game recording" value={data.session?.id ?? ""} onChange={e => context.selectSession(e.target.value)} className="h-8 max-w-56 rounded-md border bg-background px-2 text-xs">{data.sessions.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select>}
      {!!data?.segments.length && <Button size="sm" variant="outline" disabled={busy} onClick={() => context.play()}><Play className="size-3" /> Watch recording</Button>}
      {live && <Button size="sm" variant="outline" disabled={busy} onClick={context.watchLive}><Radio className="size-3 text-red-600" /> Watch live</Button>}
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error} <button className="underline" onClick={context.refresh}>Retry</button></p>}
    {data?.session && <div className="flex flex-wrap items-center gap-2">
      {(["left", "right"] as const).filter(s => data.cameras.some(c => c.side === s)).map(s => <button key={s} aria-pressed={side === s} onClick={() => context.setSide(s)} className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold capitalize ${side === s ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted"}`}>{s} camera</button>)}
      <span className="text-[11px] text-muted-foreground">{data.segments.length ? data.session.title : live ? "Live broadcast available." : "Recording will appear here when uploaded."}</span>
    </div>}
    {playback && <div className="overflow-hidden rounded-md bg-zinc-950">
      <div className="relative aspect-video">
        {playback.live ? <LiveVideoPlayer key={playback.url} label={playback.label} url={playback.url} /> : <RecordedVideo key={playback.url} playback={playback} />}
      </div>
      <p className="px-3 py-2 text-xs text-white/70">{playback.label} · {side} camera</p>
    </div>}
    {!!data?.markers.filter(m => !m.goalId).length && <div className="flex flex-wrap gap-2">{data.markers.filter(m => !m.goalId).map(m => <Button key={m.id} size="sm" variant="ghost" disabled={busy} onClick={() => context.play(m)}><Play className="size-3" />{m.label}</Button>)}</div>}
  </section>
}

function RecordedVideo({ playback }: { playback: Playback }) {
  const player = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  return <>
    <video ref={player} src={playback.url} aria-label={playback.label} controls playsInline className="h-full w-full" onError={() => setFailed(true)} onLoadedMetadata={() => {
      if (player.current) { player.current.currentTime = playback.seconds; void player.current.play().catch(() => {}) }
    }} />
    {failed && <p role="alert" className="absolute inset-x-3 top-3 rounded bg-black/80 p-3 text-xs text-white">This recording could not play. Try Safari for HEVC footage or reopen the recording.</p>}
  </>
}
