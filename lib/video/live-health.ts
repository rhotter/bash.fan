import { createHash } from "node:crypto"
import { streamRequest, type LiveInput } from "./cloudflare"

function trustedUrl(value: string, base?: URL) {
  const url = new URL(value, base)
  if (url.protocol !== "https:" || !url.hostname.endsWith(".cloudflarestream.com") || url.username || url.password) throw new Error("Invalid playback host")
  return url
}
async function playlist(url: URL) {
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) })
  if (response.status !== 200) throw new Error("Playback unavailable")
  const text = await response.text()
  if (!text.startsWith("#EXTM3U") || text.length > 512000) throw new Error("Invalid playlist")
  return text
}
/** Confirms a live video fragment is accessible; clients compare identities over time.
 * This is delivery progress, not a guarantee of visual quality or synchronized audio. */
export async function liveHealth(inputId: string): Promise<{ available: boolean; segment?: string }> {
  try {
    const input = await streamRequest<LiveInput>(`live_inputs/${inputId}`)
    if (!input.playback?.hls) return { available: false }
    const origin = trustedUrl(input.playback.hls)
    const { token } = await streamRequest<{ token: string }>(`${inputId}/token`, {
      method: "POST", body: JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 120 }),
    })
    const masterUrl = trustedUrl(`/${token}/manifest/video.m3u8`, origin)
    const master = await playlist(masterUrl)
    // Choose a video variant, never the separate audio rendition.
    const variant = master.match(/#EXT-X-STREAM-INF:[^\n]*\n([^#\r\n]+)/)?.[1]
    if (!variant) return { available: false }
    const videoUrl = trustedUrl(variant.trim(), masterUrl)
    const video = await playlist(videoUrl)
    if (video.includes("#EXT-X-ENDLIST")) return { available: false }
    const fragments = [...video.matchAll(/#EXTINF:[^\n]*\n([^#\r\n]+)/g)]
    const last = fragments.at(-1)?.[1]
    if (!last) return { available: false }
    const fragment = trustedUrl(last.trim(), videoUrl)
    async function hasMedia(url: URL) {
      const response = await fetch(url, { headers: { Range: "bytes=0-63" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) })
      if ((response.status !== 200 && response.status !== 206) || !response.body) {
        await response.body?.cancel()
        return false
      }
      const reader = response.body.getReader()
      try { const chunk = await reader.read(); return !!chunk.value?.byteLength } finally { await reader.cancel() }
    }
    const initialization = video.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1]
    const requiredMedia = [fragment, ...(initialization ? [trustedUrl(initialization, videoUrl)] : [])]
    if (!(await Promise.all(requiredMedia.map(hasMedia))).every(Boolean)) return { available: false }
    // Strip signatures and query parameters; return only a stable, opaque identity.
    return { available: true, segment: createHash("sha256").update(fragment.pathname.replace(`/${token}/`, "/")).digest("hex") }
  } catch { return { available: false } }
}
