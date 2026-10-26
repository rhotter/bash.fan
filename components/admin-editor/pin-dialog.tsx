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
      const res = await fetch("/api/bash/admin/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: pin.trim() }),
      })
      const data = await readApiJson(res)
      if (!res.ok || data.role !== "admin") {
        throw new Error(res.ok ? "An admin passcode is required." : res.status === 401 ? "Invalid passcode. Please try again." : data.error)
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
          <DialogTitle className="text-sm">Admin authentication</DialogTitle>
          <DialogDescription className="sr-only">Enter your admin passcode to authenticate.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            type="password"
            placeholder="Admin passcode"
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
