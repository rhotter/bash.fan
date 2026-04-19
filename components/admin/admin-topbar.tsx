"use client"

import Image from "next/image"
import Link from "next/link"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { LogOut } from "lucide-react"

export function AdminTopbar() {
  function handleLogout() {
    fetch("/api/bash/admin/logout", { method: "POST" }).then(() => {
      window.location.href = "/"
    })
  }

  return (
    <header className="shrink-0">
      {/* Orange admin indicator bar */}
      <div className="bg-primary text-primary-foreground px-4 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Image src="/logo.png" alt="BASH" width={18} height={18} />
          <span className="text-xs font-bold tracking-wide uppercase">Admin Dashboard</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-xs font-medium text-primary-foreground/70 hover:text-primary-foreground transition-colors"
          >
            View Public Site
          </Link>
          <button
            onClick={handleLogout}
            className="text-xs font-medium text-primary-foreground/70 hover:text-primary-foreground transition-colors flex items-center gap-1 cursor-pointer"
          >
            <LogOut className="h-3 w-3" />
            Logout
          </button>
        </div>
      </div>
      {/* Standard topbar with sidebar trigger */}
      <div className="flex h-10 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <span className="text-sm font-medium text-muted-foreground">Commissioner Tools</span>
      </div>
    </header>
  )
}
