"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { PlayerSearch } from "@/components/player-search"
import { getOptimizedLogoUrl } from "@/lib/optimized-logo"

const NAV_ITEMS = [
  { label: "Scores", href: "/" },
  { label: "Standings", href: "/standings" },
  { label: "Stats", href: "/stats" },
  { label: "About", href: "/about" },
]

function HeaderContent({ activeTab, season }: { activeTab?: string; season?: string | null }) {
  const seasonQuery = season ? `?season=${season}` : ""

  return (
    <header className="sticky top-0 z-50">
      <div className="border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-1.5 px-2 sm:gap-3 sm:px-4 md:h-14">
          <Link href={`/${seasonQuery}`} className="flex items-center gap-1.5 sm:gap-2 group shrink-0 min-w-0">
            <Image
              src={getOptimizedLogoUrl("/logo-35th.png", 128)}
              unoptimized
              alt="BASH logo"
              width={133}
              height={28}
              loading="eager"
              fetchPriority="high"
              sizes="(min-width: 768px) 190px, (min-width: 640px) 171px, 133px"
              className="h-7 w-auto shrink-0 sm:h-9 md:h-10"
            />
            <span className="sr-only">Bay Area Street Hockey — 35 Years of BASH (1991–2026)</span>
          </Link>
          <nav className="ml-auto flex items-center gap-0 sm:gap-1">
            <PlayerSearch />
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.label.toLowerCase()
              const itemQuery = (season === "all" && item.label !== "Stats") ? "" : seasonQuery
              return (
                <Link
                  key={item.label}
                  prefetch={true}
                  href={`${item.href}${itemQuery}`}
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

function SeasonHeader({ activeTab }: { activeTab?: string }) {
  const searchParams = useSearchParams()
  return <HeaderContent activeTab={activeTab} season={searchParams.get("season")} />
}

// Keep the public header outside page/loading boundaries so navigation preserves
// the logo DOM node (and the decoded image) instead of mounting it again.
export function SiteHeader() {
  const pathname = usePathname()
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return null

  const activeTab = pathname === "/" ? "scores"
    : ["/about", "/how-to", "/rulebook"].includes(pathname) ? "about"
    : pathname === "/standings" ? "standings"
    : pathname === "/stats" ? "stats"
    : undefined

  return (
    <Suspense fallback={<HeaderContent activeTab={activeTab} />}>
      <SeasonHeader activeTab={activeTab} />
    </Suspense>
  )
}
