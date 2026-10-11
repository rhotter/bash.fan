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
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"

export interface DiscountRow {
  id: number
  code: string
  reason: string | null
  amountOff: number // cents
  limitation: string
  maxUses: number | null
  usedCount: number
  expiresAt: string | null
  active: boolean
}

const LIMITATION_LABELS: Record<string, string> = {
  unlimited: "Unlimited",
  once_per_family: "Once per family",
  once_per_registrant: "Once per registrant",
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function dateInputValue(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toISOString().slice(0, 10)
}

interface FormState {
  code: string
  reason: string
  amountDollars: string
  limitation: string
  maxUses: string
  expiresAt: string
  active: boolean
}

const EMPTY_FORM: FormState = {
  code: "",
  reason: "",
  amountDollars: "",
  limitation: "unlimited",
  maxUses: "",
  expiresAt: "",
  active: true,
}

export function DiscountsClient({ initial }: { initial: DiscountRow[] }) {
  const router = useRouter()
  const [codes, setCodes] = useState(initial)
  const [editing, setEditing] = useState<DiscountRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<DiscountRow | null>(null)

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (row: DiscountRow) => {
    setEditing(row)
    setForm({
      code: row.code,
      reason: row.reason ?? "",
      amountDollars: (row.amountOff / 100).toString(),
      limitation: row.limitation,
      maxUses: row.maxUses?.toString() ?? "",
      expiresAt: dateInputValue(row.expiresAt),
      active: row.active,
    })
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (!form.code.trim()) {
      toast.error("Code is required")
      return
    }
    const dollars = Number.parseFloat(form.amountDollars)
    if (Number.isNaN(dollars) || dollars < 0) {
      toast.error("Amount must be a non-negative number")
      return
    }

    const payload: Record<string, unknown> = {
      code: form.code.trim(),
      reason: form.reason.trim() || null,
      amountOff: Math.round(dollars * 100),
      limitation: form.limitation,
      maxUses: form.maxUses.trim() ? Number.parseInt(form.maxUses, 10) : null,
      expiresAt: form.expiresAt || null,
      active: form.active,
    }

    setBusy(true)
    try {
      const url = editing
        ? `/api/bash/admin/registration/discounts/${editing.id}`
        : `/api/bash/admin/registration/discounts`
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Save failed")

      const saved: DiscountRow = {
        id: data.id,
        code: data.code,
        reason: data.reason,
        amountOff: data.amountOff,
        limitation: data.limitation,
        maxUses: data.maxUses,
        usedCount: data.usedCount,
        expiresAt: data.expiresAt,
        active: data.active,
      }

      setCodes((prev) =>
        editing ? prev.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...prev]
      )
      setDialogOpen(false)
      toast.success(editing ? "Code updated" : "Code created")
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
      const res = await fetch(`/api/bash/admin/registration/discounts/${pendingDelete.id}`, {
        method: "DELETE",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Delete failed")
      setCodes((prev) => prev.filter((c) => c.id !== pendingDelete.id))
      setPendingDelete(null)
      toast.success("Code deleted")
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
        <div className="space-y-1">
          <CardTitle className="text-base">All codes</CardTitle>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1.5" />
              New code
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit discount code" : "New discount code"}</DialogTitle>
              <DialogDescription>
                Codes are validated server-side at registration time against expiry, max uses, and limitation rules.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="code">Code</Label>
                  <Input
                    id="code"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder="xrook"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="amount">Amount off ($)</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.amountDollars}
                    onChange={(e) => setForm({ ...form, amountDollars: e.target.value })}
                    placeholder="25.00"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reason">Reason (admin only)</Label>
                <Input
                  id="reason"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="Late rookies after 3rd pickup"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Limitation</Label>
                  <Select
                    value={form.limitation}
                    onValueChange={(v) => setForm({ ...form, limitation: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unlimited">Unlimited</SelectItem>
                      <SelectItem value="once_per_family">Once per family</SelectItem>
                      <SelectItem value="once_per_registrant">Once per registrant</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="maxUses">Max total uses</Label>
                  <Input
                    id="maxUses"
                    type="number"
                    min="1"
                    value={form.maxUses}
                    onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
                    placeholder="∞"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="expiresAt">Expires</Label>
                  <Input
                    id="expiresAt"
                    type="date"
                    value={form.expiresAt}
                    onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                  />
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
                <TableHead className="text-xs font-semibold">Code</TableHead>
                <TableHead className="text-xs font-semibold">Reason</TableHead>
                <TableHead className="text-xs font-semibold text-right">Amount</TableHead>
                <TableHead className="text-xs font-semibold">Limitation</TableHead>
                <TableHead className="text-xs font-semibold text-right">Used / Max</TableHead>
                <TableHead className="text-xs font-semibold">Expires</TableHead>
                <TableHead className="text-xs font-semibold">Status</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {codes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">
                    No discount codes yet. Click <span className="font-medium">New code</span> to add one.
                  </TableCell>
                </TableRow>
              ) : (
                codes.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs font-semibold">{c.code}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[20ch] truncate">
                      {c.reason || "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">{formatCents(c.amountOff)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {LIMITATION_LABELS[c.limitation] ?? c.limitation}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {c.usedCount} / {c.maxUses ?? "∞"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(c.expiresAt)}</TableCell>
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
            <AlertDialogTitle>Delete this code?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && (
                <>
                  This will permanently delete <span className="font-mono font-semibold">{pendingDelete.code}</span>.
                  It can&apos;t be undone.
                </>
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
