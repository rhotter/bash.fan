import Link from "next/link"
import { SiteHeader } from "@/components/site-header"

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-4 py-16">
        <p className="text-8xl font-black tracking-tighter text-foreground/10 sm:text-9xl">
          404
        </p>
        <h1 className="-mt-2 text-lg font-bold text-foreground sm:text-xl">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page doesn&apos;t exist or may have been moved.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-md bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground transition-colors hover:bg-secondary/70"
        >
          Back to scores
        </Link>
      </main>
    </div>
  )
}
