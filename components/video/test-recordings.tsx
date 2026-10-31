"use client"

import { useState, type FormEvent } from "react"
import useSWR from "swr"
import { CalendarDays, Radio, Video, Film } from "lucide-react"
import { LiveVideoPlayer } from "@/components/video/live-video-player"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { readApiJson } from "@/lib/api-errors"
import type { CameraSide } from "@/lib/video/types"
import type { RecordingDay, RecordingDayDetail, RecordingClip } from "@/lib/video/recordings"

class VideoError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
async function read(url: string, body?: unknown) {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined)
  const data = await readApiJson(response)
  if (!response.ok) throw new VideoError(response.status, data.error)
  return data
}
const endpoint = "/api/bash/recordings"
const polling = { refreshInterval: 10000, shouldRetryOnError: false }
function dateLabel(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", year: "numeric" })
}
function time(value: string) {
  return new Date(value).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", second: "2-digit" })
}
function duration(seconds: number) {
  return seconds < 60 ? `${Math.round(seconds)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

export function TestRecordings() {
  const { data, error, mutate, isLoading } = useSWR<{ days: RecordingDay[] }>(endpoint, read, polling)
  const [selected, setSelected] = useState("")
  const [pin, setPin] = useState("")
  const [signingIn, setSigningIn] = useState(false)
  const [loginError, setLoginError] = useState("")
  async function login(event: FormEvent) {
    event.preventDefault()
    setSigningIn(true)
    setLoginError("")
    try {
      await read("/api/bash/admin/login", { pin: pin.trim() })
      setPin("")
      await mutate()
    } catch (error) { setLoginError(error instanceof Error ? error.message : "Couldn’t sign in. Please try again.") }
    finally { setSigningIn(false) }
  }
  if (error?.status === 401) return <form onSubmit={login} className="mt-8 max-w-sm space-y-4 rounded-xl border border-border p-5">
    <label htmlFor="recording-pin" className="text-sm font-medium">Recording PIN</label>
    <Input id="recording-pin" type="password" autoComplete="current-password" value={pin} onChange={e => setPin(e.target.value)} required />
    <p className="text-sm text-muted-foreground">Use the league operator PIN to view the cameras and recordings.</p>
    {loginError && <p role="alert" className="text-sm text-destructive">{loginError}</p>}
    <Button disabled={signingIn}>{signingIn ? "Signing in…" : "View recordings"}</Button>
  </form>
  if (error) return <div role="alert" className="mt-8 space-y-3"><p>{error.message}</p><Button onClick={() => void mutate()}>Retry</Button></div>
  if (isLoading) return <p role="status" className="mt-8 text-muted-foreground">Loading recordings…</p>
  if (!data?.days.length) return <p className="mt-8 text-muted-foreground">No recordings yet. Open the iPhone app and start recording.</p>
  const day = data.days.find(d => d.day === selected) ?? data.days.find(d => d.live || d.uploaded > 0) ?? data.days[0]
  return <div className="mt-8 grid min-w-0 gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
    <nav aria-label="Recording days" className="min-w-0 space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-medium"><CalendarDays className="size-4" /> Recording days</h2>
      <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-col">
        {data.days.map(d => <button key={d.day} onClick={() => setSelected(d.day)} aria-current={day.day === d.day ? "date" : undefined}
          className={`min-w-48 shrink-0 rounded-lg border p-3 text-left transition-colors lg:min-w-0 ${day.day === d.day ? "border-foreground/30 bg-muted" : "border-border hover:bg-muted/50"}`}>
          <span className="block text-sm font-medium">{dateLabel(d.day)}</span>
          <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">{d.live && <span className="flex items-center gap-1"><Radio className="size-3" /> Live ·</span>}{d.uploaded} {d.uploaded === 1 ? "clip" : "clips"}{!d.uploaded && !d.live ? " · No uploads" : ""}</span>
        </button>)}
      </div>
      <p className="text-xs text-muted-foreground">All times Pacific. Updates every 10 seconds.</p>
    </nav>
    <div className="min-w-0 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-xl font-semibold">{dateLabel(day.day)}</h2><p className="mt-1 text-sm text-muted-foreground">{day.uploaded} uploaded clips · {duration(day.seconds)} across both cameras{day.pending ? ` · ${day.pending} awaiting upload` : ""}</p></div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{day.live ? "Live cameras available" : "Cameras offline"}</span>
      </header>
      <Recording key={day.day} day={day.day} />
    </div>
  </div>
}

function Recording({ day }: { day: string }) {
  const { data, error, mutate } = useSWR<RecordingDayDetail>(`${endpoint}?day=${day}`, read, polling)
  if (error) return <div role="alert" className="space-y-3"><p>{error.message}</p><Button onClick={() => void mutate()}>Retry</Button></div>
  if (!data) return <p role="status">Loading recording…</p>
  return <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
    {(["left", "right"] as const).map(side => <Camera key={side} side={side} detail={data} />)}
  </div>
}

function Camera({ side, detail }: { side: CameraSide; detail: RecordingDayDetail }) {
  const camera = detail.cameras.find(c => c.side === side && c.live)
  const clips = detail.segments.filter(s => s.side === side && s.uploaded_at)
  const pending = detail.segments.filter(s => s.side === side && !s.uploaded_at).length
  const [selected, setSelected] = useState<string | null>(null)
  const choice = selected === "live" && camera ? "live" : clips.some(c => c.id === selected) ? selected : camera ? "live" : clips[0]?.id
  const label = `${side === "left" ? "Left" : "Right"} camera`
  return <section aria-label={label} className="min-w-0 overflow-hidden rounded-xl border border-border">
    <div className="flex items-center justify-between p-4 text-sm font-medium"><h3 className="flex items-center gap-2"><Video className="size-4 text-muted-foreground" />{label}</h3><span className="text-xs text-muted-foreground">{camera ? "● Live" : "Offline"}</span></div>
    <Playback key={`${choice}:${camera?.session_id ?? ""}`} choice={choice} sessionId={camera?.session_id} side={side} label={label} clips={clips} onNext={setSelected} pending={pending} />
    <div className="space-y-3 p-4">
      {camera && <Button variant={choice === "live" ? "secondary" : "outline"} className="w-full" onClick={() => setSelected("live")}><Radio className="mr-2 size-4" />Watch live</Button>}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><h4 className="flex items-center gap-1.5"><Film className="size-3.5" />{clips.length} saved clips</h4>{pending > 0 && <span>{pending} awaiting upload</span>}</div>
      {clips.length ? <div className="max-h-72 space-y-1 overflow-y-auto" aria-label={`${label} saved clips`}>
        {clips.map(c => <button key={c.id} onClick={() => setSelected(c.id)} aria-pressed={choice === c.id} className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-sm ${choice === c.id ? "bg-muted font-medium" : "hover:bg-muted/50"}`}><span>{time(c.started_at)}</span><span className="text-xs text-muted-foreground">{duration(c.duration)}</span></button>)}
      </div> : <p className="py-3 text-sm text-muted-foreground">No saved footage for this camera yet.</p>}
    </div>
  </section>
}

