"use client"

import { useState } from "react"
import { SeasonForm } from "./season-form"
import { PlaceholderCard } from "./placeholder-card"
import { SeasonTeamsTab } from "./season-teams-tab"
import { SeasonRosterTab } from "./season-roster-tab"
import { SeasonScheduleTab } from "./season-schedule-tab"
import { SeasonRegistrationTab, type PeriodForTab } from "./season-registration-tab"

type Tab = "Settings" | "Teams" | "Roster" | "Schedule" | "Draft" | "Registration"

function getTabsForStatus(status: string): Tab[] {
  if (status === "draft") {
    return ["Schedule", "Teams", "Registration", "Draft", "Roster", "Settings"]
  }
  // Registration is also useful on active seasons (open registration mid-season is rare,
  // but reading the config / closing registration should still be possible).
  return ["Schedule", "Teams", "Roster", "Registration", "Settings"]
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
    registration: {
      period: PeriodForTab | null
      notices: { id: number; title: string; ackType: string; version: number }[]
      extras: { id: number; name: string; price: number; active: boolean }[]
      discounts: { id: number; code: string; amountOff: number; active: boolean }[]
      otherPeriods: { id: string; seasonName: string }[]
    }
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
          <PlaceholderCard
            title="Draft Setup"
            phase={2}
            description="Configure the draft format: number of rounds, protection list sizes (2–10 per BASH rules), draft order based on previous season standings, and supplemental draft rules."
          />
        )}
        {activeTab === "Registration" && (
          <SeasonRegistrationTab
            seasonId={season.id}
            period={season.registration.period}
            notices={season.registration.notices}
            extras={season.registration.extras}
            discounts={season.registration.discounts}
            otherPeriods={season.registration.otherPeriods}
          />
        )}
      </div>
    </div>
  )
}

