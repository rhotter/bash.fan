"use client"

import { fetchApi as fetch, readApiJson, errorMessage } from "@/lib/api-errors"

import { Spinner } from "@/components/ui/spinner"
import { useState, useEffect, useRef } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Search, UserPlus, Plus } from "lucide-react"
import { toast } from "sonner"

interface AddPlayerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  gameId: string
  teamSide: "home" | "away"
  teamName: string
  pin?: string
  // True if this game is exhibition/tryout — for adhoc games, adding a player
  // is the normal path (not a sub), so the sub toggle defaults off.
  adhocGame?: boolean
  onPlayerAdded: (player: { id: number; name: string }, isNew: boolean, isSub: boolean) => void
}

interface SearchResult {
  id: number
  name: string
}

export function AddPlayerModal({
  open,
  onOpenChange,
  gameId,
  teamSide,
  teamName,
  pin,
  adhocGame = false,
  onPlayerAdded,
}: AddPlayerModalProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchError, setSearchError] = useState("")
  const [searchAttempt, setSearchAttempt] = useState(0)
  const [isSearching, setIsSearching] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newPlayerName, setNewPlayerName] = useState("")
  // For regular-season games, default to sub. For exhibition/tryout, default off
  // since the standard flow is to add players to the per-game roster.
  const [isSub, setIsSub] = useState(!adhocGame)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSearchQuery("")
      setSearchResults([])
      setShowCreateForm(false)
      setNewPlayerName("")
      setIsSub(!adhocGame)
      // Focus search input after modal animation
      setTimeout(() => searchInputRef.current?.focus(), 100)
    }
  }, [open, adhocGame])

  // Debounced search across the full players table
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([])
      setIsSearching(false)
      return
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      setIsSearching(true)
      setSearchError("")
      try {
        const headers: HeadersInit = {}
        if (pin) headers["x-pin"] = pin
        const res = await fetch(`/api/bash/scorekeeper/${gameId}/search-players?q=${encodeURIComponent(searchQuery)}`, { headers })
        if (res.ok) {
          const data = await readApiJson(res)
          if (!cancelled) setSearchResults(data.players || [])
        }
      } catch (error) {
        if (!cancelled) {
          setSearchResults([])
          setSearchError(errorMessage(error, "Could not search players. Please try again."))
        }
      } finally {
        if (!cancelled) setIsSearching(false)
      }
    }, 250)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [searchQuery, gameId, pin, searchAttempt])

  const handleAddExisting = async (player: SearchResult) => {
    setIsAdding(true)
    try {
      const headers: HeadersInit = { "Content-Type": "application/json" }
      if (pin) headers["x-pin"] = pin
      const res = await fetch(`/api/bash/scorekeeper/${gameId}/player`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: player.name, teamSide, isSub }),
      })
      if (!res.ok) {
        const data = await readApiJson(res)
        throw new Error(data.error || "Failed to add player")
      }
      const data = await readApiJson(res)
      onPlayerAdded(data.player, data.isNew, !!data.isSub)
      toast.success(
        data.isSub
          ? `${data.player.name} added as sub for ${teamName}`
          : `${data.player.name} added to ${teamName}`
      )
      onOpenChange(false)
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Failed to add player"))
    } finally {
      setIsAdding(false)
    }
  }

  const handleCreateNew = async () => {
    if (!newPlayerName.trim()) return
    setIsAdding(true)
    try {
      const headers: HeadersInit = { "Content-Type": "application/json" }
      if (pin) headers["x-pin"] = pin
      const res = await fetch(`/api/bash/scorekeeper/${gameId}/player`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: newPlayerName.trim(), teamSide, isSub }),
      })
      if (!res.ok) {
        const data = await readApiJson(res)
        throw new Error(data.error || "Failed to create player")
      }
      const data = await readApiJson(res)
      onPlayerAdded(data.player, data.isNew, !!data.isSub)
      toast.success(
        data.isNew
          ? `${data.player.name} created and added to ${teamName}${data.isSub ? " as sub" : ""}`
          : `${data.player.name} found and added to ${teamName}${data.isSub ? " as sub" : ""}`
      )
      onOpenChange(false)
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Failed to create player"))
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base">Add Player to {teamName}</DialogTitle>
          <DialogDescription className="text-xs">
            Search for an existing player or create a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3">
          {/* Sub toggle */}
          <label className="flex items-center gap-2 px-1 py-1.5 cursor-pointer select-none">
            <Checkbox
              checked={isSub}
              onCheckedChange={(v) => setIsSub(v === true)}
              disabled={isAdding}
              className="data-[state=checked]:bg-foreground data-[state=checked]:border-foreground data-[state=checked]:text-background"
            />
            <span className="text-xs">
              Sub for this game only
              <span className="text-muted-foreground/70 ml-1">
                — stats won&apos;t count toward season totals
              </span>
            </span>
          </label>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Search player name…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setShowCreateForm(false)
                setSearchError("")
                setSearchResults([])
                setIsSearching(e.target.value.trim().length >= 2)
              }}
              className="pl-9 h-9 text-sm"
              disabled={isAdding}
            />
          </div>

          {/* Search results */}
          {searchQuery.length >= 2 && (
            <div className="border rounded-lg overflow-hidden">
              {isSearching ? (
                <div className="flex items-center justify-center py-4 gap-2 text-sm text-muted-foreground">
                  <Spinner className="h-4 w-4" />
                  Searching…
                </div>
              ) : searchError ? (
                <div role="alert" className="p-3 text-sm text-destructive">{searchError}
                  <button type="button" className="ml-2 underline" onClick={() => setSearchAttempt((attempt) => attempt + 1)}>Try again</button>
                </div>
              ) : searchResults.length > 0 ? (
                <div className="divide-y max-h-[200px] overflow-y-auto">
                  {searchResults.map((player) => (
                    <button
                      key={player.id}
                      onClick={() => handleAddExisting(player)}
                      disabled={isAdding}
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center justify-between group disabled:opacity-50"
                    >
                      <span className="font-medium">{player.name}</span>
                      <UserPlus className="h-4 w-4 opacity-0 group-hover:opacity-100 text-primary transition-opacity" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  No players found for &ldquo;{searchQuery}&rdquo;
                </div>
              )}

              {/* Create new player option — always pinned at bottom */}
              <div className="border-t bg-muted/30">
                <button
                  onClick={() => {
                    setShowCreateForm(true)
                    setNewPlayerName(searchQuery)
                  }}
                  disabled={isAdding}
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-primary font-medium disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  Create new player
                </button>
              </div>
            </div>
          )}

          {/* Create new player form */}
          {showCreateForm && (
            <div className="border rounded-lg p-3 space-y-3 bg-muted/20">
              <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">New Player</span>
                <Badge className="bg-teal-500/10 text-teal-600 border-teal-500/20 text-[9px] uppercase tracking-wider font-semibold ml-auto">
                  New
                </Badge>
              </div>
              <Input
                placeholder="Full name (e.g., Mike Johnson)"
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                className="h-9 text-sm"
                disabled={isAdding}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newPlayerName.trim()) {
                    handleCreateNew()
                  }
                }}
              />
              <Button
                onClick={handleCreateNew}
                disabled={!newPlayerName.trim() || isAdding}
                size="sm"
                className="w-full"
              >
                {isAdding ? (
                  <>
                    <Spinner className="h-4 w-4 mr-1.5" />
                    Adding…
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4 mr-1.5" />
                    Create &amp; Add to {teamName}
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
