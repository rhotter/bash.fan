"use client"

import { Calendar, Users, ClipboardList, Trophy } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface SeasonWelcomeModalProps {
  seasonName: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

const steps = [
  {
    icon: Calendar,
    title: "Experiment with schedules",
    description:
      "Generate round-robin schedules using any number of placeholder teams. You can swap in real teams later once they're finalized.",
    color: "text-blue-500",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
  },
  {
    icon: ClipboardList,
    title: "Import rosters & registrations",
    description:
      "When registrations are complete on Sportability, export the CSV and import it into the draft's player pool. You can always add and edit players afterwards as well.",
    color: "text-emerald-500",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/30",
  },
  {
    icon: Users,
    title: "Configure teams when ready",
    description:
      "Assign or create teams whenever you're ready. If team names aren't known yet, no problem — define them right before the draft.",
    color: "text-purple-500",
    bgColor: "bg-purple-50 dark:bg-purple-950/30",
  },
  {
    icon: Trophy,
    title: "Publish the draft early, finalize later",
    description:
      "Set a draft date and location, then publish so the league knows. You can settle the details — teams, draft order, keepers, trades — right before going live.",
    color: "text-amber-500",
    bgColor: "bg-amber-50 dark:bg-amber-950/30",
  },
]

export function SeasonWelcomeModal({
  seasonName,
  isOpen,
  onOpenChange,
}: SeasonWelcomeModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg">
            🏒 Welcome to {seasonName}
          </DialogTitle>
          <DialogDescription>
            Here&rsquo;s how to set up a new season. You can do these in any order and come back at any time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {steps.map((step, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 rounded-lg p-3 ${step.bgColor}`}
            >
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background border ${step.color}`}
              >
                <step.icon className="h-4 w-4" />
              </div>
              <div className="space-y-0.5">
                <p className="text-sm font-medium leading-tight">
                  {step.title}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Got it, let&rsquo;s go
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
