"use client"

import { usePathname } from "next/navigation"
import { SiteFooter } from "@/components/site-footer"

/**
 * Conditionally renders the SiteFooter on non-admin routes.
 * Admin pages have their own shell and don't need the public footer.
 */
export function ConditionalFooter() {
  const pathname = usePathname()
  if (pathname.startsWith("/admin")) return null
  return <SiteFooter />
}
