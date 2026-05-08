"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  Loader2, Plus, Users, ListOrdered, Trash2, Send, Clock,
  MapPin, CalendarDays, Layers, ShieldCheck, MoreVertical, Upload,
  ExternalLink, ArchiveRestore, Play, Monitor, Download, UploadCloud, Settings,
  EyeOff, Eye,
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
import { DraftPoolImportModal } from "./draft-pool-import-modal"
import { DraftPlayerCard, SkillBadge } from "./draft-player-card"
import { EditDraftModal } from "./edit-draft-modal"
import type { RegistrationMeta } from "@/lib/csv-utils"

interface PoolPlayer {
  playerId: number
  playerName: string
  isKeeper: boolean
  keeperTeamSlug: string | null
  keeperRound: number | null
  registrationMeta: RegistrationMeta | null
  isGoalie?: boolean
}

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
  pool?: PoolPlayer[]
}

interface DraftTabProps {
  seasonId: string
  seasonStatus: string
  seasonType: string
  teams: { teamSlug: string; teamName: string }[]
  rosterCount: number
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  published: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  live: "bg-green-500/10 text-green-700 border-green-500/30",
  paused: "bg-orange-500/10 text-orange-700 border-orange-500/30",
  completed: "bg-muted text-muted-foreground border-border",
  archived: "bg-slate-500/10 text-slate-500 border-slate-500/30",
}

