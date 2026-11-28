import { GAME_CARD_CLASS, GAME_CARD_LABEL_CLASS, GameCardScore, GameCardStatusBar, GameCardTeam } from "@/components/game-card"
import { TeamLogo } from "@/components/team-logo"
import type { TeamRef, WeekOverview, WeekOverviewGame } from "@/lib/fantasy/week"

function GameCard({ game }: { game: WeekOverviewGame }) {
  const { result } = game
  return (
    <li className={GAME_CARD_CLASS}>
      <GameCardStatusBar>
        <span className="whitespace-nowrap text-[10px] text-muted-foreground/50">{game.startLabel}</span>
        {result && <span className={GAME_CARD_LABEL_CLASS}>Final</span>}
      </GameCardStatusBar>
      {/* Away on top, as on the Scores page. */}
      <div className="px-3 py-2 flex flex-col gap-1">
        {(["away", "home"] as const).map((side) => {
          const won = result !== null && result[`${side}Score`] > result[side === "home" ? "awayScore" : "homeScore"]
          return (
            <GameCardTeam key={side} {...game[side]} won={won}>
              <GameCardScore score={result?.[`${side}Score`]} bold={won} />
            </GameCardTeam>
          )
        })}
      </div>
      {result && <span className="sr-only">Final {result.homeScore} – {result.awayScore}</span>}
    </li>
  )
}

export function ByeTeams({ teams }: { teams: TeamRef[] }) {
  if (teams.length === 0) return null
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span>Bye:</span>
      {teams.map((team) => (
        <span key={team.slug} className="flex items-center gap-1.5 text-foreground">
          <TeamLogo slug={team.slug} name={team.name} size={16} />
          {team.name}
        </span>
      ))}
    </p>
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
      <ByeTeams teams={overview.byeTeams} />
    </section>
  )
}
