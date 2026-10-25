"use client"

import { createContext, useContext, useRef, useState, type ReactNode } from "react"
import useSWR from "swr"
import { Maximize2, Play } from "lucide-react"
import { automaticSelections, replaySelections, cameraSides as sides, type PlaybackRequest, type Selection, type Selections } from "@/lib/video/view-selection"
import { LiveVideoPlayer } from "@/components/video/live-video-player"
import { findReplay, type CameraSide, type GameVideoData, type VideoEventKind, type VideoMarker } from "@/lib/video/types"

async function read(url: string, body?: unknown) {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined)
  const data = await response.json()
  if (!response.ok) throw new Error("Video is temporarily unavailable.")
  return data
}
type Playback = { url: string; seconds: number; live: boolean; replayId?: number }
type VideoContext = {
  enabled: boolean; data?: GameVideoData; available: boolean;
  views: Record<CameraSide, View>; busy: boolean;
  play: (marker: VideoMarker) => void;
  finishReplay: () => void;
}
const Context = createContext<VideoContext | null>(null)

type View = { playback: Playback | null; busy: boolean; error: boolean; retry: () => void }
function useView(endpoint: string, selection: Selection | null): View {
  const { data: source, error, isLoading, mutate } = useSWR<{ url: string }>(
    selection ? [endpoint, selection.request] : null,
    ([url, request]: [string, PlaybackRequest]) => read(url, request),
    { revalidateOnFocus: false, revalidateOnReconnect: true },
  )
  return { playback: source && selection ? { url: source.url, seconds: selection.seconds,
    live: selection.request.action === "livePlayback", replayId: selection.replayId } : null,
    busy: isLoading, error: !!error, retry: () => { void mutate() } }
}

export function GameVideoProvider({ gameId, enabled, children }: { gameId: string; enabled: boolean; children: ReactNode }) {
  const endpoint = `/api/bash/game/${encodeURIComponent(gameId)}/video`
  const { data } = useSWR<GameVideoData>(enabled ? endpoint : null, read, { refreshInterval: 15000 })
  const [replay, setReplay] = useState<{ sessionId: string; selections: Selections } | null>(null)
  const replayId = useRef(0)
  const selections = replay && replay.sessionId === data?.session?.id ? replay.selections : automaticSelections(data)
  const left = useView(endpoint, selections.left)
  const right = useView(endpoint, selections.right)
  function play(marker: VideoMarker) {
    if (!data?.session) return
    const selections = replaySelections(data, marker, ++replayId.current)
    if (!selections.left && !selections.right) return
    setReplay({ sessionId: data.session.id, selections })
    document.getElementById("game-video")?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }
  return <Context.Provider value={{ enabled, data, available: !!(selections.left || selections.right),
    views: { left, right }, busy: left.busy || right.busy, play, finishReplay: () => setReplay(null) }}>{children}</Context.Provider>
}

export function EventReplayButton({ eventId, kind }: { eventId: string; kind: VideoEventKind }) {
  const video = useContext(Context)
  const marker = video?.data?.markers.find(m => (m.eventId === eventId && m.eventKind === kind)
    || (kind === "goal" && m.goalId === eventId))
  const covered = marker && video?.data?.cameras.some(c => findReplay(video.data!.segments, c.side, Date.parse(marker.occurred_at), c.offset_ms))
  if (!video?.enabled || !marker || !covered) return null
  return <button type="button" aria-label={`Play ${kind} replay`} title={`Play ${kind} replay`} disabled={video.busy}
    onClick={() => video.play(marker)} className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
    <Play aria-hidden="true" className="size-3.5 fill-current" />
  </button>
}

export function GameVideo() {
  const context = useContext(Context)
  if (!context?.enabled || !context.available) return null
  const primary = context.views.left.playback ? "left" : "right"
  return <section id="game-video" aria-label="Game video" className="mt-4 grid min-w-0 grid-cols-2 gap-1.5 sm:gap-3">
    {sides.map(side => {
      const { playback, busy, error, retry } = context.views[side]
      const label = `${side === "left" ? "Left" : "Right"} camera`
      return <div key={side} className="min-w-0 overflow-hidden rounded-lg border border-border bg-muted/30">
        <div className="flex min-h-11 items-center justify-between pl-2 text-xs font-medium text-muted-foreground sm:pl-3">
          <span>{label}</span>
          {playback && <button type="button" aria-label={`Fullscreen ${label.toLowerCase()}`} title="Fullscreen"
            className="grid size-11 shrink-0 place-items-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={event => {
              const media = event.currentTarget.parentElement?.parentElement?.querySelector("video") as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
              if (media?.webkitEnterFullscreen) media.webkitEnterFullscreen()
              else if (media?.requestFullscreen) void media.requestFullscreen().catch(() => {})
            }}><Maximize2 aria-hidden="true" className="size-4" /></button>}
        </div>
        <div className="relative aspect-video overflow-hidden bg-black">
          {playback && (playback.live
            ? <LiveVideoPlayer key={playback.url} label={label} url={playback.url} />
            : <RecordedVideo key={`${playback.url}:${playback.replayId ?? "game"}`} label={label} muted={side !== primary}
                playback={playback} onEnded={side === primary ? context.finishReplay : () => {}} />)}
          {!playback && !error && <div role="status" className="absolute inset-0 grid place-items-center px-2 text-center text-[11px] text-white/70 sm:text-sm">
            {busy ? "Loading video…" : "Camera unavailable"}
          </div>}
          {error && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 px-2 text-center text-[11px] text-white sm:text-sm">
            Video unavailable.<button className="min-h-11 px-3 underline" onClick={retry}>Retry</button>
          </div>}
        </div>
      </div>
    })}
  </section>
}

function RecordedVideo({ playback, onEnded, label, muted }: { playback: Playback; onEnded: () => void; label: string; muted: boolean }) {
  const player = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  return <>
    <video ref={player} src={playback.url} aria-label={label} muted={muted} controls playsInline preload="metadata" className="h-full w-full" onError={() => setFailed(true)} onEnded={() => { if (playback.replayId) onEnded() }} onLoadedMetadata={() => {
      if (player.current) {
        player.current.currentTime = playback.seconds
        if (playback.replayId) void player.current.play().catch(() => {})
      }
    }} />
    {failed && <p role="alert" className="absolute inset-x-3 top-3 rounded bg-black/80 p-3 text-xs text-white">Video is temporarily unavailable.</p>}
  </>
}
