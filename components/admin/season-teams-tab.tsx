"use client"

import { useState, useEffect, useCallback } from "react"
import { Search, Loader2, Plus, X, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { TeamLogo } from "@/components/team-logo"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"


interface SeasonTeamsTabProps {
  seasonId: string
  seasonStatus: string
  initialTeams: { teamSlug: string; teamName: string; franchiseSlug: string | null }[]
  onTeamsChange?: (teams: { teamSlug: string; teamName: string; franchiseSlug: string | null }[]) => void
}

interface Team {
  slug: string
  name: string
}

interface Franchise {
  slug: string
  name: string
  color: string | null
  logoTeamSlug: string | null
  logoSeasonId: string | null
}

export function SeasonTeamsTab({ seasonId, seasonStatus, initialTeams, onTeamsChange }: SeasonTeamsTabProps) {
  const [allTeams, setAllTeams] = useState<Team[]>([])
  const [assignedTeams, setAssignedTeams] = useState(initialTeams)
  const [franchises, setFranchises] = useState<Franchise[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [isProcessing, setIsProcessing] = useState<string | null>(null)
  const [isSavingFranchises, setIsSavingFranchises] = useState(false)

  // Local franchise assignment state (optimistic UI — only saved on "Save")
  const [localAssignments, setLocalAssignments] = useState<Record<string, string | null>>({})
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createTeamForm, setCreateTeamForm] = useState({ name: "", slug: "" })
  const [createTeamError, setCreateTeamError] = useState("")
  const [isCreatingTeam, setIsCreatingTeam] = useState(false)

  const isEditable = seasonStatus === "draft"

  // Initialize local assignments from server data
  useEffect(() => {
    const assignments: Record<string, string | null> = {}
    for (const team of initialTeams) {
      assignments[team.teamSlug] = team.franchiseSlug
    }
    setLocalAssignments(assignments)
    setHasUnsavedChanges(false)
  }, [initialTeams])

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const [teamsRes, franchisesRes] = await Promise.all([
        fetch("/api/bash/admin/teams"),
        fetch("/api/bash/admin/franchises"),
      ])
      if (teamsRes.ok) {
        const data = await teamsRes.json()
        setAllTeams(data.teams || [])
      }
      if (franchisesRes.ok) {
        const data = await franchisesRes.json()
        setFranchises(data.franchises || [])
      }
    } catch {
      toast.error("Failed to fetch data")
    } finally {
      setIsLoading(false)
    }
  }

  const addTeam = async (team: Team) => {
    if (!isEditable) return
    setIsProcessing(team.slug)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamSlug: team.slug }),
      })
      if (res.ok) {
        const updated = [...assignedTeams, { teamSlug: team.slug, teamName: team.name, franchiseSlug: null }].sort((a, b) => a.teamName.localeCompare(b.teamName))
        setAssignedTeams(updated)
        setLocalAssignments(prev => ({ ...prev, [team.slug]: null }))
        onTeamsChange?.(updated)
        toast.success(`Added ${team.name}`)
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to add team")
      }
    } catch {
      toast.error("Failed to add team")
    } finally {
      setIsProcessing(null)
    }
  }

  const removeTeam = async (slug: string, name: string) => {
    if (!isEditable) return
    setIsProcessing(slug)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/teams`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamSlug: slug }),
      })
      if (res.ok) {
        const updated = assignedTeams.filter(t => t.teamSlug !== slug)
        setAssignedTeams(updated)
        setLocalAssignments(prev => {
          const next = { ...prev }
          delete next[slug]
          return next
        })
        onTeamsChange?.(updated)
        toast.success(`Removed ${name}`)
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to remove team")
      }
    } catch {
      toast.error("Failed to remove team")
    } finally {
      setIsProcessing(null)
    }
  }

  const setFranchiseForTeam = useCallback((teamSlug: string, franchiseSlug: string | null) => {
    setLocalAssignments(prev => ({ ...prev, [teamSlug]: franchiseSlug }))
    setHasUnsavedChanges(true)
  }, [])

  const saveFranchiseAssignments = async () => {
    setIsSavingFranchises(true)
    try {
      const assignments = Object.entries(localAssignments).map(([teamSlug, franchiseSlug]) => ({
        teamSlug,
        franchiseSlug,
      }))

      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/teams`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments }),
      })

      if (res.ok) {
        const data = await res.json()
        // Update parent state with new franchise assignments
        const updated = assignedTeams.map(t => ({
          ...t,
          franchiseSlug: localAssignments[t.teamSlug] ?? null,
        }))
        setAssignedTeams(updated)
        onTeamsChange?.(updated)
        setHasUnsavedChanges(false)
        toast.success(`Updated ${data.updated} franchise assignments`)
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to save")
      }
    } catch {
      toast.error("Connection error")
    } finally {
      setIsSavingFranchises(false)
    }
  }


  const handleCreateTeam = async () => {
    if (!createTeamForm.name || !createTeamForm.slug) {
      setCreateTeamError("Both Name and Slug are required")
      return
    }
    setIsCreatingTeam(true)
    setCreateTeamError("")
    try {
      const res = await fetch("/api/bash/admin/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: createTeamForm.slug, name: createTeamForm.name }),
      })
      if (res.ok) {
        const data = await res.json()
        const newTeam = data.team
        setAllTeams((prev) => [...prev, newTeam].sort((a, b) => a.name.localeCompare(b.name)))
        toast.success(`Created team ${newTeam.name}`)
        setCreateModalOpen(false)
        setCreateTeamForm({ name: "", slug: "" })
        
        // Auto-assign to season
        addTeam(newTeam)
      } else {
        const err = await res.json()
        setCreateTeamError(err.error || "Failed to create team")
      }
    } catch {
      setCreateTeamError("Connection error")
    } finally {
      setIsCreatingTeam(false)
    }
  }


  const assignedSlugs = new Set(assignedTeams.map(t => t.teamSlug))
  const unassignedTeams = allTeams.filter(t => !assignedSlugs.has(t.slug))
  const searchLower = search.toLowerCase()
  
  const filteredUnassigned = unassignedTeams.filter(t => 
    t.name.toLowerCase().includes(searchLower) || t.slug.toLowerCase().includes(searchLower)
  )

  // Count assigned vs unassigned franchises
  const assignedFranchiseCount = Object.values(localAssignments).filter(Boolean).length

  return (
    <>
      <div className="space-y-4">
        {/* Teams Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Assigned Teams Panel */}
          <Card>
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle>Participating Teams</CardTitle>
                  <div className="text-sm font-medium bg-primary/10 text-primary px-2 py-0.5 rounded">
                    {assignedTeams.length}
                  </div>
                </div>
                {hasUnsavedChanges && (
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={saveFranchiseAssignments}
                    disabled={isSavingFranchises}
                  >
                    {isSavingFranchises ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                    Save Franchise Changes
                  </Button>
                )}
              </div>
              <CardDescription>
                Teams enrolled in this season. {assignedFranchiseCount}/{assignedTeams.length} franchise-linked.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              {!isEditable && (
                <div className="flex items-center gap-2 p-3 mb-4 bg-amber-50 text-amber-800 text-sm rounded-md border border-amber-200">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  Teams are locked because this season has left draft state.
                </div>
              )}
              
              <div className="space-y-2">
                {assignedTeams.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground border rounded-md border-dashed">
                    No teams assigned yet.
                  </div>
                ) : (
                  assignedTeams.map(team => {
                    return (
                      <div key={team.teamSlug} className="flex items-center justify-between p-2 border rounded-md group hover:border-primary/50 transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <TeamLogo slug={team.teamSlug} name={team.teamName} size={24} className="opacity-90 shrink-0" />
                          <span className="font-medium text-sm truncate">{team.teamName}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Select
                            value={localAssignments[team.teamSlug] || "__none__"}
                            onValueChange={(val) =>
                              setFranchiseForTeam(team.teamSlug, val === "__none__" ? null : val)
                            }
                          >
                            <SelectTrigger className="w-[130px] h-7 text-xs">
                              <SelectValue placeholder="Franchise" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">
                                <span className="text-muted-foreground">No franchise</span>
                              </SelectItem>
                              {franchises.map(f => (
                                <SelectItem key={f.slug} value={f.slug}>
                                  <div className="flex items-center gap-2">
                                    {f.logoTeamSlug ? (
                                      <TeamLogo slug={f.logoTeamSlug} name={f.name} size={14} className="shrink-0" />
                                    ) : (
                                      <div
                                        className="w-3 h-3 rounded-full border shrink-0"
                                        style={{ backgroundColor: f.color || "#6b7280" }}
                                      />
                                    )}
                                    {f.name}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {isEditable && (
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={() => removeTeam(team.teamSlug, team.teamName)}
                              disabled={isProcessing === team.teamSlug}
                            >
                              {isProcessing === team.teamSlug ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </CardContent>
          </Card>

          {/* Available Global Teams Panel */}
          {isEditable && (
            <Card className="bg-muted/30 border-dashed">
              <CardHeader className="pb-3 border-b border-dashed">
                <div className="flex items-center justify-between">
                  <CardTitle>Global Team Directory</CardTitle>
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setCreateModalOpen(true)}>
                    <Plus className="h-3 w-3 mr-1" /> Create Team
                  </Button>
                </div>
                <CardDescription>
                  Assign teams to this season. If a team doesn&apos;t exist, please create one.
                </CardDescription>
                <div className="pt-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder="Filter available teams..." 
                      className="pl-8 h-8 text-sm"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4 h-[400px] overflow-y-auto pr-2">
                {isLoading ? (
                  <div className="flex justify-center py-8 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : filteredUnassigned.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    {search ? "No matches found." : "All teams have been assigned!"}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredUnassigned.map(team => (
                      <div key={team.slug} className="flex items-center justify-between p-2 bg-card border border-dashed rounded-md group hover:border-primary/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <TeamLogo slug={team.slug} name={team.name} size={20} className="opacity-70 grayscale group-hover:grayscale-0 transition-all" />
                          <div className="flex flex-col">
                            <span className="font-medium text-sm leading-none">{team.name}</span>
                            <span className="text-[10px] text-muted-foreground mt-0.5">{team.slug}</span>
                          </div>
                        </div>
                        <Button 
                          variant="secondary" 
                          size="sm" 
                          className="h-7 text-xs"
                          onClick={() => addTeam(team)}
                          disabled={isProcessing === team.slug}
                        >
                          {isProcessing === team.slug ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
                          Assign
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Team</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Team Name</Label>
              <Input
                placeholder="e.g. Mighty Ducks"
                value={createTeamForm.name}
                onChange={(e) => {
                  const newName = e.target.value
                  setCreateTeamForm(f => ({
                    ...f,
                    name: newName,
                    slug: f.slug === f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') ? newName.toLowerCase().replace(/[^a-z0-9]+/g, '-') : f.slug
                  }))
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Team ID</Label>
              <Input
                placeholder="e.g. mighty-ducks"
                value={createTeamForm.slug}
                onChange={(e) => setCreateTeamForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
              />
              <p className="text-[10px] text-muted-foreground">Unique identifier used in URLs. Alphanumeric and hyphens only.</p>
            </div>
            {createTeamError && (
              <div className="text-sm text-destructive">{createTeamError}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateModalOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateTeam} disabled={isCreatingTeam || !createTeamForm.name || !createTeamForm.slug}>
              {isCreatingTeam ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create & Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
