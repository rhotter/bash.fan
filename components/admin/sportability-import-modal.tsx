import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { Upload, FileUp, Loader2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"

interface SportabilityImportModalProps {
  seasonId: string
  seasonStatus: string
}

export function SportabilityImportModal({ seasonId, seasonStatus }: SportabilityImportModalProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [step, setStep] = useState<"upload" | "preview">("upload")
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Preview Data
  const [stats, setStats] = useState<Record<string, number> | null>(null)
  const [mappedPlayers, setMappedPlayers] = useState<{ playerName: string; teamSlug: string; isGoalie: boolean; isRookie: boolean; [key: string]: unknown }[]>([])

  const resetState = () => {
    setStep("upload")
    setStats(null)
    setMappedPlayers([])
    setIsProcessing(false)
    setErrorMsg(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) resetState()
    setIsOpen(open)
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsProcessing(true)
    setErrorMsg(null)
    try {
      const formData = new FormData()
      formData.append("file", file)

      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/roster/import-preview`, {
        method: "POST",
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to parse file")
      }

      setStats(data.stats)
      setMappedPlayers(data.mappedPlayers)
      setStep("preview")
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err))
      setErrorMsg(error.message)
      toast.error(error.message)
      if (fileInputRef.current) fileInputRef.current.value = ""
    } finally {
      setIsProcessing(false)
    }
  }

  const executeImport = async (mode: "overwrite" | "append") => {
    setIsProcessing(true)
    setErrorMsg(null)
    try {
      const res = await fetch(`/api/bash/admin/seasons/${seasonId}/roster/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          players: mappedPlayers,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to import roster")
      }

      toast.success(`Successfully imported ${data.count} players!`)
      setIsOpen(false)
      resetState()
      router.refresh()
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err))
      setErrorMsg(error.message)
      toast.error(error.message)
    } finally {
      setIsProcessing(false)
    }
  }

  if (seasonStatus !== "draft") return null

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="h-4 w-4 mr-2" />
          Sportability Import
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        {step === "upload" && (
          <>
            <DialogHeader>
              <DialogTitle>Import Sportability Roster</DialogTitle>
              <DialogDescription>
                Import players from a Sportability export file.
              </DialogDescription>
            </DialogHeader>

            <div className="text-sm space-y-1.5 text-muted-foreground bg-muted/40 border rounded-md p-3">
              <p className="font-medium text-foreground text-xs uppercase tracking-wider">How to prepare your file</p>
              <ol className="list-decimal list-inside space-y-0.5 text-xs">
                <li>In Sportability, go to <strong>Players → Export</strong> and download the <code>.xlsx</code> file</li>
                <li>Open the file in Excel or Google Sheets</li>
                <li>Save / export as <strong>CSV (.csv)</strong> format</li>
                <li>Upload the <code>.csv</code> file below</li>
              </ol>
            </div>

            <div className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-10 text-center space-y-4">
              <div className="rounded-full bg-primary/10 p-4">
                <FileUp className="h-8 w-8 text-primary" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Click to upload or drag and drop</p>
                <p className="text-xs text-muted-foreground">.csv files only</p>
              </div>
              <input
                type="file"
                accept=".csv"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileUpload}
              />
              <Button 
                variant="secondary" 
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
              >
                {isProcessing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Select File
              </Button>
            </div>
            
            {errorMsg && (
              <Alert variant="destructive" className="mt-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm font-medium">
                  {errorMsg}
                </AlertDescription>
              </Alert>
            )}
          </>
        )}

        {step === "preview" && stats && (
          <>
            <DialogHeader>
              <DialogTitle>Review Import</DialogTitle>
              <DialogDescription>
                Review the parsed roster data before finalizing the import.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="border rounded-md p-3 flex flex-col justify-center items-center">
                <div className="text-3xl font-bold">{stats.totalInImport}</div>
                <div className="text-xs text-muted-foreground font-medium mt-1">Total Parsed</div>
              </div>
              
              <div className="border rounded-md p-3 bg-blue-50/50 flex flex-col justify-between">
                <div className="text-[10px] text-blue-600 font-bold uppercase tracking-wider mb-2 text-center">Global Database</div>
                <div className="flex justify-between items-center px-1">
                  <div className="text-center">
                    <div className="text-xl font-bold text-blue-700">{stats.globalExisting}</div>
                    <div className="text-[10px] text-blue-600/80 font-medium">Matches</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-blue-700">+{stats.globalNew}</div>
                    <div className="text-[10px] text-blue-600/80 font-medium">To Create</div>
                  </div>
                </div>
              </div>

              <div className="border rounded-md p-3 bg-green-50/50 flex flex-col justify-between">
                <div className="text-[10px] text-green-700 font-bold uppercase tracking-wider mb-2 text-center">Season Roster</div>
                <div className="flex justify-between items-center px-1">
                  <div className="text-center">
                    <div className="text-xl font-bold text-green-700">{stats.seasonExisting}</div>
                    <div className="text-[10px] text-green-700/80 font-medium">Matches</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-green-700">+{stats.seasonNew}</div>
                    <div className="text-[10px] text-green-700/80 font-medium">To Add</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="border rounded-md">
              <div className="bg-muted px-4 py-2 text-xs font-semibold grid grid-cols-12 gap-4">
                <div className="col-span-5">Player</div>
                <div className="col-span-4">Team</div>
                <div className="col-span-3 text-right">Flags</div>
              </div>
              <ScrollArea className="h-[250px]">
                {mappedPlayers.map((p, i) => (
                  <div key={i} className="px-4 py-2 border-t text-sm grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-5 truncate font-medium">{p.playerName}</div>
                    <div className="col-span-4 truncate text-muted-foreground">
                      {p.teamSlug === 'tbd' ? 'Unassigned' : p.teamSlug}
                    </div>
                    <div className="col-span-3 flex justify-end gap-1">
                      {p.isGoalie && <Badge variant="outline" className="text-[10px] px-1 py-0">Goalie</Badge>}
                      {p.isRookie && <Badge className="text-[10px] px-1 py-0 bg-green-600">Rookie</Badge>}
                    </div>
                  </div>
                ))}
              </ScrollArea>
            </div>

            <Alert variant="default" className="mt-4 bg-muted/50 border-none">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Overwrite</strong> will completely replace the current season roster. <br/>
                <strong>Append</strong> will keep existing players in the current season, and only append net new players.
              </AlertDescription>
            </Alert>

            <DialogFooter className="mt-6 sm:justify-between">
              <Button variant="ghost" onClick={resetState} disabled={isProcessing}>
                Cancel
              </Button>
              <div className="flex space-x-2">
                <Button 
                  variant="outline" 
                  onClick={() => executeImport("append")}
                  disabled={isProcessing}
                >
                  {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Append"}
                </Button>
                <Button 
                  variant="default"
                  onClick={() => executeImport("overwrite")}
                  disabled={isProcessing}
                >
                  {isProcessing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Overwrite
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
