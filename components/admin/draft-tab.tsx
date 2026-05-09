"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Loader2, Plus, Users, ListOrdered, Trash2, Send, Clock,
  MapPin, CalendarDays, Layers, ShieldCheck, MoreVertical,
  ExternalLink, ArchiveRestore, Play, Monitor, Settings,
  EyeOff, Eye, ArrowRightLeft, Check, AlertCircle, RotateCcw,
} from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
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
import { CreateDraftModal } from "./create-draft-modal"
import { DraftWizard } from "./draft-wizard"
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

interface DraftTrade {
  id: string
  teamASlug: string
  teamBSlug: string
  tradeType: string
  description: string | null
  tradedAt: string | null
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
  tradeCount: number
  teams: { teamSlug: string; position: number }[]
  trades: DraftTrade[]
  pool?: PoolPlayer[]
}

interface DraftTabProps {
  seasonId: string
  seasonStatus: string
  seasonType: string
  teams: { teamSlug: string; teamName: string; color?: string | null }[]
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
  const [drafts, setDrafts] = useState<DraftInstance[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DraftInstance | null>(null)
  const [publishTarget, setPublishTarget] = useState<DraftInstance | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [selectedPlayer, setSelectedPlayer] = useState<PoolPlayer | null>(null)
  const [playerCardOpen, setPlayerCardOpen] = useState(false)
  const [expandedPool, setExpandedPool] = useState<string | null>(null)
  const [poolData, setPoolData] = useState<Record<string, PoolPlayer[]>>({})
  const [unpublishTarget, setUnpublishTarget] = useState<DraftInstance | null>(null)
  const [isUnpublishing, setIsUnpublishing] = useState(false)
  const [editTarget, setEditTarget] = useState<DraftInstance | null>(null)
  const [configureTarget, setConfigureTarget] = useState<DraftInstance | null>(null)
  const [expandedTrades, setExpandedTrades] = useState<string | null>(null)
  const [addingTrade, setAddingTrade] = useState<string | null>(null)
  const [newTrade, setNewTrade] = useState({ teamASlug: "", teamARound: "1", teamBSlug: "", teamBRound: "1" })
  const [isSavingTrade, setIsSavingTrade] = useState(false)
  const [pushTarget, setPushTarget] = useState<DraftInstance | null>(null)
  const [isPushingRosters, setIsPushingRosters] = useState(false)
  const [revertTarget, setRevertTarget] = useState<DraftInstance | null>(null)
  const [isReverting, setIsReverting] = useState(false)

  const pushingDraftId = isPushingRosters ? pushTarget?.id : null
  const revertingDraftId = isReverting ? revertTarget?.id : null

  const handlePushRosters = (draft: DraftInstance) => setPushTarget(draft)

  const confirmPushRosters = async () => {
    if (!pushTarget) return
    setIsPushingRosters(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/draft/${pushTarget.id}/push-rosters`, {
        method: "POST",
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to push rosters")
      }
      const result = await res.json()
      toast.success(
        `Rosters pushed: ${result.summary.inserted} added, ${result.summary.updated} updated, ${result.summary.skipped} skipped`
      )
      setPushTarget(null)
      router.push(`/admin/seasons/${seasonId}?tab=Roster`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "An error occurred"
      toast.error(msg)
    } finally {
      setIsPushingRosters(false)
    }
  }

  const handleRevertToLive = (draft: DraftInstance) => setRevertTarget(draft)

  const confirmRevertToLive = async () => {
    if (!revertTarget) return
    setIsReverting(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/draft/${revertTarget.id}/revert-to-live`, {
        method: "POST",
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to revert")
      }
      toast.success("Draft reverted to live")
      setRevertTarget(null)
      fetchDrafts()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "An error occurred"
      toast.error(msg)
    } finally {
      setIsReverting(false)
    }
  }

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

  const handleDeleteTrade = async (draftId: string, tradeId: string) => {
    try {
      const res = await fetch(
        `/api/bash/admin/seasons/${seasonId}/draft/${draftId}/trade/${tradeId}`,
        { method: "DELETE" }
      )
      if (res.ok) {
        toast.success("Trade deleted")
        fetchDrafts()
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to delete trade")
      }
    } catch {
      toast.error("Connection error")
    }
  }

  const handleAddTrade = async (draftId: string) => {
    if (!newTrade.teamASlug || !newTrade.teamBSlug) {
      toast.error("Select both teams")
      return
    }
    setIsSavingTrade(true)
    try {
      const res = await fetch(
        `/api/bash/admin/seasons/${seasonId}/draft/${draftId}/trade`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "pre_draft_pick_swap",
            teamASlug: newTrade.teamASlug,
            teamARound: parseInt(newTrade.teamARound, 10),
            teamBSlug: newTrade.teamBSlug,
            teamBRound: parseInt(newTrade.teamBRound, 10),
          }),
        }
      )
      if (res.ok) {
        toast.success("Trade added")
        setNewTrade({ teamASlug: "", teamARound: "1", teamBSlug: "", teamBRound: "1" })
        setAddingTrade(null)
        fetchDrafts()
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to add trade")
      }
    } catch {
      toast.error("Connection error")
    } finally {
      setIsSavingTrade(false)
    }
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
              Create a draft to set the date, time, and location. You can publish it right away to announce the draft, then configure teams, player pool, and captains when you&apos;re ready.
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
        <CreateDraftModal
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          seasonId={seasonId}
          seasonType={seasonType}
          rosterCount={rosterCount}
          teamCount={teams.length}
          onComplete={handleWizardComplete}
        />
      </>
    )
  }

  // Show existing draft(s)
  return (
    <>
      <div className="space-y-4">
        {drafts.map(draft => {
          // Compute go-live readiness
          const isPreLive = draft.status === "draft" || draft.status === "published"
          const hasTeams = draft.teamCount >= 2
          const hasPool = draft.poolCount > 0
          const hasRounds = draft.rounds > 0
          const canSetup = teams.length >= 2 && rosterCount > 0

          return (
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
                      Publish Announcement
                    </Button>
                  )}
                  {draft.status === "published" && canSetup && (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => setConfigureTarget(draft)}
                    >
                      <Settings className="h-3.5 w-3.5 mr-1.5" />
                      Configure Draft
                    </Button>
                  )}
                  {draft.status === "published" && !canSetup && (
                    <Button size="sm" variant="outline" disabled>
                      <Settings className="h-3.5 w-3.5 mr-1.5" />
                      Awaiting Teams &amp; Roster
                    </Button>
                  )}
                  {(draft.status === "live") && (
                    <Button
                      size="sm"
                      onClick={() => router.push(`/admin/seasons/${seasonId}/draft/${draft.id}/board`)}
                    >
                      <Play className="h-3.5 w-3.5 mr-1.5" />
                      Resume Live Draft
                    </Button>
                  )}
                  {(draft.status === "completed" || draft.status === "archived") && (
                    <Button
                      size="sm"
                      onClick={() => window.open(`/draft/${seasonId}`, "_blank")}
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      View Draft Results
                    </Button>
                  )}
                  {draft.status === "completed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handlePushRosters(draft)}
                      disabled={pushingDraftId === draft.id}
                      title="Confirm this draft (roster & team assignment) for the season."
                    >
                      {pushingDraftId === draft.id ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Push Rosters
                    </Button>
                  )}
                  {(draft.status === "published" || draft.status === "live") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(`/draft/${seasonId}`, "_blank")}
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      Public Draft Page
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
                          Unpublish Draft
                        </DropdownMenuItem>
                      )}
                      {(draft.status === "draft" || draft.status === "published") && (
                        <DropdownMenuItem
                          onClick={() => setEditTarget(draft)}
                        >
                          <Settings className="h-4 w-4 mr-2" />
                          Edit Settings
                        </DropdownMenuItem>
                      )}
                      {(draft.status === "completed" || draft.status === "archived") && (
                        <DropdownMenuItem
                          onClick={() => router.push(`/admin/seasons/${seasonId}/draft/${draft.id}/board`)}
                        >
                          <Monitor className="h-4 w-4 mr-2" />
                          View Draft Log
                        </DropdownMenuItem>
                      )}
                      {draft.status === "completed" && (
                        <DropdownMenuItem
                          onClick={() => handleRevertToLive(draft)}
                          disabled={revertingDraftId === draft.id}
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Revert to Live
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
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <StatItem icon={Users} label="Teams" value={draft.teamCount} />
                <StatItem icon={ListOrdered} label="Player Pool" value={draft.poolCount} />
                <StatItem icon={ShieldCheck} label="Keepers" value={draft.keeperCount} />
                <StatItem icon={Clock} label="Pick Timer" value={`${draft.timerSeconds}s`} />
                <StatItem icon={ArrowRightLeft} label="Trades" value={draft.tradeCount} />
              </div>

              {/* Go-Live Readiness — shown for pre-live drafts */}
              {isPreLive && (() => {
                const checks = [
                  { label: "Teams assigned", done: hasTeams, detail: `${draft.teamCount} teams` },
                  { label: "Player pool imported", done: hasPool, detail: `${draft.poolCount} players` },
                  { label: "Rounds configured", done: hasRounds, detail: hasRounds ? `${draft.rounds} rounds` : "not set" },
                ]
                const doneCount = checks.filter(c => c.done).length
                const allDone = doneCount === checks.length
                return (
                  <div className="mt-4 pt-4 border-t">
                    <div className="flex items-center gap-2 mb-2">
                      {allDone ? (
                        <Check className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-amber-500" />
                      )}
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Draft Day Readiness ({doneCount}/{checks.length})
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {checks.map(c => (
                        <div key={c.label} className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded ${
                          c.done ? "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950" : "text-muted-foreground bg-muted/50"
                        }`}>
                          {c.done ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                          <span>{c.label}</span>
                        </div>
                      ))}
                    </div>
                    {!canSetup && (
                      <p className="text-[11px] text-muted-foreground mt-2 italic">
                        Add teams and import the season roster (Teams &amp; Roster tabs) to continue draft setup.
                      </p>
                    )}
                    {canSetup && (
                      <p className="text-[11px] text-muted-foreground mt-2 italic">
                        Season has {teams.length} teams and {rosterCount} players ready. Click &quot;Configure Draft&quot; above to set up teams, captains, draft order, and keepers.
                      </p>
                    )}
                  </div>
                )
              })()}
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
              {/* Pre-Draft Trades Section */}
              <div className="mt-4 pt-4 border-t">
                <button
                  onClick={() => setExpandedTrades(expandedTrades === draft.id ? null : draft.id)}
                  className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors w-full"
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  Pre-Draft Trades ({draft.tradeCount})
                </button>

                {expandedTrades === draft.id && (
                  <div className="mt-3 space-y-2 animate-in slide-in-from-top-1 duration-200">
                    {draft.trades.length === 0 && !addingTrade && (
                      <p className="text-xs text-muted-foreground py-2">No pre-draft trades configured.</p>
                    )}
                    {draft.trades.map((trade) => (
                      <div
                        key={trade.id}
                        className="flex items-center justify-between gap-2 rounded-md border p-3 bg-muted/30"
                      >
                        <div className="flex items-center gap-2 text-sm min-w-0">
                          <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate">{trade.description || `${trade.teamASlug} ↔ ${trade.teamBSlug}`}</span>
                        </div>
                        {draft.status === "draft" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => handleDeleteTrade(draft.id, trade.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}

                    {/* Add Trade Form */}
                    {draft.status === "draft" && addingTrade === draft.id && (
                      <div className="rounded-md border p-3 space-y-3 bg-muted/20">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Team A</Label>
                            <Select value={newTrade.teamASlug} onValueChange={(v) => setNewTrade(prev => ({ ...prev, teamASlug: v }))}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select team" /></SelectTrigger>
                              <SelectContent>
                                {draft.teams.map((t) => {
                                  const teamInfo = teams.find((tt) => tt.teamSlug === t.teamSlug)
                                  return (
                                    <SelectItem key={t.teamSlug} value={t.teamSlug}>
                                      {teamInfo?.teamName || t.teamSlug}
                                    </SelectItem>
                                  )
                                })}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Round</Label>
                            <Input
                              type="number"
                              min="1"
                              max={draft.rounds}
                              value={newTrade.teamARound}
                              onChange={(e) => setNewTrade(prev => ({ ...prev, teamARound: e.target.value }))}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-center">
                          <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Team B</Label>
                            <Select value={newTrade.teamBSlug} onValueChange={(v) => setNewTrade(prev => ({ ...prev, teamBSlug: v }))}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select team" /></SelectTrigger>
                              <SelectContent>
                                {draft.teams.map((t) => {
                                  const teamInfo = teams.find((tt) => tt.teamSlug === t.teamSlug)
                                  return (
                                    <SelectItem key={t.teamSlug} value={t.teamSlug}>
                                      {teamInfo?.teamName || t.teamSlug}
                                    </SelectItem>
                                  )
                                })}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Round</Label>
                            <Input
                              type="number"
                              min="1"
                              max={draft.rounds}
                              value={newTrade.teamBRound}
                              onChange={(e) => setNewTrade(prev => ({ ...prev, teamBRound: e.target.value }))}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleAddTrade(draft.id)}
                            disabled={isSavingTrade}
                            className="text-xs h-7"
                          >
                            {isSavingTrade && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                            Save Trade
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => { setAddingTrade(null); setNewTrade({ teamASlug: "", teamARound: "1", teamBSlug: "", teamBRound: "1" }) }}
                            className="text-xs h-7"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {draft.status === "draft" && addingTrade !== draft.id && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs mt-1"
                        onClick={() => setAddingTrade(draft.id)}
                      >
                        <Plus className="h-3 w-3 mr-1.5" />
                        Add Trade
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )})}

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
            <AlertDialogTitle>Publish announcement for &ldquo;{publishTarget?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will make the draft page live with the date, time, and location so players and fans can save the date. Teams, rosters, and captains do not need to be finalized yet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPublishing}>Not Yet</AlertDialogCancel>
            <AlertDialogAction onClick={handlePublish} disabled={isPublishing}>
              {isPublishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Publish Announcement
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

      {/* Push Rosters Confirm */}
      <AlertDialog open={!!pushTarget} onOpenChange={(open) => !open && setPushTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Push Rosters to Season?</AlertDialogTitle>
            <AlertDialogDescription>
              This will update the season roster with the draft results from &ldquo;{pushTarget?.name}&rdquo;. Player assignments and team rosters will be saved to the season.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPushingRosters}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPushRosters} disabled={isPushingRosters}>
              {isPushingRosters && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Push Rosters
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revert to Live Confirm */}
      <AlertDialog open={!!revertTarget} onOpenChange={(open) => !open && setRevertTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revert to Live?</AlertDialogTitle>
            <AlertDialogDescription>
              This will re-open &ldquo;{revertTarget?.name}&rdquo; as a live draft, allowing further picks or edits on the admin draft board.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isReverting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRevertToLive} disabled={isReverting}>
              {isReverting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Revert to Live
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      {/* Configure Draft Wizard (full multi-step: Settings → Teams & Captains → Draft Order → Review) */}
      <DraftWizard
        open={!!configureTarget}
        onOpenChange={(open) => { if (!open) setConfigureTarget(null) }}
        seasonId={seasonId}
        seasonType={seasonType}
        teams={teams}
        rosterCount={rosterCount}
        onComplete={() => {
          setConfigureTarget(null)
          fetchDrafts()
        }}
        existingDraft={configureTarget}
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
