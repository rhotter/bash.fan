"use client"

import { useState, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Upload, FileCheck, AlertTriangle, Loader2 } from "lucide-react"
import { SkillBadge } from "./draft-player-card"

interface ImportStats {
  totalParsed: number
  existingPlayers: number
  newPlayers: number
  alreadyInPool: number
  willAdd: number
  skillBreakdown: Record<string, number>
}

interface MappedPoolPlayer {
  playerName: string
  registrationMeta: Record<string, unknown>
  existingPlayerId: number | null
  isNew: boolean
  alreadyInPool: boolean
}

interface DraftPoolImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  seasonId: string
  draftId: string
  onImportComplete?: () => void
}

export function DraftPoolImportModal({
  open,
  onOpenChange,
  seasonId,
  draftId,
  onImportComplete,
}: DraftPoolImportModalProps) {
  const [step, setStep] = useState<"upload" | "preview" | "importing" | "done">("upload")
  const [file, setFile] = useState<File | null>(null)
  const [stats, setStats] = useState<ImportStats | null>(null)
  const [players, setPlayers] = useState<MappedPoolPlayer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ added: number; created: number; skipped: number; removed?: number } | null>(null)
  const [importMode, setImportMode] = useState<"append" | "overwrite">("append")

  const reset = useCallback(() => {
    setStep("upload")
    setFile(null)
    setStats(null)
    setPlayers([])
    setError(null)
    setResult(null)
    setImportMode("append")
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) {
      setFile(f)
      setError(null)
    }
  }

  const handlePreview = async () => {
    if (!file) return
    setError(null)

    try {
      const formData = new FormData()
      formData.append("file", file)

      const res = await fetch(
        `/api/bash/admin/seasons/${seasonId}/draft/${draftId}/pool/import-csv?action=preview`,
        { method: "POST", body: formData }
      )

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Failed to parse CSV")
        return
      }

      const data = await res.json()
      setStats(data.stats)
      setPlayers(data.mappedPlayers)
      setStep("preview")
    } catch {
      setError("Failed to upload file. Please try again.")
    }
  }

  const handleConfirm = async () => {
    setStep("importing")
    setError(null)

    try {
      const res = await fetch(
        `/api/bash/admin/seasons/${seasonId}/draft/${draftId}/pool/import-csv?action=confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ players, mode: importMode }),
        }
      )

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Import failed")
        setStep("preview")
        return
      }

      const data = await res.json()
      setResult(data)
      setStep("done")
      onImportComplete?.()
    } catch {
      setError("Import failed. Please try again.")
      setStep("preview")
    }
  }

  const handleClose = (open: boolean) => {
    if (!open) reset()
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import Sportability CSV
          </DialogTitle>
          <DialogDescription>
            {step === "upload" && "Upload a Sportability registration CSV to enrich draft pool players with skill level, position, and other registration data."}
            {step === "preview" && "Review the parsed registration data before applying to the pool."}
            {step === "importing" && "Applying registration data to draft pool..."}
            {step === "done" && "Import complete!"}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Step 1: Upload */}
        {step === "upload" && (
          <div className="space-y-4">
            <div className="border-2 border-dashed border-muted rounded-lg p-6 text-center">
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
                id="csv-upload"
              />
              <label
                htmlFor="csv-upload"
                className="cursor-pointer flex flex-col items-center gap-2"
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {file ? file.name : "Click to select CSV file"}
                </span>
              </label>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button onClick={handlePreview} disabled={!file}>
                Preview Import
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === "preview" && stats && (
          <div className="space-y-4">
            {/* Summary line */}
            <p className="text-sm text-muted-foreground">
              Parsed <strong>{stats.totalParsed}</strong> players from CSV.
              {stats.alreadyInPool > 0 && <> <strong>{stats.alreadyInPool}</strong> already in pool.</>}
              {stats.willAdd > 0 && <> <strong>{stats.willAdd}</strong> new to pool.</>}
            </p>

            {/* Warnings */}
            {stats.newPlayers > 0 && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {stats.newPlayers} new player record{stats.newPlayers > 1 ? "s" : ""} will be created.
              </div>
            )}
            {stats.alreadyInPool > 0 && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200 text-sm">
                <FileCheck className="h-4 w-4 shrink-0" />
                {stats.alreadyInPool} player{stats.alreadyInPool > 1 ? "s" : ""} already in pool — their registration data will be updated.
              </div>
            )}

            {/* Player list preview (first 20) */}
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Players ({players.length})
              </h4>
              <div className="max-h-48 overflow-y-auto border rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0 z-10">
                    <tr>
                      <th className="text-left p-2 font-medium">Name</th>
                      <th className="text-left p-2 font-medium">Skill</th>
                      <th className="text-left p-2 font-medium">Pos</th>
                      <th className="text-left p-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {players.slice(0, 50).map((p, i) => {
                      const meta = p.registrationMeta as Record<string, unknown>
                      return (
                        <tr key={i} className="border-t">
                          <td className="p-2">{p.playerName}</td>
                          <td className="p-2">
                            <SkillBadge skillLevel={meta?.skillLevel as string || null} />
                          </td>
                          <td className="p-2 text-muted-foreground">
                            {(meta?.positions as string) || "—"}
                          </td>
                          <td className="p-2">
                            {p.alreadyInPool && (
                              <Badge variant="outline" className="text-xs">In Pool</Badge>
                            )}
                            {p.isNew && (
                              <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700">New</Badge>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Import mode toggle */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">Import Mode</Label>
              <RadioGroup
                value={importMode}
                onValueChange={(v) => setImportMode(v as "append" | "overwrite")}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="append" id="mode-append" />
                  <Label htmlFor="mode-append" className="font-normal cursor-pointer text-sm">Append</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="overwrite" id="mode-overwrite" />
                  <Label htmlFor="mode-overwrite" className="font-normal cursor-pointer text-sm">Overwrite</Label>
                </div>
              </RadioGroup>
              <p className="text-[10px] text-muted-foreground">
                {importMode === "append"
                  ? "Enrich existing pool players and add any new ones. Does not remove anyone."
                  : "Replace pool with only the players in this CSV. Players not in the CSV will be removed."}
              </p>
            </div>

            {importMode === "overwrite" && stats.alreadyInPool < stats.totalParsed && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Pool players not matched in this CSV will be removed from the draft pool.
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Back
              </Button>
              <Button onClick={handleConfirm} variant={importMode === "overwrite" ? "destructive" : "default"}>
                {importMode === "overwrite" ? "Overwrite Pool" : "Apply Registration Data"} ({players.length})
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 3: Importing */}
        {step === "importing" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Importing players...</p>
          </div>
        )}

        {/* Step 4: Done */}
        {step === "done" && result && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2 py-4">
              <FileCheck className="h-10 w-10 text-emerald-500" />
              <p className="text-lg font-semibold">Import Complete</p>
            </div>

            <div className={`grid ${result.removed !== undefined ? 'grid-cols-4' : 'grid-cols-3'} gap-3 text-center`}>
              <div className="p-3 rounded-md bg-muted/50">
                <p className="text-xl font-bold">{result.skipped}</p>
                <p className="text-xs text-muted-foreground">Enriched</p>
              </div>
              <div className="p-3 rounded-md bg-muted/50">
                <p className="text-xl font-bold">{result.added}</p>
                <p className="text-xs text-muted-foreground">Added to Pool</p>
              </div>
              <div className="p-3 rounded-md bg-muted/50">
                <p className="text-xl font-bold">{result.created}</p>
                <p className="text-xs text-muted-foreground">New Players</p>
              </div>
              {result.removed !== undefined && (
                <div className="p-3 rounded-md bg-destructive/10">
                  <p className="text-xl font-bold text-destructive">{result.removed}</p>
                  <p className="text-xs text-muted-foreground">Removed</p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button onClick={() => handleClose(false)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
