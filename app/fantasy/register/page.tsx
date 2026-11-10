import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { RegistrationForm } from "@/components/fantasy/registration-form"
import { getCurrentFantasySeason, parseContest } from "@/lib/fantasy/season"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Join Fantasy",
  robots: { index: false, follow: false },
}

export default async function FantasyRegisterPage({ searchParams }: { searchParams: Promise<{ contest?: string }> }) {
  const { contest } = await searchParams
  const key = contest === undefined ? undefined : parseContest(contest)
  const season = key === null ? null : await getCurrentFantasySeason(key)
  if (!season) notFound()
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">Join Fantasy</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your Team Name is public. Your real name is only seen by admins.
      </p>
      <RegistrationForm contest={season.contest} />
    </main>
  )
}
