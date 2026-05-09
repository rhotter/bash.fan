"use client"

import { useState, useEffect } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface DraftInstance {
  id: string
  name: string
  draftType: string
  rounds: number
  timerSeconds: number
  maxKeepers: number
  draftDate: string | null
  location: string | null
  status: string
}

interface EditDraftModalProps {
  draft: DraftInstance | null
  seasonId: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: () => void
}

export function EditDraftModal({ draft, seasonId, isOpen, onOpenChange, onUpdate }: EditDraftModalProps) {
  const [isSaving, setIsSaving] = useState(false)
  
  // Form state
  const [name, setName] = useState(draft?.name || "")
  const [rounds, setRounds] = useState(draft?.rounds.toString() || "")
  const [timerSeconds, setTimerSeconds] = useState(draft?.timerSeconds.toString() || "")
  const [maxKeepers, setMaxKeepers] = useState(draft?.maxKeepers.toString() || "")
  const [draftType, setDraftType] = useState(draft?.draftType || "snake")
  const [draftDate, setDraftDate] = useState(draft?.draftDate ? new Date(draft.draftDate).toISOString().slice(0, 16) : "")
  const [location, setLocation] = useState(draft?.location || "")

  // Reset state when draft changes
  useEffect(() => {
    if (draft) {
      setName(draft.name)
      setRounds(draft.rounds.toString())
      setTimerSeconds(draft.timerSeconds.toString())
      setMaxKeepers(draft.maxKeepers.toString())
      setDraftType(draft.draftType)
      setDraftDate(draft.draftDate ? new Date(draft.draftDate).toISOString().slice(0, 16) : "")
      setLocation(draft.location || "")
    }
  }, [draft])

  if (!draft) return null

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const payload = {
        name,
        rounds: parseInt(rounds, 10),
        timerSeconds: parseInt(timerSeconds, 10),
        maxKeepers: parseInt(maxKeepers, 10),
        draftType,
        location,
        draftDate: draftDate ? new Date(draftDate).toISOString() : null,
      }

      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/draft/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || "Failed to update draft settings")
      } else {
        toast.success("Draft settings updated")
        onUpdate()
        onOpenChange(false)
      }
    } catch {
      toast.error("Failed to update draft settings")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Draft Settings</DialogTitle>
          <DialogDescription>
            Update the settings for &ldquo;{draft.name}&rdquo;.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="draft-name">Draft Name</Label>
            <Input
              id="draft-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 2026 Summer Draft"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="draft-rounds">Total Rounds</Label>
              <Input
                id="draft-rounds"
                type="number"
                min="1"
                max="30"
                value={rounds}
                onChange={(e) => setRounds(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="draft-max-keepers">Max Keepers</Label>
              <Input
                id="draft-max-keepers"
                type="number"
                min="0"
                max="10"
                value={maxKeepers}
                onChange={(e) => setMaxKeepers(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="draft-timer">Pick Timer (seconds)</Label>
              <Input
                id="draft-timer"
                type="number"
                min="10"
                max="300"
                value={timerSeconds}
                onChange={(e) => setTimerSeconds(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="draft-type">Draft Type</Label>
              <Select value={draftType} onValueChange={setDraftType}>
                <SelectTrigger id="draft-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="snake">Snake</SelectItem>
                  <SelectItem value="linear">Linear</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="draft-date">Draft Date & Time</Label>
            <Input
              id="draft-date"
              type="datetime-local"
              value={draftDate}
              onChange={(e) => setDraftDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="draft-location">Location (optional)</Label>
            <Input
              id="draft-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Discord, Rink"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
