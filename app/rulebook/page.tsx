import type { Metadata } from "next"
import Link from "next/link"
import { SiteHeader } from "@/components/site-header"
import { Card, CardContent } from "@/components/ui/card"
import { RulebookContent } from "@/components/rulebook-content"
import { BookOpen, ArrowLeft } from "lucide-react"

export const metadata: Metadata = {
    title: "Official Rulebook",
    description: "The comprehensive guide to the rules, regulations, and structure of the Bay Area Street Hockey league.",
}

async function getRulebookMarkdown(): Promise<string> {
    const fs = await import("fs/promises")
    const path = await import("path")
    const filePath = path.join(process.cwd(), "public", "bash_rulebook_current.md")
    return fs.readFile(filePath, "utf-8")
}

async function getChangelog(): Promise<{ date: string; version: string; notes: string[] }[]> {
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
        <div className="flex min-h-svh flex-col bg-background">
            <SiteHeader activeTab="league" />
            <main className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 py-8 md:py-12">
                {/* Back link */}
                <Link
                    href="/about"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors mb-6"
                >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to About
                </Link>

                {/* Hero */}
                <div className="text-center mb-10">
                    <div className="inline-flex items-center gap-2 text-primary mb-3">
                        <BookOpen className="h-5 w-5" />
                        <span className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Rules</span>
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-3">
                        Official BASH Rulebook
                    </h1>
                    <p className="text-muted-foreground max-w-2xl mx-auto text-sm md:text-base leading-relaxed">
                        The comprehensive guide to the rules, regulations, and structure of the Bay Area Street Hockey league. Last revised October 2025.
                    </p>
                </div>

                {/* Rulebook Content */}
                <div id="top">
                    <RulebookContent markdown={markdown} />
                </div>

                {/* Changelog */}
                {changelog.length > 0 && (
                    <RulebookChangelog changelog={changelog} />
                )}
            </main>
        </div>
    )
}

function RulebookChangelog({ changelog }: { changelog: { date: string; version: string; notes: string[] }[] }) {
    return (
        <Card>
            <CardContent className="p-5">
                <details>
                    <summary className="cursor-pointer list-none flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Rulebook Revision History</h2>
                            <span className="text-xs text-muted-foreground font-medium">({changelog[0].version})</span>
                        </div>
                        <span className="text-xs font-semibold text-muted-foreground">Click to expand</span>
                    </summary>
                    <div className="mt-4 pt-4 border-t border-border space-y-6">
                        {changelog.map((entry, index) => (
                            <div key={index} className="relative pl-5 border-l-2 border-border last:border-transparent">
                                <div className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-primary ring-4 ring-card" />
                                <div className="flex items-baseline gap-3 mb-1.5">
                                    <h3 className="text-sm font-bold text-foreground">{entry.version}</h3>
                                    <span className="text-xs font-medium text-muted-foreground">{entry.date}</span>
                                </div>
                                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                                    {entry.notes.map((note, noteIdx) => (
                                        <li key={noteIdx} className="leading-relaxed">{note}</li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </details>
            </CardContent>
        </Card>
    )
}
