"use client"

import { useState } from "react"
import { SeasonOverview } from "./season-overview"
import { SeasonForm } from "./season-form"
import { PlaceholderCard } from "./placeholder-card"
import { SeasonTeamsTab } from "./season-teams-tab"
import { SeasonRosterTab } from "./season-roster-tab"
import { SeasonScheduleTab } from "./season-schedule-tab"

type Tab = "Overview" | "Settings" | "Teams" | "Roster" | "Schedule" | "Draft" | "Registration"

function getTabsForStatus(status: string): Tab[] {
  if (status === "draft") {
    return ["Overview", "Schedule", "Teams", "Registration", "Draft", "Roster", "Settings"]
  }
  return ["Overview", "Schedule", "Teams", "Roster", "Settings"]
}

interface SeasonTabsProps {
  season: {
    id: string
    name: string
    seasonType: string
    leagueId: string | null
    status: string
    standingsMethod: string | null
    gameLength: number | null
    defaultLocation: string | null
    adminNotes: string | null
    statsOnly: boolean
    playoffTeams: number | null
    isCurrent: boolean
    teams: { teamSlug: string; teamName: string }[]
    roster: { playerId: number; playerName: string; teamSlug: string; isGoalie: boolean; isRookie: boolean }[]
    gameCount: number
    completedGameCount: number
    playerCount: number
    recentGames?: { id: number; date: string; time: string | null; awayTeam: string; homeTeam: string; location: string | null; officials: { name: string; role: string }[] }[]
    upcomingGames?: { id: number; date: string; time: string | null; awayTeam: string; homeTeam: string; location: string | null; officials: { name: string; role: string }[] }[]
  }
}

export function SeasonTabs({ season }: SeasonTabsProps) {
  const tabs = getTabsForStatus(season.status)
  const [activeTab, setActiveTab] = useState<Tab>("Overview")

  return (
    <div className="space-y-4">
      {/* Tab Buttons */}
      <div className="flex gap-1 border-b">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 text-sm font-medium transition-colors cursor-pointer border-b-2 -mb-px ${
              activeTab === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === "Overview" && <SeasonOverview season={season} onEditSettings={() => setActiveTab("Settings")} />}
        {activeTab === "Settings" && <SeasonForm season={season} />}
        {activeTab === "Teams" && <SeasonTeamsTab seasonId={season.id} seasonStatus={season.status} initialTeams={season.teams} />}
        {activeTab === "Roster" && <SeasonRosterTab seasonId={season.id} seasonStatus={season.status} roster={season.roster} teams={season.teams} />}
        {activeTab === "Schedule" && <SeasonScheduleTab seasonId={season.id} seasonStatus={season.status} initialTeams={season.teams} defaultLocation={season.defaultLocation || "The Lick"} />}
        {activeTab === "Draft" && (
          <PlaceholderCard
            title="Draft Setup"
            phase={2}
            description="Configure the draft format: number of rounds, protection list sizes (2–10 per BASH rules), draft order based on previous season standings, and supplemental draft rules."
          />
        )}
        {activeTab === "Registration" && (
          <PlaceholderCard
            title="Player Registration"
            phase={2}
            description="Manage player registration for the upcoming season. Track veteran returns, free agent declarations, rookie signups from pickups, and registration fee status."
          />
        )}
      </div>
    </div>
  )
}

