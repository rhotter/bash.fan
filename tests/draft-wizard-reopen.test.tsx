// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DraftWizard } from "@/components/admin/draft-wizard"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
const teams = [{ teamSlug: "home", teamName: "Home" }]
const existingDraft = { id: "draft1", name: "Existing Draft", draftType: "snake", rounds: 1, timerSeconds: 60, maxKeepers: 1, draftDate: null, location: null }
const captain = (playerName = "Current Captain", playerId = 1) => ({ playerId, playerName, teamSlug: "home", isCaptain: true })
const reply = (players = [captain()]) => new Response(JSON.stringify({ players }))
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function render(open: boolean) {
  await act(async () => root.render(<DraftWizard open={open} onOpenChange={() => {}} seasonId="s1" seasonType="summer"
    teams={teams} rosterCount={1} existingDraft={existingDraft} onComplete={() => {}} />))
}
function button(text: string) {
  const result = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent?.trim() === text)
  if (!result) throw new Error(`Missing button ${text}`)
  return result
}
async function click(text: string) {
  await act(async () => { button(text).click() })
}

describe("Draft wizard roster lifecycle", () => {
  it("reloads captains after reopening and preserves them in the save payload", async () => {
    const request = vi.fn(async (url: string) => url.endsWith("roster-players") ? reply() : new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal("fetch", request)
    await render(true)
    await click("Next")
    expect(document.body.textContent).toContain("Current Captain")
    await render(false)
    await render(true)
    await click("Next")
    expect(request.mock.calls.filter(([url]) => url.endsWith("roster-players"))).toHaveLength(2)
    expect(document.body.textContent).toContain("Current Captain")
    await click("Next")
    await click("Next")
    await click("Save & Set Keepers")
    const save = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/captains"))!
    expect(JSON.parse(save[1]!.body as string).captains).toEqual([{ playerId: 1, playerName: "Current Captain", teamSlug: "home" }])
  })

  it("blocks progression on roster failure and retries on reopen", async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response("Unavailable", { status: 503 })).mockImplementation(async () => reply())
    vi.stubGlobal("fetch", request)
    await render(true)
    await click("Next")
    expect(button("Next").disabled).toBe(true)
    expect(document.body.textContent).toContain("Retry loading roster")
    expect(request).toHaveBeenCalledTimes(1)
    await render(false)
    await render(true)
    await click("Next")
    expect(request).toHaveBeenCalledTimes(2)
    expect(button("Next").disabled).toBe(false)
    expect(document.body.textContent).toContain("Current Captain")
    expect(document.body.textContent).not.toContain("Retry loading roster")
  })

  it("ignores a late roster response from a previous opening", async () => {
    let finishOld!: (response: Response) => void
    const oldRequest = new Promise<Response>(resolve => { finishOld = resolve })
    const request = vi.fn().mockReturnValueOnce(oldRequest).mockResolvedValue(reply([captain("New Captain", 2)]))
    vi.stubGlobal("fetch", request)
    await render(true)
    await click("Next")
    expect(button("Next").disabled).toBe(true)
    await render(false)
    await render(true)
    await click("Next")
    await act(async () => { finishOld(reply([captain("Old Captain", 1)])); await oldRequest })
    expect(document.body.textContent).toContain("New Captain")
    expect(document.body.textContent).not.toContain("Old Captain")
  })
})
