"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, Plus, Pencil, Trash2, Palette, ChevronRight, X, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { toast } from "sonner"
import { TeamLogo } from "@/components/team-logo"

interface Franchise {
  slug: string
  name: string
  color: string | null
  logoTeamSlug: string | null
  logoSeasonId: string | null
}

interface SeasonTeamEntry {
  seasonId: string
  teamSlug: string
  teamName: string
  seasonName: string
}

export function FranchiseManager() {
  const [franchises, setFranchises] = useState<Franchise[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ name: "", slug: "", color: "#3b82f6" })
  const [createError, setCreateError] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  // Edit modal
  const [editOpen, setEditOpen] = useState(false)
  const [editFranchise, setEditFranchise] = useState<Franchise | null>(null)
  const [editForm, setEditForm] = useState({ name: "", color: "" })
  const [isEditing, setIsEditing] = useState(false)

  const [deletingSlug, setDeletingSlug] = useState<string | null>(null)

  // Detail panel
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [linkedTeams, setLinkedTeams] = useState<SeasonTeamEntry[]>([])
  const [unlinkedTeams, setUnlinkedTeams] = useState<SeasonTeamEntry[]>([])
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [unlinkedSearch, setUnlinkedSearch] = useState("")
  const [pendingAssign, setPendingAssign] = useState<Set<string>>(new Set())
  const [pendingUnassign, setPendingUnassign] = useState<Set<string>>(new Set())
  const [isSaving, setIsSaving] = useState(false)

  const fetchFranchises = useCallback(async () => {
    try {
      const res = await fetch("/api/bash/admin/franchises")
      if (res.ok) {
        const data = await res.json()
        setFranchises(data.franchises || [])
      }
    } catch {
      toast.error("Failed to load franchises")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { fetchFranchises() }, [fetchFranchises])

  const fetchFranchiseDetail = useCallback(async (slug: string) => {
    setIsLoadingDetail(true)
    try {
      const res = await fetch(`/api/bash/admin/franchises/${slug}/teams`)
      if (res.ok) {
        const data = await res.json()
        setLinkedTeams(data.linkedTeams || [])
        setUnlinkedTeams(data.unlinkedTeams || [])
      } else {
        toast.error("Failed to load franchise detail")
      }
    } catch {
      toast.error("Connection error")
    } finally {
      setIsLoadingDetail(false)
    }
  }, [])

  const selectFranchise = (slug: string) => {
    if (selectedSlug === slug) {
      setSelectedSlug(null)
      return
    }
    setSelectedSlug(slug)
    setPendingAssign(new Set())
    setPendingUnassign(new Set())
    setUnlinkedSearch("")
    fetchFranchiseDetail(slug)
  }

  const makeKey = (e: SeasonTeamEntry) => `${e.seasonId}::${e.teamSlug}`

  const toggleAssign = (entry: SeasonTeamEntry) => {
    const key = makeKey(entry)
    setPendingAssign(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleUnassign = (entry: SeasonTeamEntry) => {
    const key = makeKey(entry)
    setPendingUnassign(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const hasPendingChanges = pendingAssign.size > 0 || pendingUnassign.size > 0

  const saveAssignments = async () => {
    if (!selectedSlug || !hasPendingChanges) return
    setIsSaving(true)
    try {
      const assign = [...pendingAssign].map(key => {
        const [seasonId, teamSlug] = key.split("::")
        return { seasonId, teamSlug }
      })
      const unassign = [...pendingUnassign].map(key => {
        const [seasonId, teamSlug] = key.split("::")
        return { seasonId, teamSlug }
      })

      const res = await fetch(`/api/bash/admin/franchises/${selectedSlug}/teams`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assign, unassign }),
      })
      if (res.ok) {
        const data = await res.json()
        toast.success(`Updated ${data.updated} team assignment(s)`)
        setPendingAssign(new Set())
        setPendingUnassign(new Set())
        // Refresh detail + franchise list (logo may have changed)
        fetchFranchiseDetail(selectedSlug)
        fetchFranchises()
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to save")
      }
    } catch {
      toast.error("Connection error")
    } finally {
      setIsSaving(false)
    }
  }

  const handleCreate = async () => {
    if (!createForm.name || !createForm.slug) {
      setCreateError("Name and slug are required")
      return
    }
    setIsCreating(true)
    setCreateError("")
    try {
      const res = await fetch("/api/bash/admin/franchises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      })
      if (res.ok) {
        const data = await res.json()
        setFranchises(prev => [...prev, data.franchise].sort((a, b) => a.name.localeCompare(b.name)))
        toast.success(`Created ${data.franchise.name}`)
        setCreateOpen(false)
        setCreateForm({ name: "", slug: "", color: "#3b82f6" })
      } else {
        const err = await res.json()
        setCreateError(err.error || "Failed to create franchise")
      }
    } catch {
      setCreateError("Connection error")
    } finally {
      setIsCreating(false)
    }
  }

  const handleEdit = async () => {
    if (!editFranchise) return
    setIsEditing(true)
    try {
      const res = await fetch(`/api/bash/admin/franchises/${editFranchise.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      })
      if (res.ok) {
        setFranchises(prev => prev.map(f =>
          f.slug === editFranchise.slug ? { ...f, name: editForm.name, color: editForm.color || null } : f
        ))
        toast.success(`Updated ${editForm.name}`)
        setEditOpen(false)
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to update")
      }
    } catch {
      toast.error("Connection error")
    } finally {
      setIsEditing(false)
    }
  }

  const handleDelete = async (slug: string) => {
    setDeletingSlug(slug)
    try {
      const res = await fetch(`/api/bash/admin/franchises/${slug}`, { method: "DELETE" })
      if (res.ok) {
        setFranchises(prev => prev.filter(f => f.slug !== slug))
        if (selectedSlug === slug) setSelectedSlug(null)
        toast.success("Franchise deleted")
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to delete")
      }
    } catch {
      toast.error("Connection error")
    } finally {
      setDeletingSlug(null)
    }
  }

  const openEdit = (f: Franchise) => {
    setEditFranchise(f)
    setEditForm({ name: f.name, color: f.color || "#3b82f6" })
    setEditOpen(true)
  }

  const selectedFranchise = franchises.find(f => f.slug === selectedSlug) || null

  // Compute effective lists (accounting for pending changes)
  const effectiveLinked = linkedTeams.filter(e => !pendingUnassign.has(makeKey(e)))
  const pendingNewLinked = unlinkedTeams.filter(e => pendingAssign.has(makeKey(e)))
  const effectiveUnlinked = unlinkedTeams.filter(e => !pendingAssign.has(makeKey(e)))
  const removedFromLinked = linkedTeams.filter(e => pendingUnassign.has(makeKey(e)))

  const searchLower = unlinkedSearch.toLowerCase()
  const filteredUnlinked = effectiveUnlinked.filter(e =>
    e.teamName.toLowerCase().includes(searchLower) ||
    e.seasonName.toLowerCase().includes(searchLower)
  )

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Franchise List */}
        <div className={selectedSlug ? "lg:col-span-2" : "lg:col-span-5"}>
          <Card>
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>All Franchises</CardTitle>
                  <CardDescription>
                    Click a franchise to view and manage its season teams.
                  </CardDescription>
                </div>
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" /> New Franchise
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {franchises.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground border rounded-md border-dashed">
                  No franchises yet. Create your first one.
                </div>
              ) : (
                <div className="space-y-1">
                  {franchises.map(f => (
                    <div
                      key={f.slug}
                      className={`flex items-center justify-between p-3 border rounded-md group transition-colors cursor-pointer ${
                        selectedSlug === f.slug
                          ? "border-primary bg-primary/5"
                          : "hover:border-primary/50"
                      }`}
                      onClick={() => selectFranchise(f.slug)}
                    >
                      <div className="flex items-center gap-3">
                        {f.logoTeamSlug ? (
                          <div className="w-8 h-8 rounded-md border flex items-center justify-center shrink-0 overflow-hidden" style={{ backgroundColor: f.color || '#6b7280' }}>
                            <TeamLogo slug={f.logoTeamSlug} name={f.name} size={28} />
                          </div>
                        ) : (
                          <div
                            className="w-8 h-8 rounded-md border flex items-center justify-center text-white text-xs font-bold shrink-0"
                            style={{ backgroundColor: f.color || "#6b7280" }}
                          >
                            {f.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">{f.name}</span>
                          <span className="text-[10px] text-muted-foreground">{f.slug}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEdit(f) }}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                disabled={deletingSlug === f.slug}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {deletingSlug === f.slug ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete {f.name}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This franchise will be permanently removed. It cannot be deleted if any season teams still reference it.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-white hover:bg-destructive/90"
                                  onClick={() => handleDelete(f.slug)}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                        <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${selectedSlug === f.slug ? "rotate-90" : ""}`} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Detail Panel */}
        {selectedSlug && selectedFranchise && (
          <div className="lg:col-span-3">
            <Card className="sticky top-4">
              <CardHeader className="pb-3 border-b">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {selectedFranchise.logoTeamSlug ? (
                      <div className="w-10 h-10 rounded-lg border flex items-center justify-center shrink-0 overflow-hidden" style={{ backgroundColor: selectedFranchise.color || '#6b7280' }}>
                        <TeamLogo slug={selectedFranchise.logoTeamSlug} name={selectedFranchise.name} size={34} />
                      </div>
                    ) : (
                      <div
                        className="w-10 h-10 rounded-lg border flex items-center justify-center text-white text-sm font-bold shrink-0"
                        style={{ backgroundColor: selectedFranchise.color || "#6b7280" }}
                      >
                        {selectedFranchise.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <CardTitle>{selectedFranchise.name}</CardTitle>
                      <CardDescription>
                        {effectiveLinked.length + pendingNewLinked.length} season team{(effectiveLinked.length + pendingNewLinked.length) !== 1 ? "s" : ""} linked
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasPendingChanges && (
                      <Button size="sm" className="h-8 text-xs" onClick={saveAssignments} disabled={isSaving}>
                        {isSaving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                        Save Changes
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedSlug(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {isLoadingDetail ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    {/* Linked Teams */}
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        Season History
                      </h4>
                      {effectiveLinked.length === 0 && pendingNewLinked.length === 0 ? (
                        <div className="text-center py-6 text-sm text-muted-foreground border rounded-md border-dashed">
                          No teams linked yet. Assign teams from the list below.
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {/* Pending new additions (staged) */}
                          {pendingNewLinked.map(entry => (
                            <div key={makeKey(entry)} className="flex items-center justify-between p-2 border border-green-200 bg-green-50 rounded-md transition-colors">
                              <div className="flex items-center gap-3 min-w-0">
                                <TeamLogo slug={entry.teamSlug} name={entry.teamName} size={24} className="shrink-0" />
                                <div className="flex flex-col min-w-0">
                                  <span className="font-medium text-sm truncate">{entry.teamName}</span>
                                  <span className="text-[10px] text-muted-foreground">{entry.seasonName}</span>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-muted-foreground hover:text-destructive"
                                onClick={() => toggleAssign(entry)}
                              >
                                Undo
                              </Button>
                            </div>
                          ))}
                          {/* Existing linked */}
                          {effectiveLinked.map(entry => (
                            <div key={makeKey(entry)} className="flex items-center justify-between p-2 border rounded-md hover:border-primary/30 transition-colors">
                              <div className="flex items-center gap-3 min-w-0">
                                <TeamLogo slug={entry.teamSlug} name={entry.teamName} size={24} className="shrink-0" />
                                <div className="flex flex-col min-w-0">
                                  <span className="font-medium text-sm truncate">{entry.teamName}</span>
                                  <span className="text-[10px] text-muted-foreground">{entry.seasonName}</span>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100"
                                onClick={() => toggleUnassign(entry)}
                              >
                                <X className="h-3 w-3 mr-1" /> Remove
                              </Button>
                            </div>
                          ))}
                          {/* Pending removals (staged) */}
                          {removedFromLinked.map(entry => (
                            <div key={makeKey(entry)} className="flex items-center justify-between p-2 border border-red-200 bg-red-50 rounded-md transition-colors">
                              <div className="flex items-center gap-3 min-w-0 opacity-50">
                                <TeamLogo slug={entry.teamSlug} name={entry.teamName} size={24} className="shrink-0" />
                                <div className="flex flex-col min-w-0">
                                  <span className="font-medium text-sm truncate line-through">{entry.teamName}</span>
                                  <span className="text-[10px] text-muted-foreground">{entry.seasonName}</span>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => toggleUnassign(entry)}
                              >
                                Undo
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Unlinked / Available Teams */}
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                        Available Season Teams
                      </h4>
                      <p className="text-[10px] text-muted-foreground mb-2">
                        Only teams from active, completed, or archived seasons. Draft season teams can be assigned via the season&apos;s Teams tab.
                      </p>
                      <div className="relative mb-2">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          placeholder="Search teams or seasons..."
                          className="pl-8 h-8 text-sm"
                          value={unlinkedSearch}
                          onChange={e => setUnlinkedSearch(e.target.value)}
                        />
                      </div>
                      <div className="max-h-[300px] overflow-y-auto space-y-1 pr-1">
                        {filteredUnlinked.length === 0 ? (
                          <div className="text-center py-4 text-sm text-muted-foreground">
                            {unlinkedSearch ? "No matches." : "No unlinked teams available."}
                          </div>
                        ) : (
                          filteredUnlinked.map(entry => (
                            <div
                              key={makeKey(entry)}
                              className="flex items-center justify-between p-2 border border-dashed rounded-md hover:border-primary/50 transition-colors cursor-pointer"
                              onClick={() => toggleAssign(entry)}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <TeamLogo slug={entry.teamSlug} name={entry.teamName} size={20} className="shrink-0 opacity-70" />
                                <div className="flex flex-col min-w-0">
                                  <span className="font-medium text-sm truncate">{entry.teamName}</span>
                                  <span className="text-[10px] text-muted-foreground">{entry.seasonName}</span>
                                </div>
                              </div>
                              <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Franchise</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Franchise Name</Label>
              <Input
                placeholder="e.g. Red Army"
                value={createForm.name}
                onChange={(e) => {
                  const name = e.target.value
                  setCreateForm(f => ({
                    ...f,
                    name,
                    slug: f.slug === f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
                      ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
                      : f.slug,
                  }))
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input
                placeholder="e.g. red-army"
                value={createForm.slug}
                onChange={(e) => setCreateForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
              />
              <p className="text-[10px] text-muted-foreground">Unique identifier. Alphanumeric and hyphens only.</p>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Palette className="h-3.5 w-3.5" /> Franchise Color
              </Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={createForm.color}
                  onChange={(e) => setCreateForm(f => ({ ...f, color: e.target.value }))}
                  className="h-9 w-12 rounded border cursor-pointer"
                />
                <Input
                  value={createForm.color}
                  onChange={(e) => setCreateForm(f => ({ ...f, color: e.target.value }))}
                  className="font-mono text-sm w-28"
                  placeholder="#3b82f6"
                />
              </div>
            </div>
            {createError && <div className="text-sm text-destructive">{createError}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={isCreating || !createForm.name || !createForm.slug}>
              {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Franchise
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editFranchise?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Franchise Name</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Palette className="h-3.5 w-3.5" /> Franchise Color
              </Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={editForm.color}
                  onChange={(e) => setEditForm(f => ({ ...f, color: e.target.value }))}
                  className="h-9 w-12 rounded border cursor-pointer"
                />
                <Input
                  value={editForm.color}
                  onChange={(e) => setEditForm(f => ({ ...f, color: e.target.value }))}
                  className="font-mono text-sm w-28"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={isEditing || !editForm.name}>
              {isEditing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
