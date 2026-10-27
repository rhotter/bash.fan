"use client"

import { type CSSProperties, useState } from "react"
import Image from "next/image"
import { IntentLink as Link } from "@/components/intent-link"
import { getTeamLogoUrl } from "@/lib/team-logos"
import { getOptimizedLogoUrl } from "@/lib/optimized-logo"
import { getTeamLogoColor } from "@/lib/team-logo-colors"
import { cn } from "@/lib/utils"

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
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const logoUrl = getTeamLogoUrl(slug, seasonId)
  const optimizedUrl = logoUrl ? getOptimizedLogoUrl(logoUrl, size) : null
  const hasLogo = logoUrl && optimizedUrl && failedUrl !== logoUrl
  const badge = (
    <span
      className={cn("team-logo-badge relative inline-flex shrink-0 items-center justify-center rounded-full align-middle", className)}
      style={{ width: size, height: size, "--team-logo-color": getTeamLogoColor(slug) } as CSSProperties}
      role="img"
      aria-label={name}
    >
      <span className="team-logo-artwork absolute inset-[10%]" aria-hidden="true">
        {hasLogo ? (
          <>
            {logoUrl === "/team-logos/yetis_1024.png" && (
              <span className="absolute left-[49.2%] top-[50.1%] h-[55%] w-[55%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
            )}
            <Image
              src={optimizedUrl}
              unoptimized={optimizedUrl !== logoUrl}
              alt=""
              width={size}
              height={size}
              loading="eager"
              className="relative h-full w-full object-contain"
              onError={() => setFailedUrl(logoUrl)}
            />
          </>
        ) : (
          <FallbackLogo size={size} className="h-full w-full p-[15%]" />
        )}
      </span>
    </span>
  )

  if (linked) {
    return (
      <Link href={`/team/${slug}`} onClick={(e) => e.stopPropagation()}>
        {badge}
      </Link>
    )
  }

  return badge
}
