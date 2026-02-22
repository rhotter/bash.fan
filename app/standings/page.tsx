"use client"

import { SiteHeader } from "@/components/site-header"
import { StandingsTab } from "@/components/standings-tab"
import { useBashData } from "@/lib/hockey-data"

export default function StandingsPage() {
  const { standings, isLoading } = useBashData()

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <SiteHeader activeTab="standings" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:py-8">
        <StandingsTab standings={standings} isLoading={isLoading} />
      </main>
    </div>
  )
}
