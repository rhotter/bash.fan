"use client"

import { useState, useEffect } from "react"
import { Loader2, Trash2, Trophy, Star, Medal, ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"

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

const AWARD_TYPES = [
  "MVP", 
  "Cy Young", 
  "Gold Glove", 
  "Rookie of the Year", 
  "Captain of the Year",
  "Silver Slugger",
  "Playoff MVP",
  "Championship MVP"
]

export function AwardsClient({ seasons, allPlayers }: { seasons: Season[], allPlayers: Player[] }) {
  const [activeTab, setActiveTab] = useState("awards")
  
  // Awards State
  const [awards, setAwards] = useState<Award[]>([])
  const [selectedSeason, setSelectedSeason] = useState<string>(seasons[0]?.id || "")
  const [isAwardsLoading, setIsAwardsLoading] = useState(false)
  const [newAwardType, setNewAwardType] = useState<string>(AWARD_TYPES[0])
  const [newAwardPlayer, setNewAwardPlayer] = useState("")
  const [isAwardsSaving, setIsAwardsSaving] = useState(false)

  // HOF State
  const [hof, setHof] = useState<HOFEntry[]>([])
  const [isHofLoading, setIsHofLoading] = useState(false)
  const [newHofPlayer, setNewHofPlayer] = useState("")
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

  const matchPlayer = (name: string) => {
    return allPlayers.find(p => p.name.toLowerCase() === name.toLowerCase().trim())?.id || null
  }

  const handleAddAward = async () => {
    if (!newAwardPlayer.trim()) return
    setIsAwardsSaving(true)
    try {
      const playerId = matchPlayer(newAwardPlayer)
      const res = await fetch("/api/bash/admin/awards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          playerName: newAwardPlayer, 
          playerId, 
          seasonId: selectedSeason, 
          awardType: newAwardType 
        })
      })
      if (res.ok) {
        toast.success("Award added successfully")
        setNewAwardPlayer("")
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
        setAwards(awards.filter(a => a.id !== id))
        toast.success("Award deleted")
      } else {
        toast.error("Failed to delete award")
      }
    } catch {
      toast.error("Failed to delete award")
    }
  }

  const handleAddHof = async () => {
    if (!newHofPlayer.trim() || !newHofYear) return
    setIsHofSaving(true)
    try {
      const playerId = matchPlayer(newHofPlayer)
      const res = await fetch("/api/bash/admin/hof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          playerName: newHofPlayer, 
          playerId, 
          classYear: newHofYear, 
          wing: newHofWing,
          yearsActive: newHofYearsActive,
          achievements: newHofAchievements
        })
      })
      if (res.ok) {
        toast.success("Inductee added successfully")
        setNewHofPlayer("")
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
        setHof(hof.filter(h => h.id !== id))
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
        <div className="grid grid-cols-1 md:grid-cols-[1fr_350px] gap-6">
          <Card>
            <CardHeader className="pb-3 border-b">
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
                    {seasons.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="pt-0 p-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-4">Player</TableHead>
                    <TableHead>Award</TableHead>
                    <TableHead className="text-right pr-4">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isAwardsLoading ? (
                    <TableRow>
                      <TableCell colSpan={3} className="h-32 text-center text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : awards.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="h-32 text-center text-muted-foreground">
                        No awards assigned for this season yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    awards.map(award => (
                      <TableRow key={award.id}>
                        <TableCell className="font-medium pl-4">
                          {award.playerName}
                          {!award.playerId && (
                            <Badge variant="outline" className="ml-2 text-[9px] text-amber-600 border-amber-200">Unlinked</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="font-medium bg-muted text-foreground">
                            {award.awardType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-4">
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteAward(award.id)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
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
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-lg">Assign Award</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Award Type</label>
                <Select value={newAwardType} onValueChange={setNewAwardType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AWARD_TYPES.map(type => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Player Name</label>
                <Input 
                  placeholder="e.g. Wayne Gretzky" 
                  value={newAwardPlayer}
                  onChange={(e) => setNewAwardPlayer(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddAward() }}
                />
                <p className="text-[10px] text-muted-foreground">
                  The system will automatically link the database ID if the canonical name matches properly.
                </p>
              </div>
              <Button onClick={handleAddAward} disabled={isAwardsSaving || !newAwardPlayer.trim()} className="w-full mt-2">
                {isAwardsSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Star className="h-4 w-4 mr-2" />}
                Save Award
              </Button>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="hof" className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_350px] gap-6">
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle>Inductees</CardTitle>
              <CardDescription>All members of the BASH Hall of Fame.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0 p-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-4">Class</TableHead>
                    <TableHead>Inductee</TableHead>
                    <TableHead>Wing</TableHead>
                    <TableHead className="text-right pr-4">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isHofLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : hof.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                        No inductees found in the Hall of Fame.
                      </TableCell>
                    </TableRow>
                  ) : (
                    hof.map(entry => (
                      <TableRow key={entry.id}>
                        <TableCell className="pl-4 font-mono font-medium">{entry.classYear}</TableCell>
                        <TableCell className="font-medium">
                          {entry.playerName}
                          {!entry.playerId && (
                            <Badge variant="outline" className="ml-2 text-[9px] text-amber-600 border-amber-200">Unlinked</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="capitalize text-muted-foreground text-sm">{entry.wing}</span>
                        </TableCell>
                        <TableCell className="text-right pr-4">
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteHof(entry.id)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
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
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-lg">Induct Member</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Class Year</label>
                  <Input type="number" value={newHofYear} onChange={(e) => setNewHofYear(e.target.value)} />
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
                <label className="text-sm font-medium">Player/Member Name</label>
                <Input 
                  placeholder="e.g. Mario Lemieux" 
                  value={newHofPlayer}
                  onChange={(e) => setNewHofPlayer(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Years Active (Optional)</label>
                <Input 
                  placeholder="e.g. 2015-2025" 
                  value={newHofYearsActive}
                  onChange={(e) => setNewHofYearsActive(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Key Achievements (Optional)</label>
                <Input 
                  placeholder="e.g. 3x Champion, 2x MVP" 
                  value={newHofAchievements}
                  onChange={(e) => setNewHofAchievements(e.target.value)}
                />
              </div>
              <Button onClick={handleAddHof} disabled={isHofSaving || !newHofPlayer.trim()} className="w-full mt-2">
                {isHofSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowUpRight className="h-4 w-4 mr-2" />}
                Confirm Induction
              </Button>
            </CardContent>
          </Card>
        </div>
      </TabsContent>
    </Tabs>
  )
}
