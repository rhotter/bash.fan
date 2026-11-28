"use client"

import { Analytics } from "@vercel/analytics/next"
import { SpeedInsights } from "@vercel/speed-insights/next"
import { usePathname } from "next/navigation"

/** A Manager Link's path holds the secret that lets its holder change a team, so analytics must never see it. */
const SECRET_PATH = "/fantasy/m/"

// A script loaded on an earlier page keeps running after its component unmounts, so events are filtered too.
const dropSecretPaths = <T extends { url: string }>(event: T) => (event.url.includes(SECRET_PATH) ? null : event)

/** Vercel Analytics and Speed Insights, kept off Manager Link pages. */
export function SafeAnalytics() {
  // The packages report the raw path along with the route pattern, so on these pages they aren't loaded at all.
  if (usePathname()?.startsWith(SECRET_PATH)) return null
  return (
    <>
      <Analytics beforeSend={dropSecretPaths} />
      <SpeedInsights beforeSend={dropSecretPaths} />
    </>
  )
}
