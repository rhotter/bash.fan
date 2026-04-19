"use client"

import { SeasonWizard } from "@/components/admin/season-wizard"

export default function NewSeasonPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">New Season</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Create a new season in draft status
        </p>
      </div>
      <SeasonWizard />
    </div>
  )
}
