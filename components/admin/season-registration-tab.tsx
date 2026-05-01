"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Plus, Trash2, Loader2, Copy, AlertCircle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "sonner"

export interface PeriodForTab {
  id: string
  status: string
  baseFee: number
  dateOpen: string | null
  dateClose: string | null
  maxPlayers: number | null
  ageMinimum: number | null
  ageAsOfDate: string | null
  requiresEmergencyInfo: boolean
  requiresJerseySize: boolean
  confirmationEmailBody: string | null
  adminNotes: string | null
  questions: { id: number; questionText: string; questionType: string; isRequired: boolean }[]
  noticeIds: number[]
  extraIds: number[]
  discountIds: number[]
}

export interface SeasonRegistrationTabProps {
  seasonId: string
  period: PeriodForTab | null
  notices: { id: number; title: string; ackType: string; version: number }[]
  extras: { id: number; name: string; price: number; active: boolean }[]
  discounts: { id: number; code: string; amountOff: number; active: boolean }[]
  otherPeriods: { id: string; seasonName: string }[]
}

function dateInputValue(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toISOString().slice(0, 10)
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function SeasonRegistrationTab({ seasonId, period, notices, extras, discounts, otherPeriods }: SeasonRegistrationTabProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  // Local form state mirrors `period` but kept editable.
  const [form, setForm] = useState<PeriodForTab | null>(period)
  const [questionDialogOpen, setQuestionDialogOpen] = useState(false)
  const [newQuestion, setNewQuestion] = useState({ questionText: "", isRequired: false })
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importSourceId, setImportSourceId] = useState<string>("")
  const [importBumpYear, setImportBumpYear] = useState(true)

  const handleCreatePeriod = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/bash/admin/registration/periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seasonId, baseFeeCents: 15000 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Create failed")
      toast.success("Registration period created")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed")
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async () => {
    if (!form) return
    setBusy(true)
    try {
      const dollars = form.baseFee
      const res = await fetch(`/api/bash/admin/registration/periods/${form.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseFeeCents: dollars,
          dateOpen: form.dateOpen,
          dateClose: form.dateClose,
          maxPlayers: form.maxPlayers,
          ageMinimum: form.ageMinimum,
          ageAsOfDate: form.ageAsOfDate,
          requiresEmergencyInfo: form.requiresEmergencyInfo,
          requiresJerseySize: form.requiresJerseySize,
          confirmationEmailBody: form.confirmationEmailBody,
          adminNotes: form.adminNotes,
          noticeIds: form.noticeIds,
          extraIds: form.extraIds,
          discountIds: form.discountIds,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Save failed")
      toast.success("Registration period saved")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed")
    } finally {
      setBusy(false)
    }
  }

  const handleStatusChange = async (newStatus: string) => {
    if (!form) return
    setBusy(true)
    try {
      const res = await fetch(`/api/bash/admin/registration/periods/${form.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed")
      setForm({ ...form, status: newStatus })
      toast.success(`Status: ${newStatus}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setBusy(false)
    }
  }

  const handleAddQuestion = async () => {
    if (!form || !newQuestion.questionText.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/bash/admin/registration/periods/${form.id}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionText: newQuestion.questionText.trim(), isRequired: newQuestion.isRequired }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed")
      setForm({ ...form, questions: [...form.questions, data] })
      setNewQuestion({ questionText: "", isRequired: false })
      setQuestionDialogOpen(false)
      toast.success("Question added")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteQuestion = async (qid: number) => {
    if (!form) return
    setBusy(true)
    try {
      const res = await fetch(`/api/bash/admin/registration/periods/${form.id}/questions/${qid}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Failed")
      }
      setForm({ ...form, questions: form.questions.filter((q) => q.id !== qid) })
      toast.success("Question removed")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setBusy(false)
    }
  }

  const handleImport = async () => {
    if (!form || !importSourceId) return
    setBusy(true)
    try {
      const res = await fetch(`/api/bash/admin/registration/periods/${form.id}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePeriodId: importSourceId, bumpYear: importBumpYear }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Import failed")
      toast.success("Configuration imported. Refreshing…")
      setImportDialogOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed")
    } finally {
      setBusy(false)
    }
  }

  if (!form) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registration period</CardTitle>
          <CardDescription>
            Create a registration period to enable player sign-ups for this season.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleCreatePeriod} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Plus className="h-4 w-4 mr-1.5" />
            Create registration period
          </Button>
        </CardContent>
      </Card>
    )
  }

  const toggleAssignment = (kind: "noticeIds" | "extraIds" | "discountIds", id: number) => {
    if (!form) return
    const current = form[kind]
    setForm({
      ...form,
      [kind]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    })
  }

  const statusBadge: Record<string, { label: string; cls: string }> = {
    draft: { label: "Draft", cls: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
    open: { label: "Open", cls: "bg-green-500/10 text-green-700 border-green-500/30" },
    closed: { label: "Closed", cls: "bg-muted text-muted-foreground" },
  }
  const sb = statusBadge[form.status] ?? statusBadge.draft

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Registration period</CardTitle>
              <Badge variant="outline" className={`text-[10px] ${sb.cls}`}>{sb.label}</Badge>
            </div>
            <CardDescription>
              Players will register at <code className="text-xs">/register</code> while this period is <span className="font-medium">open</span>.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {form.status === "draft" && (
              <Button size="sm" variant="outline" onClick={() => handleStatusChange("open")} disabled={busy}>
                Open registration
              </Button>
            )}
            {form.status === "open" && (
              <Button size="sm" variant="outline" onClick={() => handleStatusChange("closed")} disabled={busy}>
                Close registration
              </Button>
            )}
            {otherPeriods.length > 0 && (
              <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="ghost">
                    <Copy className="h-4 w-4 mr-1.5" />
                    Import previous
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Import previous setup</DialogTitle>
                    <DialogDescription>
                      Clone fee, dates, custom questions, and notice/extra/discount assignments from another period.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-2">
                    <div className="space-y-1.5">
                      <Label>Source period</Label>
                      <Select value={importSourceId} onValueChange={setImportSourceId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a period to import from…" />
                        </SelectTrigger>
                        <SelectContent>
                          {otherPeriods.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.seasonName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="bumpYear"
                        checked={importBumpYear}
                        onCheckedChange={(c) => setImportBumpYear(!!c)}
                      />
                      <Label htmlFor="bumpYear" className="font-normal cursor-pointer">
                        Bump dates forward by 1 year
                      </Label>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setImportDialogOpen(false)} disabled={busy}>Cancel</Button>
                    <Button onClick={handleImport} disabled={busy || !importSourceId}>
                      {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Import
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
            <Button size="sm" onClick={handleSave} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Pricing & dates */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pricing & dates</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="baseFee">Base fee ($)</Label>
            <Input
              id="baseFee"
              type="number"
              min="0"
              step="0.01"
              value={(form.baseFee / 100).toString()}
              onChange={(e) =>
                setForm({ ...form, baseFee: Math.round(Number.parseFloat(e.target.value || "0") * 100) })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="maxPlayers">Max players</Label>
            <Input
              id="maxPlayers"
              type="number"
              min="1"
              value={form.maxPlayers ?? ""}
              onChange={(e) =>
                setForm({ ...form, maxPlayers: e.target.value ? Number.parseInt(e.target.value, 10) : null })
              }
              placeholder="∞"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dateOpen">Open date</Label>
            <Input
              id="dateOpen"
              type="date"
              value={dateInputValue(form.dateOpen)}
              onChange={(e) => setForm({ ...form, dateOpen: e.target.value || null })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dateClose">Close date</Label>
            <Input
              id="dateClose"
              type="date"
              value={dateInputValue(form.dateClose)}
              onChange={(e) => setForm({ ...form, dateClose: e.target.value || null })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Restrictions & data collection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Restrictions & data collection</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ageMinimum">Minimum age</Label>
            <Input
              id="ageMinimum"
              type="number"
              min="0"
              value={form.ageMinimum ?? ""}
              onChange={(e) =>
                setForm({ ...form, ageMinimum: e.target.value ? Number.parseInt(e.target.value, 10) : null })
              }
              placeholder="None"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ageAsOfDate">Age as of</Label>
            <Input
              id="ageAsOfDate"
              type="date"
              value={form.ageAsOfDate ?? ""}
              onChange={(e) => setForm({ ...form, ageAsOfDate: e.target.value || null })}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={form.requiresEmergencyInfo}
              onCheckedChange={(v) => setForm({ ...form, requiresEmergencyInfo: v })}
            />
            <Label className="font-normal">Require emergency / medical info</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={form.requiresJerseySize}
              onCheckedChange={(v) => setForm({ ...form, requiresJerseySize: v })}
            />
            <Label className="font-normal">Collect t-shirt size</Label>
          </div>
        </CardContent>
      </Card>

      {/* Custom questions */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-sm">Custom questions</CardTitle>
            <CardDescription className="text-xs mt-1">Up to 3, shown inline on the contact step.</CardDescription>
          </div>
          {form.questions.length < 3 && (
            <Dialog open={questionDialogOpen} onOpenChange={setQuestionDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New custom question</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div className="space-y-1.5">
                    <Label>Question</Label>
                    <Input
                      maxLength={64}
                      placeholder="How did you hear about BASH?"
                      value={newQuestion.questionText}
                      onChange={(e) => setNewQuestion({ ...newQuestion, questionText: e.target.value })}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="qrequired"
                      checked={newQuestion.isRequired}
                      onCheckedChange={(c) => setNewQuestion({ ...newQuestion, isRequired: !!c })}
                    />
                    <Label htmlFor="qrequired" className="font-normal cursor-pointer">Required</Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setQuestionDialogOpen(false)}>Cancel</Button>
                  <Button onClick={handleAddQuestion} disabled={busy || !newQuestion.questionText.trim()}>Add</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          {form.questions.length === 0 ? (
            <div className="text-sm text-muted-foreground">No custom questions.</div>
          ) : (
            <div className="space-y-2">
              {form.questions.map((q) => (
                <div key={q.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="text-sm">
                    {q.questionText}
                    {q.isRequired && <span className="ml-2 text-[10px] text-muted-foreground">required</span>}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDeleteQuestion(q.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Library assignments */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Library assignments</CardTitle>
          <CardDescription className="text-xs mt-1">
            Pick from the global libraries. Manage them at{" "}
            <Link href="/admin/registration" className="underline">/admin/registration</Link>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Notices */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Notices & waivers</Label>
            {notices.length === 0 ? (
              <Alert className="mt-2">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  No notices in the library yet. <Link href="/admin/registration/notices" className="underline">Create one</Link>.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="mt-2 space-y-1.5">
                {notices.map((n) => (
                  <label key={n.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.noticeIds.includes(n.id)}
                      onCheckedChange={() => toggleAssignment("noticeIds", n.id)}
                    />
                    <span>{n.title}</span>
                    <Badge variant="outline" className="text-[10px]">{n.ackType}</Badge>
                    <span className="text-[10px] text-muted-foreground">v{n.version}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Extras */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Extras / add-ons</Label>
            {extras.length === 0 ? (
              <Alert className="mt-2">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  No extras in the library yet. <Link href="/admin/registration/extras" className="underline">Create one</Link>.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="mt-2 space-y-1.5">
                {extras.map((e) => (
                  <label key={e.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.extraIds.includes(e.id)}
                      onCheckedChange={() => toggleAssignment("extraIds", e.id)}
                    />
                    <span>{e.name}</span>
                    <span className="text-xs text-muted-foreground">{formatCents(e.price)}</span>
                    {!e.active && <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>}
                  </label>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Discounts */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Discount codes</Label>
            {discounts.length === 0 ? (
              <Alert className="mt-2">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  No discount codes in the library yet. <Link href="/admin/registration/discounts" className="underline">Create one</Link>.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="mt-2 space-y-1.5">
                {discounts.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.discountIds.includes(d.id)}
                      onCheckedChange={() => toggleAssignment("discountIds", d.id)}
                    />
                    <span className="font-mono text-xs">{d.code}</span>
                    <span className="text-xs text-muted-foreground">−{formatCents(d.amountOff)}</span>
                    {!d.active && <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>}
                  </label>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Confirmation email + admin notes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Confirmation email</CardTitle>
          <CardDescription className="text-xs mt-1">
            Sent automatically after a registrant pays. Player name, season, amount, and date are appended.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={form.confirmationEmailBody ?? ""}
            onChange={(e) => setForm({ ...form, confirmationEmailBody: e.target.value || null })}
            rows={6}
            placeholder="Welcome to BASH! See you at The Lick…"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Admin notes</CardTitle>
          <CardDescription className="text-xs mt-1">Private — not shown to players.</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={form.adminNotes ?? ""}
            onChange={(e) => setForm({ ...form, adminNotes: e.target.value || null })}
            rows={3}
          />
        </CardContent>
      </Card>
    </div>
  )
}
