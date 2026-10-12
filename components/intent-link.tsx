"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import type { ComponentProps } from "react"

type IntentLinkProps = Omit<ComponentProps<typeof Link>, "href"> & { href: string }

/** Fetch the complete destination when a visitor shows interest in a link. */
export function IntentLink({ href, onMouseEnter, onFocus, prefetch, ...props }: IntentLinkProps) {
  const router = useRouter()
  return (
    <Link
      {...props}
      href={href}
      prefetch={prefetch ?? (href.startsWith("/team/") ? true : undefined)}
      onMouseEnter={(event) => {
        onMouseEnter?.(event)
        if (!event.defaultPrevented) router.prefetch(href)
      }}
      onFocus={(event) => {
        onFocus?.(event)
        if (!event.defaultPrevented) router.prefetch(href)
      }}
    />
  )
}
