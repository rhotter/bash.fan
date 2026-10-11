"use client"

import { Spinner } from "@/components/ui/spinner"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Pencil, Trash2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"

export interface ExtraRow {
  id: number
  name: string
  description: string | null
  price: number // cents
  detailType: string | null
  detailLabel: string | null
  active: boolean
}

const DETAIL_TYPE_LABELS: Record<string, string> = {
  none: "Checkbox only",
  text: "Text input",
  size_dropdown: "Size (S–XXL)",
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

interface FormState {
  name: string
  description: string
  priceDollars: string
  detailType: string // "none" | "text" | "size_dropdown"
  detailLabel: string
  active: boolean
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  priceDollars: "",
  detailType: "none",
  detailLabel: "",
  active: true,
}

export function ExtrasClient({ initial }: { initial: ExtraRow[] }) {
  const router = useRouter()
  const [extras, setExtras] = useState(initial)
  const [editing, setEditing] = useState<ExtraRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ExtraRow | null>(null)

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (row: ExtraRow) => {
    setEditing(row)
    setForm({
      name: row.name,
      description: row.description ?? "",
      priceDollars: (row.price / 100).toString(),
      detailType: row.detailType ?? "none",
      detailLabel: row.detailLabel ?? "",
      active: row.active,
    })
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required")
      return
    }
    const dollars = Number.parseFloat(form.priceDollars || "0")
    if (Number.isNaN(dollars) || dollars < 0) {
      toast.error("Price must be a non-negative number")
      return
    }

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      price: Math.round(dollars * 100),
      detailType: form.detailType === "none" ? null : form.detailType,
      detailLabel: form.detailLabel.trim() || null,
      active: form.active,
    }

    setBusy(true)
    try {
      const url = editing
        ? `/api/bash/admin/registration/extras/${editing.id}`
        : `/api/bash/admin/registration/extras`
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Save failed")

      const saved: ExtraRow = {
        id: data.id,
        name: data.name,
        description: data.description,
        price: data.price,
        detailType: data.detailType,
        detailLabel: data.detailLabel,
        active: data.active,
      }

      setExtras((prev) =>
        editing ? prev.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...prev]
      )
      setDialogOpen(false)
      toast.success(editing ? "Extra updated" : "Extra created")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed")
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    setBusy(true)
    try {
      const res = await fetch(`/api/bash/admin/registration/extras/${pendingDelete.id}`, {
        method: "DELETE",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Delete failed")
      setExtras((prev) => prev.filter((c) => c.id !== pendingDelete.id))
      setPendingDelete(null)
      toast.success("Extra deleted")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">All extras</CardTitle>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1.5" />
              New extra
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit extra" : "New extra"}</DialogTitle>
              <DialogDescription>
                Optional add-on. Choose how the player provides extra detail when they select it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="BASH Donation"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="price">Price ($)</Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.priceDollars}
                    onChange={(e) => setForm({ ...form, priceDollars: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Player-facing helper text shown next to the checkbox."
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Detail type</Label>
                  <Select
                    value={form.detailType}
                    onValueChange={(v) => setForm({ ...form, detailType: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Checkbox only</SelectItem>
                      <SelectItem value="text">Text input</SelectItem>
                      <SelectItem value="size_dropdown">Size dropdown (S–XXL)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="detailLabel">Detail label</Label>
                  <Input
                    id="detailLabel"
                    value={form.detailLabel}
                    onChange={(e) => setForm({ ...form, detailLabel: e.target.value })}
                    placeholder="Amount"
                    disabled={form.detailType === "none"}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="block">Active</Label>
                <div className="flex items-center h-9">
                  <Switch
                    checked={form.active}
                    onCheckedChange={(v) => setForm({ ...form, active: v })}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={busy}>
                {busy && <Spinner className="h-4 w-4 mr-1.5" />}
                {editing ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-semibold">Name</TableHead>
                <TableHead className="text-xs font-semibold">Description</TableHead>
                <TableHead className="text-xs font-semibold text-right">Price</TableHead>
                <TableHead className="text-xs font-semibold">Detail</TableHead>
                <TableHead className="text-xs font-semibold">Status</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {extras.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-10">
                    No extras yet. Click <span className="font-medium">New extra</span> to add one.
                  </TableCell>
                </TableRow>
              ) : (
                extras.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium text-sm">{c.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[28ch] truncate">
                      {c.description || "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">{formatCents(c.price)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {DETAIL_TYPE_LABELS[c.detailType ?? "none"]}
                      {c.detailLabel && <span className="ml-1 text-muted-foreground/70">({c.detailLabel})</span>}
                    </TableCell>
                    <TableCell>
                      {c.active ? (
                        <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-700 border-green-500/30">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setPendingDelete(c)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this extra?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && (
                <>This will permanently delete <span className="font-semibold">{pendingDelete.name}</span>.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleDelete()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy}
            >
              {busy && <Spinner className="h-4 w-4 mr-1.5" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
