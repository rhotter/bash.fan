"use client"

import { fetchApi as fetch, readApiJson, errorMessage } from "@/lib/api-errors"

import useSWR from "swr"
import { useState } from "react"
import { ErrorNotice } from "@/components/error-notice"
import { useRouter } from "next/navigation"
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types"
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

const fetcher = (url: string) => fetch(url).then((res) => readApiJson(res))

export function PlayerSearchDialog({ open, onOpenChange, onSelect }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (slug: string) => void
}) {
  const isMobile = useIsMobile()
  const router = useRouter()
  const [selectedPlayer, setSelectedPlayer] = useState("")
  const prefetchPlayer = (slug: string) => {
    if (slug) router.prefetch(`/player/${slug}`, { kind: PrefetchKind.FULL })
  }
  // Only fetch when opened
  const { data, error, mutate } = useSWR<{ players: PlayerSearchResult[] }>(
    open ? "/api/bash/players/search" : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 300_000 }
  )
  const players = data?.players ?? []

  const commandContent = (
    <Command className="rounded-lg" shouldFilter value={selectedPlayer} onValueChange={(slug) => {
      setSelectedPlayer(slug)
      prefetchPlayer(slug)
    }}>
      <CommandInput placeholder="Search players..." />
      {error && <ErrorNotice message={errorMessage(error, "Could not search players. Please try again.")}
        onRetry={() => { void mutate().catch(() => {}) }} />}
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>{error ? null : "No players found."}</CommandEmpty>
        <CommandGroup>
          {players.map((p) => (
            <CommandItem
              key={p.slug}
              value={p.slug}
              keywords={[p.name]}
              onSelect={() => onSelect(p.slug)}
              onMouseEnter={() => prefetchPlayer(p.slug)}
              onFocus={() => prefetchPlayer(p.slug)}
              onTouchStart={() => prefetchPlayer(p.slug)}
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
      <Drawer open={open} onOpenChange={onOpenChange}>
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
