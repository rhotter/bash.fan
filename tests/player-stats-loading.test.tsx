// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { SWRConfig } from "swr"
import { describe, expect, it, vi } from "vitest"
import { usePlayerStats, type PlayerStatsData } from "@/lib/hockey-data"

const snapshot: PlayerStatsData = { skaters: [], goalies: [], teams: [], lastUpdated: "2026-10-12T00:00:00.000Z" }
function Stats({ initialData }: { initialData?: PlayerStatsData }) {
  const { isLoading } = usePlayerStats(undefined, initialData)
  return <span>{isLoading ? "Loading" : "Ready"}</span>
}

async function withStats(initialData: PlayerStatsData | undefined, check: (fetchMock: ReturnType<typeof vi.fn>, container: HTMLDivElement) => Promise<void>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(snapshot)))
  vi.stubGlobal("fetch", fetchMock)
  const container = document.createElement("div")
  const root = createRoot(container)
  try {
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><Stats initialData={initialData} /></SWRConfig>))
    await check(fetchMock, container)
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
}

describe("Stats initial data", () => {
  it("uses the server snapshot without sending a duplicate mount request", async () => {
    await withStats(snapshot, async (fetchMock, container) => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      expect(container.textContent).toBe("Ready")
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  it("still fetches data when no server snapshot is available", async () => {
    await withStats(undefined, async (fetchMock, container) => {
      await act(async () => { await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce()) })
      expect(container.textContent).toBe("Ready")
    })
  })
})
