"use client"

import { useState, type FormEvent } from "react"
import useSWR from "swr"
import { LiveVideoPlayer } from "@/components/video/live-video-player"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { CameraSide, VideoDetail, VideoSession } from "@/lib/video/types"

class VideoError extends Error {
  constructor(public status: number) { super(status === 401 ? "Enter your recording PIN to continue." : "Couldn’t load recordings. Please retry.") }
}
async function read(url: string, body?: unknown) {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined)
  if (!response.ok) throw new VideoError(response.status)
  return response.json()
}
function time(value: string) {
  return new Date(value).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })
}

export function TestRecordings() {
  const { data, error, mutate, isLoading } = useSWR<{ sessions: VideoSession[] }>("/api/bash/video", read, { refreshInterval: 10000, shouldRetryOnError: false })
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
    } catch { setLoginError("Couldn’t sign in. Check your PIN and try again.") }
    finally { setSigningIn(false) }
  }
  if (error?.status === 401) return <form onSubmit={login} className="mt-8 max-w-sm space-y-4">
    <label htmlFor="recording-pin" className="text-sm font-medium">Recording PIN</label>
    <Input id="recording-pin" type="password" autoComplete="current-password" value={pin} onChange={e => setPin(e.target.value)} required />
    <p className="text-sm text-muted-foreground">Use the same PIN as the iPhone app.</p>
    {loginError && <p role="alert" className="text-sm text-destructive">{loginError}</p>}
    <Button disabled={signingIn}>{signingIn ? "Signing in…" : "View recordings"}</Button>
  </form>
  if (error) return <div role="alert" className="mt-8 space-y-3"><p>{error.message}</p><Button onClick={() => void mutate()}>Retry</Button></div>
  if (isLoading) return <p role="status" className="mt-8 text-muted-foreground">Loading recordings…</p>
  if (!data?.sessions.length) return <p className="mt-8 text-muted-foreground">No recordings yet. Open the iPhone app and start recording.</p>
  const id = data.sessions.some(s => s.id === selected) ? selected : data.sessions[0].id
  return <div className="mt-6 space-y-6">
    <div className="max-w-md space-y-2">
      <label htmlFor="recording-session" className="text-sm font-medium">Recording</label>
      <select id="recording-session" value={id} onChange={e => setSelected(e.target.value)} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
        {data.sessions.map(s => <option key={s.id} value={s.id}>{s.capture_day ?? time(s.created_at)} · {s.title}</option>)}
      </select>
    </div>
    <Recording key={id} id={id} />
  </div>
}

function Recording({ id }: { id: string }) {
  const { data, error, mutate } = useSWR<VideoDetail>(`/api/bash/video/${id}`, read, { refreshInterval: 10000, shouldRetryOnError: false })
  if (error) return <div role="alert"><p>{error.message}</p><Button onClick={() => void mutate()}>Retry</Button></div>
  if (!data) return <p role="status">Loading recording…</p>
  return <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
    {(["left", "right"] as const).map(side => <Camera key={side} side={side} detail={data} />)}
  </div>
}

function Camera({ side, detail }: { side: CameraSide; detail: VideoDetail }) {
  const camera = detail.cameras.find(c => c.side === side)
  const live = !detail.session.ended_at && !!camera?.stream_input_id && camera.streaming && !!camera.last_seen_at && Date.now() - Date.parse(camera.last_seen_at) < 25000
  const clips = detail.segments.filter(s => s.side === side && s.uploaded_at)
  const pending = detail.segments.filter(s => s.side === side && !s.uploaded_at).length
  const [selected, setSelected] = useState<string | null>(null)
  const choice = selected === "live" && live ? "live" : clips.some(c => c.id === selected) ? selected : live ? "live" : clips.at(-1)?.id
  const label = `${side === "left" ? "Left" : "Right"} camera`
  const endpoint = `/api/bash/video/${detail.session.id}`
  const { data, error, mutate } = useSWR<{ url: string }>(choice ? [endpoint, choice, side] : null,
    () => read(endpoint, choice === "live" ? { action: "livePlayback", side } : { action: "playback", segmentId: choice }),
    { revalidateOnFocus: false, shouldRetryOnError: false, refreshInterval: 45 * 60 * 1000 })
  return <section aria-label={label} className="min-w-0 overflow-hidden rounded-xl border border-border">
    <div className="flex items-center justify-between p-3 text-sm font-medium"><h2>{label}</h2>{live && <span className="text-red-600">● Live</span>}</div>
    <div className="relative aspect-video bg-black text-white">
      {error ? <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center text-sm"><p>Video unavailable.</p><Button variant="secondary" className="mt-2" onClick={() => void mutate()}>Retry</Button></div>
        : data && choice ? choice === "live" ? <LiveVideoPlayer key={data.url} label={label} url={data.url} />
          : <video key={data.url} src={data.url} aria-label={label} controls playsInline preload="metadata" className="h-full w-full" onEnded={() => {
            const index = clips.findIndex(c => c.id === choice)
            if (clips[index + 1]) setSelected(clips[index + 1].id)
          }} />
        : <p role="status" className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-white/70">{choice ? "Loading video…" : pending ? "Upload in progress…" : "Waiting for this camera"}</p>}
    </div>
    <div className="space-y-2 p-3">
      <label htmlFor={`clip-${side}`} className="text-xs text-muted-foreground">{clips.length} uploaded {clips.length === 1 ? "clip" : "clips"}{pending ? ` · ${pending} uploading` : ""}</label>
      {(clips.length > 0 || live) && <select id={`clip-${side}`} aria-label={`${label} playback`} value={choice ?? ""} onChange={e => setSelected(e.target.value)} className="h-11 w-full rounded-md border border-input bg-background px-2 text-sm">
        {live && <option value="live">Watch live</option>}
        {clips.map(c => <option key={c.id} value={c.id}>{time(c.started_at)} · {Math.round(c.duration)}s</option>)}
      </select>}
    </div>
  </section>
}
