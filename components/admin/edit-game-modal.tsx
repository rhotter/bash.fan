"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"

export interface GameFormData {
  id?: string
  date: string
  time: string
  homeTeam: string
  awayTeam: string
  location: string
  gameType: string
  status: string
  homeScore: number | null
  awayScore: number | null
  isOvertime: boolean
  hasShootout: boolean
  isForfeit: boolean
  notes: string | null
  homeNotes: string | null
  awayNotes: string | null
}

interface EditGameModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  game?: GameFormData | null
  teams: { teamSlug: string; teamName: string }[]
  seasonId: string
  defaultLocation: string
  onSaved: () => void
}

export function EditGameModal({
  open,
  onOpenChange,
  game,
  teams,
  seasonId,
  defaultLocation,
  onSaved,
}: EditGameModalProps) {
  const isEditing = !!game?.id

  const [formData, setFormData] = useState<GameFormData>({
    date: "",
    time: "",
    homeTeam: "",
    awayTeam: "",
    location: defaultLocation,
    gameType: "regular",
    status: "upcoming",
    homeScore: null,
    awayScore: null,
    isOvertime: false,
    hasShootout: false,
    isForfeit: false,
    notes: null,
    homeNotes: null,
    awayNotes: null,
  })

  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      if (game) {
        setFormData(game)
      } else {
        setFormData({
          date: new Date().toISOString().split("T")[0],
          time: "12:00p",
          homeTeam: "",
          awayTeam: "",
          location: defaultLocation,
          gameType: "regular",
          status: "upcoming",
          homeScore: null,
          awayScore: null,
          isOvertime: false,
          hasShootout: false,
          isForfeit: false,
          notes: null,
          homeNotes: null,
          awayNotes: null,
        })
      }
    }
  }, [open, game, defaultLocation])

  const handleSubmit = async () => {
    if (!formData.date || !formData.time || !formData.homeTeam || !formData.awayTeam) {
      toast.error("Please fill in all required fields")
      return
    }

    setIsSubmitting(true)
    try {
      const url = isEditing
        ? `/api/bash/admin/seasons/${seasonId}/schedule/${game.id}`
        : `/api/bash/admin/seasons/${seasonId}/schedule`
      const method = isEditing ? "PATCH" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to save game")
      }

      toast.success(isEditing ? "Game updated" : "Game added")
      onSaved()
      onOpenChange(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setIsSubmitting(false)
    }
  }

  // Include the TBD placeholder team
  const allTeams = [{ teamSlug: "tbd", teamName: "(TBD)" }, ...teams]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Game" : "Add Game"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Date *</Label>
              <Input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Time *</Label>
              <Input
                placeholder="e.g., 10:00a or TBD"
                value={formData.time}
                onChange={(e) => setFormData({ ...formData, time: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={formData.status}
                onValueChange={(val) => setFormData({ ...formData, status: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="upcoming">Upcoming</SelectItem>
                  <SelectItem value="live">Live (In Progress)</SelectItem>
                  <SelectItem value="final">Final</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Game Type</Label>
              <Select
                value={formData.gameType}
                onValueChange={(val) => setFormData({ ...formData, gameType: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="regular">Regular Season</SelectItem>
                  <SelectItem value="playoff">Playoff</SelectItem>
                  <SelectItem value="tryout">Tryout</SelectItem>
                  <SelectItem value="practice">Practice</SelectItem>
                  <SelectItem value="exhibition">Exhibition</SelectItem>
                  <SelectItem value="championship">Championship</SelectItem>
                  <SelectItem value="jamboree">Jamboree</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Input
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-5 gap-4 items-end bg-muted/30 p-4 rounded-lg">
            <div className="col-span-2 space-y-2">
              <Label>Away Team *</Label>
              <Select
                value={formData.awayTeam}
                onValueChange={(val) => setFormData({ ...formData, awayTeam: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select team..." />
                </SelectTrigger>
                <SelectContent>
                  {allTeams.map((t) => (
                    <SelectItem key={t.teamSlug} value={t.teamSlug}>
                      {t.teamName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="Score"
                value={formData.awayScore ?? ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    awayScore: e.target.value === "" ? null : parseInt(e.target.value, 10),
                  })
                }
              />
            </div>
            <div className="col-span-1 flex items-center justify-center pb-2 text-sm text-muted-foreground font-medium">
              VS
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Home Team *</Label>
              <Select
                value={formData.homeTeam}
                onValueChange={(val) => setFormData({ ...formData, homeTeam: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select team..." />
                </SelectTrigger>
                <SelectContent>
                  {allTeams.map((t) => (
                    <SelectItem key={t.teamSlug} value={t.teamSlug}>
                      {t.teamName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="Score"
                value={formData.homeScore ?? ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    homeScore: e.target.value === "" ? null : parseInt(e.target.value, 10),
                  })
                }
              />
            </div>
          </div>

          <div className="bg-muted/10 p-4 rounded-lg border">
            <div className="flex flex-wrap gap-8 items-center justify-between sm:justify-start">
              <div className="flex items-center gap-2">
                <Switch
                  id="overtime"
                  checked={formData.isOvertime}
                  onCheckedChange={(checked) => setFormData({ ...formData, isOvertime: checked })}
                />
                <Label htmlFor="overtime">Overtime</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="shootout"
                  checked={formData.hasShootout}
                  onCheckedChange={(checked) => setFormData({ ...formData, hasShootout: checked })}
                />
                <Label htmlFor="shootout">Shootout</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="forfeit"
                  checked={formData.isForfeit}
                  onCheckedChange={(checked) => setFormData({ ...formData, isForfeit: checked })}
                />
                <Label htmlFor="forfeit" className="text-destructive">Forfeit</Label>
              </div>
            </div>
          </div>

          <Tabs defaultValue="league">
            <TabsList className="w-full">
              <TabsTrigger value="league" className="flex-1">League Notes</TabsTrigger>
              <TabsTrigger value="away" className="flex-1">Away Notes</TabsTrigger>
              <TabsTrigger value="home" className="flex-1">Home Notes</TabsTrigger>
            </TabsList>
            <TabsContent value="league">
              <Textarea
                placeholder="Public notes about this game..."
                value={formData.notes || ""}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
              />
            </TabsContent>
            <TabsContent value="away">
              <Textarea
                placeholder="Internal/away team specific notes..."
                value={formData.awayNotes || ""}
                onChange={(e) => setFormData({ ...formData, awayNotes: e.target.value })}
                rows={3}
              />
            </TabsContent>
            <TabsContent value="home">
              <Textarea
                placeholder="Internal/home team specific notes..."
                value={formData.homeNotes || ""}
                onChange={(e) => setFormData({ ...formData, homeNotes: e.target.value })}
                rows={3}
              />
            </TabsContent>
          </Tabs>

        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save Game"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
