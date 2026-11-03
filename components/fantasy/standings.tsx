"use client"

import { Check, Minus, X } from "lucide-react"
import { useState } from "react"
import { IntentLink } from "@/components/intent-link"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Chevron, ProvisionalBadge } from "@/components/fantasy/week-row"
import { WeekOverviewPanel } from "@/components/fantasy/week-overview"
import { playerSlug } from "@/lib/player-slug"
import { weekLabel } from "@/lib/fantasy/week"
import { fantasyHref, type FantasyTab, type FantasyView } from "@/lib/fantasy/view-state"
import { cn } from "@/lib/utils"
import type { PickemWeek, PickemWeekRow, PredictionOutcome } from "@/lib/fantasy/pickem"
import type { PublicSelection, StandingsWeek } from "@/lib/fantasy/standings"
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

/** Links by id, because Team Names can be renamed. */
function ManagerLink({ managerId, teamName }: { managerId: number; teamName: string }) {
  return (
    // The span takes the spare width, so only the name itself is a link and the rest of the row still expands it.
    <span className="min-w-0 flex-1 truncate">
      <IntentLink href={`/fantasy/manager/${managerId}`} className="font-medium hover:underline">
        {teamName}
      </IntentLink>
    </span>
  )
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
  tab,
  selectedId,
  switchTo,
}: {
  weekIds: string[]
  tab: FantasyTab
  selectedId: string
  switchTo: ChangeView
}) {
  return (
    <nav aria-label="Weeks" className="flex gap-1 overflow-x-auto">
      {weekIds.map((id) => (
        <ViewLink
          key={id}
          view={{ tab, weekId: id }}
          switchTo={switchTo}
          aria-current={id === selectedId ? "page" : undefined}
          className={cn(
            "shrink-0 rounded-md px-2 py-1 text-xs font-semibold transition-colors",
            id === selectedId ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
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
          view={{ tab, weekId: view.weekId }}
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

function Medal({ rank }: { rank: number }) {
  const color =
    rank === 1
      ? "bg-amber-400 text-amber-950"
      : rank === 2
        ? "bg-slate-300 text-slate-900"
        : rank === 3
          ? "bg-orange-300 text-orange-950"
          : "bg-secondary text-muted-foreground"
  return <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums", color)}>{rank}</span>
}

function GoalieTag() {
  return <span className="rounded bg-foreground px-1 text-[10px] font-bold leading-4 text-background">G</span>
}

function BackupTag() {
  return <span className="rounded border border-border px-1 text-[10px] font-semibold leading-4 text-muted-foreground">BACKUP</span>
}

/** A Backup only shows once it has actually come in. */
function shownSelections(selections: PublicSelection[]) {
  return selections.filter((s) => !s.isBackup || s.outcome === "played")
}

/** A Week's Selections as a box score. Each game gets one line of stats. */
export function BoxScore({
  selections,
  provisional,
  showIdleBackups = false,
}: {
  selections: PublicSelection[]
  provisional: boolean
  /** Admins see every Backup. The public page hides the ones that never came in. */
  showIdleBackups?: boolean
}) {
  return (
    <div className="space-y-3 px-3 py-3">
      {(showIdleBackups ? selections : shownSelections(selections)).map((selection) => {
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

const PODIUM_STRIPE = ["border-l-amber-400", "border-l-slate-400", "border-l-orange-400"]

function Score({ value, big }: { value: number; big?: boolean }) {
  return <span className={cn("font-bold tabular-nums", big ? "text-2xl" : "text-lg")}>{value}</span>
}

/** One Manager's row in a Weekly list: podium stripe, rank, team and score, with the details when opened. */
function RankedCard({
  rank,
  managerId,
  teamName,
  score,
  children,
}: {
  rank: number
  managerId: number
  teamName: string
  score: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <li>
      <details className={cn("rounded-xl border border-l-4 border-border bg-card", PODIUM_STRIPE[rank - 1] ?? "border-l-border")}>
        <summary className="flex cursor-pointer list-none items-center gap-3 p-3 text-sm [&::-webkit-details-marker]:hidden">
          <span className={cn("w-5 shrink-0 text-right tabular-nums", rank <= 3 ? "font-bold" : "text-muted-foreground")}>{rank}</span>
          <ManagerLink managerId={managerId} teamName={teamName} />
          {score}
          <Chevron />
        </summary>
        <div className="border-t border-border">{children}</div>
      </details>
    </li>
  )
}

/** One row in a Season list. */
function SeasonRow({ rank, managerId, teamName, score }: { rank: number; managerId: number; teamName: string; score: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
      <Medal rank={rank} />
      <ManagerLink managerId={managerId} teamName={teamName} />
      {score}
    </li>
  )
}

function WeekStandings({ week }: { week: StandingsWeek }) {
  if (week.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No Lineups were submitted this Week.</p>
  }
  return (
    <ul className="space-y-2">
      {week.rows.map((row) => (
        <RankedCard key={row.managerId} {...row} score={<Score value={row.points} big={row.rank === 1} />}>
          <BoxScore selections={row.selections} provisional={week.provisional} />
        </RankedCard>
      ))}
    </ul>
  )
}

function SeasonTable({ season }: { season: FantasyPageData["season"] }) {
  if (season.rows.length === 0) return <p className="text-sm text-muted-foreground">No Managers yet.</p>
  return (
    <ol className="space-y-1.5">
      {season.rows.map((row) => (
        <SeasonRow key={row.managerId} {...row} score={<Score value={row.points} />} />
      ))}
    </ol>
  )
}

/** One column at a time, so each list gets the full width. */
function StandingsToggle({
  weekly,
  season,
}: {
  weekly: { provisional?: boolean; children: React.ReactNode }
  season: { provisional?: boolean; children: React.ReactNode }
}) {
  const [which, setWhich] = useState<"weekly" | "season">("weekly")
  const pages = { weekly, season }
  return (
    <Tabs value={which} onValueChange={(value) => setWhich(value as typeof which)} className="mx-auto max-w-xl gap-3">
      <div className="flex items-center justify-between gap-2">
        <TabsList aria-label="Standings">
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="season">Season</TabsTrigger>
        </TabsList>
        {pages[which].provisional && <ProvisionalBadge />}
      </div>
      <TabsContent value={which} aria-label={`${which === "weekly" ? "Weekly" : "Season"} standings`} className="min-w-0">
        {pages[which].children}
      </TabsContent>
    </Tabs>
  )
}

function FantasyStandings({ week, season }: { week: StandingsWeek | undefined; season: FantasyPageData["season"] }) {
  return (
    <StandingsToggle
      weekly={{
        provisional: week?.provisional,
        children: week ? (
          <WeekStandings week={week} />
        ) : (
          <p className="text-sm text-muted-foreground">Standings appear after this Week closes.</p>
        ),
      }}
      season={{ provisional: season.provisional, children: <SeasonTable season={season} /> }}
    />
  )
}

const OUTCOMES: Record<PredictionOutcome, string> = {
  correct: "Correct winner",
  wrong: "Wrong winner",
  pending: "Not scored yet",
  void: "Forfeited, doesn't count",
}

/** A check or X for a scored predicted winner, and a dash for a game with no verdict. Words stay for screen readers. */
function OutcomeMark({ outcome }: { outcome: PredictionOutcome }) {
  const Icon = outcome === "correct" ? Check : outcome === "wrong" ? X : Minus
  return (
    <span className="ml-2 inline-flex align-middle" title={OUTCOMES[outcome]}>
      <Icon aria-hidden className={cn("size-4", outcome === "correct" ? "text-foreground" : "text-muted-foreground")} />
      <span className="sr-only">{OUTCOMES[outcome]}</span>
    </span>
  )
}

function PickemRecord({ correct, goalError, big }: { correct: number; goalError: number; big?: boolean }) {
  return (
    <span className="shrink-0 text-right tabular-nums">
      <Score value={correct} big={big} />
      <span className="ml-2 text-xs font-normal text-muted-foreground">{goalError} goals off</span>
    </span>
  )
}

export function Predictions({ row, games }: { row: { predictions: PickemWeekRow["predictions"] }; games: WeekOverview["games"] | undefined }) {
  return (
    <ul className="space-y-1 px-3 pb-3 text-sm">
      {row.predictions.map((p) => {
        const game = games?.find((g) => g.id === p.gameId)
        return (
          <li key={p.gameId} className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate">
              {game ? `${game.home.name} vs ${game.away.name}` : "Game"}
              <OutcomeMark outcome={p.outcome} />
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {p.homeScore} – {p.awayScore}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function PickemWeekStandings({ week, overview }: { week: PickemWeek; overview: WeekOverview | undefined }) {
  if (week.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No Predictions were made this Week.</p>
  }
  return (
    <ul className="space-y-2">
      {week.rows.map((row) => (
        <RankedCard key={row.managerId} {...row} score={<PickemRecord correct={row.correct} goalError={row.goalError} big={row.rank === 1} />}>
          <div className="pt-3">
            <Predictions row={row} games={overview?.games} />
          </div>
        </RankedCard>
      ))}
    </ul>
  )
}

function PickemSeasonTable({ season }: { season: FantasyPageData["pickem"]["season"] }) {
  if (season.rows.length === 0) return <p className="text-sm text-muted-foreground">No Predictions yet.</p>
  return (
    <ol className="space-y-1.5">
      {season.rows.map((row) => (
        <SeasonRow key={row.managerId} {...row} score={<PickemRecord correct={row.correct} goalError={row.goalError} />} />
      ))}
    </ol>
  )
}

/** Contests are separate games with their own Managers, so each is its own page rather than an in-place switch. */
function ContestNav({ data }: { data: FantasyPageData }) {
  return (
    <nav aria-label="Contests" className="flex gap-1">
      {data.contests.map((key, index) => (
        <IntentLink
          key={key}
          // The first contest is the page's default, so its link stays the plain /fantasy.
          href={fantasyHref({ tab: "fantasy", weekId: null, contest: index === 0 ? undefined : key })}
          aria-current={key === data.contest ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1 text-sm font-semibold capitalize transition-colors",
            key === data.contest ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {key}
        </IntentLink>
      ))}
    </nav>
  )
}

/** Everything it needs is already here, so the tab and Week switch in place and only rewrite the URL. */
export function FantasyStandingsView({ data, view: initialView }: { data: FantasyPageData; view: FantasyView }) {
  const [view, setView] = useState(initialView)
  const { weeks, season, overviews, pickem } = data

  function changeView(next: FantasyView) {
    setView(next)
    window.history.replaceState(null, "", fantasyHref(next))
  }
  const weekIds = Object.keys(overviews).sort()
  const week = weeks.find((w) => w.id === view.weekId)
  const pickemWeek = pickem.weeks.find((w) => w.id === view.weekId)
  const overview = view.weekId ? overviews[view.weekId] : undefined

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fantasy</h1>
          <p className="mt-1 text-sm text-muted-foreground">Lineups and Predictions close {closingLabel(data)}</p>
        </div>
        <Button asChild size="sm">
          <IntentLink href={`/fantasy/register?contest=${encodeURIComponent(data.contest)}`}>Join Fantasy</IntentLink>
        </Button>
      </div>

      {data.contests.length > 1 && <ContestNav data={data} />}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{view.weekId ? `Week of ${weekLabel(view.weekId)}` : "This Week"}</h2>
          {weekIds.length > 1 && view.weekId && <WeekPicker weekIds={weekIds} tab={view.tab} selectedId={view.weekId} switchTo={changeView} />}
        </div>
        {overview ? (
          <WeekOverviewPanel overview={overview} />
        ) : (
          <p className="text-sm text-muted-foreground">No Weeks yet.</p>
        )}
      </div>

      <TabNav view={view} switchTo={changeView} />

      {view.tab === "fantasy" ? (
        <FantasyStandings week={week} season={season} />
      ) : (
        <div className="mx-auto max-w-xl space-y-3">
          <p className="text-sm text-muted-foreground">
            Ranked by winners picked correctly. Predicted scores only break ties: fewer total goals off ranks higher.
          </p>
          <StandingsToggle
            weekly={{
              provisional: pickemWeek?.provisional,
              children: pickemWeek ? (
                <PickemWeekStandings week={pickemWeek} overview={overview} />
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
