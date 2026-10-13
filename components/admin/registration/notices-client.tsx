"use client"

import { fetchApi as fetch, readApiJson, errorMessage } from "@/lib/api-errors"

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
import { toast } from "sonner"

export interface NoticeRow {
  id: number
  title: string
  body: string
  ackType: string
  version: number
  updatedAt: string | null
}

interface FormState {
  title: string
  body: string
  ackType: string
}

const EMPTY_FORM: FormState = { title: "", body: "", ackType: "basic" }

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

export function NoticesClient({ initial }: { initial: NoticeRow[] }) {
  const router = useRouter()
  const [notices, setNotices] = useState(initial)
  const [editing, setEditing] = useState<NoticeRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<NoticeRow | null>(null)

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (row: NoticeRow) => {
    setEditing(row)
    setForm({ title: row.title, body: row.body, ackType: row.ackType })
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      toast.error("Title is required")
      return
    }
    if (!form.body.trim()) {
      toast.error("Body is required")
      return
    }

    setBusy(true)
    try {
      const url = editing
        ? `/api/bash/admin/registration/notices/${editing.id}`
        : `/api/bash/admin/registration/notices`
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          body: form.body,
          ackType: form.ackType,
        }),
      })
      const data = await readApiJson(res)
      if (!res.ok) throw new Error(data.error || "Save failed")

      const saved: NoticeRow = {
        id: data.id,
        title: data.title,
        body: data.body,
        ackType: data.ackType,
        version: data.version,
        updatedAt: data.updatedAt,
      }

      setNotices((prev) =>
        editing ? prev.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...prev]
      )
      setDialogOpen(false)
      toast.success(editing ? "Notice updated" : "Notice created")
      router.refresh()
    } catch (err) {
      toast.error(errorMessage(err, "Save failed"))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!pendingDelete) return
    setBusy(true)
    try {
      const res = await fetch(`/api/bash/admin/registration/notices/${pendingDelete.id}`, {
        method: "DELETE",
      })
      const data = await readApiJson(res)
      if (!res.ok) throw new Error(data.error || "Delete failed")
      setNotices((prev) => prev.filter((c) => c.id !== pendingDelete.id))
      setPendingDelete(null)
      toast.success("Notice deleted")
      router.refresh()
    } catch (err) {
      toast.error(errorMessage(err, "Delete failed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">All notices</CardTitle>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1.5" />
              New notice
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit notice" : "New notice"}</DialogTitle>
              <DialogDescription>
                Editing the body bumps the version. Players who already acknowledged the previous version stay associated with that version.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="BASH Participation Waiver"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Acknowledgement type</Label>
                  <Select
                    value={form.ackType}
                    onValueChange={(v) => setForm({ ...form, ackType: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basic">Basic ("I have read")</SelectItem>
                      <SelectItem value="legal">Legal ("I am bound")</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="body">Body (markdown supported)</Label>
                <Textarea
                  id="body"
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  rows={12}
                  className="font-mono text-xs"
                  placeholder="Full waiver text..."
                />
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
                <TableHead className="text-xs font-semibold">Title</TableHead>
                <TableHead className="text-xs font-semibold">Type</TableHead>
                <TableHead className="text-xs font-semibold text-right">Version</TableHead>
                <TableHead className="text-xs font-semibold">Last updated</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {notices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-10">
                    No notices yet. Click <span className="font-medium">New notice</span> to add one.
                  </TableCell>
                </TableRow>
              ) : (
                notices.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="font-medium text-sm">{n.title}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          n.ackType === "legal"
                            ? "bg-amber-500/10 text-amber-700 border-amber-500/30"
                            : "text-muted-foreground"
                        }`}
                      >
                        {n.ackType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">v{n.version}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(n.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(n)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setPendingDelete(n)}
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
            <AlertDialogTitle>Delete this notice?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && (
                <>This will permanently delete <span className="font-semibold">{pendingDelete.title}</span>.</>
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
