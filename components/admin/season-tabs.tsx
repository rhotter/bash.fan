"use client"

import { useState } from "react"
import { SeasonForm } from "./season-form"
import { PlaceholderCard } from "./placeholder-card"
import { SeasonTeamsTab } from "./season-teams-tab"
import { SeasonRosterTab } from "./season-roster-tab"
import { SeasonScheduleTab } from "./season-schedule-tab"
import { DraftTab } from "./draft-tab"

type Tab = "Settings" | "Teams" | "Roster" | "Schedule" | "Draft" | "Registration"

function getTabsForStatus(status: string): Tab[] {
  if (status === "draft") {
    return ["Schedule", "Teams", "Registration", "Draft", "Roster", "Settings"]
  }
  return ["Schedule", "Teams", "Roster", "Settings"]
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
  }
}

export function SeasonTabs({ season }: SeasonTabsProps) {
  const tabs = getTabsForStatus(season.status)
  const [activeTab, setActiveTab] = useState<Tab>(tabs[0])

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
        {activeTab === "Settings" && <SeasonForm season={season} />}
        {activeTab === "Teams" && <SeasonTeamsTab seasonId={season.id} seasonStatus={season.status} initialTeams={season.teams} />}
        {activeTab === "Roster" && <SeasonRosterTab seasonId={season.id} seasonStatus={season.status} roster={season.roster} teams={season.teams} />}
        {activeTab === "Schedule" && <SeasonScheduleTab seasonId={season.id} seasonStatus={season.status} initialTeams={season.teams} defaultLocation={season.defaultLocation || "The Lick"} />}
        {activeTab === "Draft" && (
          <DraftTab
            seasonId={season.id}
            seasonStatus={season.status}
            seasonType={season.seasonType}
            teams={season.teams}
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

