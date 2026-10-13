"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types"
import type { ComponentProps } from "react"

type IntentLinkProps = Omit<ComponentProps<typeof Link>, "href"> & { href: string }

/** Fetch the complete destination when a visitor shows interest in a link. */
export function IntentLink({ href, onMouseEnter, onFocus, onTouchStart, prefetch, ...props }: IntentLinkProps) {
  const router = useRouter()
  return (
    <Link
      {...props}
      href={href}
      prefetch={prefetch ?? (href.startsWith("/team/") ? true : undefined)}
      onMouseEnter={(event) => {
        onMouseEnter?.(event)
        if (!event.defaultPrevented && prefetch !== false) router.prefetch(href, { kind: PrefetchKind.FULL })
      }}
      onFocus={(event) => {
        onFocus?.(event)
        if (!event.defaultPrevented && prefetch !== false) router.prefetch(href, { kind: PrefetchKind.FULL })
      }}
      onTouchStart={(event) => {
        onTouchStart?.(event)
        if (!event.defaultPrevented && prefetch !== false) router.prefetch(href, { kind: PrefetchKind.FULL })
      }}
    />
  )
}
