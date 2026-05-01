"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

export function SignupForm({ callbackUrl }: { callbackUrl: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (formData: FormData) => {
    setError(null)
    setBusy(true)
    try {
      const email = (formData.get("email") ?? "").toString().trim()
      const password = (formData.get("password") ?? "").toString()
      const name = (formData.get("name") ?? "").toString().trim()

      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || "Signup failed")
        return
      }

      toast.success("Account created. Signing you in…")
      await signIn("credentials", { email, password, redirectTo: callbackUrl })
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form action={handleSubmit} className="space-y-3">
      {error && (
        <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-md border border-destructive/30">
          {error}
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" placeholder="Wayne Gretzky" autoComplete="name" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <p className="text-[11px] text-muted-foreground">At least 8 characters.</p>
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Create account
      </Button>
    </form>
  )
}
