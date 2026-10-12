"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"

const SearchDialog = dynamic(() => import("@/components/player-search-dialog").then((module) => module.PlayerSearchDialog))

export function PlayerSearch() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  const handleSelect = useCallback(
    (slug: string) => {
      setOpen(false)
      router.push(`/player/${slug}`)
    },
    [router]
  )

  return open ? <SearchDialog open={open} onOpenChange={setOpen} onSelect={handleSelect} /> : null
}
