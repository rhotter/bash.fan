"use client"

import { Suspense } from "react"
import Link from "next/link"
import useSWR from "swr"
import { SeasonSelector } from "@/components/season-selector"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function SiteFooter() {
  const { data: draftStatus } = useSWR<{ status: string | null; seasonSlug?: string }>(
    "/api/bash/draft-status",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  )

  const showDraftResults = draftStatus?.status === "completed"

  return (
    <footer className="mt-auto border-t border-border/40 py-6 px-4">
      <div className="mx-auto max-w-6xl space-y-3">
        <div className="flex items-center gap-3">
          <Suspense fallback={null}>
            <SeasonSelector />
          </Suspense>
          <div className="ml-auto flex items-center gap-3">
            {showDraftResults && (
              <Link href={`/draft/${draftStatus.seasonSlug}`} className="text-xs text-muted-foreground/30 hover:text-muted-foreground transition-colors">
                Draft Results
              </Link>
            )}
            <Link href="/scorekeeper" className="text-xs text-muted-foreground/30 hover:text-muted-foreground transition-colors">
              Scorekeeper
            </Link>
            <Link href="/admin" className="text-xs text-muted-foreground/30 hover:text-muted-foreground transition-colors">
              Admin
            </Link>
          </div>
        </div>
        <div className="text-center text-[10px] text-muted-foreground/40">
          © {new Date().getFullYear()} BASH · Bay Area Street Hockey
        </div>
      </div>
    </footer>
  )
}
