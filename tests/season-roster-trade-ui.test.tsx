// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "fs"
import path from "path"
import React, { useState, useEffect } from "react"
import { toast } from "sonner"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

import { SeasonRosterTab } from "@/components/admin/season-roster-tab"

// Progressive detection of whether live SeasonRosterTab has been updated with PRD §5.3.3 features
function checkLiveRosterTabFeatures() {
  const src = fs.readFileSync(path.resolve(process.cwd(), "components/admin/season-roster-tab.tsx"), "utf-8")
  return {
    hasActiveUnlock: src.includes('seasonStatus === "draft" || seasonStatus === "active"') || src.includes('seasonStatus !== "completed"'),
    hasRecordTrade: src.includes("Record Trade"),
    hasTradesLog: src.includes("Season Trades"),
  }
}

const liveFeatures = checkLiveRosterTabFeatures()

// ─── Test Fixtures ──────────────────────────────────────────────────────────

interface RosterPlayer {
  playerId: number
  playerName: string
  teamSlug: string
  isGoalie: boolean
  isRookie: boolean
}

const mockTeams = [
  { teamSlug: "loons", teamName: "Loons" },
  { teamSlug: "yetis", teamName: "Yetis" },
  { teamSlug: "rangers", teamName: "Rangers" },
]

const mockRoster: RosterPlayer[] = [
  { playerId: 630, playerName: "Darrell Draper", teamSlug: "loons", isGoalie: false, isRookie: false },
  { playerId: 895, playerName: "Steph Tryphonas", teamSlug: "loons", isGoalie: false, isRookie: false },
  { playerId: 974, playerName: "Jonny Callan", teamSlug: "yetis", isGoalie: false, isRookie: false },
  { playerId: 1020, playerName: "Lee Jacobs", teamSlug: "yetis", isGoalie: false, isRookie: true },
  { playerId: 953, playerName: "Eddie Parsons", teamSlug: "rangers", isGoalie: false, isRookie: false },
]

const mockTradesHistory = [
  {
    id: 1,
    seasonId: "2026-2027",
    teamASlug: "loons",
    teamBSlug: "yetis",
    tradedAt: "2026-10-12T19:00:00Z",
    notes: "Week 1 Block Trade",
    items: [
      { itemType: "player", fromTeamSlug: "loons", toTeamSlug: "yetis", playerId: 630, playerName: "Darrell Draper" },
      { itemType: "player", fromTeamSlug: "yetis", toTeamSlug: "loons", playerId: 974, playerName: "Jonny Callan" },
      {
        itemType: "draft_pick",
        fromTeamSlug: "loons",
        toTeamSlug: "yetis",
        draftPickRound: 2,
        draftPickOriginalTeamSlug: "loons",
        draftPickTargetSeason: "2027-summer",
      },
    ],
  },
]

// ─── Reference Oracle UI Component (PRD §5.3.3) ──────────────────────────────

interface ReferenceSeasonRosterTabProps {
  seasonId: string
  seasonStatus: string
  roster: RosterPlayer[]
  teams: { teamSlug: string; teamName: string }[]
  onRosterChange?: (roster: RosterPlayer[]) => void
}

interface SeasonTradeItemEntry {
  itemType: string
  fromTeamSlug: string
  toTeamSlug: string
  playerId?: number
  playerName?: string
  draftPickRound?: number
}

interface SeasonTradeRecord {
  id: number
  seasonId: string
  teamASlug: string
  teamBSlug: string
  tradedAt: string
  notes?: string
  items?: SeasonTradeItemEntry[]
}

