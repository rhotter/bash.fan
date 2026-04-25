"use client"

import { useState, useEffect } from "react"
import { Search, Loader2, Plus, X, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"
import { TeamLogo } from "@/components/team-logo"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

interface SeasonTeamsTabProps {
  seasonId: string
  seasonStatus: string
  initialTeams: { teamSlug: string; teamName: string }[]
}

interface Team {
  slug: string
  name: string
}

export function SeasonTeamsTab({ seasonId, seasonStatus, initialTeams }: SeasonTeamsTabProps) {
  const [allTeams, setAllTeams] = useState<Team[]>([])
  const [assignedTeams, setAssignedTeams] = useState<{ teamSlug: string; teamName: string }[]>(initialTeams)
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [isProcessing, setIsProcessing] = useState<string | null>(null)

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createTeamForm, setCreateTeamForm] = useState({ name: "", slug: "" })
  const [createTeamError, setCreateTeamError] = useState("")
  const [isCreatingTeam, setIsCreatingTeam] = useState(false)

  const isEditable = seasonStatus === "draft"

  useEffect(() => {
    fetchGlobalTeams()
  }, [])

  const fetchGlobalTeams = async () => {
    try {
      const res = await fetch("/api/bash/admin/teams")
      if (res.ok) {
        const data = await res.json()
        setAllTeams(data.teams || [])
      }
    } catch (e) {
      toast.error("Failed to fetch available teams")
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
        setAssignedTeams([...assignedTeams, { teamSlug: team.slug, teamName: team.name }].sort((a, b) => a.teamName.localeCompare(b.teamName)))
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
        setAssignedTeams(assignedTeams.filter(t => t.teamSlug !== slug))
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
        toast.success(`Created franchise ${newTeam.name}`)
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Assigned Teams Panel */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <div className="flex items-center justify-between">
            <CardTitle>Participating Teams</CardTitle>
            <div className="text-sm font-medium bg-primary/10 text-primary px-2 py-0.5 rounded">
              {assignedTeams.length}
            </div>
          </div>
          <CardDescription>
            Teams actively enrolled in this season.
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
              assignedTeams.map(team => (
                <div key={team.teamSlug} className="flex items-center justify-between p-2 border rounded-md group hover:border-primary/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <TeamLogo slug={team.teamSlug} name={team.teamName} size={24} className="opacity-90" />
                    <span className="font-medium text-sm">{team.teamName}</span>
                  </div>
                  {isEditable && (
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => removeTeam(team.teamSlug, team.teamName)}
                      disabled={isProcessing === team.teamSlug}
                    >
                      {isProcessing === team.teamSlug ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Available Global Teams Panel */}
      {isEditable && (
        <Card className="bg-muted/30 border-dashed">
          <CardHeader className="pb-3 border-b border-dashed">
            <div className="flex items-center justify-between">
              <CardTitle>Global Franchise Directory</CardTitle>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setCreateModalOpen(true)}>
                <Plus className="h-3 w-3 mr-1" /> Create Team
              </Button>
            </div>
            <CardDescription>
              Assign franchises to this season. If a team doesn't exist, please create one.
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
                {search ? "No matches found." : "All franchises have been assigned!"}
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

      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Franchise</DialogTitle>
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
    </div>
  )
}
