"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { errorMessage, fetchApi, readApiJson } from "@/lib/api-errors"
import { isValidPrediction, MAX_PREDICTED_SCORE, type Prediction } from "@/lib/fantasy/pickem"
import type { PredictionError } from "@/lib/fantasy/predictions"
import type { WeekOverview } from "@/lib/fantasy/week"

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
      className="w-16 px-2 text-center tabular-nums"
    />
  )
}

export function PredictionsFormPanel({
  overview,
  saved,
  week,
  token,
}: {
  overview: WeekOverview
  saved: Prediction[]
  week: { id: string; lockAt: string; timeZone: string }
  token: string
}) {
  const [boxes, setBoxes] = useState(() => initialBoxes(overview, saved))
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null)

  const closes = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: week.timeZone,
  }).format(new Date(week.lockAt))

  function change(gameId: string, side: "home" | "away", value: string) {
    setBoxes({ ...boxes, [gameId]: { ...boxes[gameId], [side]: value } })
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
      const response = await fetchApi("/api/bash/fantasy/predictions", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ weekId: week.id, predictions: read.predictions }),
      })
      const body = await readApiJson(response)
      if (response.ok) {
        setDirty(false)
        setMessage({ text: "Saved. You can keep editing until it closes.", failed: false })
      } else if (response.status === 401) {
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
      <p className="text-sm">
        Predictions close <span className="font-medium">{closes}</span>
      </p>
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Pick the winner of each game.</span> Standings rank by how many
          winners you get right.
        </p>
        <p>
          Enter a final score to make your pick. The scores only break ties, favoring whoever is closest in total
          goals. Leave a game blank to skip it, with no penalty.
        </p>
        <p>{dirty ? "Unsaved changes." : saved.length > 0 ? "Your saved Predictions are shown." : "Nothing saved for this Week yet."}</p>
      </div>

      <ul className="space-y-3">
        {overview.games.map((game) => {
          const box = boxes[game.id]
          const home = Number(box.home)
          const away = Number(box.away)
          const filled = box.home.trim() !== "" && box.away.trim() !== "" && home !== away
          const winner = filled ? (home > away ? game.home.name : game.away.name) : null
          return (
            <li key={game.id} className="space-y-2 rounded-md border border-border p-3 text-sm">
              <p className="text-xs text-muted-foreground">{game.startLabel}</p>
              {(
                [
                  ["home", game.home],
                  ["away", game.away],
                ] as const
              ).map(([side, team]) => (
                <div key={side} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">{team.name}</span>
                  <ScoreBox label={`${team.name} score, ${game.home.name} vs ${game.away.name}`} value={box[side]} onChange={(v) => change(game.id, side, v)} />
                </div>
              ))}
              <p className="text-xs text-muted-foreground" aria-live="polite">
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
      <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Predictions"}</Button>
    </form>
  )
}
