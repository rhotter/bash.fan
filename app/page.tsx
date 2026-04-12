import { Suspense } from "react"
import { redirect } from "next/navigation"
import { SiteHeader } from "@/components/site-header"
import { HomeContent } from "@/components/home-content"
import { fetchBashData } from "@/lib/fetch-bash-data"

export const revalidate = 30

export default async function HomePage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const { season } = await searchParams
  if (season === "all") redirect("/stats?season=all")
  const data = await fetchBashData(season)

  return (
    <div className="flex flex-1 flex-col bg-background">
      <SiteHeader activeTab="scores" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:py-8">
        <Suspense>
          <HomeContent initialData={data} />
        </Suspense>
      </main>
    </div>
  )
}
