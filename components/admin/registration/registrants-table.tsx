"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Search, Loader2, MoreHorizontal, DollarSign, XCircle, ListChecks } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { toast } from "sonner"

export interface RegistrantRow {
  id: string
  status: string
  teamSlug: string | null
  userName: string | null
  userEmail: string
  amountPaid: number | null
  paidAt: string | null
  manualPayment: boolean
  createdAt: string | null
  yearsPlayed: number | null
  skillLevel: string | null
  positions: string | null
  lastTeam: string | null
  discountCode: string | null
}

function formatCents(cents: number | null): string {
  if (cents === null || cents === undefined) return "—"
  return `$${(cents / 100).toFixed(2)}`
}

function statusBadge(status: string): { label: string; cls: string } {
  return (
    {
      paid: { label: "Paid", cls: "bg-green-500/10 text-green-700 border-green-500/30" },
      registered_unpaid: { label: "Unpaid", cls: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
      pending_payment: { label: "Pending", cls: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
      draft: { label: "Draft", cls: "bg-muted text-muted-foreground" },
      cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground" },
      waitlisted: { label: "Waitlist", cls: "bg-blue-500/10 text-blue-700 border-blue-500/30" },
    }[status] ?? { label: status, cls: "bg-muted text-muted-foreground" }
  )
}

export function RegistrantsTable({ registrants }: { registrants: RegistrantRow[] }) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState<RegistrantRow | null>(null)

  const filtered = useMemo(() => {
    let r = registrants
    if (statusFilter !== "all") r = r.filter((x) => x.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      r = r.filter(
        (x) =>
          (x.userName ?? "").toLowerCase().includes(q) ||
          x.userEmail.toLowerCase().includes(q) ||
          (x.lastTeam ?? "").toLowerCase().includes(q)
      )
    }
    return r
  }, [registrants, search, statusFilter])

  const markPaidManual = async (row: RegistrantRow) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/bash/admin/registration/registrations/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paid", manualPayment: true }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Failed")
      toast.success("Marked as paid (manual)")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setBusy(false)
    }
  }

  const cancelReg = async () => {
    if (!confirmCancel) return
    setBusy(true)
    try {
      const res = await fetch(`/api/bash/admin/registration/registrations/${confirmCancel.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Failed")
      toast.success("Registration cancelled")
      setConfirmCancel(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setBusy(false)
    }
  }

  const promoteFromWaitlist = async (row: RegistrantRow) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/bash/admin/registration/registrations/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "registered_unpaid" }),
      })
      if (!res.ok) throw new Error((await res.json()).error || "Failed")
      toast.success("Promoted from waitlist")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-base">Registrants ({filtered.length})</CardTitle>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search by name, email, or last team…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="registered_unpaid">Unpaid</SelectItem>
              <SelectItem value="pending_payment">Pending</SelectItem>
              <SelectItem value="waitlisted">Waitlist</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-semibold">Name</TableHead>
                <TableHead className="text-xs font-semibold">Status</TableHead>
                <TableHead className="text-xs font-semibold text-right">Amount</TableHead>
                <TableHead className="text-xs font-semibold">Discount</TableHead>
                <TableHead className="text-xs font-semibold text-center">Years</TableHead>
                <TableHead className="text-xs font-semibold">Skill</TableHead>
                <TableHead className="text-xs font-semibold">Position</TableHead>
                <TableHead className="text-xs font-semibold">Last team</TableHead>
                <TableHead className="text-xs font-semibold">Date</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-10">
                    No registrants match.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => {
                  const sb = statusBadge(r.status)
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="text-sm font-medium">{r.userName || "—"}</div>
                        <div className="text-xs text-muted-foreground">{r.userEmail}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${sb.cls}`}>
                          {sb.label}
                          {r.manualPayment && r.status === "paid" && " (manual)"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm">{formatCents(r.amountPaid)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {r.discountCode ?? "—"}
                      </TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {r.yearsPlayed ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground capitalize">
                        {r.skillLevel ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.positions ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.lastTeam ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" disabled={busy}>
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {(r.status === "registered_unpaid" || r.status === "pending_payment" || r.status === "draft") && (
                              <DropdownMenuItem onClick={() => markPaidManual(r)}>
                                <DollarSign className="h-3.5 w-3.5 mr-2" />
                                Mark paid (manual)
                              </DropdownMenuItem>
                            )}
                            {r.status === "waitlisted" && (
                              <DropdownMenuItem onClick={() => promoteFromWaitlist(r)}>
                                <ListChecks className="h-3.5 w-3.5 mr-2" />
                                Promote from waitlist
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => setConfirmCancel(r)}
                              className="text-destructive focus:text-destructive"
                            >
                              <XCircle className="h-3.5 w-3.5 mr-2" />
                              Cancel registration
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <AlertDialog open={!!confirmCancel} onOpenChange={(o) => !o && setConfirmCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this registration?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmCancel && (
                <>
                  Cancels the registration for{" "}
                  <span className="font-semibold">{confirmCancel.userName || confirmCancel.userEmail}</span>.
                  Any payment is not automatically refunded — issue refunds in the Stripe dashboard.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                cancelReg()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy}
            >
              {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Cancel registration
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