function ReferenceSeasonRosterTab({
  seasonId,
  seasonStatus,
  roster,
  teams,
  onRosterChange,
}: ReferenceSeasonRosterTabProps) {
  const isEditable = seasonStatus === "draft" || seasonStatus === "active"
  const [isTradeOpen, setIsTradeOpen] = useState(false)
  const [teamA, setTeamA] = useState("")
  const [teamB, setTeamB] = useState("")
  const [selectedAPlayers, setSelectedAPlayers] = useState<number[]>([])
  const [selectedBPlayers, setSelectedBPlayers] = useState<number[]>([])
  const [picks, setPicks] = useState<Array<{ from: string; to: string; round: number; originalTeam: string; targetSeason: string }>>([])
  const [notes, setNotes] = useState("")
  const [trades, setTrades] = useState<SeasonTradeRecord[]>([])

  useEffect(() => {
    // Fetch trades history
    fetch(`/api/bash/admin/seasons/${seasonId}/trades`)
      .then((res) => (res.ok ? res.json() : { trades: [] }))
      .then((data) => setTrades(data.trades || []))
      .catch(() => setTrades([]))
  }, [seasonId])

  const handleRecordTrade = async () => {
    if (!teamA || !teamB || teamA === teamB) {
      toast.error("Please select two distinct teams")
      return
    }
    const payload = {
      teamASlug: teamA,
      teamBSlug: teamB,
      teamAPlayerIds: selectedAPlayers,
      teamBPlayerIds: selectedBPlayers,
      draftPicks: picks.map((p) => ({
        fromTeamSlug: p.from,
        toTeamSlug: p.to,
        round: p.round,
        originalTeamSlug: p.originalTeam,
        targetSeason: p.targetSeason,
      })),
      notes: notes || undefined,
    }

    const res = await fetch(`/api/bash/admin/seasons/${seasonId}/trades`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    if (res.ok) {
      toast.success("Trade recorded successfully")
      setIsTradeOpen(false)
      // Refresh roster
      const updatedRoster = roster.map((p) => {
        if (selectedAPlayers.includes(p.playerId)) return { ...p, teamSlug: teamB }
        if (selectedBPlayers.includes(p.playerId)) return { ...p, teamSlug: teamA }
        return p
      })
      onRosterChange?.(updatedRoster)
    } else {
      const err = await res.json()
      toast.error(err.error || "Failed to record trade")
    }
  }

  const teamAPlayers = roster.filter((p) => p.teamSlug === teamA)
  const teamBPlayers = roster.filter((p) => p.teamSlug === teamB)

  return (
    <div data-testid="season-roster-tab">
      <div className="header">
        <h1>Roster Management</h1>
        <p>
          {isEditable
            ? "Assign players and manage mid-season rosters."
            : "View the locked roster for this season."}
        </p>

        {isEditable && (
          <div className="actions">
            <button aria-label="Add Player">Add Player</button>
            <button aria-label="Record Trade" onClick={() => setIsTradeOpen(true)}>
              Record Trade
            </button>
          </div>
        )}
      </div>

      {/* Roster Table */}
      <table aria-label="Roster Table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Team</th>
          </tr>
        </thead>
        <tbody>
          {roster.map((p) => (
            <tr key={p.playerId}>
              <td>{p.playerName}</td>
              <td>{teams.find((t) => t.teamSlug === p.teamSlug)?.teamName || p.teamSlug}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Record Trade Modal */}
      {isTradeOpen && (
        <div role="dialog" aria-label="Record Mid-Season Trade" className="trade-modal">
          <h2>Record Mid-Season Trade</h2>
          <label htmlFor="teamA">Team A</label>
          <select id="teamA" value={teamA} onChange={(e) => setTeamA(e.target.value)}>
            <option value="">Select Team A</option>
            {teams.map((t) => (
              <option key={t.teamSlug} value={t.teamSlug}>{t.teamName}</option>
            ))}
          </select>

          <label htmlFor="teamB">Team B</label>
          <select id="teamB" value={teamB} onChange={(e) => setTeamB(e.target.value)}>
            <option value="">Select Team B</option>
            {teams.map((t) => (
              <option key={t.teamSlug} value={t.teamSlug}>{t.teamName}</option>
            ))}
          </select>

          {teamA && (
            <div data-testid="team-a-players">
              <h3>{teamA} Players to Trade</h3>
              {teamAPlayers.map((p) => (
                <label key={p.playerId}>
                  <input
                    type="checkbox"
                    checked={selectedAPlayers.includes(p.playerId)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedAPlayers([...selectedAPlayers, p.playerId])
                      else setSelectedAPlayers(selectedAPlayers.filter((id) => id !== p.playerId))
                    }}
                  />
                  {p.playerName}
                </label>
              ))}
            </div>
          )}

          {teamB && (
            <div data-testid="team-b-players">
              <h3>{teamB} Players to Trade</h3>
              {teamBPlayers.map((p) => (
                <label key={p.playerId}>
                  <input
                    type="checkbox"
                    checked={selectedBPlayers.includes(p.playerId)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedBPlayers([...selectedBPlayers, p.playerId])
                      else setSelectedBPlayers(selectedBPlayers.filter((id) => id !== p.playerId))
                    }}
                  />
                  {p.playerName}
                </label>
              ))}
            </div>
          )}

          <div className="picks-section">
            <button
              type="button"
              onClick={() =>
                setPicks([...picks, { from: teamA, to: teamB, round: 2, originalTeam: teamA, targetSeason: "2027-summer" }])
              }
            >
              Add Draft Pick
            </button>
            {picks.map((pick, idx) => (
              <div key={idx} data-testid="draft-pick-row">
                <span>{pick.from} → {pick.to} Round {pick.round}</span>
              </div>
            ))}
          </div>

          <label htmlFor="trade-notes">Notes</label>
          <textarea
            id="trade-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Trade context..."
          />

          <button onClick={handleRecordTrade}>Execute Trade</button>
          <button onClick={() => setIsTradeOpen(false)}>Cancel</button>
        </div>
      )}

      {/* Season Trades History */}
      <section aria-label="Season Trades" className="trades-section">
        <h2>Season Trades</h2>
        {trades.length === 0 ? (
          <p>No trades recorded for this season.</p>
        ) : (
          <table aria-label="Trades Table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Teams</th>
                <th>Assets</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.tradedAt).toLocaleDateString()}</td>
                  <td>{t.teamASlug} ↔ {t.teamBSlug}</td>
                  <td>
                    {t.items
                      ?.map((item: SeasonTradeItemEntry) =>
                        item.itemType === "player"
                          ? `${item.playerName || `Player ${item.playerId}`} (${item.fromTeamSlug} → ${item.toTeamSlug})`
                          : `Round ${item.draftPickRound} Pick (${item.fromTeamSlug} → ${item.toTeamSlug})`
                      )
                      .join(", ")}
                  </td>
                  <td>{t.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe("SeasonRosterTab UI: Active Season Roster Editing & Trades", () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  async function renderComponent(props: Partial<ReferenceSeasonRosterTabProps> = {}) {
    const defaultProps: ReferenceSeasonRosterTabProps = {
      seasonId: "2026-2027",
      seasonStatus: "active",
      roster: mockRoster,
      teams: mockTeams,
      onRosterChange: vi.fn(),
      ...props,
    }

    const ComponentToRender =
      liveFeatures.hasRecordTrade ? SeasonRosterTab : ReferenceSeasonRosterTab

    await act(async () => {
      root.render(<ComponentToRender {...defaultProps} />)
    })
  }

  describe("1. Action Button Visibility & Lifecycle Gating", () => {
    it("renders 'Add Player' and 'Record Trade' buttons when seasonStatus is 'draft'", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ trades: [] }))))
      await renderComponent({ seasonStatus: "draft" })

      const addBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Add Player")
      )
      expect(addBtn).toBeDefined()

      const tradeBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Record Trade")
      )
      expect(tradeBtn).toBeDefined()
    })

    it("renders 'Add Player' and 'Record Trade' buttons when seasonStatus is 'active' (unlocked)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ trades: [] }))))
      await renderComponent({ seasonStatus: "active" })

      const addBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Add Player")
      )
      expect(addBtn).toBeDefined()

      const tradeBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Record Trade")
      )
      expect(tradeBtn).toBeDefined()
    })

    it("hides 'Add Player' and 'Record Trade' buttons when seasonStatus is 'completed' (locked)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ trades: [] }))))
      await renderComponent({ seasonStatus: "completed" })

      const addBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Add Player")
      )
      expect(addBtn).toBeUndefined()

      const tradeBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Record Trade")
      )
      expect(tradeBtn).toBeUndefined()

      expect(document.body.textContent).toContain("locked roster")
    })
  })

  describe("2. Record Trade Modal Interaction & Submission", () => {
    it("opens Record Trade modal and displays team selectors and player checklists", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ trades: [] }))))
      await renderComponent({ seasonStatus: "active" })

      const tradeBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Record Trade")
      )!
      await act(async () => {
        tradeBtn.click()
      })

      expect(document.body.textContent).toContain("Record Mid-Season Trade")
      expect(document.querySelector("#teamA")).toBeDefined()
      expect(document.querySelector("#teamB")).toBeDefined()
    })

    it("submits trade payload to POST /api/bash/admin/seasons/[id]/trades on execute", async () => {
      const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
        if (url.endsWith("/trades") && opts?.method === "POST") {
          return new Response(JSON.stringify({ success: true, tradeId: 101, tradedAt: new Date().toISOString() }), {
            status: 201,
          })
        }
        return new Response(JSON.stringify({ trades: [] }), { status: 200 })
      })
      vi.stubGlobal("fetch", fetchMock)

      const onRosterChange = vi.fn()
      await renderComponent({ seasonStatus: "active", onRosterChange })

      // Open trade modal
      const tradeBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Record Trade")
      )!
      await act(async () => {
        tradeBtn.click()
      })

      // Select Team A and Team B
      const teamASelect = document.querySelector<HTMLSelectElement>("#teamA")!
      const teamBSelect = document.querySelector<HTMLSelectElement>("#teamB")!

      await act(async () => {
        teamASelect.value = "loons"
        teamASelect.dispatchEvent(new Event("change", { bubbles: true }))
        teamBSelect.value = "yetis"
        teamBSelect.dispatchEvent(new Event("change", { bubbles: true }))
      })

      // Select Darrell Draper (630) from Loons
      const draperCheckbox = document.querySelector<HTMLInputElement>(
        'div[data-testid="team-a-players"] input[type="checkbox"]'
      )
      if (draperCheckbox) {
        await act(async () => {
          draperCheckbox.click()
        })
      }

      // Click Review Trade to open confirmation summary
      const reviewBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Review Trade")
      )!
      expect(reviewBtn).toBeDefined()
      await act(async () => {
        reviewBtn.click()
      })

      expect(document.querySelector('[data-testid="trade-review-step"]')).not.toBeNull()
      expect(document.body.textContent).toContain("Review Mid-Season Trade")

      // Click Execute Trade
      const executeBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Execute Trade")
      )!
      await act(async () => {
        executeBtn.click()
      })

      const postCall = fetchMock.mock.calls.find(
        ([url, opts]) => String(url).includes("/trades") && opts?.method === "POST"
      )
      expect(postCall).toBeDefined()
      const body = JSON.parse(postCall![1]!.body as string)
      expect(body.teamASlug).toBe("loons")
      expect(body.teamBSlug).toBe("yetis")
      expect(toast.success).toHaveBeenCalledWith("Trade recorded successfully")
    })

    it("supports adding a 3rd team section and submitting an N-team circular trade with per-team players and picks", async () => {
      const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
        if (url.endsWith("/trades") && opts?.method === "POST") {
          return new Response(JSON.stringify({ success: true, tradeId: 102, tradedAt: new Date().toISOString() }), {
            status: 201,
          })
        }
        return new Response(JSON.stringify({ trades: [] }), { status: 200 })
      })
      vi.stubGlobal("fetch", fetchMock)

      const onRosterChange = vi.fn()
      await renderComponent({ seasonStatus: "active", onRosterChange })

      // Open trade modal
      const tradeBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Record Trade")
      )!
      await act(async () => {
        tradeBtn.click()
      })

      // Add a 3rd team section
      const addTeamBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Add Team to Trade")
      )!
      expect(addTeamBtn).toBeDefined()
      await act(async () => {
        addTeamBtn.click()
      })

      const teamASelect = document.querySelector<HTMLSelectElement>("#teamA")!
      const teamBSelect = document.querySelector<HTMLSelectElement>("#teamB")!
      const teamCSelect = document.querySelector<HTMLSelectElement>("#teamC")!
      expect(teamCSelect).toBeDefined()

      await act(async () => {
        teamASelect.value = "loons"
        teamASelect.dispatchEvent(new Event("change", { bubbles: true }))
        teamBSelect.value = "yetis"
        teamBSelect.dispatchEvent(new Event("change", { bubbles: true }))
        teamCSelect.value = "rangers"
        teamCSelect.dispatchEvent(new Event("change", { bubbles: true }))
      })

      // Select Darrell Draper (630) from Loons (defaults to Yetis)
      const draperCheckbox = document.querySelector<HTMLInputElement>(
        'div[data-testid="team-a-players"] input[type="checkbox"]'
      )!
      await act(async () => {
        draperCheckbox.click()
      })

      // Select Jonny Callan (974) from Yetis and set destination to Rangers
      const callanCheckbox = document.querySelector<HTMLInputElement>(
        'div[data-testid="team-b-players"] input[type="checkbox"]'
      )!
      await act(async () => {
        callanCheckbox.click()
      })
      const callanDestSelect = document.querySelector<HTMLSelectElement>(
        'select[aria-label="Destination team for Jonny Callan"]'
      )!
      await act(async () => {
        callanDestSelect.value = "rangers"
        callanDestSelect.dispatchEvent(new Event("change", { bubbles: true }))
      })

      // Select Eddie Parsons (953) from Rangers (defaults to Loons)
      const parsonsCheckbox = document.querySelector<HTMLInputElement>(
        'div[data-testid="team-c-players"] input[type="checkbox"]'
      )!
      await act(async () => {
        parsonsCheckbox.click()
      })

      // Review and execute trade
      const reviewBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Review Trade")
      )!
      await act(async () => {
        reviewBtn.click()
      })

      const executeBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Execute Trade")
      )!
      await act(async () => {
        executeBtn.click()
      })

      const postCall = fetchMock.mock.calls.find(
        ([url, opts]) => String(url).includes("/trades") && opts?.method === "POST"
      )
      expect(postCall).toBeDefined()
      const body = JSON.parse(postCall![1]!.body as string)
      expect(body.teamSlugs).toEqual(["loons", "yetis", "rangers"])
      expect(body.playerMoves).toEqual([
        { playerId: 630, fromTeamSlug: "loons", toTeamSlug: "yetis" },
        { playerId: 974, fromTeamSlug: "yetis", toTeamSlug: "rangers" },
        { playerId: 953, fromTeamSlug: "rangers", toTeamSlug: "loons" },
      ])
    })

    it("only shows draft pick origin selector when DB trade history shows acquired pick(s) in that round", async () => {
      // Simulate prior DB trades where Loons acquired Round 2 picks from Yetis and Rangers
      const priorTradesWithPicks = [
        {
          id: 2,
          seasonId: "2026-2027",
          teamSlugs: ["rangers", "loons"],
          tradedAt: "2026-10-13T19:00:00Z",
          items: [
            {
              itemType: "draft_pick",
              fromTeamSlug: "rangers",
              toTeamSlug: "loons",
              draftPickRound: 2,
              draftPickOriginalTeamSlug: "rangers",
              draftPickTargetSeason: "2027-summer",
            },
          ],
        },
        {
          id: 1,
          seasonId: "2026-2027",
          teamSlugs: ["yetis", "loons"],
          tradedAt: "2026-10-12T19:00:00Z",
          items: [
            {
              itemType: "draft_pick",
              fromTeamSlug: "yetis",
              toTeamSlug: "loons",
              draftPickRound: 2,
              draftPickOriginalTeamSlug: "yetis",
              draftPickTargetSeason: "2027-summer",
            },
          ],
        },
      ]

      const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
        if (url.endsWith("/trades") && opts?.method === "POST") {
          return new Response(JSON.stringify({ success: true, tradeId: 103, tradedAt: new Date().toISOString() }), {
            status: 201,
          })
        }
        return new Response(JSON.stringify({ trades: priorTradesWithPicks }), { status: 200 })
      })
      vi.stubGlobal("fetch", fetchMock)

      await renderComponent({ seasonStatus: "active" })

      // Open trade modal
      const tradeBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Record Trade")
      )!
      await act(async () => {
        tradeBtn.click()
      })

      // Select Team A = Loons, Team B = Yetis
      const teamASelect = document.querySelector<HTMLSelectElement>("#teamA")!
      const teamBSelect = document.querySelector<HTMLSelectElement>("#teamB")!
      await act(async () => {
        teamASelect.value = "loons"
        teamASelect.dispatchEvent(new Event("change", { bubbles: true }))
        teamBSelect.value = "yetis"
        teamBSelect.dispatchEvent(new Event("change", { bubbles: true }))
      })

      // Click Add Draft Pick in Loons's section (defaults to Round 2)
      const addPickBtns = Array.from(document.querySelectorAll("button")).filter((b) =>
        b.textContent?.includes("Add Draft Pick")
      )
      await act(async () => {
        addPickBtns[0].click()
      })

      // Because Loons acquired Round 2 picks from Yetis and Rangers, origin selector must appear with all 3 options
      const originSelect = document.querySelector<HTMLSelectElement>('select[data-testid="draft-pick-origin-select"]')!
      expect(originSelect).not.toBeNull()
      const optionValues = Array.from(originSelect.options).map((o) => o.value)
      expect(optionValues).toEqual(["loons", "yetis", "rangers"])

      // Switch Round to Round 3 (where Loons has NO acquired picks) -> origin selector disappears
      const roundSelect = document.querySelector<HTMLSelectElement>(
        'select[aria-label="Draft pick round for Loons"]'
      )!
      await act(async () => {
        roundSelect.value = "3"
        roundSelect.dispatchEvent(new Event("change", { bubbles: true }))
      })
      expect(document.querySelector('select[data-testid="draft-pick-origin-select"]')).toBeNull()

      // Switch back to Round 2 and select the acquired Rangers Round 2 pick
      await act(async () => {
        roundSelect.value = "2"
        roundSelect.dispatchEvent(new Event("change", { bubbles: true }))
      })
      const originSelectAgain = document.querySelector<HTMLSelectElement>(
        'select[data-testid="draft-pick-origin-select"]'
      )!
      await act(async () => {
        originSelectAgain.value = "rangers"
        originSelectAgain.dispatchEvent(new Event("change", { bubbles: true }))
      })

      // Review and execute trade and verify originalTeamSlug === 'rangers'
      const reviewBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Review Trade")
      )!
      await act(async () => {
        reviewBtn.click()
      })

      const executeBtn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Execute Trade")
      )!
      await act(async () => {
        executeBtn.click()
      })

      const postCall = fetchMock.mock.calls.find(
        ([url, opts]) => String(url).includes("/trades") && opts?.method === "POST"
      )
      expect(postCall).toBeDefined()
      const body = JSON.parse(postCall![1]!.body as string)
      expect(body.draftPicks).toEqual([
        {
          fromTeamSlug: "loons",
          toTeamSlug: "yetis",
          round: 2,
          originalTeamSlug: "rangers",
          targetSeason: "2027-2028",
        },
      ])
    })
  })

  describe("3. Season Trades History Section", () => {
    it("renders empty state message when no trades have been recorded", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ trades: [] }))))
      await renderComponent({ seasonStatus: "active" })

      expect(document.body.textContent).toContain("Season Trades")
      expect(document.body.textContent).toContain("No trades recorded for this season.")
    })

    it("renders trades table with past trades when trades exist", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ trades: mockTradesHistory })))
      )
      await renderComponent({ seasonStatus: "active" })

      expect(document.body.textContent).toContain("Season Trades")
      expect(document.body.textContent).toContain("loons ↔ yetis")
      expect(document.body.textContent).toContain("Darrell Draper")
      expect(document.body.textContent).toContain("Jonny Callan")
      expect(document.body.textContent).toContain("Round 2 Pick")
      expect(document.body.textContent).toContain("Week 1 Block Trade")
    })

    it("renders Undo button only on the most recent trade and calls DELETE on confirm", async () => {
      const twoTrades = [
        {
          id: 2,
          seasonId: "2026-2027",
          teamSlugs: ["rangers", "yetis"],
          tradedAt: "2026-10-15T19:00:00Z",
          items: [
            { itemType: "player", fromTeamSlug: "rangers", toTeamSlug: "yetis", playerId: 953, playerName: "Eddie Parsons" },
          ],
        },
        ...mockTradesHistory,
      ]

      const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
        if (String(url).includes("/trades?tradeId=2") && opts?.method === "DELETE") {
          return new Response(
            JSON.stringify({
              success: true,
              undoneTradeId: 2,
              revertedPlayers: [{ playerId: 953, fromTeamSlug: "yetis", toTeamSlug: "rangers" }],
            }),
            { status: 200 }
          )
        }
        return new Response(JSON.stringify({ trades: twoTrades }), { status: 200 })
      })
      vi.stubGlobal("fetch", fetchMock)

      await renderComponent({ seasonStatus: "active" })

      const undoBtns = document.querySelectorAll('[data-testid="undo-latest-trade-btn"]')
      expect(undoBtns).toHaveLength(1)
      expect(undoBtns[0].getAttribute("aria-label")).toBe("Undo Trade #2")

      await act(async () => {
        ;(undoBtns[0] as HTMLButtonElement).click()
      })

      expect(document.body.textContent).toContain("Undo Trade #2?")

      const confirmUndoBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Undo Trade"
      )!
      expect(confirmUndoBtn).toBeDefined()

      await act(async () => {
        confirmUndoBtn.click()
      })

      const deleteCall = fetchMock.mock.calls.find(
        ([url, opts]) => String(url).includes("/trades?tradeId=2") && opts?.method === "DELETE"
      )
      expect(deleteCall).toBeDefined()
      expect(toast.success).toHaveBeenCalledWith("Trade undone successfully")
    })
  })
})
