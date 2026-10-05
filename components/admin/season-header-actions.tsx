"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Globe, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { toast } from "sonner"

interface SeasonHeaderActionsProps {
  seasonId: string
  seasonName: string
  isCurrent: boolean
}

export function SeasonHeaderActions({
  seasonId,
  seasonName,
  isCurrent,
}: SeasonHeaderActionsProps) {
  const router = useRouter()
  const [isSettingCurrent, setIsSettingCurrent] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleSetCurrent = async () => {
    setIsSettingCurrent(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCurrent: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success("Season set as current")
        setConfirmOpen(false)
        router.refresh()
      } else {
        toast.error(data.error || "Failed to set current season")
      }
    } catch {
      toast.error("Failed to set current season")
    } finally {
      setIsSettingCurrent(false)
    }
  }

  if (isCurrent) {
    return (
      <Badge
        variant="outline"
        className="border-primary/40 text-primary bg-primary/5 text-[10px] font-medium"
      >
        <Globe className="h-3 w-3" />
        Current Season (Homepage)
      </Badge>
    )
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 text-xs font-medium cursor-pointer"
        onClick={() => setConfirmOpen(true)}
        disabled={isSettingCurrent}
      >
        {isSettingCurrent ? (
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        ) : (
          <Globe className="h-3.5 w-3.5 mr-1.5" />
        )}
        Set as Current Season
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set as Current Season?</AlertDialogTitle>
            <AlertDialogDescription>
              This will make <strong>{seasonName}</strong> the default season on
              the public homepage, displaying its tryout games and announcements.
              The season will remain in Draft status, so teams, rosters, drafts,
              and schedules remain fully editable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSettingCurrent}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleSetCurrent()
              }}
              disabled={isSettingCurrent}
              className="cursor-pointer"
            >
              {isSettingCurrent && (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              )}
              Set as Current Season
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
