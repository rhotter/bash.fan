"use client"

import { Spinner } from "@/components/ui/spinner"
import { useEffect, useState } from "react"
import { ArrowUpRight, Check, ChevronsUpDown, Medal, Star, Trash2, Trophy, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

interface Season {
  id: string
  name: string
}

interface Player {
  id: number
  name: string
}

interface Award {
  id: number
  playerName: string
  playerId: number | null
  seasonId: string
  awardType: string
}

interface HOFEntry {
  id: number
  playerName: string
  playerId: number | null
  classYear: number
  wing: string
  yearsActive: string | null
  achievements: string | null
}

interface PlayerPickerProps {
  players: Player[]
  selectedPlayerId: number | null
  onSelect: (player: Player | null) => void
  placeholder: string
}

const AWARD_TYPES = [
  "MVP",
  "Cy Young",
  "Gold Glove",
  "Rookie of the Year",
  "Captain of the Year",
  "Silver Slugger",
  "Playoff MVP",
  "Championship MVP",
]

function PlayerPicker({ players, selectedPlayerId, onSelect, placeholder }: PlayerPickerProps) {
  const [open, setOpen] = useState(false)
  const selectedPlayer = players.find((player) => player.id === selectedPlayerId) ?? null

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", !selectedPlayer && "text-muted-foreground")}>
              {selectedPlayer?.name ?? placeholder}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start">
          <Command shouldFilter>
            <CommandInput placeholder="Search players..." />
            <CommandList>
              <CommandEmpty>No players found.</CommandEmpty>
              <CommandGroup>
                {players.map((player) => (
                  <CommandItem
                    key={player.id}
                    value={player.name}
                    onSelect={() => {
                      onSelect(player)
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedPlayerId === player.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="truncate">{player.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedPlayer ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onSelect(null)}
          aria-label="Clear selected player"
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  )
}

export function AwardsClient({ seasons, allPlayers }: { seasons: Season[]; allPlayers: Player[] }) {
  const [activeTab, setActiveTab] = useState("awards")
  const players = [...allPlayers].sort((a, b) => a.name.localeCompare(b.name))

  const [awards, setAwards] = useState<Award[]>([])
  const [selectedSeason, setSelectedSeason] = useState<string>(seasons[0]?.id || "")
  const [isAwardsLoading, setIsAwardsLoading] = useState(false)
  const [newAwardType, setNewAwardType] = useState<string>(AWARD_TYPES[0])
  const [selectedAwardPlayerId, setSelectedAwardPlayerId] = useState<number | null>(null)
  const [isAwardsSaving, setIsAwardsSaving] = useState(false)

  const [hof, setHof] = useState<HOFEntry[]>([])
  const [isHofLoading, setIsHofLoading] = useState(false)
  const [selectedHofPlayerId, setSelectedHofPlayerId] = useState<number | null>(null)
  const [customHofPlayerName, setCustomHofPlayerName] = useState("")
  const [newHofYear, setNewHofYear] = useState<string>(new Date().getFullYear().toString())
  const [newHofWing, setNewHofWing] = useState("players")
  const [newHofYearsActive, setNewHofYearsActive] = useState("")
  const [newHofAchievements, setNewHofAchievements] = useState("")
  const [isHofSaving, setIsHofSaving] = useState(false)

  useEffect(() => {
    if (activeTab === "awards" && selectedSeason) {
      fetchAwards()
    } else if (activeTab === "hof" && hof.length === 0) {
      fetchHof()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedSeason])

  const fetchAwards = async () => {
    setIsAwardsLoading(true)
    try {
      const res = await fetch(`/api/bash/admin/awards?seasonId=${selectedSeason}`)
      if (res.ok) {
        const data = await res.json()
        setAwards(data.awards || [])
      }
    } catch {
      toast.error("Failed to fetch awards")
    } finally {
      setIsAwardsLoading(false)
    }
  }

  const fetchHof = async () => {
    setIsHofLoading(true)
    try {
      const res = await fetch("/api/bash/admin/hof")
      if (res.ok) {
        const data = await res.json()
        setHof(data.hallOfFame || [])
      }
    } catch {
      toast.error("Failed to fetch Hall of Fame")
    } finally {
      setIsHofLoading(false)
    }
  }

  const handleAddAward = async () => {
    const selectedPlayer = players.find((player) => player.id === selectedAwardPlayerId) ?? null
    const playerName = selectedPlayer?.name ?? ""

    if (!playerName) return

    setIsAwardsSaving(true)
    try {
      const res = await fetch("/api/bash/admin/awards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerName,
          playerId: selectedPlayer?.id ?? null,
          seasonId: selectedSeason,
          awardType: newAwardType,
        }),
      })
      if (res.ok) {
        toast.success("Award added successfully")
        setSelectedAwardPlayerId(null)
        fetchAwards()
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to add award")
      }
    } catch {
      toast.error("Failed to add award")
    } finally {
      setIsAwardsSaving(false)
    }
  }

  const handleDeleteAward = async (id: number) => {
    if (!confirm("Are you sure you want to delete this award?")) return
    try {
      const res = await fetch(`/api/bash/admin/awards/${id}`, { method: "DELETE" })
      if (res.ok) {
        setAwards(awards.filter((award) => award.id !== id))
        toast.success("Award deleted")
      } else {
        toast.error("Failed to delete award")
      }
    } catch {
      toast.error("Failed to delete award")
    }
  }

  const handleAddHof = async () => {
    const selectedPlayer = players.find((player) => player.id === selectedHofPlayerId) ?? null
    const playerName = selectedPlayer?.name ?? customHofPlayerName.trim()

    if (!playerName || !newHofYear) return

    setIsHofSaving(true)
    try {
      const res = await fetch("/api/bash/admin/hof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerName,
          playerId: selectedPlayer?.id ?? null,
          classYear: newHofYear,
          wing: newHofWing,
          yearsActive: newHofYearsActive,
          achievements: newHofAchievements,
        }),
      })
      if (res.ok) {
        toast.success("Inductee added successfully")
        setSelectedHofPlayerId(null)
        setCustomHofPlayerName("")
        setNewHofYearsActive("")
        setNewHofAchievements("")
        fetchHof()
      } else {
        const err = await res.json()
        toast.error(err.error || "Failed to add inductee")
      }
    } catch {
      toast.error("Failed to add inductee")
    } finally {
      setIsHofSaving(false)
    }
  }

  const handleDeleteHof = async (id: number) => {
    if (!confirm("Are you sure you want to remove this inductee?")) return
    try {
      const res = await fetch(`/api/bash/admin/hof/${id}`, { method: "DELETE" })
      if (res.ok) {
        setHof(hof.filter((entry) => entry.id !== id))
        toast.success("Inductee removed")
      } else {
        toast.error("Failed to remove inductee")
      }
    } catch {
      toast.error("Failed to remove inductee")
    }
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="awards" className="flex items-center gap-2">
          <Medal className="h-4 w-4" /> Season Awards
        </TabsTrigger>
        <TabsTrigger value="hof" className="flex items-center gap-2">
          <Trophy className="h-4 w-4" /> Hall of Fame
        </TabsTrigger>
      </TabsList>

      <TabsContent value="awards" className="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_350px]">
          <Card>
            <CardHeader className="border-b pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Awards Roster</CardTitle>
                  <CardDescription>View and manage awards for a specific season.</CardDescription>
                </div>
                <Select value={selectedSeason} onValueChange={setSelectedSeason}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Select a season" />
                  </SelectTrigger>
                  <SelectContent>
                    {seasons.map((season) => (
                      <SelectItem key={season.id} value={season.id}>
                        {season.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0 pt-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-4">Player</TableHead>
                    <TableHead>Award</TableHead>
                    <TableHead className="pr-4 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isAwardsLoading ? (
                    <TableRow>
                      <TableCell colSpan={3} className="h-32 text-center text-muted-foreground">
                        <Spinner className="mx-auto h-5 w-5" />
                      </TableCell>
                    </TableRow>
                  ) : awards.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="h-32 text-center text-muted-foreground">
                        No awards assigned for this season yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    awards.map((award) => (
                      <TableRow key={award.id}>
                        <TableCell className="pl-4 font-medium">
                          {award.playerName}
                          {!award.playerId ? (
                            <Badge variant="outline" className="ml-2 border-amber-200 text-[9px] text-amber-600">
                              Unlinked
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="bg-muted font-medium text-foreground">
                            {award.awardType}
                          </Badge>
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteAward(award.id)}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-lg">Assign Award</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Award Type</label>
                <Select value={newAwardType} onValueChange={setNewAwardType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AWARD_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Player</label>
                <PlayerPicker
                  players={players}
                  selectedPlayerId={selectedAwardPlayerId}
                  onSelect={(player) => setSelectedAwardPlayerId(player?.id ?? null)}
                  placeholder="Select a player"
                />
              </div>
              <Button
                onClick={handleAddAward}
                disabled={isAwardsSaving || !selectedAwardPlayerId}
                className="mt-2 w-full"
              >
                {isAwardsSaving ? (
                  <Spinner className="mr-2 h-4 w-4" />
                ) : (
                  <Star className="mr-2 h-4 w-4" />
                )}
                Save Award
              </Button>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="hof" className="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_350px]">
          <Card>
            <CardHeader className="border-b pb-3">
              <CardTitle>Inductees</CardTitle>
              <CardDescription>All members of the BASH Hall of Fame.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 pt-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-4">Class</TableHead>
                    <TableHead>Inductee</TableHead>
                    <TableHead>Wing</TableHead>
                    <TableHead className="pr-4 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isHofLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                        <Spinner className="mx-auto h-5 w-5" />
                      </TableCell>
                    </TableRow>
                  ) : hof.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                        No inductees found in the Hall of Fame.
                      </TableCell>
                    </TableRow>
                  ) : (
                    hof.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="pl-4 font-mono font-medium">{entry.classYear}</TableCell>
                        <TableCell className="font-medium">
                          {entry.playerName}
                          {!entry.playerId ? (
                            <Badge variant="outline" className="ml-2 border-amber-200 text-[9px] text-amber-600">
                              Unlinked
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm capitalize text-muted-foreground">{entry.wing}</span>
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteHof(entry.id)}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-lg">Induct Member</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Class Year</label>
                  <Input type="number" value={newHofYear} onChange={(event) => setNewHofYear(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Wing</label>
                  <Select value={newHofWing} onValueChange={setNewHofWing}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="players">Players</SelectItem>
                      <SelectItem value="builders">Builders</SelectItem>
                      <SelectItem value="officials">Officials</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Linked Player (Optional)</label>
                <PlayerPicker
                  players={players}
                  selectedPlayerId={selectedHofPlayerId}
                  onSelect={(player) => setSelectedHofPlayerId(player?.id ?? null)}
                  placeholder="Select a player"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Player/Member Name</label>
                <Input
                  placeholder="e.g. Mario Lemieux or a builder/officiating name"
                  value={customHofPlayerName}
                  onChange={(event) => setCustomHofPlayerName(event.target.value)}
                  disabled={selectedHofPlayerId !== null}
                />
                <p className="text-[10px] text-muted-foreground">
                  Leave this blank when you pick a linked player. Use it for builders or officials not in the player database.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Years Active (Optional)</label>
                <Input
                  placeholder="e.g. 2015-2025"
                  value={newHofYearsActive}
                  onChange={(event) => setNewHofYearsActive(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Key Achievements (Optional)</label>
                <Input
                  placeholder="e.g. 3x Champion, 2x MVP"
                  value={newHofAchievements}
                  onChange={(event) => setNewHofAchievements(event.target.value)}
                />
              </div>
              <Button
                onClick={handleAddHof}
                disabled={isHofSaving || (!selectedHofPlayerId && !customHofPlayerName.trim())}
                className="mt-2 w-full"
              >
                {isHofSaving ? (
                  <Spinner className="mr-2 h-4 w-4" />
                ) : (
                  <ArrowUpRight className="mr-2 h-4 w-4" />
                )}
                Confirm Induction
              </Button>
            </CardContent>
          </Card>
        </div>
      </TabsContent>
    </Tabs>
  )
}
