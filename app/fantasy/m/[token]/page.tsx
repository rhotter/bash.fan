import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { CloseTime } from "@/components/fantasy/close-time"
import { ManagerPanel } from "@/components/fantasy/manager-panel"
import { loadLineupForm } from "@/lib/fantasy/lineups"
import { findManagerByToken } from "@/lib/fantasy/managers"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Your Lineup and Predictions",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

export default async function ManagerPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ week?: string }>
}) {
  const [{ token }, { week }] = await Promise.all([params, searchParams])
  const manager = await findManagerByToken(token)
  const form = manager ? await loadLineupForm(manager, new Date(), week) : null
  if (!manager || !form) notFound()

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="min-w-0 break-words text-2xl font-bold tracking-tight">{form.teamName}</h1>
        {form.closed ? (
          <p className="text-sm text-muted-foreground">Picks are closed for this Week.</p>
        ) : (
          !form.noGames && <CloseTime lockAt={form.week.lockAt} timeZone={form.week.timeZone} />
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        This page is your Manager Link. Bookmark it and keep it private: anyone with it can change your Lineup and Predictions.
      </p>
      <ManagerPanel form={form} token={token} managerId={manager.id} />
    </main>
  )
}
