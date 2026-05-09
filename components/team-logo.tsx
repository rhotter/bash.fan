"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { getTeamLogoUrl } from "@/lib/team-logos"

const FallbackLogo = ({ size, className }: { size: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`text-muted-foreground/50 ${className || ""}`}
  >
    <path d="M3 2L18 20h4" />
    <path d="M21 2L6 20H2" />
    <circle cx="12" cy="21" r="2" fill="currentColor" stroke="none" />
  </svg>
)

export function TeamLogo({
  slug,
  name,
  size = 20,
  className,
  linked = false,
  seasonId,
}: {
  slug: string
  name: string
  size?: number
  className?: string
  linked?: boolean
  seasonId?: string
}) {
  const [error, setError] = useState(false)
  const logoUrl = getTeamLogoUrl(slug, seasonId)

  if (!logoUrl || error) {
    const fallback = <FallbackLogo size={size} className={className} />
    if (linked) {
      return (
        <Link href={`/team/${slug}`} onClick={(e) => e.stopPropagation()}>
          {fallback}
        </Link>
      )
    }
    return fallback
  }

  const img = (
    <Image
      src={logoUrl}
      alt={name}
      width={size}
      height={size}
      className={className}
      onError={() => setError(true)}
    />
  )

  if (linked) {
    return (
      <Link href={`/team/${slug}`} onClick={(e) => e.stopPropagation()}>
        {img}
      </Link>
    )
  }

  return img
}
