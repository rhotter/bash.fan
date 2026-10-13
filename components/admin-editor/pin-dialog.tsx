"use client"

import { fetchApi as fetch, readApiJson, errorMessage } from "@/lib/api-errors"

import { useState } from "react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export function PinDialog({ open, onOpenChange, onSuccess }: {
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
      const res = await fetch("/api/bash/admin/validate-pin", {
        method: "POST", headers: { "x-pin": pin.trim() },
      })
      if (!res.ok) {
        const data = await readApiJson(res)
        throw new Error(res.status === 401 ? "Invalid PIN. Please try again." : data.error)
      }
      onSuccess(pin.trim())
      setPin("")
    } catch (error) {
      setError(errorMessage(error, "Connection error"))
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
