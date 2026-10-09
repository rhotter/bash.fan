"use client"

import { useState, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import type { LiveGameState, RosterPlayer } from "@/lib/scorekeeper-types"
import { GoalsEditor } from "./goals-editor"
import { PenaltiesEditor } from "./penalties-editor"
import { ShotsEditor } from "./shots-editor"
import { AttendanceEditor } from "./attendance-editor"
import { GoaliePullsEditor } from "./goalie-pulls-editor"
import { GoalieChangesEditor } from "./goalie-changes-editor"
import { OfficialsEditor } from "./officials-editor"
import { NotesEditor } from "./notes-editor"
import { ThreeStarsEditor } from "./three-stars-editor"
import { gameEditMode } from "@/lib/game-edit-mode"
import { GoalieShotAllocation, type ShotAllocationGoalie } from "@/components/scorekeeper/shared/goalie-shot-allocation"
import { ShootoutEditor } from "./shootout-editor"

interface AdminGameEditorProps {
  gameId: string
  state: LiveGameState
  pin: string
  homeSlug: string
  awaySlug: string
  homeTeam: string
  awayTeam: string
  homeRoster: RosterPlayer[]
  awayRoster: RosterPlayer[]
  playerNames: Record<number, string>
  savedGoalies: ShotAllocationGoalie[]
  onClose: () => void
  onSaved: () => void
}

export function AdminGameEditor({
  gameId, state: initialState, pin,
  homeSlug, awaySlug, homeTeam, awayTeam,
  homeRoster, awayRoster, playerNames, savedGoalies,
  onClose, onSaved,
}: AdminGameEditorProps) {
  const [state, setState] = useState<LiveGameState>(() => {
    const s = structuredClone(initialState)
    // Ensure optional array fields exist (older games may not have them)
    if (!s.goaliePulls) s.goaliePulls = []
    if (!s.goalieChanges) s.goalieChanges = []
    if (!s.timeouts) s.timeouts = []
    return s
  })
  const savedState = useRef(initialState)
  const needsFinalization = useRef(initialState.finalizationPending?.phase === "failed")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [forfeited, setForfeited] = useState(false)

  const nameById = useCallback((id: number | null): string | null => {
    if (id == null) return null
    if (playerNames[id]) return playerNames[id]
    const allRoster = [...homeRoster, ...awayRoster]
    const player = allRoster.find((p) => p.id === id)
    return player?.name ?? `#${id}`
  }, [playerNames, homeRoster, awayRoster])

  const allocationGoalies = [...savedGoalies]
  for (const [slug, team, assigned] of [[homeSlug, homeTeam, state.homeGoalieId], [awaySlug, awayTeam, state.awayGoalieId]] as const) {
    const ids = [assigned, ...(state.goalieChanges ?? []).filter((c) => c.team === slug).flatMap((c) => [c.outGoalieId, c.inGoalieId])]
    for (const id of ids) {
      if (id != null && !allocationGoalies.some((g) => g.id === id)) allocationGoalies.push({ id, name: nameById(id) ?? `#${id}`, team })
    }
  }

  function updateState(patch: Partial<LiveGameState>) {
    setState((prev) => ({ ...prev, ...patch }))
  }

  async function handleSave() {
    if (saving || forfeited) return
    setSaving(true)
    setError("")
    try {
      const mode = gameEditMode(savedState.current, state)
      if (mode === "unchanged" && !needsFinalization.current) { onSaved(); return }
      // A shot-only correction never replays historical events. Full edits are
      // validated together by finalization before the proposed state is saved.
      const shotsOnly = mode === "shots" && !needsFinalization.current
      const response = await fetch(`/api/bash/scorekeeper/${gameId}/${shotsOnly ? "state" : "finalize"}`, {
        method: shotsOnly ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "x-pin": pin },
        body: JSON.stringify(shotsOnly ? {
          expectedState: savedState.current, homeShots: state.homeShots, awayShots: state.awayShots,
          goalieShotsAgainst: state.goalieShotsAgainst,
        } : { expectedState: savedState.current, state: { ...state, updatedAt: Date.now() } }),
      })
      const result = await response.json().catch(() => ({}))
      if (result.code === "GAME_FORFEITED") {
        setForfeited(true)
        needsFinalization.current = false
        setError(result.error || "This game was forfeited. Live finalization has been canceled.")
        // Only accept a confirmed clean snapshot. A reload-required response
        // must not make us clear a different, still-running claim locally.
        if (result.finalizationCanceled && result.state && !result.reloadRequired && !result.state.finalizationPending) {
          savedState.current = result.state
          setState(result.state)
        }
        return
      }
      // A runtime failure after validated state persistence can be retried
      // against that accepted snapshot without losing the user's corrections.
      if (result.stateSaved && result.state) {
        savedState.current = result.state
        setState(result.state)
        needsFinalization.current = true
      }
      if (!response.ok) throw new Error(result.error || "Failed to save game")

      needsFinalization.current = false
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/60 -mx-4 px-4 py-3 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="text-sm font-medium truncate">
          Editing: <span className="text-muted-foreground">{awayTeam} @ {homeTeam}</span>
        </div>
        {error && <span className="text-xs text-destructive">{error}</span>}
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" onClick={onClose} disabled={saving} className="text-xs h-8">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || forfeited} className="text-xs h-8">
            {saving ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </div>

      {forfeited && <p className="mb-4 text-sm">
        <a href={`/game/${gameId}`} className="text-foreground underline">View official game result</a>
      </p>}

      {needsFinalization.current && <p className="mb-4 text-xs text-destructive">The previous save needs to finish rebuilding its statistics. Save again to retry.</p>}

      {/* Editor sections */}
      <fieldset disabled={saving || forfeited} className="space-y-8">
        <GoalsEditor
          state={state}
          onChange={(goals) => updateState({ goals })}
          homeSlug={homeSlug} awaySlug={awaySlug}
          homeTeam={homeTeam} awayTeam={awayTeam}
          homeRoster={homeRoster} awayRoster={awayRoster}
          nameById={nameById}
        />

        <PenaltiesEditor
          state={state}
          onChange={(penalties) => updateState({ penalties })}
          homeSlug={homeSlug} awaySlug={awaySlug}
          homeTeam={homeTeam} awayTeam={awayTeam}
          homeRoster={homeRoster} awayRoster={awayRoster}
          nameById={nameById}
        />

        <ShotsEditor
          state={state}
          onChange={updateState}
          homeTeam={homeTeam} awayTeam={awayTeam}
        />

        <GoalieShotAllocation goalies={allocationGoalies} value={state.goalieShotsAgainst}
          onChange={(goalieShotsAgainst) => updateState({ goalieShotsAgainst })} />

        <AttendanceEditor
          state={state}
          onChange={updateState}
          homeSlug={homeSlug} awaySlug={awaySlug}
          homeTeam={homeTeam} awayTeam={awayTeam}
          homeRoster={homeRoster} awayRoster={awayRoster}
        />

        <GoaliePullsEditor
          state={state}
          onChange={(goaliePulls) => updateState({ goaliePulls })}
          homeSlug={homeSlug} awaySlug={awaySlug}
          homeTeam={homeTeam} awayTeam={awayTeam}
        />

        <GoalieChangesEditor
          state={state}
          onChange={(goalieChanges) => updateState({ goalieChanges })}
          homeSlug={homeSlug} awaySlug={awaySlug}
          homeTeam={homeTeam} awayTeam={awayTeam}
          homeRoster={homeRoster} awayRoster={awayRoster}
          nameById={nameById}
        />

        <OfficialsEditor
          state={state}
          onChange={(officials) => updateState({ officials })}
        />

        <ThreeStarsEditor
          state={state}
          onChange={(threeStars) => updateState({ threeStars })}
          homeRoster={homeRoster} awayRoster={awayRoster}
        />

        <ShootoutEditor
          state={state}
          onChange={(shootout) => updateState({ shootout })}
          homeSlug={homeSlug} awaySlug={awaySlug}
          homeTeam={homeTeam} awayTeam={awayTeam}
          homeRoster={homeRoster} awayRoster={awayRoster}
        />

        <NotesEditor
          state={state}
          onChange={(notes) => updateState({ notes })}
        />
      </fieldset>
    </div>
  )
}
