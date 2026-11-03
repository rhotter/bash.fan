"use client"

import Link from "next/link"
import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { errorMessage, fetchApi, readApiJson } from "@/lib/api-errors"
import { CopyLink } from "./copy-link"

export function RegistrationForm({ contest }: { contest: string }) {
  const [fields, setFields] = useState({ teamName: "", firstName: "", lastName: "" })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [managerPath, setManagerPath] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const response = await fetchApi(`/api/bash/fantasy/register?contest=${encodeURIComponent(contest)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      })
      const body = await readApiJson(response)
      if (!response.ok) setError(body.error ?? "Could not register.")
      else if (typeof body.managerPath === "string") setManagerPath(body.managerPath)
      else setError("You’re registered, but the server didn’t return your Manager Link. Ask an admin to reissue it.")
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (managerPath) {
    return (
      <div className="mt-6 space-y-4">
        <p className="text-sm font-medium">
          You&apos;re in. Save your Manager Link now: it&apos;s shown only once, and it&apos;s how you set your Lineup.
        </p>
        <CopyLink path={managerPath} />
        <Button asChild>
          <Link href={managerPath} prefetch={false}>Set your Lineup</Link>
        </Button>
      </div>
    )
  }

  const field = (name: keyof typeof fields, label: string, maxLength: number) => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        required
        maxLength={maxLength}
        value={fields[name]}
        onChange={(e) => setFields({ ...fields, [name]: e.target.value })}
      />
    </div>
  )

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      {field("teamName", "Team Name", 40)}
      {field("firstName", "First name", 60)}
      {field("lastName", "Last name", 60)}
      <p className="text-sm text-muted-foreground">
        Use your real name. It stays private, and it&apos;s the only way we can reissue your Manager Link if you lose it,
        so please don&apos;t make one up.
      </p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={saving}>{saving ? "Registering…" : "Register"}</Button>
    </form>
  )
}
