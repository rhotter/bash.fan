"use client"

import { useEffect, useRef, useState } from "react"
import type Hls from "hls.js"
import { Button } from "@/components/ui/button"

export function LiveVideoPlayer({ url, label }: { url: string; label: string }) {
  const video = useRef<HTMLVideoElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState("Connecting to stream…")
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const media = video.current
    if (!media) return
    let disposed = false
    let player: Hls | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let retries = 0
    let recoveredMedia = false
    const unavailable = () => {
      if (disposed) return
      setFailed(true)
      setStatus("Video is temporarily unavailable.")
    }
    let started = false
    const play = () => {
      if (disposed || started) return
      started = true
      setFailed(false)
      void media.play().catch(() => { if (!disposed) setStatus("Press play to watch.") })
    }
    media.addEventListener("canplay", play)

    void import("hls.js").then(({ default: Hls }) => {
      if (disposed) return
      if (!Hls.isSupported()) {
        if (media.canPlayType("application/vnd.apple.mpegurl")) {
          media.src = url
          media.addEventListener("error", unavailable)
        } else unavailable()
        return
      }
      player = new Hls({ maxBufferLength: 20, backBufferLength: 30, capLevelToPlayerSize: true })
      player.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || disposed) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retries < 6) {
          retries++
          setStatus("Waiting for the stream. Reconnecting…")
          clearTimeout(retry)
          retry = setTimeout(() => { if (!disposed) player?.loadSource(url) }, 10000)
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMedia) {
          recoveredMedia = true
          player?.recoverMediaError()
        } else {
          player?.stopLoad()
          unavailable()
        }
      })
      player.loadSource(url)
      player.attachMedia(media)
    }).catch(unavailable)
    return () => {
      disposed = true
      clearTimeout(retry)
      media.removeEventListener("canplay", play)
      media.removeEventListener("error", unavailable)
      player?.destroy()
      media.pause()
      media.removeAttribute("src")
      media.load()
    }
  }, [url, attempt])

  return <>
    <video ref={video} aria-label={label} controls playsInline muted className="h-full w-full"
      onPlaying={() => { setStatus(""); setFailed(false) }}
      onWaiting={() => setStatus("Buffering…")} />
    {status && <div role="status" className="absolute inset-x-3 top-3 flex items-center justify-between gap-3 rounded-md bg-black/75 px-3 py-2 text-xs text-white">
      <span>{status}</span>
      {failed && <Button size="sm" variant="secondary" onClick={() => { setFailed(false); setStatus("Reconnecting…"); setAttempt(value => value + 1) }}>Retry playback</Button>}
    </div>}
  </>
}
