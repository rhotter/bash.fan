// @vitest-environment jsdom
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FantasyConfigForm } from "@/components/admin/fantasy-config-form"
import { FantasyScopeBar } from "@/components/admin/fantasy-scope-bar"
import { DEFAULT_FANTASY_CONFIG } from "@/lib/fantasy/config"
import { describeConfigChanges, startingConfig } from "@/lib/fantasy/config-draft"
import { contestKeyFromName, contestLabel } from "@/lib/fantasy/view-state"

const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

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
const onSave = vi.fn()

const render = (node: ReactNode) => act(async () => root.render(node))
const renderForm = (props: Partial<React.ComponentProps<typeof FantasyConfigForm>> = {}) =>
  render(<FantasyConfigForm initial={DEFAULT_FANTASY_CONFIG} enabled hasLineups={false} onSave={onSave} {...props} />)

beforeEach(() => {
  onSave.mockReset()
  push.mockReset()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const field = <T extends HTMLElement = HTMLInputElement>(label: string) => {
  const found = document.body.querySelector<T>(`[aria-label="${label}"]`)
  if (!found) throw new Error(`No field labelled ${label}`)
  return found
}
const button = (text: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!
const click = (element: HTMLElement) => act(async () => element.click())
const type = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }))
  })
const json = () => field<HTMLTextAreaElement>("Config JSON")
const openJson = () => click(button("Advanced: edit as JSON"))
const saveButton = () => button("Save settings")

