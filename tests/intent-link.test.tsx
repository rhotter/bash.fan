// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { IntentLink } from "@/components/intent-link"

const prefetch = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch }) }))

async function withLink(props: Partial<React.ComponentProps<typeof IntentLink>>, check: (link: HTMLAnchorElement) => Promise<void>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  prefetch.mockClear()
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<IntentLink href="/player/alex-muhn" {...props}>Alex Muhn</IntentLink>))
    await check(container.querySelector("a")!)
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
}

describe("Detail navigation preloading", () => {
  it("waits for interest, then fetches the destination on hover and keyboard focus", async () => {
    await withLink({}, async (link) => {
      expect(link.getAttribute("href")).toBe("/player/alex-muhn")
      expect(prefetch).not.toHaveBeenCalled()
      await act(async () => link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })))
      expect(prefetch).toHaveBeenCalledWith("/player/alex-muhn")
      prefetch.mockClear()
      await act(async () => link.dispatchEvent(new FocusEvent("focusin", { bubbles: true })))
      expect(prefetch).toHaveBeenCalledWith("/player/alex-muhn")
    })
  })

  it("lets a caller cancel preloading and preserves its event handler", async () => {
    const onMouseEnter = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) => event.preventDefault())
    await withLink({ onMouseEnter }, async (link) => {
      await act(async () => link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true })))
      expect(onMouseEnter).toHaveBeenCalledOnce()
      expect(prefetch).not.toHaveBeenCalled()
    })
  })
})
