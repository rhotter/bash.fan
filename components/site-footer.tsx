"use client"

import { fetchApi as fetch, readApiJson } from "@/lib/api-errors"

import { Suspense } from "react"
import Link from "next/link"
import useSWR from "swr"
import type { PublicDraftStatus } from "@/lib/fetch-draft-status"
import { SeasonSelector } from "@/components/season-selector"

const fetcher = (url: string) => fetch(url).then((r) => readApiJson(r))

export function SiteFooter({ initialDraftStatus }: { initialDraftStatus: PublicDraftStatus }) {
  const { data: draftStatus } = useSWR<PublicDraftStatus>(
    "/api/bash/draft-status",
    fetcher,
    { fallbackData: initialDraftStatus, revalidateOnFocus: false, dedupingInterval: 30000 }
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
      </div>
    </footer>
  )
}
