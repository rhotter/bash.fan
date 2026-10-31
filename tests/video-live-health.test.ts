import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ stream: vi.fn() }))
vi.mock("@/lib/video/cloudflare", () => ({ streamRequest: mocks.stream }))
import { liveHealth } from "@/lib/video/live-health"
const fetcher = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal("fetch", fetcher)
  mocks.stream.mockResolvedValueOnce({ playback: { hls: "https://customer-test.cloudflarestream.com/input/manifest/video.m3u8" } }).mockResolvedValueOnce({ token: "signed-token" })
})
afterEach(() => vi.unstubAllGlobals())
function playlists(segment = "seg_1.mp4?p=secret", ending = "") {
  fetcher.mockResolvedValueOnce(new Response('#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\nvideo.m3u8\n'))
    .mockResolvedValueOnce(new Response(`#EXTM3U\n#EXTINF:2,\n${segment}\n${ending}`))
}
describe("live delivery checks", () => {
  it("requires accessible video data and returns no signed URLs", async () => {
    playlists()
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array([0, 1, 2]), { status: 206 }))
    const result = await liveHealth("input")
    expect(result.available).toBe(true)
    expect(result.segment).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(result)).not.toContain("secret")
    expect(fetcher.mock.calls[2][1].headers.Range).toBe("bytes=0-63")
  })
  it("does not treat a connected input with an empty playlist as healthy", async () => {
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect(await liveHealth("input")).toEqual({ available: false })
  })
  it("does not treat a failed media request as healthy", async () => {
    playlists()
    fetcher.mockResolvedValueOnce(new Response(null, { status: 404 }))
    expect(await liveHealth("input")).toEqual({ available: false })
  })
  it("rejects completed streams and off-provider media URLs", async () => {
    playlists("https://example.com/private.mp4")
    expect(await liveHealth("input")).toEqual({ available: false })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it("does not mistake a refreshed signing token for video progress", async () => {
    playlists()
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 206 }))
    const first = await liveHealth("input")
    mocks.stream.mockResolvedValueOnce({ playback: { hls: "https://customer-test.cloudflarestream.com/input/manifest/video.m3u8" } }).mockResolvedValueOnce({ token: "different-token" })
    playlists()
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 206 }))
    expect(await liveHealth("input")).toEqual(first)
  })
  it("rejects completed streams", async () => {
    playlists("seg_1.mp4", "#EXT-X-ENDLIST")
    expect(await liveHealth("input")).toEqual({ available: false })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
