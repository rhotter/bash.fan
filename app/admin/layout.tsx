import type { Metadata } from "next"
import { getSession } from "@/lib/admin-session"
import { AdminLoginGate } from "@/components/admin/admin-login-gate"
import { AdminSidebar } from "@/components/admin/admin-sidebar"
import { AdminTopbar } from "@/components/admin/admin-topbar"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"

export const metadata: Metadata = {
  title: {
    default: "BASH Admin",
    template: "%s | BASH Admin",
  },
  description: "Admin dashboard for Bay Area Street Hockey league management.",
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const isAuthenticated = await getSession()

  if (!isAuthenticated) {
    return <AdminLoginGate />
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SidebarProvider>
        <AdminSidebar />
        <SidebarInset>
          <AdminTopbar />
          <main className="flex-1 p-4 md:p-6 lg:p-8">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}