function Playback({ choice, sessionId, side, label, clips, onNext, pending }: {
  choice: string | null | undefined; sessionId?: string; side: CameraSide; label: string; clips: RecordingClip[]; onNext: (id: string) => void; pending: number
}) {
  const [mediaError, setMediaError] = useState(false)
  const { data, error, mutate } = useSWR<{ url: string }>(choice ? [endpoint, choice, sessionId, side] : null,
    () => read(endpoint, choice === "live" ? { action: "livePlayback", sessionId, side } : { action: "playback", segmentId: choice }),
    { revalidateOnFocus: false, shouldRetryOnError: false, refreshInterval: 45 * 60 * 1000 })
  return <div className="relative aspect-video bg-black text-white">
    {error || mediaError ? <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-sm"><p>{mediaError ? "This browser could not play the clip. Try Safari or open the original." : error.message}</p>{data?.url && <a href={data.url} target="_blank" rel="noreferrer" className="underline">Open original</a>}<Button variant="secondary" onClick={() => { setMediaError(false); void mutate() }}>Retry</Button></div>
      : data && choice ? choice === "live" ? <LiveVideoPlayer label={label} url={data.url} />
        : <video key={data.url} src={data.url} aria-label={`${label} recording`} controls playsInline preload="metadata" className="h-full w-full" onError={() => setMediaError(true)} onEnded={() => {
          const index = clips.findIndex(c => c.id === choice)
          if (clips[index + 1]) onNext(clips[index + 1].id)
        }} />
      : <p role="status" className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-white/70">{choice ? "Loading video…" : pending ? "Waiting for uploads to finish" : "No footage recorded"}</p>}
  </div>
}
