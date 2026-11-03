"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CopyLink } from "@/components/fantasy/copy-link"
import { errorMessage, fetchApi, readApiJson } from "@/lib/api-errors"

/** Rename, reissue the link, or remove one Manager. */
export function FantasyManagerActions({
  seasonId,
  manager,
  backHref,
}: {
  seasonId: string
  backHref: string
  manager: { id: number; teamName: string; duplicate: boolean }
}) {
  const router = useRouter()
  const url = `/api/bash/admin/seasons/${seasonId}/fantasy/managers/${manager.id}`
  const [renaming, setRenaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reissuedPath, setReissuedPath] = useState<string | null>(null)

  /** Runs a change, shows any failure, and returns the response body on success. */
  async function act(target: string, method: string, payload?: unknown) {
    setError(null)
    try {
      const response = await fetchApi(target, {
        method,
        headers: { "Content-Type": "application/json" },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      })
      const body = await readApiJson(response)
      if (!response.ok) {
        setError(body.error)
        return null
      }
      return body
    } catch (err) {
      setError(errorMessage(err))
      return null
    }
  }

  async function rename() {
    if (renaming === null || !(await act(url, "PATCH", { teamName: renaming }))) return
    setRenaming(null)
    router.refresh()
  }

  async function reissue() {
    if (!window.confirm(`Reissue the link for ${manager.teamName}? Their old link stops working.`)) return
    const body = await act(`${url}/reissue`, "POST")
    if (body) setReissuedPath(body.managerPath)
  }

  async function remove() {
    if (!window.confirm(`Remove ${manager.teamName} and delete their Lineups? This can't be undone.`)) return
    if (await act(url, "DELETE")) router.push(backHref)
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Manage</h2>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {manager.duplicate && <Badge variant="outline">Duplicate name</Badge>}
      {reissuedPath && (
        <div className="space-y-2 rounded-md border border-border p-4">
          <p className="text-sm font-medium">New link. It&apos;s shown only once, so send it to them now.</p>
          <CopyLink path={reissuedPath} />
        </div>
      )}
      {renaming !== null ? (
        <div className="flex max-w-md gap-2">
          <Input aria-label="New Team Name" maxLength={40} value={renaming} onChange={(e) => setRenaming(e.target.value)} />
          <Button size="sm" onClick={rename}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setRenaming(manager.teamName)}>Rename</Button>
          <Button size="sm" variant="outline" onClick={reissue}>Reissue link</Button>
          <Button size="sm" variant="outline" onClick={remove}>Remove</Button>
        </div>
      )}
    </section>
  )
}
