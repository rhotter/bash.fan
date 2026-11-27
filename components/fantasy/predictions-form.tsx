"use client"

import { X } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"
import { UnsavedBadge } from "@/components/fantasy/unsaved-badge"
import { GAME_CARD_CLASS, GameCardStatusBar, GameCardTeam } from "@/components/game-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { saveRequest, type SaveTarget } from "@/components/fantasy/save-target"
import { errorMessage, fetchApi, readApiJson } from "@/lib/api-errors"
import { isValidPrediction, MAX_PREDICTED_SCORE, type Prediction } from "@/lib/fantasy/pickem"
import type { PredictionError } from "@/lib/fantasy/predictions"
import type { WeekOverview } from "@/lib/fantasy/week"
import { cn } from "@/lib/utils"

const ERRORS: Record<PredictionError, string> = {
  "tied-score": "A game can't end tied: pick a winner.",
  "unknown-game": "One of these games isn't in this Week.",
  "duplicate-game": "A game can appear only once.",
}

type Boxes = Record<string, { home: string; away: string }>

function initialBoxes(overview: WeekOverview, saved: Prediction[]): Boxes {
  const byGame = new Map(saved.map((p) => [p.gameId, p]))
  return Object.fromEntries(
    overview.games.map(({ id }) => {
      const p = byGame.get(id)
      return [id, { home: p ? String(p.homeScore) : "", away: p ? String(p.awayScore) : "" }]
    })
  )
}

/** Blank boxes skip a game. Anything else must be a whole score with a winner. */
function readBoxes(overview: WeekOverview, boxes: Boxes) {
  const predictions: Prediction[] = []
  for (const game of overview.games) {
    const { home, away } = boxes[game.id]
    if (home.trim() === "" && away.trim() === "") continue
    const homeScore = home.trim() === "" ? NaN : Number(home)
    const awayScore = away.trim() === "" ? NaN : Number(away)
    const label = `${game.home.name} vs ${game.away.name}`
    if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) {
      return { error: `${label}: enter both scores, or clear both to skip the game.` }
    }
    if (!Number.isInteger(homeScore) || homeScore < 0 || awayScore < 0 || homeScore > MAX_PREDICTED_SCORE || awayScore > MAX_PREDICTED_SCORE) {
      return { error: `${label}: scores are whole numbers from 0 to ${MAX_PREDICTED_SCORE}.` }
    }
    const prediction = { gameId: game.id, homeScore, awayScore }
    if (!isValidPrediction(prediction)) return { error: `${label}: a game can't end tied, so pick a winner.` }
    predictions.push(prediction)
  }
  return { predictions }
}

function ScoreBox({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={0}
      max={MAX_PREDICTED_SCORE}
      step={1}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-16 shrink-0 px-2 text-center tabular-nums"
    />
  )
}

export function PredictionsFormPanel({
  overview,
  saved,
  week,
  onDirtyChange,
  ...target
}: {
  overview: WeekOverview
  saved: Prediction[]
  week: { id: string }
  /** Told whether there's something unsaved. Leaving the form counts as nothing unsaved. */
  onDirtyChange?: (dirty: boolean) => void
} & SaveTarget) {
  const isAdmin = target.adminUrl !== undefined
  const [boxes, setBoxes] = useState(() => initialBoxes(overview, saved))
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null)

  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])

  function change(gameId: string, side: "home" | "away", value: string) {
    setBoxes({ ...boxes, [gameId]: { ...boxes[gameId], [side]: value } })
    setMessage(null)
    setDirty(true)
  }

  function clear(gameId: string) {
    setBoxes({ ...boxes, [gameId]: { home: "", away: "" } })
    setMessage(null)
    setDirty(true)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const read = readBoxes(overview, boxes)
    if (read.error !== undefined) return setMessage({ text: read.error, failed: true })

    setSaving(true)
    setMessage(null)
    try {
      const { url, init } = saveRequest(target, "predictions", { weekId: week.id, predictions: read.predictions })
      const response = await fetchApi(url, init)
      const body = await readApiJson(response)
      if (response.ok) {
        setDirty(false)
        setMessage({ text: isAdmin ? "Saved." : "Saved. You can keep editing until it closes.", failed: false })
        target.onSaved?.()
      } else if (response.status === 401 && !isAdmin) {
        setMessage({ text: "This Manager Link is no longer valid. Ask an admin to reissue it.", failed: true })
      } else if (Array.isArray(body.errors)) {
        setMessage({ text: (body.errors as PredictionError[]).map((e) => ERRORS[e] ?? body.error).join(" "), failed: true })
      } else {
        setMessage({ text: body.error, failed: true })
      }
    } catch (err) {
      setMessage({ text: errorMessage(err), failed: true })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-6 space-y-6">
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Pick the winner of each game.</span> Standings rank by how many
          winners you get right.
        </p>
        <p>
          Enter a final score to make your pick. The scores only break ties, favoring whoever is closest in total
          goals. Leave a game blank to skip it, with no penalty.
        </p>
        {!dirty && <p>{saved.length > 0 ? "Your saved Predictions are shown." : "Nothing saved for this Week yet."}</p>}
      </div>

      <ul className="space-y-3">
        {overview.games.map((game) => {
          const box = boxes[game.id]
          const home = Number(box.home)
          const away = Number(box.away)
          const filled = box.home.trim() !== "" && box.away.trim() !== "" && home !== away
          const winner = filled ? (home > away ? game.home.name : game.away.name) : null
          const matchup = `${game.home.name} vs ${game.away.name}`
          const entered = box.home !== "" || box.away !== ""
          return (
            <li key={game.id} className={GAME_CARD_CLASS}>
              <GameCardStatusBar>
                <span className="text-[10px] text-muted-foreground/50">{game.startLabel}</span>
                {/* Always laid out, so the card doesn't jump when the button appears. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn("-mr-1.5 size-6", !entered && "invisible")}
                  aria-label={`Clear ${matchup}`}
                  title="Clear this game"
                  onClick={() => clear(game.id)}
                >
                  <X aria-hidden />
                </Button>
              </GameCardStatusBar>
              <div className="flex flex-col gap-1.5 px-3 py-2">
                {(["away", "home"] as const).map((side) => (
                  <GameCardTeam key={side} {...game[side]} won={winner === game[side].name}>
                    <ScoreBox label={`${game[side].name} score, ${matchup}`} value={box[side]} onChange={(v) => change(game.id, side, v)} />
                  </GameCardTeam>
                ))}
              </div>
              <p className="border-t border-border/20 bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground" aria-live="polite">
                {winner ? <>Your pick: <span className="font-medium text-foreground">{winner}</span> wins</> : "No pick yet"}
              </p>
            </li>
          )
        })}
      </ul>

      {message && (
        <p role={message.failed ? "alert" : "status"} className={message.failed ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {message.text}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Predictions"}</Button>
        {dirty && <UnsavedBadge />}
      </div>
    </form>
  )
}
