"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/** Shows a Manager Link. It can't be looked up later, so it needs to be saved now. */
export function CopyLink({ path }: { path: string }) {
  // Kept with its path, so a reissued link never reads as copied while the clipboard holds the old one.
  const [attempt, setAttempt] = useState<{ path: string; copied: boolean } | null>(null)
  const url = `${window.location.origin}${path}`
  const current = attempt?.path === path ? attempt : null

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setAttempt({ path, copied: true })
    } catch (error) {
      console.error("Could not copy the Manager Link:", error)
      setAttempt({ path, copied: false })
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input readOnly value={url} aria-label="Manager Link" onFocus={(e) => e.target.select()} />
        <Button type="button" variant="outline" onClick={copy}>
          {current?.copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {current && !current.copied && (
        <p role="alert" className="text-sm text-destructive">Couldn&apos;t copy. Select the link and copy it yourself.</p>
      )}
    </div>
  )
}
