import type { Metadata } from "next"
import { getSession } from "@/lib/admin-session"
import { AdminLoginGate } from "@/components/admin/admin-login-gate"
import { VideoDashboard } from "@/components/video/video-dashboard"

export const metadata: Metadata = {
  title: "Video",
  robots: { index: false, follow: false },
}

export default async function VideoPage() {
  const authenticated = await getSession()
  return <div className="flex flex-1 flex-col bg-background">
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:py-8">
      {authenticated ? <VideoDashboard /> : <AdminLoginGate title="BASH Video" compact />}
    </main>
  </div>
}
