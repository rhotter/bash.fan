"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, Circle, AlertCircle, ArrowRight, Flag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface SeasonActivationChecklistProps {
  season: {
    id: string
    name: string
    status: string
    teams: { teamSlug: string }[]
    roster: { teamSlug: string }[]
    gameCount: number
    statsOnly: boolean
  }
}

export function SeasonActivationChecklist({ season }: SeasonActivationChecklistProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [confirmDialog, setConfirmDialog] = useState(false)

  if (season.status !== "draft") {
    return null
  }

  const hasTeams = season.teams.length > 0
  const hasPlayers = season.roster.length > 0
  const unassignedCount = season.roster.filter(p => p.teamSlug === "tbd" || !p.teamSlug).length
  const allAssigned = hasPlayers && unassignedCount === 0
  const hasGames = season.gameCount > 0 || season.statsOnly

  const checks = [
    {
      id: "teams",
      label: "Create Teams",
      description: "Add participating teams to the season.",
      passed: hasTeams,
    },
    {
      id: "players",
      label: "Register Players",
      description: "Add players to the draft pool.",
      passed: hasPlayers,
    },
    {
      id: "draft",
      label: "Draft / Assign Players",
      description: "Assign all players to teams. No players can remain 'TBD'.",
      passed: allAssigned,
    },
    {
      id: "schedule",
      label: season.statsOnly ? "Stats-Only Mode" : "Generate Schedule",
      description: season.statsOnly ? "Season is set to stats-only. No schedule required." : "Create the regular season game schedule.",
      passed: hasGames,
    },
  ]

  const readyToActivate = checks.every(c => c.passed)

  async function handleActivate() {
    setConfirmDialog(false)
    setSaving(true)
    setError("")
    
    try {
      const res = await fetch(`/api/bash/admin/seasons/${season.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      })
      
      if (res.ok) {
        router.refresh()
      } else {
        const data = await res.json()
        setError(data.error || "Failed to activate season")
      }
    } catch {
      setError("Connection error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card className="border-green-500/20 bg-green-500/5 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1 h-full bg-green-500" />
        <CardHeader className="py-3 sm:px-4 flex flex-row items-center justify-between space-y-0 border-b border-green-500/10">
          <div className="flex flex-col gap-0.5">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <Flag className="h-4 w-4 text-green-600" />
              Season Activation
            </CardTitle>
          </div>
          <div className="flex items-center gap-3">
            {error && (
              <span className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="h-3 w-3"/> {error}</span>
            )}
            <Button 
              onClick={() => setConfirmDialog(true)}
              disabled={!readyToActivate || saving}
              size="sm"
              className="h-7 text-xs px-3 bg-green-600 hover:bg-green-700 text-white"
            >
              {saving ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : null}
              Activate Season
              <ArrowRight className="h-3 w-3 ml-1.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:px-4">
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            {checks.map((check) => (
              <div key={check.id} className="flex items-start gap-2.5">
                <div className="mt-0.5 shrink-0">
                  {check.passed ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground/30" />
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className={`text-xs font-semibold ${check.passed ? "text-foreground" : "text-muted-foreground"}`}>
                    {check.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground leading-tight">
                    {check.description}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmDialog} onOpenChange={setConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate {season.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will make it the current active season on the public site and lock season settings like team count.
              Are you sure you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleActivate} className="bg-green-600 hover:bg-green-700">
              Activate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
