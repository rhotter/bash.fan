import type { Metadata } from "next"
import { RulebookContent } from "@/components/rulebook-content"

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
        <div className="flex flex-1 flex-col bg-background">
            <main className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 py-10 md:py-16">
                {/* Hero */}
                <section className="mb-12 text-center">
                    <h1 className="mb-5 text-4xl md:text-6xl font-bold tracking-tighter leading-[0.95] text-foreground">
                        The Official <span className="text-primary">Rulebook.</span>
                    </h1>
                    <p className="mx-auto max-w-xl text-[15px] md:text-base leading-relaxed text-muted-foreground">
                        The comprehensive guide to the rules, regulations, and structure of the Bay Area Street Hockey league.
                    </p>
                </section>

                {/* Rulebook Content */}
                <div id="top">
                    <RulebookContent markdown={markdown} />
                </div>

                {/* Changelog */}
                {changelog.length > 0 && <RulebookChangelog changelog={changelog} />}
            </main>
        </div>
    )
}

function RulebookChangelog({ changelog }: { changelog: { date: string; version: string; notes: string[] }[] }) {
    return (
        <section className="mt-16">
            <div className="mb-5 flex items-baseline gap-3">
                <span className="font-mono text-[11px] font-medium tabular-nums text-primary">[01]</span>
                <h2 className="text-lg md:text-xl font-bold tracking-tight text-foreground">Revision History</h2>
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    Latest · {changelog[0].version}
                </span>
                <div className="h-px flex-1 bg-border" />
            </div>
            <details className="group rounded-xl border border-border bg-card">
                <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between hover:bg-secondary/40 rounded-xl transition-colors">
                    <span className="text-sm font-semibold text-foreground">View all revisions</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground group-open:hidden">Expand</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground hidden group-open:inline">Collapse</span>
                </summary>
                <div className="border-t border-border px-5 py-6">
                    <ol className="space-y-7">
                        {changelog.map((entry, index) => (
                            <li key={index} className="relative pl-6 border-l border-border last:border-transparent">
                                <span className="absolute -left-[3px] top-1 h-1.5 w-1.5 rounded-full bg-primary ring-4 ring-card" />
                                <div className="mb-2 flex items-baseline gap-3">
                                    <h3 className="font-mono text-sm font-bold text-foreground">{entry.version}</h3>
                                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{entry.date}</span>
                                </div>
                                <ul className="space-y-1.5 text-sm leading-relaxed text-muted-foreground">
                                    {entry.notes.map((note, noteIdx) => (
                                        <li key={noteIdx} className="flex gap-2.5">
                                            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary/60" />
                                            <span>{note}</span>
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        ))}
                    </ol>
                </div>
            </details>
        </section>
    )
}
