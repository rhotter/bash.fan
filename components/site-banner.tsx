"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState, useMemo, type MouseEvent } from "react"
import useSWR from "swr"
import { X } from "lucide-react"
import {
  PublicBanner,
  computeCountdownSuffix,
  resolveEffectiveVariant,
  isBannerVisible,
  getDismissalKey,
} from "@/lib/banner-helpers"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function SiteBanner() {
  const pathname = usePathname()
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set())
  const [checkedBannerKey, setCheckedBannerKey] = useState<string | null>(null)

  // Periodic clock tick for live countdown updating
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  // Fetch highest-priority active banner from database
  const { data } = useSWR<{ banner: PublicBanner | null }>(
    "/api/bash/banners",
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
      refreshInterval: 30000,
    },
  )

  const banner = data?.banner ?? null

  // Hydrate client-side localStorage dismissals before first render frame
  useEffect(() => {
    if (!banner) {
      setCheckedBannerKey(null)
      return
    }
    const key = getDismissalKey(banner.id, banner.dismissVersion)
    try {
      const val = localStorage.getItem(key)
      if (val === "dismissed" || val === "1") {
        setDismissedKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
      }
    } catch {
      // Ignore localStorage errors (e.g. private browsing mode)
    }
    setCheckedBannerKey(key)
  }, [banner])

  // Dynamic suffix and effective variant calculation
  const suffix = useMemo(() => {
    if (!banner) return null
    return computeCountdownSuffix(
      banner.countdownType,
      banner.countdownTarget,
      now,
      "America/Los_Angeles",
    )
  }, [banner, now])

  const effectiveVariant = useMemo(() => {
    if (!banner) return "default"
    return resolveEffectiveVariant(banner.variant, banner.countdownType, suffix)
  }, [banner, suffix])

  // Evaluate full client visibility (active status, route suppression, date bounds, dismissals)
  const currentBannerKey = banner ? getDismissalKey(banner.id, banner.dismissVersion) : null
  const isDismissalChecked = banner && checkedBannerKey === currentBannerKey

  const isVisible = useMemo(() => {
    if (!banner || !isDismissalChecked) return false
    return isBannerVisible(banner, pathname, dismissedKeys, now)
  }, [banner, isDismissalChecked, pathname, dismissedKeys, now])

  // Safely normalize external vs internal URLs (supports mailto:, tel:, #)
  const resolvedHref = useMemo(() => {
    if (!banner) return "/"
    const trimmed = banner.href?.trim() || ""
    if (!trimmed) return "/"
    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      (trimmed.startsWith("/") && !trimmed.startsWith("//")) ||
      trimmed.startsWith("mailto:") ||
      trimmed.startsWith("tel:") ||
      trimmed.startsWith("#")
    ) {
      return trimmed
    }
    return `https://${trimmed}`
  }, [banner])

  if (!isVisible || !banner) {
    return null
  }

  const handleDismiss = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const key = getDismissalKey(banner.id, banner.dismissVersion)
    try {
      localStorage.setItem(key, "dismissed")
    } catch {
      // Ignore localStorage errors (e.g. private browsing mode)
    }
    setDismissedKeys((prev) => new Set(prev).add(key))
  }

  const mobileLabel = banner.mobileLabel?.trim() || null

  return (
    <div
      role="region"
      aria-label="Site announcement"
      className="relative border-b border-border/60 bg-muted/40 h-8"
    >
      <Link
        href={resolvedHref}
        className="group flex h-full items-center justify-start gap-x-2 py-1.5 pl-4 pr-12 sm:pr-8 text-left text-[12px] text-muted-foreground transition-colors hover:bg-muted/70 sm:justify-center sm:px-8 sm:text-[13px] min-w-0"
      >
        {/* Visual Indicator Dot */}
        {effectiveVariant === "live" ? (
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
        ) : effectiveVariant === "warning" ? (
          <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
        ) : (
          <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/40" />
        )}

        {/* Truncated Copy with Pure CSS Responsive Switching */}
        <span
          className={
            "truncate font-medium underline underline-offset-4 group-hover:decoration-foreground " +
            (effectiveVariant === "live"
              ? "text-emerald-600 dark:text-emerald-400 decoration-emerald-600/30 dark:decoration-emerald-400/30"
              : effectiveVariant === "warning"
              ? "text-amber-600 dark:text-amber-400 decoration-amber-600/30 dark:decoration-amber-400/30"
              : "text-foreground decoration-foreground/30")
          }
        >
          <span className={mobileLabel ? "hidden sm:inline" : ""}>
            {banner.label}
          </span>
          {mobileLabel && (
            <span className="inline sm:hidden">{mobileLabel}</span>
          )}
        </span>

        {/* Protected Countdown Suffix (Direct sibling with shrink-0 tabular-nums) */}
        {suffix && (
          <span className="shrink-0 text-muted-foreground/70 tabular-nums">
            {suffix}
          </span>
        )}
      </Link>

      {/* Dismiss Button with WCAG 2.5.5 Touch Target (min 44×44px on mobile, compact on desktop) */}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss banner"
        className="absolute right-0 top-1/2 -translate-y-1/2 flex h-full min-h-[44px] min-w-[44px] items-center justify-center p-2 touch-manipulation text-muted-foreground/60 hover:text-foreground sm:right-2 sm:h-auto sm:min-h-0 sm:min-w-0 sm:p-1"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
