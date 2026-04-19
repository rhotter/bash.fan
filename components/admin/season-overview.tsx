"use client"

import { Users, UserCheck, Gamepad2, CheckCircle, MapPin, Timer, Trophy, StickyNote } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import Link from "next/link"
import { TeamLogo } from "@/components/team-logo"

interface SeasonOverviewProps {
  season: {
    teams: { teamSlug: string; teamName: string }[]
    teamCount?: number
    playerCount: number
    gameCount: number
    completedGameCount: number
    standingsMethod?: string | null
    gameLength?: number | null
    defaultLocation?: string | null
    adminNotes?: string | null
    recentGames?: { id: number; date: string; time: string | null; awayTeam: string; homeTeam: string; location: string | null }[]
    upcomingGames?: { id: number; date: string; time: string | null; awayTeam: string; homeTeam: string; location: string | null }[]
  }
}

const STANDINGS_LABELS: Record<string, string> = {
  "pts-pbla": "Points (PBLA)",
  "pts-standard": "Points (Standard)",
  "win-pct": "Win Percentage",
  "pts-custom": "Custom Points",
}

const STANDINGS_DESCRIPTIONS: Record<string, string> = {
  "pts-pbla": "W=3, OTW=2, OTL=1, L=0 (BASH default)",
  "pts-standard": "W=2, T=1, OTL=1, L=0",
  "win-pct": "Strictly Win-Loss percentage. Ties excluded.",
  "pts-custom": "Custom points calculation.",
}

export function SeasonOverview({ season }: SeasonOverviewProps) {
  const analytics = [
    { label: "Teams", value: season.teams.length, icon: Users, color: "text-blue-600" },
    { label: "Players", value: season.playerCount, icon: UserCheck, color: "text-green-600" },
    { label: "Games", value: season.gameCount, icon: Gamepad2, color: "text-primary" },
    { label: "Completed", value: season.completedGameCount, icon: CheckCircle, color: "text-emerald-600" },
  ]

  return (
    <div className="space-y-4">
      {/* Key Analytics */}
      <div className="grid grid-cols-4 gap-3">
        {analytics.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <stat.icon className={`h-3 w-3 ${stat.color}`} />
                <div>
                  <p className="text-sm font-bold leading-none">{stat.value}</p>
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">{stat.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Games */}
      {season.recentGames && season.recentGames.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Last 7 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {season.recentGames.map((game) => (
                <div
                  key={game.id}
                  className="grid grid-cols-[80px_1fr_auto] items-center py-2 border-b last:border-0 gap-4"
                >
                  <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap leading-tight">
                    {game.date}
                    {game.time && <br />}
                    {game.time && <span>{game.time}</span>}
                  </span>
                  
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 min-w-0">
                    <div className="flex items-center justify-end gap-1.5 min-w-0">
                      <span className="uppercase text-xs font-bold truncate leading-none pt-0.5">{game.awayTeam}</span>
                      <TeamLogo slug={game.awayTeam} name={game.awayTeam} size={16} className="shrink-0" />
                    </div>
                    <span className="text-[10px] text-muted-foreground text-center w-4">@</span>
                    <div className="flex items-center justify-start gap-1.5 min-w-0">
                      <TeamLogo slug={game.homeTeam} name={game.homeTeam} size={16} className="shrink-0" />
                      <span className="uppercase text-xs font-bold truncate leading-none pt-0.5">{game.homeTeam}</span>
                    </div>
                  </div>

                  <Link 
                    href={`/scorekeeper/${game.id}`} 
                    target="_blank" 
                    className="text-[10px] uppercase tracking-wider font-bold text-primary hover:underline px-2 py-1 bg-primary/10 rounded justify-self-end shrink-0"
                  >
                    Boxscore
                  </Link>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upcoming Games */}
      {season.upcomingGames && season.upcomingGames.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Next 7 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {season.upcomingGames.map((game) => (
                <div
                  key={game.id}
                  className="grid grid-cols-[80px_1fr_auto] items-center py-2 border-b last:border-0 gap-4"
                >
                  <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap leading-tight">
                    {game.date}
                    {game.time && <br />}
                    {game.time && <span>{game.time}</span>}
                  </span>
                  
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 min-w-0">
                    <div className="flex items-center justify-end gap-1.5 min-w-0">
                      <span className="uppercase text-xs font-bold truncate leading-none pt-0.5">{game.awayTeam}</span>
                      <TeamLogo slug={game.awayTeam} name={game.awayTeam} size={16} className="shrink-0" />
                    </div>
                    <span className="text-[10px] text-muted-foreground text-center w-4">@</span>
                    <div className="flex items-center justify-start gap-1.5 min-w-0">
                      <TeamLogo slug={game.homeTeam} name={game.homeTeam} size={16} className="shrink-0" />
                      <span className="uppercase text-xs font-bold truncate leading-none pt-0.5">{game.homeTeam}</span>
                    </div>
                  </div>

                  <Link 
                    href={`/scorekeeper/${game.id}`} 
                    target="_blank" 
                    className="text-[10px] uppercase tracking-wider font-bold text-primary hover:underline px-2 py-1 bg-primary/10 rounded justify-self-end shrink-0"
                  >
                    Scorekeeper
                  </Link>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Settings Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Season Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-start gap-2 cursor-help group w-fit">
                    <Trophy className="h-3.5 w-3.5 mt-0.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                    <div className="text-left">
                      <p className="font-medium decoration-dotted underline decoration-muted-foreground underline-offset-4 group-hover:decoration-foreground transition-colors">{STANDINGS_LABELS[season.standingsMethod || "pts-pbla"] || season.standingsMethod}</p>
                      <p className="text-xs text-muted-foreground">Standings method</p>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-center">
                  <p>{STANDINGS_DESCRIPTIONS[season.standingsMethod || "pts-pbla"] || "The method used to calculate team points."}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div className="flex items-start gap-2">
              <Timer className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
              <div>
                <p className="font-medium">{season.gameLength || 60} min</p>
                <p className="text-xs text-muted-foreground">Game length</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <MapPin className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
              <div>
                <p className="font-medium">{season.defaultLocation || "Not set"}</p>
                <p className="text-xs text-muted-foreground">Default location</p>
              </div>
            </div>
            {season.adminNotes && (
              <div className="flex items-start gap-2">
                <StickyNote className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="font-medium line-clamp-2">{season.adminNotes}</p>
                  <p className="text-xs text-muted-foreground">Admin notes</p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
