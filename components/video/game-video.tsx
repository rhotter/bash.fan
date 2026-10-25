"use client"

import { createContext, useContext, useRef, useState, type ReactNode } from "react"
import useSWR from "swr"
import { Play } from "lucide-react"
import { LiveVideoPlayer } from "@/components/video/live-video-player"
import { findReplay, type CameraSide, type GameVideoData, type VideoMarker } from "@/lib/video/types"

async function read(url: string, body?: unknown) {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined)
  const data = await response.json()
  if (!response.ok) throw new Error("Video is temporarily unavailable.")
  return data
}
type PlaybackRequest =
  | { action: "livePlayback"; sessionId: string; side: CameraSide }
  | { action: "playback"; sessionId: string; segmentId: string }
type Selection = { request: PlaybackRequest; seconds: number; replayId?: number }
type Playback = { url: string; seconds: number; live: boolean; replayId?: number }
type VideoContext = {
  enabled: boolean; data?: GameVideoData; available: boolean;
  playback: Playback | null; busy: boolean; error: string; refresh: () => void;
  play: (marker: VideoMarker) => void;
  finishReplay: () => void;
}
const Context = createContext<VideoContext | null>(null)

function automaticSelection(data?: GameVideoData): Selection | null {
  if (!data?.session) return null
  const sessionId = data.session.id
  const live = data.cameras.find(c => c.side === "left" && c.live) ?? data.cameras.find(c => c.live)
  if (live) return { request: { action: "livePlayback", sessionId, side: live.side }, seconds: 0 }
  const segment = data.segments.find(s => s.side === "left") ?? data.segments[0]
  return segment ? { request: { action: "playback", sessionId, segmentId: segment.id }, seconds: 0 } : null
}

export function GameVideoProvider({ gameId, enabled, children }: { gameId: string; enabled: boolean; children: ReactNode }) {
  const endpoint = `/api/bash/game/${encodeURIComponent(gameId)}/video`
  const { data, mutate } = useSWR<GameVideoData>(enabled ? endpoint : null, read, { refreshInterval: 15000 })
  const [replay, setReplay] = useState<Selection | null>(null)
  const replayId = useRef(0)
  const selection = replay?.request.sessionId === data?.session?.id ? replay : automaticSelection(data)
  const { data: source, error, isLoading, mutate: reloadSource } = useSWR<{ url: string }>(
    selection ? [endpoint, selection.request] : null,
    ([url, request]: [string, PlaybackRequest]) => read(url, request),
    { revalidateOnFocus: false, revalidateOnReconnect: true },
  )
  const playback = source && selection ? { url: source.url, seconds: selection.seconds,
    live: selection.request.action === "livePlayback", replayId: selection.replayId } : null
  function play(marker: VideoMarker) {
    if (!data?.session) return
    const match = (["left", "right"] as const).map(side => findReplay(data.segments, side,
      Date.parse(marker.occurred_at), data.cameras.find(c => c.side === side)?.offset_ms ?? 0)).find(Boolean)
    if (!match) return
    setReplay({ request: { action: "playback", sessionId: data.session.id, segmentId: match.segment.id },
      seconds: match.seconds, replayId: ++replayId.current })
    document.getElementById("game-video")?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }
  return <Context.Provider value={{ enabled, data, available: !!selection, playback, busy: isLoading,
    error: error ? "Video is temporarily unavailable." : "", refresh: () => { void mutate(); void reloadSource() },
    play, finishReplay: () => setReplay(null) }}>{children}</Context.Provider>
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
  if (!context?.enabled || !context.available) return null
  const { playback, error } = context
  return <section id="game-video" aria-label="Game video" className="relative mt-4 aspect-video overflow-hidden rounded-lg bg-black">
    {playback && (playback.live
      ? <LiveVideoPlayer key={playback.url} label="Game video" url={playback.url} />
      : <RecordedVideo key={`${playback.url}:${playback.replayId ?? "game"}`} playback={playback} onEnded={context.finishReplay} />)}
    {!playback && !error && <div role="status" className="absolute inset-0 grid place-items-center text-sm text-white/70">Loading video…</div>}
    {error && <div role="alert" className="absolute inset-0 flex items-center justify-center gap-2 bg-black/80 text-sm text-white">
      Video is temporarily unavailable. <button className="underline" onClick={context.refresh}>Retry</button>
    </div>}
  </section>
}

function RecordedVideo({ playback, onEnded }: { playback: Playback; onEnded: () => void }) {
  const player = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  return <>
    <video ref={player} src={playback.url} aria-label="Game video" controls playsInline preload="metadata" className="h-full w-full" onError={() => setFailed(true)} onEnded={() => { if (playback.replayId) onEnded() }} onLoadedMetadata={() => {
      if (player.current) {
        player.current.currentTime = playback.seconds
        if (playback.replayId) void player.current.play().catch(() => {})
      }
    }} />
    {failed && <p role="alert" className="absolute inset-x-3 top-3 rounded bg-black/80 p-3 text-xs text-white">Video is temporarily unavailable.</p>}
  </>
}