describe("FantasyConfigForm", () => {
  it("shows the config as fields, with the JSON closed", async () => {
    await renderForm()

    expect(field<HTMLButtonElement>("Regular").getAttribute("aria-checked")).toBe("true")
    expect(field<HTMLButtonElement>("Playoff").getAttribute("aria-checked")).toBe("false")
    expect(field("Skaters in a Lineup").value).toBe("3")
    expect(field("Skater uses per Player").value).toBe("3")
    expect(field("Points per goal against").value).toBe("-3")
    expect(field<HTMLSelectElement>("Closing day").value).toBe("6")
    expect(field("Closing time").value).toBe("08:00")
    expect(field<HTMLSelectElement>("Time zone").value).toBe("America/Los_Angeles")
    expect(document.querySelector('[aria-label="Config JSON"]')).toBeNull()
  })

  it("saves what the fields say", async () => {
    await renderForm()

    await type(field("Skaters in a Lineup"), "4")
    await click(field("Playoff"))
    await type(field<HTMLSelectElement>("Closing day"), "5")
    await click(saveButton())

    expect(onSave).toHaveBeenCalledWith({
      ...DEFAULT_FANTASY_CONFIG,
      gameTypes: ["regular", "playoff"],
      lineup: { ...DEFAULT_FANTASY_CONFIG.lineup, skaters: 4 },
      lock: { ...DEFAULT_FANTASY_CONFIG.lock, dayOfWeek: 5 },
    })
  })

  it("keeps the fields and the JSON showing the same draft", async () => {
    await renderForm()
    await openJson()

    await type(field("Points per goal"), "12")
    expect(JSON.parse(json().value).weights.skater.goal).toBe(12)

    await type(json(), JSON.stringify({ ...DEFAULT_FANTASY_CONFIG, lineup: { ...DEFAULT_FANTASY_CONFIG.lineup, goalies: 2 } }))
    expect(field("Goalies in a Lineup").value).toBe("2")
    expect(field("Points per goal").value).toBe("10")
  })

  it.each(["", "-", "1.2.3"])("never turns %j into a number", async (text) => {
    await renderForm()

    await type(field("Points per assist"), text)

    expect(field("Points per assist").value).toBe(text)
    expect(field("Points per assist").getAttribute("aria-invalid")).toBe("true")
    expect(container.textContent).toContain("Enter a number")
    expect(saveButton().disabled).toBe(true)
  })

  it("lets a decimal or negative number be typed a character at a time", async () => {
    await renderForm()

    for (const text of ["-", "-0", "-0.", "-0.5"]) {
      await type(field("Points per assist"), text)
      expect(field("Points per assist").value).toBe(text)
    }
    await click(saveButton())

    expect(onSave.mock.calls[0][0].weights.skater.assist).toBe(-0.5)
  })

  it("shows the server's rule beside the field that breaks it", async () => {
    await renderForm()

    await type(field("Closing time"), "13:00")

    expect(container.textContent).toContain("The Lock must be at or before 12:00")
    expect(saveButton().disabled).toBe(true)
  })

  it("needs at least one game type", async () => {
    await renderForm()

    await click(field("Regular"))

    expect(container.textContent).toContain("Score at least one game type")
    expect(saveButton().disabled).toBe(true)
  })

  it("turns a cap off with No limit, and brings the number back", async () => {
    await renderForm()

    await click(field("No limit on skater uses"))
    expect(field("Skater uses per Player").disabled).toBe(true)
    await click(field("No limit on skater uses"))
    expect(field("Skater uses per Player").value).toBe("3")

    await click(field("No limit on goalie uses"))
    await click(saveButton())
    expect(onSave.mock.calls[0][0].usageCap).toEqual({ skater: 3, goalie: null })
  })

  it("keeps unreadable JSON, pausing the fields and Save until it's discarded", async () => {
    await renderForm()
    await openJson()
    await type(field("Skaters in a Lineup"), "5")

    await type(json(), "{ nope")

    expect(json().value).toBe("{ nope")
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("isn't valid JSON")
    expect(container.querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(true)
    expect(saveButton().disabled).toBe(true)

    await click(button("Discard JSON changes"))
    expect(field("Skaters in a Lineup").value).toBe("5")
    expect(JSON.parse(json().value).lineup.skaters).toBe(5)
    expect(saveButton().disabled).toBe(false)
  })

  it.each([
    ["an unknown setting", { ...DEFAULT_FANTASY_CONFIG, bonus: 1 }, "bonus"],
    ["an unknown game type", { ...DEFAULT_FANTASY_CONFIG, gameTypes: ["regularr"] }, "gameTypes"],
    ["a missing section", { gameTypes: ["regular"] }, "lineup"],
  ])("won't save JSON with %s, which the fields can't show", async (_name, value, message) => {
    await renderForm()
    await openJson()

    await type(json(), JSON.stringify(value))

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message)
    expect(saveButton().disabled).toBe(true)
    // The JSON can't be hidden while it's the only place to fix this.
    await openJson()
    expect(json()).toBeTruthy()
  })

  it("asks before saving changes once Lineups exist, listing them", async () => {
    await renderForm({ hasLineups: true })
    await type(field("Points per goal"), "12")
    await type(field<HTMLSelectElement>("Closing day"), "5")

    await click(saveButton())

    expect(onSave).not.toHaveBeenCalled()
    const dialog = document.querySelector('[role="alertdialog"]')!
    expect(dialog.textContent).toContain("Points per goal: 10 → 12")
    expect(dialog.textContent).toContain("Closing day: Saturday → Friday")
    expect(dialog.textContent).toContain("different Week")

    await click(button("Save changes"))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it("asks before saving changes when there are only Predictions", async () => {
    await renderForm({ hasPredictions: true })
    await type(field("Points per goal"), "12")

    await click(saveButton())

    expect(onSave).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
  })

  it("locks the closing day, and says why, once Lineups are saved", async () => {
    await renderForm({ hasLineups: true, fixedClosingDay: true })

    expect(field<HTMLSelectElement>("Closing day").disabled).toBe(true)
    expect(container.textContent).toContain("can't change once Lineups are saved")
  })

  it("saves nothing when that confirmation is cancelled", async () => {
    await renderForm({ hasLineups: true })
    await type(field("Points per goal"), "12")
    await click(saveButton())

    await click(button("Cancel"))

    expect(onSave).not.toHaveBeenCalled()
  })

  it("turns a new contest on without a confirmation", async () => {
    await renderForm({ enabled: false })

    await click(button("Turn on run"))

    expect(onSave).toHaveBeenCalledWith(DEFAULT_FANTASY_CONFIG)
  })
})

describe("ending a run", () => {
  it("saves an end date, and clears it again", async () => {
    await renderForm()
    expect(field("End date").value).toBe("")

    await type(field("End date"), "2026-12-19")
    await click(saveButton())
    expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_FANTASY_CONFIG, endsOn: "2026-12-19" })

    await click(button("Clear end date"))
    await click(saveButton())
    expect(onSave).toHaveBeenLastCalledWith(DEFAULT_FANTASY_CONFIG)
  })

  it("saves a start date, and clears it again", async () => {
    await renderForm()

    await type(field("Start date"), "2027-01-09")
    await click(saveButton())
    expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_FANTASY_CONFIG, startsOn: "2027-01-09" })

    await click(button("Clear start date"))
    await click(saveButton())
    expect(onSave).toHaveBeenLastCalledWith(DEFAULT_FANTASY_CONFIG)
  })

  it("won't save dates that hold no Week", async () => {
    await renderForm()

    await type(field("Start date"), "2027-01-16")
    await type(field("End date"), "2027-01-09")

    expect(container.textContent).toContain("No Week closes between the start and end dates")
    expect(saveButton().disabled).toBe(true)
  })

  it("lists the end date in the confirmation once Lineups exist", async () => {
    await renderForm({ hasLineups: true })

    await type(field("End date"), "2026-12-19")
    await click(saveButton())

    expect(document.querySelector('[role="alertdialog"]')!.textContent).toContain("End date: None → 2026-12-19")
  })
})

