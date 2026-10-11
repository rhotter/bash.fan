// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { LoadingState, type LoadingVariant } from "@/components/loading-state"
import { RefsTab } from "@/components/refs-tab"
import { Spinner } from "@/components/ui/spinner"

const state = vi.hoisted(() => ({ refs: [] as { name: string; games: number; totalPen: number; totalPim: number; avgPimPerGame: number }[], isLoading: true, isError: false }))
vi.mock("@/lib/hockey-data", () => ({ useRefStats: () => state }))

function render(element: React.ReactNode) {
  const container = document.createElement("div")
  container.innerHTML = renderToStaticMarkup(element)
  return container
}

describe("Shared loading states", () => {
  it.each<LoadingVariant>(["scores", "table", "stats", "draft", "detail", "list"])("announces one loading status for %s and hides decorative placeholders", (variant) => {
    const view = render(<LoadingState variant={variant} label="Loading results…" />)
    expect(view.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(view.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Loading results…")
    expect(view.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
    for (const placeholder of view.querySelectorAll('[data-slot="skeleton"]')) {
      expect(placeholder.closest('[aria-hidden="true"]')).not.toBeNull()
    }
    expect(view.querySelector('button, a, input')).toBeNull()
  })

  it("gives action spinners a default accessible label and supports a specific action", () => {
    expect(render(<Spinner />).querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Loading")
    expect(render(<Spinner aria-label="Saving roster…" />).querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Saving roster…")
  })

  it("shows placeholders only until data arrives and keeps results through refreshes and errors", () => {
    state.refs = []
    state.isLoading = true
    state.isError = false
    expect(render(<RefsTab />).querySelector('[role="status"]')).not.toBeNull()

    state.refs = [{ name: "Sample Referee", games: 3, totalPen: 4, totalPim: 8, avgPimPerGame: 2.67 }]
    for (const isLoading of [false, true]) {
      for (const isError of [false, true]) {
        Object.assign(state, { isLoading, isError })
        const view = render(<RefsTab />)
        expect(view.textContent).toContain("Sample Referee")
        expect(view.querySelector('[role="status"]')).toBeNull()
      }
    }

    Object.assign(state, { refs: [], isLoading: false, isError: false })
    const empty = render(<RefsTab />)
    expect(empty.textContent).toContain("No referee data available yet")
    expect(empty.querySelector('[role="status"]')).toBeNull()
  })
})
