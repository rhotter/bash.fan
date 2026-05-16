"use client"

import { useState, useEffect, useRef } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Loader2, Search, UserPlus, Plus } from "lucide-react"
import { toast } from "sonner"

interface AddPlayerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  gameId: string
  teamSide: "home" | "away"
  teamName: string
  pin?: string
  onPlayerAdded: (player: { id: number; name: string }, isNew: boolean) => void
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
  onPlayerAdded,
}: AddPlayerModalProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newPlayerName, setNewPlayerName] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSearchQuery("")
      setSearchResults([])
      setShowCreateForm(false)
      setNewPlayerName("")
      // Focus search input after modal animation
      setTimeout(() => searchInputRef.current?.focus(), 100)
    }
  }, [open])

  // Debounced search across the full players table
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([])
      return
    }

    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        const headers: HeadersInit = {}
        if (pin) headers["x-pin"] = pin
        const res = await fetch(`/api/bash/scorekeeper/${gameId}/search-players?q=${encodeURIComponent(searchQuery)}`, { headers })
        if (res.ok) {
          const data = await res.json()
          setSearchResults(data.players || [])
        }
      } catch {
        // Silently fail search
      } finally {
        setIsSearching(false)
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [searchQuery, gameId, pin])

  const handleAddExisting = async (player: SearchResult) => {
    setIsAdding(true)
    try {
      const headers: HeadersInit = { "Content-Type": "application/json" }
      if (pin) headers["x-pin"] = pin
      const res = await fetch(`/api/bash/scorekeeper/${gameId}/player`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: player.name, teamSide }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to add player")
      }
      const data = await res.json()
      onPlayerAdded(data.player, data.isNew)
      toast.success(`${data.player.name} added to ${teamName}`)
      onOpenChange(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add player")
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
        body: JSON.stringify({ name: newPlayerName.trim(), teamSide }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to create player")
      }
      const data = await res.json()
      onPlayerAdded(data.player, data.isNew)
      toast.success(
        data.isNew
          ? `${data.player.name} created and added to ${teamName}`
          : `${data.player.name} found and added to ${teamName}`
      )
      onOpenChange(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create player")
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
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Searching…
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
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
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
