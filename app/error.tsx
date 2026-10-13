"use client"

import { ErrorNotice } from "@/components/error-notice"

export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
    <ErrorNotice message="This page couldn't load. Please try again." onRetry={reset} />
  </main>
}
