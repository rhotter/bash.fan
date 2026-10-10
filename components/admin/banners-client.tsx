"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Megaphone,
  Smartphone,
  Monitor,
  AlertTriangle,
  ExternalLink,
  Clock,
  Archive,
  FileEdit,
  X,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
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
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import {
  getBannerStatus,
  computeCountdownSuffix,
  resolveEffectiveVariant,
  needsMobileLabelWarning,
  validateBannerInput,
  normalizeHideOnPaths,
  type BannerStatus,
  type BannerVariant,
  type CountdownType,
} from "@/lib/banner-helpers"

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface BannerRow {
  id: string
  label: string
  mobileLabel: string | null
  href: string
  variant: BannerVariant
  isActive: boolean
  startDate: string | null
  endDate: string | null
  countdownType: CountdownType
  countdownTarget: string | null
  priority: number
  dismissVersion: number
  hideOnPaths: string[]
  createdAt: string
  updatedAt: string
}

interface BannerFormState {
  label: string
  mobileLabel: string
  href: string
  variant: BannerVariant
  isActive: boolean
  startDate: string
  endDate: string
  countdownType: CountdownType
  countdownTarget: string
  priority: number
  hideOnPaths: string
  resetDismissals: boolean
}

const EMPTY_FORM: BannerFormState = {
  label: "",
  mobileLabel: "",
  href: "/register",
  variant: "default",
  isActive: true,
  startDate: "",
  endDate: "",
  countdownType: "none",
  countdownTarget: "",
  priority: 10,
  hideOnPaths: "/admin",
  resetDismissals: false,
}

// ─── Formatting Helpers ──────────────────────────────────────────────────────

function toLocalDatetimeInput(iso: string | null | undefined): string {
  if (!iso) return ""
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ""
    const pad = (n: number) => n.toString().padStart(2, "0")
    const year = d.getFullYear()
    const month = pad(d.getMonth() + 1)
    const day = pad(d.getDate())
    const hours = pad(d.getHours())
    const minutes = pad(d.getMinutes())
    return `${year}-${month}-${day}T${hours}:${minutes}`
  } catch {
    return ""
  }
}

function formatDateDisplay(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return "—"
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Los_Angeles",
    })
  } catch {
    return "—"
  }
}

// ─── Status Badge Component ──────────────────────────────────────────────────

function StatusBadge({ status }: { status: BannerStatus }) {
  switch (status) {
    case "live":
      return (
        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 gap-1.5 font-medium">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          Live
        </Badge>
      )
    case "scheduled":
      return (
        <Badge variant="secondary" className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30 gap-1.5 font-medium">
          <Clock className="h-3 w-3" />
          Scheduled
        </Badge>
      )
    case "expired":
      return (
        <Badge variant="outline" className="text-muted-foreground gap-1.5 font-medium">
          <Archive className="h-3 w-3" />
          Expired
        </Badge>
      )
    case "draft":
      return (
        <Badge variant="outline" className="border-dashed text-muted-foreground gap-1.5 font-medium">
          <FileEdit className="h-3 w-3" />
          Draft
        </Badge>
      )
  }
}

// ─── Main Client Component ───────────────────────────────────────────────────

