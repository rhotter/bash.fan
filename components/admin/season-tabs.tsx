"use client"

import { useState } from "react"
import { SeasonOverview } from "./season-overview"
import { SeasonForm } from "./season-form"
import { PlaceholderCard } from "./placeholder-card"

const TABS = ["Overview", "Settings", "Teams", "Roster", "Schedule"] as const
type Tab = (typeof TABS)[number]

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
    isCurrent: boolean
    teams: { teamSlug: string; teamName: string }[]
    gameCount: number
    completedGameCount: number
    playerCount: number
    recentGames?: { id: number; date: string; time: string | null; awayTeam: string; homeTeam: string; location: string | null }[]
    upcomingGames?: { id: number; date: string; time: string | null; awayTeam: string; homeTeam: string; location: string | null }[]
  }
}

export function SeasonTabs({ season }: SeasonTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("Overview")

  return (
    <div className="space-y-4">
      {/* Tab Buttons */}
      <div className="flex gap-1 border-b">
        {TABS.map((tab) => (
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
        {activeTab === "Overview" && <SeasonOverview season={season} />}
        {activeTab === "Settings" && <SeasonForm season={season} />}
        {activeTab === "Teams" && <PlaceholderCard title="Team Management" phase={2} />}
        {activeTab === "Roster" && <PlaceholderCard title="Roster Management" phase={2} />}
        {activeTab === "Schedule" && <PlaceholderCard title="Schedule Editor" phase={2} />}
      </div>
    </div>
  )
}
