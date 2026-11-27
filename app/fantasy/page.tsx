import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { FantasyStandingsView } from "@/components/fantasy/standings"
import { fantasyHref, parseContest, parseFantasyView } from "@/lib/fantasy/view-state"
import { fetchFantasyPageData } from "@/lib/cached-page-data"

/** No key means the season's first contest. A key that isn't valid matches none, so the page 404s. */
function contestParam(value: string | undefined) {
  return value === undefined ? undefined : (parseContest(value) ?? "")
}

export const revalidate = 30

export const metadata: Metadata = {
  title: "Fantasy",
  description: "BASH Fantasy standings and Lineups.",
}

export default async function FantasyPage({ searchParams }: { searchParams: Promise<{ tab?: string; week?: string; contest?: string }> }) {
  const params = await searchParams
  const data = await fetchFantasyPageData(contestParam(params.contest))
  if (!data) notFound()
  // With more than one contest the URL always names one, so a shared link stays on it when the default moves on.
  if (data.contests.length > 1 && params.contest === undefined) {
    const { tab } = parseFantasyView(params, [])
    redirect(fantasyHref({ tab, weekId: params.week ?? null, contest: data.contest }))
  }

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:py-8">
        <FantasyStandingsView
          data={data}
          view={parseFantasyView(params, Object.keys(data.overviews).sort(), data.weeks.at(-1)?.id ?? data.openWeekId)}
          initialRange={params.week === undefined ? "season" : "weekly"}
        />
      </main>
    </div>
  )
}
