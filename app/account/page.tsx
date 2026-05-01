import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { db, schema } from "@/lib/db"
import { eq, desc } from "drizzle-orm"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SignOutButton } from "@/components/auth/sign-out-button"

export const metadata = { title: "Account | BASH" }

function formatCents(cents: number | null): string {
  if (cents === null || cents === undefined) return "—"
  return `$${(cents / 100).toFixed(2)}`
}

function statusBadge(status: string): { label: string; cls: string } {
  const variants: Record<string, { label: string; cls: string }> = {
    paid: { label: "Paid", cls: "bg-green-500/10 text-green-700 border-green-500/30" },
    registered_unpaid: { label: "Pending payment", cls: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
    pending_payment: { label: "Pending payment", cls: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
    draft: { label: "In progress", cls: "bg-muted text-muted-foreground" },
    cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground" },
    waitlisted: { label: "Waitlist", cls: "bg-blue-500/10 text-blue-700 border-blue-500/30" },
  }
  return variants[status] ?? { label: status, cls: "bg-muted text-muted-foreground" }
}

export default async function AccountPage() {
  const session = await auth()
  if (!session?.user) redirect("/signin?callbackUrl=/account")

  // @ts-expect-error session.user.id is augmented in auth.ts callbacks
  const userId: string = session.user.id

  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1)

  // Joined registration list with period name
  const regs = await db
    .select({
      id: schema.registrations.id,
      status: schema.registrations.status,
      amountPaid: schema.registrations.amountPaid,
      paidAt: schema.registrations.paidAt,
      createdAt: schema.registrations.createdAt,
      periodId: schema.registrations.periodId,
      seasonId: schema.registrationPeriods.seasonId,
      seasonName: schema.seasons.name,
    })
    .from(schema.registrations)
    .innerJoin(schema.registrationPeriods, eq(schema.registrations.periodId, schema.registrationPeriods.id))
    .innerJoin(schema.seasons, eq(schema.registrationPeriods.seasonId, schema.seasons.id))
    .where(eq(schema.registrations.userId, userId))
    .orderBy(desc(schema.registrations.createdAt))

  const linkedPlayer = user?.playerId
    ? await db.select().from(schema.players).where(eq(schema.players.id, user.playerId)).limit(1).then(r => r[0])
    : null

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My account</h1>
          <p className="text-muted-foreground mt-1">{user?.email}</p>
        </div>
        <SignOutButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Name</span>
            <span>{user?.name || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Email</span>
            <span>{user?.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Linked player</span>
            <span>
              {linkedPlayer ? (
                <Link href={`/player/${linkedPlayer.name.toLowerCase().replace(/\s+/g, "-")}`} className="underline">
                  {linkedPlayer.name}
                </Link>
              ) : (
                <span className="text-muted-foreground italic">Not linked</span>
              )}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registrations</CardTitle>
          <CardDescription>Your sign-up history.</CardDescription>
        </CardHeader>
        <CardContent>
          {regs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">
              No registrations yet.{" "}
              <Link href="/register" className="underline">Register for the current season</Link>.
            </div>
          ) : (
            <div className="space-y-3">
              {regs.map((r) => {
                const sb = statusBadge(r.status)
                return (
                  <div key={r.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">{r.seasonName}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.paidAt ? `Paid ${new Date(r.paidAt).toLocaleDateString()}` : `Created ${r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ""}`}
                        {r.amountPaid !== null && ` · ${formatCents(r.amountPaid)}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] ${sb.cls}`}>{sb.label}</Badge>
                      {r.status === "draft" && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/register/${r.periodId}`}>Resume</Link>
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
