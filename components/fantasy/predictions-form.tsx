"use client"

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react"
import { PickRow, pickedSide, SIDES, type Side } from "@/components/fantasy/pick-row"
import { UnsavedBadge } from "@/components/fantasy/unsaved-badge"
import { ByeTeams } from "@/components/fantasy/week-overview"
import { Button } from "@/components/ui/button"
import { saveRequest, type SaveTarget } from "@/components/fantasy/save-target"
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

/** A refresh can add a game to the Week after the boxes were built, so it may have none yet. */
const boxesFor = (boxes: Boxes, gameId: string) => boxes[gameId] ?? { home: "", away: "" }

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
    const { home, away } = boxesFor(boxes, game.id)
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

/** Moves on once a score is typed. A lone 1 waits, as it could be the start of 10 or more. */
function advance(event: ChangeEvent<HTMLInputElement>, value: string) {
  const { inputType } = event.nativeEvent as InputEvent
  if (value === "" || value === "1" || inputType?.startsWith("delete")) return
  const inputs = [...(event.target.form?.querySelectorAll("input") ?? [])]
  inputs[inputs.indexOf(event.target) + 1]?.focus()
}

function ScoreBox({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    // A text box, since a number box can't be selected or limited to two digits.
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={2}
      autoComplete="off"
      aria-label={label}
      value={value}
      onFocus={(event) => event.target.select()}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, "").slice(0, 2)
        onChange(digits)
        advance(event, digits)
      }}
      className="h-13 w-14 rounded-lg border border-input bg-card text-center text-2xl font-bold tabular-nums outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
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

  function change(gameId: string, side: Side, value: string) {
    setBoxes({ ...boxes, [gameId]: { ...boxesFor(boxes, gameId), [side]: value } })
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

  const reads = overview.games.map((game) => {
    const { home, away } = boxesFor(boxes, game.id)
    const complete = home !== "" && away !== ""
    return { game, home, away, picked: complete ? pickedSide(Number(away), Number(home)) : null, tied: complete && Number(home) === Number(away) }
  })
  const pickedCount = reads.filter(({ picked }) => picked !== null).length

  return (
    <form onSubmit={submit} noValidate className="@container mt-6">
      {/* Locked while saving, so nothing changed meanwhile can read as saved. */}
      <fieldset disabled={saving} className="min-w-0 space-y-4">
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Pick the winner of each game</span> by giving it the higher
            score. Winners decide the standings, and scores only break ties, favoring whoever is closest in total goals.
          </p>
          <p>Leave both boxes empty to skip a game, with no penalty.</p>
          {!dirty && <p>{saved.length > 0 ? "Your saved Predictions are shown." : "Nothing saved for this Week yet."}</p>}
        </div>

        {/* `clip` rounds the corners without stopping the Save bar from sticking. */}
        <div className="overflow-clip rounded-xl border border-border bg-card">
          <ul className="divide-y divide-border">
            {reads.map(({ game, home, away, picked, tied }) => {
              const matchup = `${game.home.name} vs ${game.away.name}`
              const entered = home !== "" || away !== ""
              return (
                <li key={game.id}>
                  <PickRow
                    game={game}
                    picked={picked}
                    scores={Object.fromEntries(
                      SIDES.map((side) => [
                        side,
                        <ScoreBox
                          key={side}
                          label={`${game[side].name} score, ${matchup}`}
                          value={side === "home" ? home : away}
                          onChange={(value) => change(game.id, side, value)}
                        />,
                      ])
                    ) as Record<Side, React.ReactNode>}
                    // Always laid out, so the row doesn't jump when the button appears.
                    action={
                      <Button
                        type="button"
                        variant="link"
                        className={entered ? "h-6 p-0 text-xs text-muted-foreground underline" : "invisible h-6 p-0 text-xs"}
                        aria-label={`Clear ${matchup}`}
                        onClick={() => clear(game.id)}
                      >
                        Clear
                      </Button>
                    }
                  >
                    <p className="sr-only" aria-live="polite">
                      {picked ? `Your pick: ${game[picked].name} wins` : "No pick yet"}
                    </p>
                    {tied && <p className="mt-2 text-center text-xs text-destructive">A game can&apos;t end tied. Change one score.</p>}
                    {game.result && (
                      <p className="mt-2 text-center text-xs font-semibold">
                        Final {game.result.awayScore}–{game.result.homeScore}
                      </p>
                    )}
                  </PickRow>
                </li>
              )
            })}
          </ul>

          <div className="sticky bottom-0 flex flex-col gap-2 border-t border-border bg-muted p-3 @min-[34rem]:static @min-[34rem]:flex-row @min-[34rem]:items-center @min-[34rem]:justify-between @min-[34rem]:px-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {message ? (
                <p role={message.failed ? "alert" : "status"} className={message.failed ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                  {message.text}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {pickedCount} of {overview.games.length} games picked
                </p>
              )}
              {dirty && <UnsavedBadge />}
            </div>
            <Button type="submit" disabled={saving} className="@min-[34rem]:shrink-0">
              {saving ? "Saving…" : "Save Predictions"}
            </Button>
          </div>
        </div>

        <ByeTeams teams={overview.byeTeams} />
      </fieldset>
    </form>
  )
}