describe("config drafts", () => {
  it("starts a playoffs run on playoff games and a regular one on regular games", () => {
    expect(startingConfig("playoffs", DEFAULT_FANTASY_CONFIG).gameTypes).toEqual(["playoff", "championship"])
    expect(startingConfig("regular", DEFAULT_FANTASY_CONFIG)).toEqual(DEFAULT_FANTASY_CONFIG)
  })

  it("describes only what changed, naming a removed cap", () => {
    const next = { ...DEFAULT_FANTASY_CONFIG, usageCap: { skater: null, goalie: 4 } }

    expect(describeConfigChanges(DEFAULT_FANTASY_CONFIG, next)).toEqual(["Skater uses per Player: 3 → No limit"])
    expect(describeConfigChanges(DEFAULT_FANTASY_CONFIG, DEFAULT_FANTASY_CONFIG)).toEqual([])
  })
})

describe("contest names", () => {
  it.each([
    ["December Beta", "december-beta"],
    ["  2nd Half!  ", "2nd-half"],
    ["Playoffs", "playoffs"],
  ])("turns %j into the key %j", (name, key) => {
    expect(contestKeyFromName(name)).toBe(key)
  })

  it.each(["", "   ", "!!!"])("has no key for %j", (name) => {
    expect(contestKeyFromName(name)).toBeNull()
  })

  it("reads a key back as a name", () => {
    expect(contestLabel("december-beta")).toBe("December Beta")
    expect(contestLabel("regular")).toBe("Regular")
  })
})

describe("starting a new run", () => {
  const bar = (contests: string[], contest = contests[0]) =>
    render(<FantasyScopeBar seasons={[{ id: "s1", name: "Fall" }]} seasonId="s1" contest={contest} contests={contests} />)
  const createButton = () => button("Create")

  it("takes a type and a name, showing the link the name makes", async () => {
    await bar(["regular"])
    await click(button("+ New run"))
    expect(createButton().disabled).toBe(true)

    await type(field<HTMLSelectElement>("Run type"), "playoffs")
    await type(field("Run name"), "Spring Cup")
    expect(container.textContent).toContain("/fantasy?contest=spring-cup")
    await click(createButton())

    expect(push).toHaveBeenCalledWith("/admin/fantasy?season=s1&contest=spring-cup&type=playoffs")
  })

  it("offers only the two types", async () => {
    await bar(["regular"])
    await click(button("+ New run"))

    expect([...field<HTMLSelectElement>("Run type").options].map((o) => o.value)).toEqual(["regular", "playoffs"])
  })

  it("refuses a name the season already uses", async () => {
    await bar(["regular", "december-beta"])
    await click(button("+ New run"))

    await type(field("Run name"), "December  Beta")

    expect(createButton().disabled).toBe(true)
    expect(container.textContent).toContain("already has a run with that name")
  })

  it("shows each run by name, and doesn't reload the one already open", async () => {
    await bar(["regular", "december-beta"], "december-beta")

    await click(button("December Beta"))
    expect(push).not.toHaveBeenCalled()
    await click(button("Regular"))
    expect(push).toHaveBeenCalledWith("/admin/fantasy?season=s1&contest=regular")
  })
})
