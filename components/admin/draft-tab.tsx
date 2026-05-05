"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Loader2, Plus, Users, ListOrdered, Trash2, Send, Clock,
  MapPin, CalendarDays, Layers, ShieldCheck, MoreVertical,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import { DraftWizard } from "./draft-wizard"

interface DraftInstance {
  id: string
  name: string
  status: string
  draftType: string
  rounds: number
  timerSeconds: number
  maxKeepers: number
  draftDate: string | null
  location: string | null
  seasonType: string
  teamCount: number
  poolCount: number
  keeperCount: number
  teams: { teamSlug: string; position: number }[]
}

interface DraftTabProps {
  seasonId: string
  seasonStatus: string
  seasonType: string
  teams: { teamSlug: string; teamName: string }[]
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  published: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  live: "bg-green-500/10 text-green-700 border-green-500/30",
  paused: "bg-orange-500/10 text-orange-700 border-orange-500/30",
  completed: "bg-muted text-muted-foreground border-border",
}

export function DraftTab({ seasonId, seasonStatus, seasonType, teams }: DraftTabProps) {
  const [drafts, setDrafts] = useState<DraftInstance[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DraftInstance | null>(null)
  const [publishTarget, setPublishTarget] = useState<DraftInstance | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)

  const fetchDrafts = useCallback(async () => {
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/draft`)
      if (res.ok) {
        const data = await res.json()
        setDrafts(data.drafts || [])
      }
    } catch {
      toast.error("Failed to load drafts")
    } finally {
      setIsLoading(false)
    }
  }, [seasonId])

  useEffect(() => { fetchDrafts() }, [fetchDrafts])

  const handleDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      const res = await fetch(
        `/api/bash/admin/seasons/${seasonId}/draft/${deleteTarget.id}`,
        { method: "DELETE" }
      )
      if (res.ok) {
        setDrafts(prev => prev.filter(d => d.id !== deleteTarget.id))
        toast.success("Draft deleted")
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to delete")
      }
    } catch {
      toast.error("Connection error")
    } finally {
      setIsDeleting(false)
      setDeleteTarget(null)
    }
  }

  const handlePublish = async () => {
    if (!publishTarget) return
    setIsPublishing(true)
    try {
      const res = await fetch(
        `/api/bash/admin/seasons/${seasonId}/draft/${publishTarget.id}/publish`,
        { method: "POST" }
      )
      if (res.ok) {
        toast.success("Draft published!")
        fetchDrafts()
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to publish")
      }
    } catch {
      toast.error("Connection error")
    } finally {
      setIsPublishing(false)
      setPublishTarget(null)
    }
  }

  const handleWizardComplete = () => {
    setWizardOpen(false)
    fetchDrafts()
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // No drafts — show empty state
  if (drafts.length === 0) {
    return (
      <>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Layers className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-1">No Draft Configured</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              Create a draft instance to configure the draft format, player pool, team order, and keepers for this season.
            </p>
            <Button onClick={() => setWizardOpen(true)} disabled={seasonStatus !== "draft"}>
              <Plus className="h-4 w-4 mr-2" />
              Create Draft
            </Button>
            {seasonStatus !== "draft" && (
              <p className="text-xs text-muted-foreground mt-2">
                Drafts can only be created for seasons in draft status.
              </p>
            )}
          </CardContent>
        </Card>
        <DraftWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          seasonId={seasonId}
          seasonType={seasonType}
          teams={teams}
          onComplete={handleWizardComplete}
        />
      </>
    )
  }

  // Show existing draft(s)
  return (
    <>
      <div className="space-y-4">
        {drafts.map(draft => (
          <Card key={draft.id}>
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{draft.name}</CardTitle>
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-medium ${STATUS_STYLES[draft.status] || STATUS_STYLES.draft}`}
                    >
                      {draft.status}
                    </Badge>
                  </div>
                  <CardDescription>
                    {draft.draftType === "snake" ? "Snake" : "Linear"} draft · {draft.rounds} rounds
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {draft.status === "draft" && (
                    <Button
                      size="sm"
                      onClick={() => setPublishTarget(draft)}
                    >
                      <Send className="h-3.5 w-3.5 mr-1.5" />
                      Publish
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {draft.status === "draft" && (
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget(draft)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Draft
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatItem icon={Users} label="Teams" value={draft.teamCount} />
                <StatItem icon={ListOrdered} label="Player Pool" value={draft.poolCount} />
                <StatItem icon={ShieldCheck} label="Keepers" value={draft.keeperCount} />
                <StatItem icon={Clock} label="Pick Timer" value={`${draft.timerSeconds}s`} />
              </div>
              {(draft.draftDate || draft.location) && (
                <div className="flex items-center gap-4 mt-4 pt-4 border-t text-sm text-muted-foreground">
                  {draft.draftDate && (
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {new Date(draft.draftDate).toLocaleDateString("en-US", {
                        weekday: "short", month: "short", day: "numeric", year: "numeric",
                      })}
                    </span>
                  )}
                  {draft.location && (
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" />
                      {draft.location}
                    </span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{deleteTarget?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the draft and all associated data (pool, team order, picks, trades, logs). This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Publish Confirmation */}
      <AlertDialog open={!!publishTarget} onOpenChange={(open) => !open && setPublishTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish &ldquo;{publishTarget?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will make the draft visible at a public URL. Any simulation data will be cleared. Captains, players, and fans will be able to see the draft page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPublishing}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handlePublish} disabled={isPublishing}>
              {isPublishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Publish Draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function StatItem({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2.5 p-2.5 rounded-md bg-muted/50">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold">{value}</div>
      </div>
    </div>
  )
}
