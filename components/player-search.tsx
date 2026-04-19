"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { useIsMobile } from "@/components/ui/use-mobile"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import type { PlayerSearchResult } from "@/app/api/bash/players/search/route"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function PlayerSearch() {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const isMobile = useIsMobile()

  // Only fetch when opened
  const { data } = useSWR<{ players: PlayerSearchResult[] }>(
    open ? "/api/bash/players/search" : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 300_000 }
  )
  const players = data?.players ?? []

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

  const commandContent = (
    <Command className="rounded-lg" shouldFilter>
      <CommandInput placeholder="Search players..." />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>No players found.</CommandEmpty>
        <CommandGroup>
          {players.map((p) => (
            <CommandItem
              key={p.slug}
              value={p.name}
              onSelect={() => handleSelect(p.slug)}
              className="flex items-center justify-between gap-2 py-3"
            >
              <span className="font-medium text-sm">{p.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {p.team}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader className="sr-only">
            <DrawerTitle>Search players</DrawerTitle>
            <DrawerDescription>Find a player by name</DrawerDescription>
          </DrawerHeader>
          <div className="p-2">{commandContent}</div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-md" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Search players</DialogTitle>
          <DialogDescription>Find a player by name</DialogDescription>
        </DialogHeader>
        {commandContent}
      </DialogContent>
    </Dialog>
  )
}
