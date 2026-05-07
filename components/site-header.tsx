"use client"

import Link from "next/link"
import Image from "next/image"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"
import useSWR from "swr"
import { PlayerSearch } from "@/components/player-search"

const NAV_ITEMS = [
  { label: "Scores", href: "/" },
  { label: "Standings", href: "/standings" },
  { label: "Stats", href: "/stats" },
  { label: "About", href: "/about" },
]

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function SiteHeaderInner({ activeTab }: { activeTab?: string }) {
  const searchParams = useSearchParams()
  const season = searchParams.get("season")
  const seasonQuery = season ? `?season=${season}` : ""

  // Fetch draft status for conditional nav link
  const { data: draftStatus } = useSWR<{ status: string | null; seasonSlug?: string }>(
    "/api/bash/draft-status",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  )

  // Draft link: shown in header for published/live, omitted for completed (goes to footer)
  const showDraftInHeader = draftStatus?.status === "published" || draftStatus?.status === "live"
  const draftLabel = draftStatus?.status === "live" ? "Live Draft" : "Draft"
  const draftHref = draftStatus?.status === "published"
    ? `/draft/${draftStatus.seasonSlug}`
    : `/draft/${draftStatus?.seasonSlug}`

  return (
    <header className="sticky top-0 z-50">
      <div className="border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-1.5 px-2 sm:gap-3 sm:px-4 md:h-14">
          <Link href={`/${seasonQuery}`} className="flex items-center gap-1.5 sm:gap-2 group shrink-0 min-w-0">
            <Image
              src="/logo.png"
              alt="BASH logo"
              width={28}
              height={28}
              className="shrink-0 sm:w-8 sm:h-8 md:w-9 md:h-9"

            />
            <div className="hidden sm:flex flex-col">
              <span className="text-[13px] font-bold leading-tight tracking-tight text-foreground md:text-sm">
                Bay Area Street Hockey
              </span>
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70 md:text-[10px]">
                BASH
              </span>
            </div>
            <span className="sm:hidden text-xs font-bold tracking-tight text-foreground">
              BASH
            </span>
          </Link>
          <nav className="ml-auto flex items-center gap-0 sm:gap-1">
            <PlayerSearch />
            {showDraftInHeader && (
              <Link
                href={draftHref}
                className={
                  "text-[11px] sm:text-xs font-semibold px-2 sm:px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 " +
                  (activeTab === "draft"
                    ? "text-foreground bg-secondary"
                    : draftStatus?.status === "live"
                      ? "text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300"
                      : "text-muted-foreground/50 hover:text-muted-foreground")
                }
              >
                {draftStatus?.status === "live" && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                )}
                {draftLabel}
              </Link>
            )}
            {NAV_ITEMS.filter((item) => season !== "all" || item.label === "Stats").map((item) => {
              const isActive = activeTab === item.label.toLowerCase()
              return (
                <Link
                  key={item.label}
                  href={`${item.href}${seasonQuery}`}
                  className={
                    "text-[11px] sm:text-xs font-semibold px-2 sm:px-3 py-1.5 rounded-md transition-colors " +
                    (isActive
                      ? "text-foreground bg-secondary"
                      : "text-muted-foreground/50 hover:text-muted-foreground")
                  }
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
    </header>
  )
}

export function SiteHeader({ activeTab }: { activeTab?: string }) {
  return (
    <Suspense fallback={
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-1.5 px-2 sm:gap-3 sm:px-4 md:h-14" />
      </header>
    }>
      <SiteHeaderInner activeTab={activeTab} />
    </Suspense>
  )
}
