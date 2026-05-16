"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState, type MouseEvent } from "react"
import { X } from "lucide-react"

const CLOSE_DATE = new Date("2026-05-18T23:59:59")
const SEASON_LABEL = "Summer 2026"
const STORAGE_KEY = "bash-reg-banner-dismissed-summer-2026"

export function RegistrationBanner() {
  const pathname = usePathname()
  const [hidden, setHidden] = useState(true)

  useEffect(() => {
    setHidden(localStorage.getItem(STORAGE_KEY) === "1")
  }, [])

  if (hidden) return null
  if (pathname.startsWith("/admin") || pathname === "/register") return null
  if (Date.now() > CLOSE_DATE.getTime()) return null

  const daysLeft = Math.max(
    0,
    Math.ceil((CLOSE_DATE.getTime() - Date.now()) / 86400000),
  )

  const dismiss = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    localStorage.setItem(STORAGE_KEY, "1")
    setHidden(true)
  }

  return (
    <div className="relative border-b border-border/60 bg-muted/40">
      <Link
        href="/register"
        className="group flex items-center justify-center gap-x-2 px-8 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted/70 sm:text-[13px]"
      >
        <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/40" />
        <span className="truncate">
          <span className="font-medium text-foreground underline decoration-foreground/30 underline-offset-4 group-hover:decoration-foreground">
            Register for {SEASON_LABEL}
          </span>
          <span className="text-muted-foreground/70">
            {" · "}
            <span className="tabular-nums">{daysLeft}</span>{" "}
            day{daysLeft === 1 ? "" : "s"} left
          </span>
        </span>
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss registration banner"
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground/60 hover:bg-foreground/10 hover:text-foreground sm:right-3"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
