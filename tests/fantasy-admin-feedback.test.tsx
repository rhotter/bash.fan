// @vitest-environment jsdom
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FantasyAdmin } from "@/components/admin/fantasy-admin"
import { FantasyManagerActions } from "@/components/admin/fantasy-manager-actions"
import { FantasyScopeBar } from "@/components/admin/fantasy-scope-bar"
import { DEFAULT_FANTASY_CONFIG } from "@/lib/fantasy/config"

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
)

let container: HTMLDivElement
let root: Root
const fetchMock = vi.fn()
const realFetch = globalThis.fetch

beforeEach(() => {
  for (const mock of [router.push, router.refresh, toast.success, toast.error, toast.info, fetchMock]) mock.mockReset()
  globalThis.fetch = fetchMock
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  globalThis.fetch = realFetch
})

const render = (node: ReactNode) => act(async () => root.render(node))
const button = (text: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!
const click = (element: HTMLElement) => act(async () => element.click())
const respond = (status: number, body: object) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }))
const type = (label: string, value: string) =>
  act(async () => {
    const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })

const dialog = () => document.querySelector('[role="dialog"]')

const loaded = (enabled: boolean) => ({
  enabled,
  status: enabled ? "active" : null,
  picksOpenAt: null,
  config: DEFAULT_FANTASY_CONFIG,
  hasLineups: false,
  managers: [],
  overview: null,
})

describe("saving a run's settings", () => {
  const closed = () => render(<FantasyAdmin seasonId="s1" contest="december-beta" />)
  /** Renders the page and opens the settings. */
  const admin = async () => {
    await closed()
    await click(button("Settings") ?? button("Set up run"))
  }

  it("marks a run that hasn't been turned on", async () => {
    fetchMock.mockImplementation(() => respond(200, loaded(false)))

    await closed()

    expect(container.textContent).toContain("Not saved")
    expect(container.textContent).toContain("December Beta isn't saved yet")
    expect(button("Set up run")).toBeDefined()
  })

  it("says the run is on, and refreshes the page so its tab stops looking unsaved", async () => {
    fetchMock.mockImplementationOnce(() => respond(200, loaded(false)))
    await admin()
    fetchMock.mockImplementationOnce(() => respond(200, {})).mockImplementation(() => respond(200, loaded(true)))

    await click(button("Turn on run"))

    expect(toast.success).toHaveBeenCalledWith("December Beta is turned on.")
    expect(router.refresh).toHaveBeenCalled()
  })

  it("confirms a later save", async () => {
    fetchMock.mockImplementation(() => respond(200, loaded(true)))
    await admin()

    await click(button("Save settings"))

    expect(toast.success).toHaveBeenCalledWith("December Beta settings saved.")
    expect(dialog()).toBeNull()
  })

  it("shows it's working, and can't be clicked twice", async () => {
    fetchMock.mockImplementationOnce(() => respond(200, loaded(true)))
    await admin()
    let finish!: (response: Response) => void
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        })
    )
    fetchMock.mockImplementation(() => respond(200, loaded(true)))

    await click(button("Save settings"))

    expect(button("Saving…").disabled).toBe(true)
    await act(async () => finish(await respond(200, {})))
    expect(dialog()).toBeNull()
  })

  it("reports a failure where it can be seen, without claiming success", async () => {
    fetchMock.mockImplementationOnce(() => respond(200, loaded(true)))
    await admin()
    fetchMock.mockImplementationOnce(() => respond(400, { error: "That config isn't valid." }))

    await click(button("Save settings"))

    expect(toast.error).toHaveBeenCalledWith("That config isn't valid.", { position: "top-center" })
    expect(toast.success).not.toHaveBeenCalled()
    expect(router.refresh).not.toHaveBeenCalled()
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe("That config isn't valid.")
    expect(button("Save settings").disabled).toBe(false)
  })
})

describe("the settings window", () => {
  const dismiss = () => click(button("Close"))
  const page = (isNew?: boolean) =>
    render(<FantasyAdmin seasonId="s1" contest="december-beta" type={isNew ? "regular" : undefined} />)

  it("keeps the settings off the page until asked for", async () => {
    fetchMock.mockImplementation(() => respond(200, loaded(true)))

    await page()

    expect(dialog()).toBeNull()
    expect(document.querySelector('[aria-label="Points per goal"]')).toBeNull()
    await click(button("Settings"))
    expect(dialog()?.textContent).toContain("December Beta settings")
    expect(document.querySelector('[aria-label="Points per goal"]')).toBeTruthy()
  })

  it("opens straight away for a run that was just created", async () => {
    fetchMock.mockImplementation(() => respond(200, loaded(false)))

    await page(true)

    expect(dialog()).toBeTruthy()
    expect(button("Turn on run")).toBeDefined()
  })

  it("doesn't reopen for a saved run whose address still names a type", async () => {
    fetchMock.mockImplementation(() => respond(200, loaded(true)))

    await page(true)

    expect(dialog()).toBeNull()
  })

  it("closes without asking when nothing changed", async () => {
    fetchMock.mockImplementation(() => respond(200, loaded(true)))
    const confirm = vi.spyOn(window, "confirm")
    confirm.mockClear()
    await page()
    await click(button("Settings"))

    await dismiss()

    expect(confirm).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()
  })

  it("asks before throwing away changes", async () => {
    fetchMock.mockImplementation(() => respond(200, loaded(true)))
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    confirm.mockClear()
    await page()
    await click(button("Settings"))
    await type("Points per goal", "12")

    await dismiss()

    expect(confirm).toHaveBeenCalledWith("Discard your unsaved changes?")
    expect(document.querySelector<HTMLInputElement>('[aria-label="Points per goal"]')?.value).toBe("12")

    confirm.mockReturnValue(true)
    await dismiss()
    expect(dialog()).toBeNull()
    await click(button("Settings"))
    expect(document.querySelector<HTMLInputElement>('[aria-label="Points per goal"]')?.value).toBe("10")
  })
})

describe("starting a new run", () => {
  it("says the run still needs to be turned on", async () => {
    await render(<FantasyScopeBar seasons={[{ id: "s1", name: "Fall" }]} seasonId="s1" contest="regular" contests={["regular"]} />)
    await click(button("+ New run"))
    await type("Run name", "December Beta")

    await click(button("Create"))

    expect(toast.info).toHaveBeenCalledWith("December Beta isn't saved yet.", {
      description: "Check its settings, then click Turn on run.",
      position: "top-center",
    })
  })
})

describe("managing a team", () => {
  const actions = () =>
    render(<FantasyManagerActions seasonId="s1" backHref="/back" manager={{ id: 7, teamName: "Puck Norris", duplicate: false }} />)

  it("confirms a rename", async () => {
    fetchMock.mockImplementation(() => respond(200, {}))
    await actions()
    await click(button("Rename"))

    await click(button("Save"))

    expect(toast.success).toHaveBeenCalledWith("Team renamed.")
  })

  it("confirms a removal before leaving the page", async () => {
    fetchMock.mockImplementation(() => respond(200, {}))
    vi.spyOn(window, "confirm").mockReturnValue(true)
    await actions()

    await click(button("Remove"))

    expect(toast.success).toHaveBeenCalledWith("Puck Norris removed.")
  })

  it("says nothing succeeded when it didn't", async () => {
    fetchMock.mockImplementation(() => respond(409, { error: "That Team Name is taken." }))
    await actions()
    await click(button("Rename"))

    await click(button("Save"))

    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith("That Team Name is taken.")
  })
})
