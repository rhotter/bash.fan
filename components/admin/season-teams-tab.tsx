"use client"

import { LoadingState } from "@/components/loading-state"
import { Spinner } from "@/components/ui/spinner"
import { useState, useEffect, useCallback } from "react"
import { Search, Plus, X, ShieldAlert, Pencil, Check, PanelRightOpen, PanelRightClose, Leaf } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { TeamLogo } from "@/components/team-logo"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { HexColorPicker } from "react-colorful"


interface SeasonTeamsTabProps {
  seasonId: string
  seasonStatus: string
  initialTeams: { teamSlug: string; teamName: string; franchiseSlug: string | null; color: string | null }[]
  onTeamsChange?: (teams: { teamSlug: string; teamName: string; franchiseSlug: string | null; color: string | null }[]) => void
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

  const [localAssignments, setLocalAssignments] = useState<Record<string, string | null>>({})
  const [localColors, setLocalColors] = useState<Record<string, string | null>>({})
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createTeamForm, setCreateTeamForm] = useState({ name: "", slug: "" })
  const [createTeamError, setCreateTeamError] = useState("")
  const [isCreatingTeam, setIsCreatingTeam] = useState(false)

  const [editingTeamSlug, setEditingTeamSlug] = useState<string | null>(null)
  const [editingTeamName, setEditingTeamName] = useState("")

  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [fallOnly, setFallOnly] = useState(true)

  const isEditable = seasonStatus === "draft"

  useEffect(() => {
    const assignments: Record<string, string | null> = {}
    const colors: Record<string, string | null> = {}
    for (const team of initialTeams) {
      assignments[team.teamSlug] = team.franchiseSlug
      colors[team.teamSlug] = team.color
    }
    setLocalAssignments(assignments)
    setLocalColors(colors)
    setHasUnsavedChanges(false)
  }, [initialTeams])

  useEffect(() => {
    fetchData(fallOnly)
  }, [fallOnly])

  const fetchData = async (filterFall: boolean) => {
    try {
      const teamsUrl = filterFall
        ? "/api/bash/admin/teams?seasonType=fall"
        : "/api/bash/admin/teams"
      const [teamsRes, franchisesRes] = await Promise.all([
        fetch(teamsUrl),
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
        const updated = [...assignedTeams, { teamSlug: team.slug, teamName: team.name, franchiseSlug: null, color: null }].sort((a, b) => a.teamName.localeCompare(b.teamName))
        setAssignedTeams(updated)
        setLocalAssignments(prev => ({ ...prev, [team.slug]: null }))
        setLocalColors(prev => ({ ...prev, [team.slug]: null }))
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
        setLocalColors(prev => {
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
    // When assigning a franchise, auto-populate color from franchise if team has no color
    if (franchiseSlug) {
      const franchise = franchises.find(f => f.slug === franchiseSlug)
      if (franchise?.color) {
        setLocalColors(prev => {
          if (!prev[teamSlug]) return { ...prev, [teamSlug]: franchise.color }
          return prev
        })
      }
    }
    setHasUnsavedChanges(true)
  }, [franchises])

  const setColorForTeam = useCallback((teamSlug: string, color: string | null) => {
    setLocalColors(prev => ({ ...prev, [teamSlug]: color }))
    setHasUnsavedChanges(true)
  }, [])

  const saveFranchiseAssignments = async () => {
    setIsSavingFranchises(true)
    try {
      const assignments = Object.entries(localAssignments).map(([teamSlug, franchiseSlug]) => ({
        teamSlug,
        franchiseSlug,
        color: localColors[teamSlug] ?? null,
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
          color: localColors[t.teamSlug] ?? null,
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
  const renameTeam = async (slug: string) => {
    const trimmed = editingTeamName.trim()
    if (!trimmed) {
      setEditingTeamSlug(null)
      return
    }
    // Skip if unchanged
    const current = assignedTeams.find(t => t.teamSlug === slug)
    if (current && current.teamName === trimmed) {
      setEditingTeamSlug(null)
      return
    }
    try {
      const res = await fetch(`/api/bash/admin/teams/${slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })
      if (res.ok) {
        const updated = assignedTeams.map(t =>
          t.teamSlug === slug ? { ...t, teamName: trimmed } : t
        )
        setAssignedTeams(updated)
        onTeamsChange?.(updated)
        // Also update the allTeams list so the global directory stays in sync
        setAllTeams(prev => prev.map(t => t.slug === slug ? { ...t, name: trimmed } : t))
        toast.success(`Renamed to ${trimmed}`)
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to rename team")
      }
    } catch {
      toast.error("Connection error")
    } finally {
      setEditingTeamSlug(null)
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

  // Resolve display color: explicit team color → franchise color → default gray
  const resolveColor = (teamSlug: string): string => {
    if (localColors[teamSlug]) return localColors[teamSlug]!
    const fSlug = localAssignments[teamSlug]
    if (fSlug) {
      const franchise = franchises.find(f => f.slug === fSlug)
      if (franchise?.color) return franchise.color
    }
    return '#94a3b8'
  }

  return (
    <>
      <div className="space-y-4">
        {/* Teams Layout */}
        <div className="flex gap-6">
          {/* Participating Teams — fills available space */}
          <div className={`flex-1 min-w-0 transition-all ${directoryOpen && isEditable ? '' : ''}`}>
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
                    {isSavingFranchises ? <Spinner className="h-3 w-3 mr-1" /> : null}
                    Save Team Changes
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
                  Teams are locked because this season has left draft state. Colors and franchises can still be updated.
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
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                className="w-6 h-6 rounded-full border-2 border-muted hover:border-primary/50 transition-colors cursor-pointer shrink-0 focus:outline-none focus:ring-2 focus:ring-primary/50"
                                style={{ backgroundColor: resolveColor(team.teamSlug) }}
                                title="Set team color for season"
                              />
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-3" align="start">
                              <div className="space-y-3">
                                <p className="text-xs font-medium text-muted-foreground">Team Color</p>
                                <HexColorPicker
                                  color={resolveColor(team.teamSlug)}
                                  onChange={(c) => setColorForTeam(team.teamSlug, c)}
                                />
                                <div className="flex items-center gap-2">
                                  <Input
                                    value={localColors[team.teamSlug] || ''}
                                    onChange={(e) => setColorForTeam(team.teamSlug, e.target.value)}
                                    placeholder="#hexcolor"
                                    className="h-7 text-xs font-mono"
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => setColorForTeam(team.teamSlug, null)}
                                  >
                                    Clear
                                  </Button>
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                          <TeamLogo slug={team.teamSlug} name={team.teamName} size={24} className="opacity-90 shrink-0" />
                          {editingTeamSlug === team.teamSlug ? (
                            <form
                              className="flex items-center gap-1 min-w-0"
                              onSubmit={(e) => { e.preventDefault(); renameTeam(team.teamSlug) }}
                            >
                              <Input
                                autoFocus
                                value={editingTeamName}
                                onChange={(e) => setEditingTeamName(e.target.value)}
                                onBlur={() => renameTeam(team.teamSlug)}
                                onKeyDown={(e) => { if (e.key === 'Escape') setEditingTeamSlug(null) }}
                                className="h-6 text-sm font-medium px-1.5 py-0 w-[160px]"
                              />
                              <Button type="submit" variant="ghost" size="icon" className="h-6 w-6 text-primary">
                                <Check className="h-3 w-3" />
                              </Button>
                            </form>
                          ) : (
                            <span
                              className="font-medium text-sm truncate group/name inline-flex items-center gap-1.5 cursor-pointer hover:text-primary transition-colors"
                              onClick={() => { setEditingTeamSlug(team.teamSlug); setEditingTeamName(team.teamName) }}
                              title="Click to rename"
                            >
                              {team.teamName}
                              <Pencil className="h-3 w-3 opacity-0 group-hover/name:opacity-60 transition-opacity" />
                            </span>
                          )}
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
                              {isProcessing === team.teamSlug ? <Spinner className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
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
          </div>

          {/* Toggle button for directory panel */}
          {isEditable && (
            <div className="flex items-start pt-2">
              {directoryOpen ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-primary"
                  onClick={() => setDirectoryOpen(false)}
                  title="Collapse directory"
                >
                  <PanelRightClose className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 text-xs gap-1.5 text-muted-foreground hover:text-primary"
                  onClick={() => setDirectoryOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Assign Teams
                  <PanelRightOpen className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}

          {/* Available Global Teams Panel — collapsible */}
          {isEditable && directoryOpen && (
            <div className="w-[400px] shrink-0 transition-all">
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
                <div className="pt-2 flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder="Filter available teams..." 
                      className="pl-8 h-8 text-sm"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>
                  <Button
                    variant={fallOnly ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs shrink-0 gap-1"
                    onClick={() => { setIsLoading(true); setFallOnly(prev => !prev) }}
                    title={fallOnly ? "Showing fall league teams only" : "Showing all teams"}
                  >
                    <Leaf className="h-3 w-3" />
                    Fall
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-4 h-[400px] overflow-y-auto pr-2">
                {isLoading ? (
                  <LoadingState variant="list" label="Loading teams…" />
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
                          {isProcessing === team.slug ? <Spinner className="h-3 w-3" /> : <Plus className="h-3 w-3 mr-1" />}
                          Assign
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            </div>
          )}
        </div>
      </div>

      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Team</DialogTitle>
          </DialogHeader>
          <div className="flex items-start gap-2 p-2.5 bg-amber-50 text-amber-800 text-xs rounded-md border border-amber-200">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>Team name IDs are <strong>permanent</strong> and visible across the site. Only create a team once you have the final/near final name. You do not need teams entered here to experiment with the schedule tab/wizard.</span>
          </div>
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
              {isCreatingTeam ? <Spinner className="mr-2 h-4 w-4" /> : null}
              Create & Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
