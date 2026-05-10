"use client"

import { useState, useCallback, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { SeasonForm } from "./season-form"
import { PlaceholderCard } from "./placeholder-card"
import { SeasonTeamsTab } from "./season-teams-tab"
import { SeasonRosterTab } from "./season-roster-tab"
import { SeasonScheduleTab } from "./season-schedule-tab"
import { DraftTab } from "./draft-tab"
import { SeasonWelcomeModal } from "./season-welcome-modal"

type Tab = "Settings" | "Teams" | "Roster" | "Schedule" | "Draft" | "Registration"

function getTabsForStatus(status: string): Tab[] {
  if (status === "draft") {
    return ["Schedule", "Teams", "Registration", "Draft", "Roster", "Settings"]
  }
  return ["Schedule", "Teams", "Roster", "Settings"]
}

type RosterPlayer = { playerId: number; playerName: string; teamSlug: string; isGoalie: boolean; isRookie: boolean }

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
    teams: { teamSlug: string; teamName: string; franchiseSlug: string | null; color: string | null }[]
    roster: { playerId: number; playerName: string; teamSlug: string; isGoalie: boolean; isRookie: boolean }[]
  }
}

export function SeasonTabs({ season }: SeasonTabsProps) {
  const tabs = getTabsForStatus(season.status)
  const searchParams = useSearchParams()
  const router = useRouter()
  const tabParam = searchParams.get("tab") as Tab | null
  const initialTab = tabParam && tabs.includes(tabParam) ? tabParam : tabs[0]
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)

  // Lift teams into shared state so mutations propagate across tabs
  const [teams, setTeams] = useState(season.teams)
  const [roster, setRoster] = useState(season.roster)

  const handleRosterChange = useCallback((updatedRoster: RosterPlayer[]) => {
    setRoster(updatedRoster)
    router.refresh()
  }, [router])

  const handleTeamsChange = useCallback((updatedTeams: { teamSlug: string; teamName: string; franchiseSlug: string | null; color: string | null }[]) => {
    setTeams(updatedTeams)
    router.refresh()
  }, [router])

  // Welcome modal — show once for fresh seasons (no teams, draft status)
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  useEffect(() => {
    if (season.status !== "draft") return
    const key = `bash-season-welcomed-${season.id}`
    if (typeof window !== "undefined" && !localStorage.getItem(key)) {
      setWelcomeOpen(true)
      localStorage.setItem(key, "1")
    }
  }, [season.id, season.status, season.teams.length])

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
        {activeTab === "Teams" && <SeasonTeamsTab seasonId={season.id} seasonStatus={season.status} initialTeams={teams} onTeamsChange={handleTeamsChange} />}
        {activeTab === "Roster" && <SeasonRosterTab seasonId={season.id} seasonStatus={season.status} roster={roster} teams={teams} onRosterChange={handleRosterChange} />}
        {activeTab === "Schedule" && <SeasonScheduleTab seasonId={season.id} seasonStatus={season.status} initialTeams={teams} defaultLocation={season.defaultLocation || "The Lick"} />}
        {activeTab === "Draft" && (
          <DraftTab
            seasonId={season.id}
            seasonStatus={season.status}
            seasonType={season.seasonType}
            teams={teams}
            rosterCount={roster.length}
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

      <SeasonWelcomeModal
        seasonName={season.name}
        isOpen={welcomeOpen}
        onOpenChange={setWelcomeOpen}
      />
    </div>
  )
}
