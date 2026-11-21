import type { Metadata } from "next"
import { ExternalLink, FileText } from "lucide-react"
import { RulebookContent } from "@/components/rulebook-content"
import { RulebookChangelog } from "@/components/rulebook-changelog"
import { RULEBOOK_REFERENCE_LINKS, type ChangelogEntry } from "@/lib/rulebook-parser"

export const metadata: Metadata = {
    title: "Official Rulebook",
    description:
        "The official Bay Area Street Hockey (BASH) rulebook, matching the official league document verbatim, with quick rule search, direct links, and rule changelog.",
}

async function getRulebookMarkdown(): Promise<string> {
    const fs = await import("fs/promises")
    const path = await import("path")
    const filePath = path.join(process.cwd(), "public", "bash_rulebook_current.md")
    return fs.readFile(filePath, "utf-8")
}

async function getChangelog(): Promise<ChangelogEntry[]> {
    const fs = await import("fs/promises")
    const path = await import("path")
    try {
        const filePath = path.join(process.cwd(), "public", "rulebooks", "changelog.json")
        const raw = await fs.readFile(filePath, "utf-8")
        return JSON.parse(raw)
    } catch {
        return []
    }
}

export default async function RulebookPage() {
    const [markdown, changelog] = await Promise.all([getRulebookMarkdown(), getChangelog()])

    return (
        <div className="flex flex-1 flex-col bg-background">
            <main className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 py-8 md:py-12">
                {/* Hero */}
                <section className="mb-6 md:mb-8 text-center">
                    <h1 className="mb-3 text-3xl sm:text-4xl md:text-5xl font-bold tracking-tighter leading-[0.98] text-foreground">
                        The Official <span className="text-primary">Rulebook.</span>
                    </h1>
                    <p className="mx-auto max-w-2xl text-sm md:text-base leading-relaxed text-muted-foreground">
                        The official rules, regulations, and structure of the Bay Area Street Hockey
                        league.
                    </p>
                </section>

                {/* Rule Changelog (minimized by default) */}
                {changelog.length > 0 && <RulebookChangelog changelog={changelog} />}

                {/* Rulebook Content */}
                <div id="top" className="scroll-mt-24">
                    <RulebookContent
                        markdown={markdown}
                        latestChangelogVersion={changelog[0]?.version}
                    />
                </div>

                {/* Reference Documents Footer */}
                <footer
                    id="references"
                    className="mt-14 pt-6 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-muted-foreground"
                >
                    <div className="flex items-center gap-2 font-medium text-foreground">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span>Reference Documents</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                        {RULEBOOK_REFERENCE_LINKS.map((link) => (
                            <a
                                key={link.url}
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 hover:text-foreground underline decoration-border underline-offset-2 transition-colors"
                            >
                                <span>{link.label}</span>
                                <ExternalLink className="h-3 w-3 opacity-70" />
                            </a>
                        ))}
                    </div>
                </footer>
            </main>
        </div>
    )
}