export function DraftTab({ seasonId, seasonStatus, seasonType, teams, rosterCount }: DraftTabProps) {
  const router = useRouter()
  const restoreInputRef = useRef<HTMLInputElement>(null)
  const [drafts, setDrafts] = useState<DraftInstance[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DraftInstance | null>(null)
  const [publishTarget, setPublishTarget] = useState<DraftInstance | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [importDraftId, setImportDraftId] = useState<string | null>(null)
  const [selectedPlayer, setSelectedPlayer] = useState<PoolPlayer | null>(null)
  const [playerCardOpen, setPlayerCardOpen] = useState(false)
  const [expandedPool, setExpandedPool] = useState<string | null>(null)
  const [poolData, setPoolData] = useState<Record<string, PoolPlayer[]>>({})
  const [unpublishTarget, setUnpublishTarget] = useState<DraftInstance | null>(null)
  const [isUnpublishing, setIsUnpublishing] = useState(false)
  const [editTarget, setEditTarget] = useState<DraftInstance | null>(null)

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

  // Backup restore handler
  const handleRestoreBackup = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const target = drafts.find((d) => d.status === "draft")
    if (!target) {
      toast.error("No draft in editable status to restore to")
      return
    }
    try {
      const text = await file.text()
      const backup = JSON.parse(text)
      const res = await fetch(
        `/api/bash/admin/seasons/${seasonId}/draft/${target.id}/backup`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(backup) }
      )
      if (res.ok) {
        toast.success("Backup restored successfully")
        fetchDrafts()
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to restore backup")
      }
    } catch {
      toast.error("Invalid backup file")
    }
    if (restoreInputRef.current) restoreInputRef.current.value = ""
  }, [drafts, seasonId, fetchDrafts])

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

  const handleUnpublish = async () => {
    if (!unpublishTarget) return
    setIsUnpublishing(true)
    try {
      const res = await fetch(
        `/api/bash/admin/seasons/${seasonId}/draft/${unpublishTarget.id}/publish`,
        { method: "DELETE" }
      )
      if (res.ok) {
        toast.success("Draft unpublished — moved back to draft status")
        fetchDrafts()
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to unpublish")
      }
    } catch {
      toast.error("Connection error")
    } finally {
      setIsUnpublishing(false)
      setUnpublishTarget(null)
    }
  }

  const fetchPool = useCallback(async (draftId: string) => {
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/draft/${draftId}/pool`)
      if (res.ok) {
        const data = await res.json()
        setPoolData(prev => ({ ...prev, [draftId]: data.pool || [] }))
      }
    } catch {
      toast.error("Failed to load player pool")
    }
  }, [seasonId])

  const togglePool = (draftId: string) => {
    if (expandedPool === draftId) {
      setExpandedPool(null)
    } else {
      setExpandedPool(draftId)
      if (!poolData[draftId]) fetchPool(draftId)
    }
  }

  const handlePlayerClick = (player: PoolPlayer) => {
    setSelectedPlayer(player)
    setPlayerCardOpen(true)
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
          rosterCount={rosterCount}
          onComplete={handleWizardComplete}
        />
      </>
    )
  }

  // Show existing draft(s)
  return (
    <>
      {/* Hidden file input for backup restore */}
      <input
        ref={restoreInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleRestoreBackup}
      />
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
                      variant="outline"
                      onClick={() => setImportDraftId(draft.id)}
                    >
                      <Upload className="h-3.5 w-3.5 mr-1.5" />
                      Import CSV
                    </Button>
                  )}
                  {draft.status === "draft" && (
                    <Button
                      size="sm"
                      onClick={() => setPublishTarget(draft)}
                    >
                      <Send className="h-3.5 w-3.5 mr-1.5" />
                      Publish
                    </Button>
                  )}
                  {draft.status !== "draft" && (
                    <Button
                      size="sm"
                      variant={draft.status === "completed" || draft.status === "archived" ? "outline" : "default"}
                      onClick={() => router.push(`/admin/seasons/${seasonId}/draft/${draft.id}/board`)}
                    >
                      {draft.status === "published" ? (
                        <Play className="h-3.5 w-3.5 mr-1.5" />
                      ) : (
                        <Monitor className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      {draft.status === "published" ? "Open Draft Board" : "View Admin Draft"}
                    </Button>
                  )}
                  {(draft.status === "completed" || draft.status === "archived") && (
                    <Button
                      size="sm"
                      variant={draft.status === "archived" ? "outline" : "default"}
                      onClick={() => window.open(`/draft/${seasonId}`, "_blank")}
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      View Draft Results
                    </Button>
                  )}
                  {(draft.status === "published" || draft.status === "live") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(`/draft/${seasonId}`, "_blank")}
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      View Public Draft
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {draft.status === "published" && (
                        <DropdownMenuItem
                          onClick={() => setUnpublishTarget(draft)}
                        >
                          <ArchiveRestore className="h-4 w-4 mr-2" />
                          Unpublish to Draft
                        </DropdownMenuItem>
                      )}
                      {draft.status === "draft" && (
                        <DropdownMenuItem
                          onClick={() => setEditTarget(draft)}
                        >
                          <Settings className="h-4 w-4 mr-2" />
                          Edit Settings
                        </DropdownMenuItem>
                      )}
                      {draft.status === "draft" && (
                        <DropdownMenuItem
                          onClick={() => setImportDraftId(draft.id)}
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          Import CSV
                        </DropdownMenuItem>
                      )}
                      {draft.status === "completed" && (
                        <DropdownMenuItem
                          onClick={async () => {
                            try {
                              const res = await fetch(
                                `/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/archive`,
                                { method: "POST" }
                              )
                              if (res.ok) {
                                toast.success("Draft results removed from public navigation")
                                fetchDrafts()
                              } else {
                                const err = await res.json()
                                toast.error(err.error || "Failed to archive")
                              }
                            } catch {
                              toast.error("Connection error")
                            }
                          }}
                        >
                          <EyeOff className="h-4 w-4 mr-2" />
                          Archive Draft
                        </DropdownMenuItem>
                      )}
                      {draft.status === "archived" && (
                        <DropdownMenuItem
                          onClick={async () => {
                            try {
                              const res = await fetch(
                                `/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/archive`,
                                { method: "DELETE" }
                              )
                              if (res.ok) {
                                toast.success("Draft results restored to public navigation")
                                fetchDrafts()
                              } else {
                                const err = await res.json()
                                toast.error(err.error || "Failed to restore")
                              }
                            } catch {
                              toast.error("Connection error")
                            }
                          }}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          Unarchive Draft
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={() => {
                          window.open(
                            `/api/bash/admin/seasons/${seasonId}/draft/${draft.id}/backup`,
                            "_blank"
                          )
                        }}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Export Backup
                      </DropdownMenuItem>
                      {draft.status === "draft" && (
                        <DropdownMenuItem
                          onClick={() => restoreInputRef.current?.click()}
                        >
                          <UploadCloud className="h-4 w-4 mr-2" />
                          Restore from Backup
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteTarget(draft)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Draft
                      </DropdownMenuItem>
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
              {/* Player Pool Section */}
              {draft.poolCount > 0 && (
                <div className="mt-4 pt-4 border-t">
                  <button
                    onClick={() => togglePool(draft.id)}
                    className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors w-full"
                  >
                    <Users className="h-3.5 w-3.5" />
                    Player Pool ({draft.poolCount})
                  </button>

                  {expandedPool === draft.id && poolData[draft.id] && (
                    <div className="mt-3 border rounded-md overflow-hidden animate-in slide-in-from-top-1 duration-200">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left p-2 font-medium">Player</th>
                            <th className="text-left p-2 font-medium">Skill</th>
                            <th className="text-left p-2 font-medium hidden sm:table-cell">Pos</th>
                            <th className="text-left p-2 font-medium hidden md:table-cell">Games</th>
                            <th className="text-left p-2 font-medium hidden md:table-cell">Playoffs</th>
                          </tr>
                        </thead>
                        <tbody>
                          {poolData[draft.id].map((player) => {
                            const meta = player.registrationMeta
                            return (
                              <tr
                                key={player.playerId}
                                className="border-t hover:bg-muted/30 cursor-pointer transition-colors"
                                onClick={() => handlePlayerClick(player)}
                              >
                                <td className="p-2">
                                  <div className="flex items-center gap-1.5">
                                    {player.playerName}
                                    {player.isKeeper && (
                                      <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">K</Badge>
                                    )}
                                    {meta?.isRookie && (
                                      <Badge variant="outline" className="text-[10px] bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300">R</Badge>
                                    )}
                                  </div>
                                </td>
                                <td className="p-2">
                                  <SkillBadge skillLevel={meta?.skillLevel} />
                                </td>
                                <td className="p-2 text-muted-foreground hidden sm:table-cell">
                                  {meta?.positions || "—"}
                                </td>
                                <td className="p-2 text-muted-foreground hidden md:table-cell">
                                  {meta?.gamesExpected || "—"}
                                </td>
                                <td className="p-2 text-muted-foreground hidden md:table-cell">
                                  {meta?.playoffAvail || "—"}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
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
            <AlertDialogTitle className={deleteTarget && deleteTarget.status !== "draft" ? "text-destructive" : ""}>
              {deleteTarget && deleteTarget.status !== "draft"
                ? `⚠️ Permanently Delete "${deleteTarget?.name}"?`
                : `Delete "${deleteTarget?.name}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This will permanently delete the draft and all associated data including the player pool, team order, picks, trades, and activity logs. This action cannot be undone.
                </p>
                {deleteTarget && deleteTarget.status !== "draft" && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 space-y-1.5">
                    <p className="font-semibold text-destructive text-sm">
                      Draft results will be permanently deleted
                    </p>
                    <p className="text-xs text-destructive/80">
                      This draft is currently <strong>{deleteTarget.status}</strong>. All draft results,
                      pick history, and the public draft results page will be removed and cannot be recovered.
                      Consider exporting a backup first.
                    </p>
                  </div>
                )}
              </div>
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
              {deleteTarget && deleteTarget.status !== "draft"
                ? "Delete Draft & Results"
                : "Delete Draft"}
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
              This will make the draft visible at a public URL. Captains, players, and fans will be able to see the draft page.
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

      {/* Unpublish Confirmation */}
      <AlertDialog open={!!unpublishTarget} onOpenChange={(open) => !open && setUnpublishTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unpublish &ldquo;{unpublishTarget?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will move the draft back to draft status. The public draft page will no longer be accessible until you publish again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUnpublishing}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleUnpublish} disabled={isUnpublishing}>
              {isUnpublishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Unpublish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* CSV Import Modal */}
      <DraftPoolImportModal
        open={!!importDraftId}
        onOpenChange={(open) => { if (!open) setImportDraftId(null) }}
        seasonId={seasonId}
        draftId={importDraftId || ""}
        onImportComplete={() => {
          fetchDrafts()
          if (importDraftId) fetchPool(importDraftId)
        }}
      />

      {/* Player Card Sheet */}
      <DraftPlayerCard
        player={selectedPlayer}
        open={playerCardOpen}
        onOpenChange={setPlayerCardOpen}
      />

      {/* Edit Settings Modal */}
      <EditDraftModal
        draft={editTarget}
        seasonId={seasonId}
        isOpen={!!editTarget}
        onOpenChange={(open) => { if (!open) setEditTarget(null) }}
        onUpdate={fetchDrafts}
      />
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
