import { TeamLogo } from "@/components/team-logo"
import type { WeekOverview, WeekOverviewGame } from "@/lib/fantasy/week"

function Team({ team, size = 20 }: { team: WeekOverviewGame["home"]; size?: number }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <TeamLogo slug={team.slug} name={team.name} size={size} />
      <span className="truncate font-medium">{team.name}</span>
    </span>
  )
}

function GameCard({ game }: { game: WeekOverviewGame }) {
  return (
    <li className="space-y-1 rounded-md border border-border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <Team team={game.home} />
        {game.result && <span className="shrink-0 font-semibold tabular-nums">{game.result.homeScore}</span>}
      </div>
      <div className="flex items-center justify-between gap-2">
        <Team team={game.away} />
        {game.result && <span className="shrink-0 font-semibold tabular-nums">{game.result.awayScore}</span>}
      </div>
      <p className="whitespace-nowrap text-xs text-muted-foreground">
        {game.startLabel}
        {game.result && <span className="sr-only"> final {game.result.homeScore} – {game.result.awayScore}</span>}
      </p>
    </li>
  )
}

/** The games, Bye team and results for one Week. Shared by /fantasy and the Manager Link page. */
export function WeekOverviewPanel({ overview }: { overview: WeekOverview }) {
  return (
    <section aria-label="Week overview" className="space-y-3">
      {overview.games.length === 0 ? (
        <p className="text-sm text-muted-foreground">No games this Week.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {overview.games.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </ul>
      )}
      {overview.byeTeams.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>Bye:</span>
          {overview.byeTeams.map((team) => (
            <span key={team.slug} className="flex items-center gap-1.5 text-foreground">
              <TeamLogo slug={team.slug} name={team.name} size={16} />
              {team.name}
            </span>
          ))}
        </p>
      )}
    </section>
  )
}
