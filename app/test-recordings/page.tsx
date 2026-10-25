import { notFound } from "next/navigation"
import { TestRecordings } from "@/components/video/test-recordings"

export const dynamic = "force-dynamic"
export const metadata = { title: "Test recordings", robots: { index: false, follow: false } }

export default function TestRecordingsPage() {
  if (process.env.VIDEO_ENABLED !== "1" || process.env.VERCEL_ENV === "production") notFound()
  return <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
    <h1 className="text-2xl font-bold tracking-tight">Test recordings</h1>
    <p className="mt-2 text-sm text-muted-foreground">Watch your cameras and uploads, even when no game is running.</p>
    <TestRecordings />
  </main>
}
