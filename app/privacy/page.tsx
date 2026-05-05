import type { Metadata } from "next"
import { SiteHeader } from "@/components/site-header"

export const metadata: Metadata = {
  title: "Privacy Policy — BASH",
  description: "Privacy policy for bayareastreethockey.com and the BASH Hockey Stats app.",
}

export default function PrivacyPage() {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 md:py-12">
        <h1 className="text-2xl font-bold mb-6">Privacy Policy</h1>
        <div className="prose prose-sm prose-neutral dark:prose-invert space-y-4 text-sm text-muted-foreground">
          <p><strong>Last updated:</strong> April 2, 2026</p>

          <h2 className="text-base font-semibold text-foreground mt-6">What we collect</h2>
          <p>
            bayareastreethockey.com and the BASH Hockey Stats app display publicly available Bay Area Street Hockey (BASH) league data
            including game scores, standings, player statistics, and historical records. This data is sourced from
            Sportability and league scorekeepers.
          </p>
          <p>
            We do not collect, store, or process any personal information from visitors or app users. No accounts,
            cookies, or tracking are required to use the site or app.
          </p>

          <h2 className="text-base font-semibold text-foreground mt-6">ChatGPT App (MCP Server)</h2>
          <p>
            The BASH Hockey Stats ChatGPT app provides read-only access to league statistics via an MCP server. Queries
            are executed against a read-only database connection. We do not log, store, or retain any queries made
            through the app. No personal data is collected or transmitted.
          </p>

          <h2 className="text-base font-semibold text-foreground mt-6">Third-party services</h2>
          <p>
            The site is hosted on Vercel and uses Vercel Analytics for anonymous page view counts. The database is
            hosted on Neon. Neither service receives personal information from users through our application.
          </p>

          <h2 className="text-base font-semibold text-foreground mt-6">Contact</h2>
          <p>
            For questions about this policy, contact us via the{" "}
            <a href="https://github.com/rhotter/bash.fan" className="text-foreground underline">
              GitHub repository
            </a>.
          </p>
        </div>
      </main>
    </div>
  )
}