export function BannersClient({ initial }: { initial: BannerRow[] }) {
  const router = useRouter()
  const [banners, setBanners] = useState<BannerRow[]>(initial)
  const [editing, setEditing] = useState<BannerRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<BannerFormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<BannerRow | null>(null)
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop")

  // Modal open handlers
  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setPreviewMode("desktop")
    setDialogOpen(true)
  }

  // Active switch handler: populates start date with current time when toggled ON (unless already scheduled for future)
  const handleActiveToggle = (checked: boolean) => {
    setForm((prev) => {
      let nextStartDate = prev.startDate
      if (checked) {
        const currentStartMs = prev.startDate ? new Date(prev.startDate).getTime() : NaN
        if (isNaN(currentStartMs) || currentStartMs <= Date.now()) {
          nextStartDate = toLocalDatetimeInput(new Date().toISOString())
        }
      }
      return {
        ...prev,
        isActive: checked,
        startDate: nextStartDate,
      }
    })
  }

  const openEdit = (row: BannerRow) => {
    setEditing(row)
    setForm({
      label: row.label,
      mobileLabel: row.mobileLabel ?? "",
      href: row.href,
      variant: row.variant,
      isActive: row.isActive,
      startDate: toLocalDatetimeInput(row.startDate),
      endDate: toLocalDatetimeInput(row.endDate),
      countdownType: row.countdownType,
      countdownTarget: toLocalDatetimeInput(row.countdownTarget),
      priority: row.priority,
      hideOnPaths: Array.isArray(row.hideOnPaths)
        ? row.hideOnPaths.join(", ")
        : normalizeHideOnPaths(row.hideOnPaths).join(", "),
      resetDismissals: false,
    })
    setPreviewMode("desktop")
    setDialogOpen(true)
  }

  // Live countdown calculation for modal preview
  const previewSuffix = useMemo(() => {
    if (form.countdownType === "none" || !form.countdownTarget) return null
    return computeCountdownSuffix(
      form.countdownType,
      new Date(form.countdownTarget),
      new Date(),
      "America/Los_Angeles",
    )
  }, [form.countdownType, form.countdownTarget])

  const previewEffectiveVariant = useMemo(() => {
    return resolveEffectiveVariant(form.variant, form.countdownType, previewSuffix)
  }, [form.variant, form.countdownType, previewSuffix])

  const showMobileWarning = useMemo(() => {
    return needsMobileLabelWarning(form.label, form.mobileLabel)
  }, [form.label, form.mobileLabel])

  // Fast inline active toggle handler
  const handleToggleActive = async (banner: BannerRow) => {
    const nextState = !banner.isActive
    setTogglingId(banner.id)

    // Optimistic UI update
    setBanners((prev) =>
      prev.map((b) => (b.id === banner.id ? { ...b, isActive: nextState } : b))
    )

    try {
      const res = await fetch(`/api/bash/admin/banners/${encodeURIComponent(banner.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextState }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to update banner status")

      toast.success(nextState ? "Banner activated" : "Banner deactivated")
      router.refresh()
    } catch (err) {
      // Revert optimistic update
      setBanners((prev) =>
        prev.map((b) => (b.id === banner.id ? { ...b, isActive: banner.isActive } : b))
      )
      toast.error(err instanceof Error ? err.message : "Failed to toggle status")
    } finally {
      setTogglingId(null)
    }
  }

  // Save / Create handler
  const handleSubmit = async () => {
    // Client-side payload preparation
    const toValidIsoOrRaw = (val: string) => {
      if (!val || !val.trim()) return null
      const d = new Date(val)
      return isNaN(d.getTime()) ? val : d.toISOString()
    }

    const parsedPaths = form.hideOnPaths
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0)

    const payload: Record<string, unknown> = {
      label: form.label.trim(),
      mobileLabel: form.mobileLabel.trim() || null,
      href: form.href.trim(),
      variant: form.variant,
      isActive: form.isActive,
      startDate: form.startDate ? toValidIsoOrRaw(form.startDate) : null,
      endDate: form.endDate ? toValidIsoOrRaw(form.endDate) : null,
      countdownType: form.countdownType,
      countdownTarget:
        form.countdownType !== "none" && form.countdownTarget
          ? toValidIsoOrRaw(form.countdownTarget)
          : null,
      priority: Number(form.priority),
      hideOnPaths: parsedPaths.length > 0 ? parsedPaths : ["/admin"],
    }

    if (editing) {
      payload.resetDismissals = form.resetDismissals
    }

    // Validation
    const validation = validateBannerInput(payload)
    if (!validation.valid) {
      toast.error(validation.errors[0] || "Invalid banner settings")
      return
    }

    setBusy(true)
    try {
      const url = editing
        ? `/api/bash/admin/banners/${encodeURIComponent(editing.id)}`
        : `/api/bash/admin/banners`
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to save banner")

      const savedRow: BannerRow = {
        id: data.banner.id,
        label: data.banner.label,
        mobileLabel: data.banner.mobileLabel ?? null,
        href: data.banner.href,
        variant: data.banner.variant,
        isActive: data.banner.isActive,
        startDate: data.banner.startDate ?? null,
        endDate: data.banner.endDate ?? null,
        countdownType: data.banner.countdownType,
        countdownTarget: data.banner.countdownTarget ?? null,
        priority: data.banner.priority,
        dismissVersion: data.banner.dismissVersion,
        hideOnPaths: data.banner.hideOnPaths ?? ["/admin"],
        createdAt: data.banner.createdAt ?? new Date().toISOString(),
        updatedAt: data.banner.updatedAt ?? new Date().toISOString(),
      }

      setBanners((prev) => {
        const next = editing
          ? prev.map((b) => (b.id === savedRow.id ? savedRow : b))
          : [savedRow, ...prev]
        return next.sort((a, b) => {
          if (b.priority !== a.priority) return b.priority - a.priority
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        })
      })

      setDialogOpen(false)
      toast.success(editing ? "Banner updated successfully" : "Banner created successfully")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed")
    } finally {
      setBusy(false)
    }
  }

  // Delete banner handler
  const handleDelete = async () => {
    if (!pendingDelete) return
    setBusy(true)
    try {
      const res = await fetch(`/api/bash/admin/banners/${encodeURIComponent(pendingDelete.id)}`, {
        method: "DELETE",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to delete banner")

      setBanners((prev) => prev.filter((b) => b.id !== pendingDelete.id))
      setPendingDelete(null)
      toast.success("Banner deleted")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* ─── Card Header & Action ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div className="space-y-1">
            <CardTitle className="text-xl flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-primary" />
              Site Banners
            </CardTitle>
            <CardDescription>
              Manage public alert banners, schedule windows, and dynamic countdown broadcasts.
            </CardDescription>
          </div>
          <Button onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" />
            New banner
          </Button>
        </CardHeader>

        {/* ─── Banners Table ─────────────────────────────────────────────── */}
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Active</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead>Headline & Destination</TableHead>
                  <TableHead className="w-28">Style</TableHead>
                  <TableHead className="w-36">Schedule</TableHead>
                  <TableHead className="w-36">Countdown</TableHead>
                  <TableHead className="w-20 text-center">Priority</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {banners.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-12">
                      No site banners configured. Click <span className="font-semibold text-foreground">New banner</span> to broadcast announcements.
                    </TableCell>
                  </TableRow>
                ) : (
                  banners.map((b) => {
                    const status = getBannerStatus(b)
                    const isToggling = togglingId === b.id

                    return (
                      <TableRow key={b.id} className="hover:bg-muted/50 transition-colors">
                        {/* 1. Fast Toggle Switch */}
                        <TableCell>
                          <Switch
                            checked={b.isActive}
                            disabled={isToggling}
                            onCheckedChange={() => handleToggleActive(b)}
                            aria-label={`Toggle active for ${b.label}`}
                          />
                        </TableCell>

                        {/* 2. Status Badge */}
                        <TableCell>
                          <StatusBadge status={status} />
                        </TableCell>

                        {/* 3. Headline & Mobile Preview */}
                        <TableCell className="max-w-md">
                          <div className="space-y-1">
                            <div className="font-medium text-foreground text-sm flex items-center gap-1.5">
                              <span>{b.label}</span>
                              {b.mobileLabel && (
                                <Badge variant="outline" className="text-[10px] py-0 px-1 font-mono text-muted-foreground">
                                  Mobile Copy Set
                                </Badge>
                              )}
                            </div>
                            {b.mobileLabel && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Smartphone className="h-3 w-3 shrink-0" />
                                <span className="italic">{b.mobileLabel}</span>
                              </p>
                            )}
                            <div className="flex items-center gap-1 text-xs text-muted-foreground/80 font-mono">
                              <ExternalLink className="h-3 w-3 shrink-0" />
                              <span className="truncate">{b.href}</span>
                            </div>
                          </div>
                        </TableCell>

                        {/* 4. Variant Badge */}
                        <TableCell>
                          {b.variant === "live" ? (
                            <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs">
                              Live (Pulsing)
                            </Badge>
                          ) : b.variant === "warning" ? (
                            <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 text-xs">
                              Warning
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">
                              Default
                            </Badge>
                          )}
                        </TableCell>

                        {/* 5. Schedule Window */}
                        <TableCell className="text-xs text-muted-foreground">
                          {b.startDate || b.endDate ? (
                            <div className="space-y-0.5">
                              <div>{formatDateDisplay(b.startDate)}</div>
                              <div className="text-[11px] text-muted-foreground/70">to {formatDateDisplay(b.endDate)}</div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground/60 italic">Always on</span>
                          )}
                        </TableCell>

                        {/* 6. Countdown Config */}
                        <TableCell className="text-xs">
                          {b.countdownType === "none" ? (
                            <span className="text-muted-foreground/60">—</span>
                          ) : (
                            <div className="space-y-0.5">
                              <Badge variant="secondary" className="capitalize text-[11px]">
                                {b.countdownType}
                              </Badge>
                              {b.countdownTarget && (
                                <div className="text-[11px] text-muted-foreground">
                                  {formatDateDisplay(b.countdownTarget)}
                                </div>
                              )}
                            </div>
                          )}
                        </TableCell>

                        {/* 7. Priority Score */}
                        <TableCell className="text-center font-mono text-xs font-semibold">
                          {b.priority}
                        </TableCell>

                        {/* 8. Action Buttons */}
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={() => openEdit(b)}
                              aria-label={`Edit ${b.label}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => setPendingDelete(b)}
                              aria-label={`Delete ${b.label}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ─── Create & Edit Modal Dialog ──────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-primary" />
              {editing ? "Edit Site Banner" : "Create Site Banner"}
            </DialogTitle>
            <DialogDescription>
              Configure banner copy, interactive live countdown, scheduling window, and preview mobile rendering in real time.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* ─── Dual Interactive Preview Widget ───────────────────────── */}
            <div className="space-y-2 rounded-lg border bg-card p-3 shadow-xs">
              <div className="flex items-center justify-between pb-1">
                <div className="text-xs font-semibold tracking-tight text-foreground flex items-center gap-1.5">
                  <span>Interactive Preview</span>
                  <Badge variant="outline" className="text-[10px] py-0">
                    Live Simulator
                  </Badge>
                </div>
                {/* Desktop ↔ Mobile Toggle */}
                <div className="flex items-center rounded-md border p-0.5 bg-muted/60">
                  <Button
                    type="button"
                    variant={previewMode === "desktop" ? "default" : "ghost"}
                    size="sm"
                    className="h-6 px-2.5 text-xs gap-1"
                    onClick={() => setPreviewMode("desktop")}
                  >
                    <Monitor className="h-3 w-3" />
                    Desktop
                  </Button>
                  <Button
                    type="button"
                    variant={previewMode === "mobile" ? "default" : "ghost"}
                    size="sm"
                    className="h-6 px-2.5 text-xs gap-1"
                    onClick={() => setPreviewMode("mobile")}
                  >
                    <Smartphone className="h-3 w-3" />
                    Mobile (375px)
                  </Button>
                </div>
              </div>

              {/* Rendered Preview Bar */}
              <div className="p-2 bg-background/50 rounded border border-dashed flex justify-center">
                {previewMode === "desktop" ? (
                  /* Desktop Simulation: Full width, centered text, 13px */
                  <div className="w-full relative rounded border border-border/60 bg-muted/40 transition-all">
                    <div className="flex items-center justify-center gap-x-2 py-1.5 px-8 text-center text-[13px] text-muted-foreground min-w-0">
                      {/* Variant Dot */}
                      {previewEffectiveVariant === "live" ? (
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                      ) : previewEffectiveVariant === "warning" ? (
                        <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                      ) : (
                        <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/40" />
                      )}

                      {/* Truncated Copy */}
                      <span
                        className={
                          "truncate font-medium underline underline-offset-4 " +
                          (previewEffectiveVariant === "live"
                            ? "text-emerald-600 dark:text-emerald-400 decoration-emerald-600/30"
                            : previewEffectiveVariant === "warning"
                            ? "text-amber-600 dark:text-amber-400 decoration-amber-600/30"
                            : "text-foreground decoration-foreground/30")
                        }
                      >
                        {form.label.trim() || "Banner headline announcement"}
                      </span>

                      {/* Protected Suffix */}
                      {previewSuffix && (
                        <span className="shrink-0 text-muted-foreground/70 tabular-nums font-normal">
                          {previewSuffix}
                        </span>
                      )}
                    </div>
                    {/* Simulated Dismiss X Button */}
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/60">
                      <X className="h-3.5 w-3.5" />
                    </div>
                  </div>
                ) : (
                  /* Mobile Simulation: Strict 375px frame, left-aligned, 12px, 44px dismiss target */
                  <div className="w-[375px] max-w-full relative rounded-md border-2 border-border/80 bg-muted/40 shadow-xs transition-all overflow-hidden">
                    <div className="flex items-center justify-start gap-x-2 py-2 pl-4 pr-11 text-left text-[12px] text-muted-foreground truncate">
                      {/* Variant Dot */}
                      {previewEffectiveVariant === "live" ? (
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                      ) : previewEffectiveVariant === "warning" ? (
                        <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                      ) : (
                        <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/40" />
                      )}

                      <div className="flex min-w-0 items-center gap-1.5 truncate">
                        <span
                          className={
                            "truncate font-medium underline underline-offset-4 " +
                            (previewEffectiveVariant === "live"
                              ? "text-emerald-600 dark:text-emerald-400 decoration-emerald-600/30"
                              : previewEffectiveVariant === "warning"
                              ? "text-amber-600 dark:text-amber-400 decoration-amber-600/30"
                              : "text-foreground decoration-foreground/30")
                          }
                        >
                          {form.mobileLabel.trim() || form.label.trim() || "Banner headline"}
                        </span>
                        {previewSuffix && (
                          <span className="shrink-0 text-muted-foreground/70 tabular-nums">
                            {previewSuffix}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Simulated 44px Accessible Touch Dismiss Hit Area */}
                    <div className="absolute right-0 top-0 flex h-full min-h-[44px] min-w-[44px] items-center justify-center p-2 text-muted-foreground/60 border-l border-border/30 bg-muted/20">
                      <X className="h-3.5 w-3.5" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ─── Headline & Mobile Label Fields ────────────────────────── */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="banner-label" className="text-sm font-medium">
                    Primary Headline <span className="text-destructive">*</span>
                  </Label>
                  <span
                    className={
                      "text-xs font-mono " +
                      (form.label.length > 35 ? "text-amber-500 font-semibold" : "text-muted-foreground")
                    }
                  >
                    {form.label.length} chars
                  </span>
                </div>
                <Input
                  id="banner-label"
                  placeholder="e.g. Fall 2026–27 Registration Open"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                />
              </div>

              {/* Length Warning Indicator */}
              {showMobileWarning && (
                <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                  <p>
                    Primary headline is <strong>{form.label.length} characters</strong>. On narrow phone screens (≤375px), it will likely truncate before the countdown suffix. Consider entering a concise <strong>Mobile Label</strong> below.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="banner-mobile-label" className="text-sm font-medium">
                    Mobile Label <span className="text-muted-foreground font-normal">(Optional short copy)</span>
                  </Label>
                  {form.mobileLabel && (
                    <span className="text-xs font-mono text-muted-foreground">
                      {form.mobileLabel.length} chars
                    </span>
                  )}
                </div>
                <Input
                  id="banner-mobile-label"
                  placeholder="e.g. Fall Registration Open"
                  value={form.mobileLabel}
                  onChange={(e) => setForm({ ...form, mobileLabel: e.target.value })}
                />
              </div>
            </div>

            {/* ─── Destination URL ────────────────────────────────────────── */}
            <div className="space-y-1.5">
              <Label htmlFor="banner-href" className="text-sm font-medium block">
                Destination URL <span className="text-destructive">*</span>
              </Label>
              <Input
                id="banner-href"
                placeholder="/register or /draft/slug"
                value={form.href}
                onChange={(e) => setForm({ ...form, href: e.target.value })}
              />
            </div>

            {/* ─── Visual Variant & Active Status ─────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="banner-variant" className="text-sm font-medium block">
                  Visual Variant
                </Label>
                <Select
                  value={form.variant}
                  onValueChange={(v) => setForm({ ...form, variant: v as BannerVariant })}
                >
                  <SelectTrigger id="banner-variant" className="w-full h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default (Neutral Dot)</SelectItem>
                    <SelectItem value="live">Live (Pulsing Green)</SelectItem>
                    <SelectItem value="warning">Warning (Amber Alert)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="banner-is-active" className="text-sm font-medium block">
                  Status
                </Label>
                <div className="flex h-9 items-center justify-between rounded-md border px-3 bg-muted/30">
                  <Label htmlFor="banner-is-active" className="text-xs font-medium cursor-pointer">
                    Active Immediately
                  </Label>
                  <Switch
                    id="banner-is-active"
                    checked={form.isActive}
                    onCheckedChange={handleActiveToggle}
                  />
                </div>
              </div>
            </div>

            {/* ─── Countdown Configuration ───────────────────────────────── */}
            <div className="space-y-3 rounded-md border p-3 bg-muted/20">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className={`space-y-1.5 ${form.countdownType === "none" ? "sm:col-span-2" : ""}`}>
                  <Label className="text-sm font-medium block">Countdown Calculation</Label>
                  <Select
                    value={form.countdownType}
                    onValueChange={(v) => setForm({ ...form, countdownType: v as CountdownType })}
                  >
                    <SelectTrigger className="w-full h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (Standard copy only)</SelectItem>
                      <SelectItem value="deadline">Deadline (· X days left)</SelectItem>
                      <SelectItem value="event">Event Broadcast (· Live in X days / LIVE NOW)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {form.countdownType !== "none" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="countdown-target" className="text-sm font-medium block">
                      Target Event Date & Time <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="countdown-target"
                      type="datetime-local"
                      className="h-9"
                      value={form.countdownTarget}
                      onChange={(e) => setForm({ ...form, countdownTarget: e.target.value })}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* ─── Schedule Window ───────────────────────────────────────── */}
            <div className="space-y-3 rounded-md border p-3 bg-muted/20">
              <div className="text-xs font-medium text-foreground">
                Scheduling Window (Optional — leave blank for unbounded activation)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="start-date" className="text-xs text-muted-foreground block">
                    Start Showing At
                  </Label>
                  <Input
                    id="start-date"
                    type="datetime-local"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="end-date" className="text-xs text-muted-foreground block">
                    Stop Showing At
                  </Label>
                  <Input
                    id="end-date"
                    type="datetime-local"
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* ─── Advanced Settings: Priority, Paths, Reset Dismissals ──── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="banner-priority" className="text-sm font-medium">
                  Priority Score
                </Label>
                <Input
                  id="banner-priority"
                  type="number"
                  min="0"
                  step="1"
                  className="h-9"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value, 10) || 0 })}
                />
                <p className="text-[11px] text-muted-foreground">
                  Higher numbers display first (default: 10)
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="banner-hide-paths" className="text-sm font-medium">
                  Suppress On Routes
                </Label>
                <Input
                  id="banner-hide-paths"
                  placeholder="/admin, /draft"
                  className="h-9"
                  value={form.hideOnPaths}
                  onChange={(e) => setForm({ ...form, hideOnPaths: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground">
                  Comma-separated (e.g. /admin, /draft)
                </p>
              </div>
            </div>

            {/* Edit Mode: Reset Player Dismissals Checkbox */}
            {editing && (
              <div className="flex items-start space-x-2 pt-1 border-t">
                <Checkbox
                  id="reset-dismissals"
                  checked={form.resetDismissals}
                  onCheckedChange={(checked) => setForm({ ...form, resetDismissals: !!checked })}
                />
                <div className="grid gap-1 leading-none">
                  <Label
                    htmlFor="reset-dismissals"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Reset player dismissals (v{editing.dismissVersion} → v{editing.dismissVersion + 1})
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Check this if you made a critical announcement update so users who previously dismissed this banner will see it again.
                  </p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={busy} className="gap-1.5">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : "Create banner"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Confirmation Alert Dialog ────────────────────────────── */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Site Banner</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete banner &ldquo;{pendingDelete?.label}&rdquo;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? "Deleting..." : "Delete Banner"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
