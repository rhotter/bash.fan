"use client"

import { useState, useEffect, useCallback } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { Loader2, Search, X, UserPlus } from "lucide-react"
import type { ScheduleGame } from "./season-schedule-tab"

interface AdhocRosterModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  game: ScheduleGame | null
  seasonId: string
  onSaved?: () => void
}

interface Player {
  id: number
  name: string
}

interface AssignedPlayer extends Player {
  teamSide: "home" | "away"
}

export function AdhocRosterModal({
  open,
  onOpenChange,
  game,
  seasonId,
  onSaved,
}: AdhocRosterModalProps) {
  const [roster, setRoster] = useState<AssignedPlayer[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Player search state
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<Player[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [activeTab, setActiveTab] = useState<"home" | "away">("away")

  const fetchRoster = useCallback(async () => {
    if (!game) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/adhoc/${game.id}/roster`)
      if (res.ok) {
        const data = await res.json()
        setRoster(data.roster.map((r: { playerId: number; name: string; teamSide: "home" | "away" }) => ({
          id: r.playerId,
          name: r.name,
          teamSide: r.teamSide,
        })))
      }
    } catch {
      toast.error("Failed to load ad-hoc roster")
    } finally {
      setIsLoading(false)
    }
  }, [game, seasonId])

  useEffect(() => {
    if (open && game) {
      fetchRoster()
      setSearchQuery("")
      setSearchResults([])
    }
  }, [open, game, fetchRoster])

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([])
      return
    }

    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        const res = await fetch(`/api/bash/admin/players?q=${encodeURIComponent(searchQuery)}`)
        if (res.ok) {
          const data = await res.json()
          setSearchResults(data.players || [])
        }
      } catch (err) {
        console.error(err)
      } finally {
        setIsSearching(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery])

  const handleSave = async () => {
    if (!game) return
    setIsSaving(true)
    try {
      const payload = {
        players: roster.map(p => ({
          playerId: p.id,
          teamSide: p.teamSide,
        }))
      }

      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/adhoc/${game.id}/roster`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to save roster")
      }

      toast.success("Roster saved successfully")
      onSaved?.()
      onOpenChange(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setIsSaving(false)
    }
  }

  const addPlayer = (player: Player) => {
    if (roster.some(p => p.id === player.id)) {
      toast.error(`${player.name} is already on the roster`)
      return
    }
    setRoster(prev => [...prev, { ...player, teamSide: activeTab }])
    setSearchQuery("")
  }

  const removePlayer = (playerId: number) => {
    setRoster(prev => prev.filter(p => p.id !== playerId))
  }

  if (!game) return null

  const homePlayers = roster.filter(p => p.teamSide === "home").sort((a, b) => a.name.localeCompare(b.name))
  const awayPlayers = roster.filter(p => p.teamSide === "away").sort((a, b) => a.name.localeCompare(b.name))

  const renderRosterList = (players: AssignedPlayer[]) => (
    <div className="border rounded-md divide-y mt-4 max-h-[300px] overflow-y-auto">
      {players.length === 0 ? (
        <div className="p-4 text-center text-sm text-muted-foreground">
          No players assigned to this team yet.
        </div>
      ) : (
        players.map(p => (
          <div key={p.id} className="flex items-center justify-between p-2 text-sm hover:bg-muted/50 transition-colors">
            <span>{p.name}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={() => removePlayer(p.id)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))
      )}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Manage Ad-Hoc Roster</DialogTitle>
          <DialogDescription>
            Assign players to the {game.gameType} game between {game.awayTeam} and {game.homeTeam}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-2">
          {isLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "home" | "away")} className="w-full">
              <TabsList className="w-full grid grid-cols-2 mb-4">
                <TabsTrigger value="away">Away: {game.awayTeam}</TabsTrigger>
                <TabsTrigger value="home">Home: {game.homeTeam}</TabsTrigger>
              </TabsList>

              <div className="space-y-4">
                {/* Search Box */}
                <div className="relative border rounded-md p-3 bg-muted/20">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                    Add Player to {activeTab === "home" ? game.homeTeam : game.awayTeam}
                  </Label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search player name..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 h-9"
                    />
                  </div>

                  {searchQuery.length >= 2 && (
                    <div className="absolute z-10 w-[calc(100%-24px)] mt-1 bg-popover border shadow-md rounded-md max-h-[200px] overflow-y-auto">
                      {isSearching ? (
                        <div className="p-3 text-center text-sm text-muted-foreground flex items-center justify-center">
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Searching...
                        </div>
                      ) : searchResults.length > 0 ? (
                        <div className="py-1">
                          {searchResults.map(player => (
                            <button
                              key={player.id}
                              onClick={() => addPlayer(player)}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center justify-between group"
                            >
                              <span>{player.name}</span>
                              <UserPlus className="h-4 w-4 opacity-0 group-hover:opacity-100 text-primary transition-opacity" />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="p-3 text-center text-sm text-muted-foreground">
                          No players found matching "{searchQuery}".
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <TabsContent value="away" className="m-0 focus-visible:outline-none">
                  {renderRosterList(awayPlayers)}
                </TabsContent>
                
                <TabsContent value="home" className="m-0 focus-visible:outline-none">
                  {renderRosterList(homePlayers)}
                </TabsContent>
              </div>
            </Tabs>
          )}
        </div>

        <DialogFooter className="shrink-0 pt-4 border-t mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || isLoading}>
            {isSaving ? "Saving..." : "Save Roster"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
