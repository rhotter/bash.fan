// @vitest-environment jsdom
import { act, Suspense } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SiteHeader } from "@/components/site-header"
import { PageLoading } from "@/components/page-loading"

const route = vi.hoisted(() => ({ pathname: "/", search: "", suspend: false }))
const pending = new Promise<never>(() => {})
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => {
    if (route.suspend) throw pending
    return new URLSearchParams(route.search)
  },
}))
vi.mock("@/components/player-search", () => ({ PlayerSearch: () => null }))

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(route, { pathname: "/", search: "", suspend: false })
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function Page({ loading }: { loading: boolean }) {
  if (loading) throw pending
  return <main>Loaded page</main>
}
async function render(loading = false) {
  await act(async () => root.render(<>
    <SiteHeader />
    <Suspense fallback={<PageLoading variant="scores" label="Loading scores…" />}>
      <Page loading={loading} />
    </Suspense>
  </>))
}

describe("Persistent public header", () => {
  it("keeps the same eagerly loaded logo through route loading and completion", async () => {
    await render()
    const logo = container.querySelector('img[alt="BASH logo"]')
    expect(logo?.getAttribute("loading")).toBe("eager")
    route.pathname = "/standings"
    await render(true)
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    expect(container.querySelector('img[alt="BASH logo"]')).toBe(logo)
    expect(container.querySelectorAll("header")).toHaveLength(1)
    await render()
    expect(container.querySelector('img[alt="BASH logo"]')).toBe(logo)
    expect(container.querySelector('nav a[href="/standings"]')?.className).toContain("bg-secondary")
  })

  it("updates season links without replacing the logo and preserves all-season rules", async () => {
    route.search = "season=2026-summer"
    await render()
    const logo = container.querySelector("img")
    expect(logo?.closest("a")?.getAttribute("href")).toBe("/?season=2026-summer")
    route.pathname = "/stats"
    route.search = "season=all"
    await render()
    expect(container.querySelector("img")).toBe(logo)
    expect(container.querySelector('nav a[href="/stats?season=all"]')?.className).toContain("bg-secondary")
    expect(container.querySelector('nav a[href="/standings"]')).not.toBeNull()
  })

  it("shows the logo even while search parameters are suspended", async () => {
    route.suspend = true
    await render()
    expect(container.querySelector('img[alt="BASH logo"]')).not.toBeNull()
  })

  it.each(["/admin", "/admin/seasons", "/admin/scoresheet/123"])("omits the public header on %s", async (pathname) => {
    route.pathname = pathname
    await render()
    expect(container.querySelector("header")).toBeNull()
  })

  it.each(["/about", "/how-to", "/rulebook"])("keeps About selected on %s", async (pathname) => {
    route.pathname = pathname
    await render()
    expect(container.querySelector('nav a[href="/about"]')?.className).toContain("bg-secondary")
  })
})
