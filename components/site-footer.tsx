"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useAdmin } from "@/lib/admin-context"
import { PinDialog } from "@/components/admin-editor/pin-dialog"
import { SeasonSelector } from "@/components/season-selector"

export function SiteFooter() {
  const { isAdmin, login, logout } = useAdmin()
  const [pinDialogOpen, setPinDialogOpen] = useState(false)

  return (
    <footer className="mt-auto border-t border-border/40 py-6 px-4">
      <div className="mx-auto max-w-6xl flex items-center gap-3">
        <Suspense fallback={null}>
          <SeasonSelector />
        </Suspense>
        <div className="ml-auto flex items-center gap-3">
        <Link href="/scorekeeper" className="text-xs text-muted-foreground/30 hover:text-muted-foreground transition-colors">
          Scorekeeper
        </Link>
        {isAdmin ? (
          <button
            onClick={logout}
            className="text-xs text-muted-foreground/30 hover:text-muted-foreground transition-colors cursor-pointer"
          >
            Exit Admin
          </button>
        ) : (
          <button
            onClick={() => setPinDialogOpen(true)}
            className="text-xs text-muted-foreground/30 hover:text-muted-foreground transition-colors cursor-pointer"
          >
            Admin
          </button>
        )}
        </div>
      </div>
      <PinDialog
        open={pinDialogOpen}
        onOpenChange={setPinDialogOpen}
        onSuccess={(pin) => {
          login(pin)
          setPinDialogOpen(false)
        }}
      />
    </footer>
  )
}
