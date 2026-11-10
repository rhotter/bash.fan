"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/** Shows a Manager Link. It can't be looked up later, so it needs to be saved now. */
export function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}${path}`

  async function copy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
  }

  return (
    <div className="flex gap-2">
      <Input readOnly value={url} aria-label="Manager Link" onFocus={(e) => e.target.select()} />
      <Button type="button" variant="outline" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  )
}
