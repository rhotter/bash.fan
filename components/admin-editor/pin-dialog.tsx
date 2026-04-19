"use client"

import { useState } from "react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export function PinDialog({ open, onOpenChange, gameId, currentState, onSuccess }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  gameId?: string
  currentState?: unknown
  onSuccess: (pin: string) => void
}) {
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")
    try {
      let res: Response
      if (gameId && currentState !== undefined && currentState !== null) {
        // Game-specific: validate PIN by PUTing the current state back (no-op save)
        res = await fetch(`/api/bash/scorekeeper/${gameId}/state`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-pin": pin },
          body: JSON.stringify(currentState),
        })
      } else {
        // Generic PIN validation
        res = await fetch("/api/bash/admin/validate-pin", {
          method: "POST",
          headers: { "x-pin": pin },
        })
      }
      if (res.status === 401) {
        setError("Invalid PIN")
        setLoading(false)
        return
      }
      onSuccess(pin)
      setPin("")
    } catch {
      setError("Connection error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-sm">Admin Authentication</DialogTitle>
          <DialogDescription className="sr-only">Enter your PIN to authenticate.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            type="password"
            placeholder="Enter PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoFocus
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={!pin || loading} className="w-full">
              {loading ? "Verifying..." : "Authenticate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
