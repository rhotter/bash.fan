"use client"

import { Check, ChevronDown, X } from "lucide-react"
import { useState } from "react"
import { IntentLink } from "@/components/intent-link"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OpenContestList } from "@/components/fantasy/open-contests"
import { PickRow, pickedSide } from "@/components/fantasy/pick-row"
import { FantasyStandingsTable } from "@/components/fantasy/standings-table"
import { ProvisionalBadge, WEEK_NAV_CLASS } from "@/components/fantasy/week-row"
import { WeekOverviewPanel } from "@/components/fantasy/week-overview"
import { playerSlug } from "@/lib/player-slug"
import { weekLabel } from "@/lib/fantasy/week"
import { contestLabel, fantasyHref, type FantasyTab, type FantasyView } from "@/lib/fantasy/view-state"
import { cn } from "@/lib/utils"
import type { PickemWeek, PickemWeekRow, PredictionOutcome, PublicPrediction } from "@/lib/fantasy/pickem"
import type { PublicSelection } from "@/lib/fantasy/standings"
import type { WeekOverview } from "@/lib/fantasy/week"
import type { FantasyPageData } from "@/lib/fetch-fantasy"

function closingLabel(data: FantasyPageData) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: data.timeZone,
    timeZoneName: "short",
  }).format(new Date(data.nextLockAt))
}

function outcomeLabel({ outcome, isBackup }: PublicSelection, provisional: boolean) {
  if (outcome === "absent") return "Absent"
  if (outcome === "pending") return "Not scored yet"
  // While the Week is provisional, a Backup may still come in for an absent starter.
  if (outcome === "unused") return provisional ? "Not scored yet" : "Not needed"
  return isBackup ? "Came in" : null
}

type ChangeView = (view: FantasyView) => void

/** A real link, so it still works without scripts, that switches the view in place instead of navigating. */
function ViewLink({ view, switchTo, ...props }: { view: FantasyView; switchTo: ChangeView } & Omit<React.ComponentProps<typeof IntentLink>, "href" | "onClick">) {
  return (
    <IntentLink
      {...props}
      href={fantasyHref(view)}
      prefetch={false}
      scroll={false}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        switchTo(view)
      }}
    />
  )
}

