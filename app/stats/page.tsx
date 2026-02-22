"use client"

import { Suspense } from "react"
import { SiteHeader } from "@/components/site-header"
import { StatsTab } from "@/components/stats-tab"

export default function StatsPage() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <SiteHeader activeTab="stats" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:py-8">
        <Suspense>
          <StatsTab />
        </Suspense>
      </main>
    </div>
  )
}
