// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { SWRConfig } from "swr"
import { PinDialog } from "@/components/admin-editor/pin-dialog"
import { AdminLoginGate } from "@/components/admin/admin-login-gate"
import { StatsTab } from "@/components/stats-tab"
import { AdminProvider, useAdmin } from "@/lib/admin-context"

const toastError = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: { error: toastError } }))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))

async function withUI(element: React.ReactNode, check: (container: HTMLDivElement) => Promise<void>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Server unavailable</html>", { status: 503 })))
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>{element}</SWRConfig>))
    await check(container)
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
}

async function submit(input: HTMLInputElement) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "test-pin")
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await act(async () => input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
}

describe("Error messages in real forms and loaders", () => {
  it("does not report a successful sign-out or clear admin mode after the server fails", async () => {
    function AdminControls() {
      const admin = useAdmin()
      return <><span>{admin.isAdmin ? "Editing enabled" : "Editing disabled"}</span>
        <button onClick={() => admin.login("test-pin")}>Enable admin</button>
        <button onClick={admin.logout}>Sign out</button></>
    }
    await withUI(<AdminProvider><AdminControls /></AdminProvider>, async (container) => {
      await act(async () => container.querySelectorAll("button")[0].click())
      expect(container.textContent).toContain("Editing enabled")
      await act(async () => container.querySelectorAll("button")[1].click())
      expect(container.textContent).toContain("Editing enabled")
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining("Reload to check"))
    })
  })
  it("never authenticates or saves game state after PIN validation returns a server error", async () => {
    const success = vi.fn()
    await withUI(<PinDialog open onOpenChange={() => {}} gameId="g55" currentState={{ goals: [] }} onSuccess={success} />, async () => {
      await submit(document.querySelector<HTMLInputElement>('input[placeholder="Enter PIN"]')!)
      expect(success).not.toHaveBeenCalled()
      expect(document.body.textContent).toContain("Reload to check")
      expect(document.body.textContent).not.toContain("Invalid PIN")
      expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(["/api/bash/admin/validate-pin"])
    })
  })

  it("does not blame an admin's PIN when the server fails", async () => {
    await withUI(<AdminLoginGate />, async (container) => {
      await submit(container.querySelector<HTMLInputElement>('input[placeholder="Enter PIN"]')!)
      expect(container.textContent).toContain("Reload to check")
      expect(container.textContent).not.toContain("Invalid PIN")
    })
  })

  it("shows a failed Stats request as an error with retry, rather than no player stats", async () => {
    await withUI(<StatsTab />, async (container) => {
      await act(async () => { await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull()) })
      expect(container.textContent).toContain("Try again")
      expect(container.textContent).not.toContain("No player stats available")
    })
  })
})