function WeekPicker({
  weekIds,
  view,
  switchTo,
}: {
  weekIds: string[]
  view: FantasyView
  switchTo: ChangeView
}) {
  return (
    <nav aria-label="Weeks" className={WEEK_NAV_CLASS}>
      {weekIds.map((id) => (
        <ViewLink
          key={id}
          view={{ ...view, weekId: id }}
          switchTo={switchTo}
          aria-current={id === view.weekId ? "page" : undefined}
          className={cn(
            "shrink-0 rounded-md px-2 py-1 text-xs font-semibold transition-colors",
            id === view.weekId ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {weekLabel(id)}
        </ViewLink>
      ))}
    </nav>
  )
}

const TABS: { tab: FantasyTab; label: string }[] = [
  { tab: "fantasy", label: "Fantasy" },
  { tab: "pickem", label: "Pick'em" },
]

function TabNav({ view, switchTo }: { view: FantasyView; switchTo: ChangeView }) {
  return (
    <nav aria-label="Game" className="flex gap-1 border-b border-border">
      {TABS.map(({ tab, label }) => (
        <ViewLink
          key={tab}
          view={{ ...view, tab }}
          switchTo={switchTo}
          aria-current={tab === view.tab ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors",
            tab === view.tab
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {label}
        </ViewLink>
      ))}
    </nav>
  )
}

function GoalieTag() {
  return <span className="rounded bg-foreground px-1 text-[10px] font-bold leading-4 text-background">G</span>
}

function BackupTag() {
  return <span className="rounded border border-border px-1 text-[10px] font-semibold leading-4 text-muted-foreground">BACKUP</span>
}

/** The admin's view of a Week's Selections, listing every Backup. Each game gets one line of stats. */
export function BoxScore({
  selections,
  provisional,
}: {
  selections: PublicSelection[]
  provisional: boolean
}) {
  return (
    <div className="space-y-3 px-3 py-3">
      {selections.map((selection) => {
        const note = selection.outcome === "played" ? null : outcomeLabel(selection, provisional)
        return (
          <section key={`${selection.kind}-${selection.playerId}`} className={cn(selection.outcome !== "played" && "opacity-70")}>
            <h3 className="flex items-center gap-2 text-sm">
              {selection.kind === "goalie" && <GoalieTag />}
              <IntentLink href={`/player/${playerSlug(selection.playerName)}`} className="font-medium hover:underline">
                {selection.playerName}
              </IntentLink>
              {selection.isBackup && <BackupTag />}
              <span className="ml-auto font-semibold tabular-nums">{selection.points}</span>
            </h3>
            {selection.games.length === 0 ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{note ?? "No games"}</p>
            ) : (
              <ul className="mt-1 space-y-0.5 border-l-2 border-border pl-3">
                {selection.games.map((game) => (
                  <li key={game.gameId} className="flex items-baseline gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate tabular-nums text-muted-foreground">
                      {game.stats.map(({ label, value }) => `${label} ${value}`).join("  ")}
                    </span>
                    <span className="shrink-0 tabular-nums">{game.points}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}

export type StandingsRange = "season" | "weekly"

/** One column at a time, so each list gets the full width. */
function StandingsToggle({
  which,
  onChange,
  weekly,
  season,
}: {
  which: StandingsRange
  onChange: (which: StandingsRange) => void
  weekly: { provisional?: boolean; children: React.ReactNode }
  season: { provisional?: boolean; children: React.ReactNode }
}) {
  const pages = { weekly, season }
  return (
    <Tabs value={which} onValueChange={(value) => onChange(value as StandingsRange)} className="gap-3">
      <div className="flex items-center justify-between gap-2">
        <TabsList aria-label="Standings">
          <TabsTrigger value="season">Season</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
        </TabsList>
        {pages[which].provisional && <ProvisionalBadge />}
      </div>
      <TabsContent value={which} aria-label={`${which === "weekly" ? "Weekly" : "Season"} standings`} className="min-w-0">
        {pages[which].children}
      </TabsContent>
    </Tabs>
  )
}

const OUTCOMES: Record<PredictionOutcome, string> = {
  correct: "Correct winner",
  wrong: "Wrong winner",
  pending: "Not scored yet",
  void: "Forfeited, doesn't count",
}

/** What happened in one game, and how the Prediction did. A game without one was skipped. */
function PredictionVerdict({ result, prediction }: { result: WeekOverview["games"][number]["result"]; prediction: PublicPrediction | undefined }) {
  const outcome = prediction?.outcome
  const scored = outcome === "correct" || outcome === "wrong"
  const off =
    scored && prediction && result
      ? Math.abs(prediction.homeScore - result.homeScore) + Math.abs(prediction.awayScore - result.awayScore)
      : null
  return (
    <p className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {result && (
        <span className="font-semibold text-foreground">
          Final {result.awayScore}–{result.homeScore}
        </span>
      )}
      <span
        className={cn(
          "flex items-center gap-1",
          scored && "font-semibold",
          outcome === "correct" && "text-green-700",
          outcome === "wrong" && "text-destructive"
        )}
      >
        {outcome === "correct" && <Check aria-hidden className="size-4" />}
        {outcome === "wrong" && <X aria-hidden className="size-4" />}
        {outcome ? OUTCOMES[outcome] : "Skipped"}
        {off !== null && `, ${off} ${off === 1 ? "goal" : "goals"} off`}
      </span>
    </p>
  )
}

function PredictedScore({ score }: { score: number | undefined }) {
  return (
    // The spoken summary of each game carries the scores.
    <span aria-hidden className="grid h-13 w-14 place-items-center rounded-lg border border-border bg-card text-2xl font-bold tabular-nums">
      {score ?? <span className="text-muted-foreground">–</span>}
    </span>
  )
}

/** A Week's Predictions in the entry form's layout, read only. Every game is listed, skipped ones too. */
export function Predictions({ row, games }: { row: { predictions: PickemWeekRow["predictions"] }; games: WeekOverview["games"] }) {
  return (
    <div className="@container">
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-muted/40">
        {games.map((game) => {
          const p = row.predictions.find((prediction) => prediction.gameId === game.id)
          return (
            <li key={game.id}>
              <p className="sr-only">
                {game.home.name} vs {game.away.name}, {p ? `predicted ${p.homeScore} – ${p.awayScore}` : "no Prediction"}
              </p>
              <PickRow
                game={game}
                picked={p ? pickedSide(p.awayScore, p.homeScore) : null}
                scores={{ away: <PredictedScore score={p?.awayScore} />, home: <PredictedScore score={p?.homeScore} /> }}
              >
                <PredictionVerdict result={game.result} prediction={p} />
              </PickRow>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The columns every Pick'em standings row shares with its heading. */
function PickemColumns({ rank, name, correct, goalError }: { rank: number; name: React.ReactNode; correct: number; goalError: number }) {
  return (
    <>
      <span className="w-7 font-semibold">{rank}</span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="w-14 text-right text-base font-bold">
        {correct}
        <span className="sr-only"> correct</span>
      </span>
      <span className="w-16 text-right text-muted-foreground">
        {goalError}
        <span className="sr-only"> goals off</span>
      </span>
    </>
  )
}

/** Pick'em standings as a table in the Fantasy standings' style. */
function PickemTable({ expandable, children }: { expandable?: boolean; children: React.ReactNode }) {
  return (
    <div className="border-t-2 border-foreground">
      <div aria-hidden className="flex items-center gap-2 border-b border-border px-2 py-1.5 text-xs text-muted-foreground">
        <span className="w-7">Rank</span>
        <span className="flex-1">Team</span>
        <span className="w-14 text-right">Correct</span>
        <span className="w-16 text-right">Goals off</span>
        {expandable && <span className="w-4" />}
      </div>
      <ol>{children}</ol>
    </div>
  )
}

/** Links by id, because Team Names can be renamed. Sits above a row's expand button. */
function ManagerLink({ managerId, teamName }: { managerId: number; teamName: string }) {
  return (
    <IntentLink href={`/fantasy/manager/${managerId}`} className="relative font-semibold hover:underline">
      {teamName}
    </IntentLink>
  )
}

function PickemWeekStandings({ week, overview }: { week: PickemWeek; overview: WeekOverview | undefined }) {
  const [open, setOpen] = useState<number | null>(null)
  if (week.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No Predictions were made this Week.</p>
  }
  return (
    <PickemTable expandable>
      {week.rows.map((row) => {
        const isOpen = open === row.managerId
        return (
          <li key={row.managerId} className={cn("border-b border-border", isOpen && "bg-muted/60")}>
            <div className="relative flex items-center gap-2 px-2 py-2.5 text-sm tabular-nums hover:bg-muted/60">
              {/* Covers the row, so everywhere but the Team Name opens it. */}
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={`Predictions for ${row.teamName}`}
                onClick={() => setOpen(isOpen ? null : row.managerId)}
                className="absolute inset-0 w-full cursor-pointer"
              />
              <PickemColumns rank={row.rank} name={<ManagerLink {...row} />} correct={row.correct} goalError={row.goalError} />
              <ChevronDown aria-hidden className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
            </div>
            {isOpen && (
              <div className="pb-3 pt-1 sm:px-2">
                <Predictions row={row} games={overview?.games ?? []} />
              </div>
            )}
          </li>
        )
      })}
    </PickemTable>
  )
}

function PickemSeasonTable({ season }: { season: FantasyPageData["pickem"]["season"] }) {
  if (season.rows.length === 0) return <p className="text-sm text-muted-foreground">No Predictions yet.</p>
  return (
    <PickemTable>
      {season.rows.map((row) => (
        <li key={row.managerId} className="flex items-center gap-2 border-b border-border px-2 py-2.5 text-sm tabular-nums">
          <PickemColumns rank={row.rank} name={<ManagerLink {...row} />} correct={row.correct} goalError={row.goalError} />
        </li>
      ))}
    </PickemTable>
  )
}

/** Contests are separate games with their own Managers, so each is its own page rather than an in-place switch. */
function ContestNav({ data }: { data: FantasyPageData }) {
  return (
    <nav aria-label="Contests" className="flex flex-wrap gap-1">
      {data.contests.map((key) => (
        <IntentLink
          key={key}
          href={fantasyHref({ tab: "fantasy", weekId: null, contest: key })}
          aria-current={key === data.contest ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1 text-sm font-semibold transition-colors",
            key === data.contest ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {contestLabel(key)}
        </IntentLink>
      ))}
    </nav>
  )
}

/** Everything it needs is already here, so the tab and Week switch in place and only rewrite the URL. */
export function FantasyStandingsView({
  data,
  view: initialView,
  initialRange = "season",
}: {
  data: FantasyPageData
  view: FantasyView
  /** The page opens on the overall standings. A link that names a Week opens on that Week's. */
  initialRange?: StandingsRange
}) {
  // Each game remembers its own choice.
  const [ranges, setRanges] = useState<Record<FantasyTab, StandingsRange>>({ fantasy: initialRange, pickem: initialRange })
  // With more than one contest, every link and rewritten URL names this one, so a reload or a shared link stays on it.
  const [view, setView] = useState(() =>
    data.contests.length > 1 ? { ...initialView, contest: data.contest } : initialView
  )
  const { weeks, season, overviews, pickem } = data

  function changeView(next: FantasyView) {
    setView(next)
    window.history.replaceState(null, "", fantasyHref(next))
  }
  const setRange = (range: StandingsRange) => setRanges({ ...ranges, [view.tab]: range })

  /** Picking a Week is asking for its results. */
  function changeWeek(next: FantasyView) {
    setRanges({ fantasy: "weekly", pickem: "weekly" })
    changeView(next)
  }
  const weekIds = Object.keys(overviews).sort()
  const pickemWeek = pickem.weeks.find((w) => w.id === view.weekId)
  const overview = view.weekId ? overviews[view.weekId] : undefined

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fantasy</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.status === "upcoming"
              ? "This run hasn't started. You can join and make picks now."
              : data.status === "active"
                ? `Lineups and Predictions close ${closingLabel(data)}`
                : data.status === "final-week"
                  ? "Picks are closed: the last Week is being played."
                  : "This run has ended."}
          </p>
        </div>
        {(data.status === "active" || data.status === "upcoming") && (
          <Button asChild size="sm">
            <IntentLink href={`/fantasy/register?contest=${encodeURIComponent(data.contest)}`}>Join Fantasy</IntentLink>
          </Button>
        )}
      </div>

      {data.contests.length > 1 && <ContestNav data={data} />}

      <OpenContestList contests={data.otherOpenContests} />

      {/* An upcoming run has no Week to show until its games are scheduled. */}
      {(data.status !== "upcoming" || weekIds.length > 0) && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{view.weekId ? `Week of ${weekLabel(view.weekId)}` : "This Week"}</h2>
            {weekIds.length > 1 && view.weekId && <WeekPicker weekIds={weekIds} view={view} switchTo={changeWeek} />}
          </div>
          {overview ? (
            <WeekOverviewPanel overview={overview} />
          ) : (
            <p className="text-sm text-muted-foreground">No Weeks yet.</p>
          )}
        </div>
      )}

      <TabNav view={view} switchTo={changeView} />

      {view.tab === "fantasy" ? (
        <FantasyStandingsTable
          weeks={weeks}
          season={season}
          scope={ranges.fantasy === "season" ? { range: "season" } : { range: "weekly", weekId: view.weekId }}
          onSeason={() => setRange("season")}
          onWeek={(weekId) => changeWeek({ ...view, weekId })}
        />
      ) : (
        <div className="mx-auto max-w-3xl space-y-3">
          <p className="text-sm text-muted-foreground">
            Ranked by winners picked correctly. Predicted scores only break ties: fewer total goals off ranks higher.
          </p>
          <StandingsToggle
            which={ranges.pickem}
            onChange={setRange}
            weekly={{
              provisional: pickemWeek?.provisional,
              children: pickemWeek ? (
                <PickemWeekStandings key={pickemWeek.id} week={pickemWeek} overview={overview} />
              ) : (
                <p className="text-sm text-muted-foreground">Predictions appear after this Week closes.</p>
              ),
            }}
            season={{ provisional: pickem.season.provisional, children: <PickemSeasonTable season={pickem.season} /> }}
          />
        </div>
      )}
    </div>
  )
}
