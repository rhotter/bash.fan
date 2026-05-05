"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, Plus, Pencil, Trash2, Palette } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { toast } from "sonner"

interface Franchise {
  slug: string
  name: string
  color: string | null
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

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3 border-b">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>All Franchises</CardTitle>
              <CardDescription>
                Franchise identities persist across seasons. Assign them to season teams.
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
            <div className="space-y-2">
              {franchises.map(f => (
                <div
                  key={f.slug}
                  className="flex items-center justify-between p-3 border rounded-md group hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-md border flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ backgroundColor: f.color || "#6b7280" }}
                    >
                      {f.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium text-sm">{f.name}</span>
                      <span className="text-[10px] text-muted-foreground">{f.slug}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(f)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          disabled={deletingSlug === f.slug}
                        >
                          {deletingSlug === f.slug ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
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
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
