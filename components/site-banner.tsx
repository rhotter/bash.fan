"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useMemo, useState, type MouseEvent } from "react"
import useSWR from "swr"
import { X } from "lucide-react"

// ─── Types ──────────────────────────────────────────────────────────────────

/** Visual style for the banner dot indicator */
type BannerVariant = "live" | "default"

/**
 * Configuration for a single site-wide banner.
 *
 * To add a new banner type:
 *   1. Add a new entry to the `banners` array inside `SiteBanner` (order = priority)
 *   2. Set `isActive` to a boolean condition (date check, SWR data, etc.)
 *   3. Choose a unique `dismissKey` so users can dismiss it independently
 *   4. That's it — the component handles rendering, dismiss, and priority.
 */
type BannerConfig = {
  /** Unique identifier for this banner (used in aria-label) */
  id: string
  /** localStorage key for dismissal tracking — must be globally unique */
  dismissKey: string
  /** Display text shown in the banner */
  label: string
  /** Link destination when the banner is clicked */
  href: string
  /** "live" = green pulsing dot, "default" = subtle dot */
  variant: BannerVariant
  /** Whether this banner's activation conditions are met */
  isActive: boolean
  /** Pathname prefixes where this banner is suppressed */
  hideOnPaths?: string[]
  /** Optional trailing content (e.g., countdown, badge) */
  suffix?: React.ReactNode
}

// ─── Shared ─────────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// ─── Registration config ────────────────────────────────────────────────────
// TODO: Remove after Summer 2026 season begins
const REG_CLOSE_DATE = new Date("2026-05-18T23:59:59")
const REG_SEASON_LABEL = "Summer 2026"

// ─── Component ──────────────────────────────────────────────────────────────

export function SiteBanner() {
  const pathname = usePathname()
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set())
  const [hydrated, setHydrated] = useState(false)

  // Fetch draft status
  const { data: draftStatus } = useSWR<{
    status: string | null
    seasonSlug?: string
  }>("/api/bash/draft-status", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  })

  // ─── Derived state ──────────────────────────────────────────────────────
  const draftActive =
    draftStatus?.status === "live" || draftStatus?.status === "published"
  const draftSeasonSlug = draftStatus?.seasonSlug ?? ""
  const isLive = draftStatus?.status === "live"

  const regExpired = Date.now() > REG_CLOSE_DATE.getTime()
  const daysLeft = Math.max(
    0,
    Math.ceil((REG_CLOSE_DATE.getTime() - Date.now()) / 86400000),
  )

  // ─── Banner configs (ordered by priority — first match wins) ────────────
  //
  // To add a new banner, append an entry here. The first active +
  // visible + non-dismissed banner is rendered; everything else is skipped.
  //
  const banners: BannerConfig[] = [
    // Priority 1: Live or Published Draft
    {
      id: "draft",
      dismissKey: `bash-draft-banner-dismissed-${draftSeasonSlug}-${draftStatus?.status ?? ""}`,
      label: isLive
        ? "BASH Draft is LIVE — Watch the picks unfold"
        : "BASH Draft Board is now available",
      href: `/draft/${draftSeasonSlug}`,
      variant: isLive ? "live" : "default",
      isActive: draftActive && !!draftSeasonSlug,
      hideOnPaths: ["/admin", "/draft"],
    },

    // Priority 2: Registration (TODO: remove after Summer 2026)
    {
      id: "registration",
      dismissKey: `bash-reg-banner-dismissed-summer-2026`,
      label: `Register for ${REG_SEASON_LABEL}`,
      href: "/register",
      variant: "default",
      isActive: !regExpired,
      hideOnPaths: ["/admin", "/register"],
      suffix: (
        <span className="text-muted-foreground/70">
          {" · "}
          <span className="tabular-nums">{daysLeft}</span>{" "}
          day{daysLeft === 1 ? "" : "s"} left
        </span>
      ),
    },

    // ─── Add future banners here ────────────────────────────────────────
    // Example:
    // {
    //   id: "playoffs",
    //   dismissKey: "bash-banner-playoffs-2026-summer",
    //   label: "Playoff bracket is live — check the matchups",
    //   href: "/standings?season=2026-summer",
    //   variant: "default",
    //   isActive: false,
    //   hideOnPaths: ["/admin"],
    // },
  ]

  // ─── Compute dismiss keys to check (stable memo for useEffect dep) ──────
  const dismissKeyList = useMemo(
    () => banners.filter((b) => b.isActive).map((b) => b.dismissKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftStatus?.status, draftSeasonSlug, regExpired],
  )

  // ─── Hydrate dismiss state from localStorage ───────────────────────────
  useEffect(() => {
    const dismissed = new Set<string>()
    dismissKeyList.forEach((key) => {
      if (localStorage.getItem(key) === "1") dismissed.add(key)
    })
    setDismissedKeys(dismissed)
    setHydrated(true)
  }, [dismissKeyList])

  // ─── Resolve the highest-priority banner to show ────────────────────────
  if (!hydrated) return null

  const activeBanner = banners.find((b) => {
    if (!b.isActive) return false
    if (b.hideOnPaths?.some((p) => pathname.startsWith(p))) return false
    if (dismissedKeys.has(b.dismissKey)) return false
    return true
  })

  if (!activeBanner) return null

  // ─── Dismiss handler ──────────────────────────────────────────────────
  const dismiss = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    localStorage.setItem(activeBanner.dismissKey, "1")
    setDismissedKeys((prev) => new Set(prev).add(activeBanner.dismissKey))
  }

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div className="relative border-b border-border/60 bg-muted/40">
      <Link
        href={activeBanner.href}
        className="group flex items-center justify-center gap-x-2 px-8 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted/70 sm:text-[13px]"
      >
        {activeBanner.variant === "live" ? (
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
        ) : (
          <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/40" />
        )}
        <span className="truncate">
          <span
            className={
              "font-medium underline underline-offset-4 group-hover:decoration-foreground " +
              (activeBanner.variant === "live"
                ? "text-green-600 dark:text-green-400 decoration-green-600/30 dark:decoration-green-400/30"
                : "text-foreground decoration-foreground/30")
            }
          >
            {activeBanner.label}
          </span>
          {activeBanner.suffix}
        </span>
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label={`Dismiss ${activeBanner.id} banner`}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground/60 hover:bg-foreground/10 hover:text-foreground sm:right-3"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
