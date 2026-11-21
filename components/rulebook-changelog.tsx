"use client"

import { useState, useEffect } from "react"
import { ChevronDown, ExternalLink, History } from "lucide-react"
import type { ChangelogEntry } from "@/lib/rulebook-parser"

function ChangelogItemsList({ entry }: { entry: ChangelogEntry }) {
    if (entry.items && entry.items.length > 0) {
        return (
            <ul className="divide-y divide-border/60 text-sm leading-relaxed text-muted-foreground">
                {entry.items.map((item, idx) => (
                    <li
                        key={idx}
                        className="py-3 first:pt-0 last:pb-0 grid grid-cols-1 sm:grid-cols-[124px_1fr] gap-y-1.5 sm:gap-x-4 items-baseline"
                    >
                        <div className="min-w-0">
                            {item.ruleRef &&
                                (item.ruleAnchor ? (
                                    <a
                                        href={`#${item.ruleAnchor}`}
                                        className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-[11px] font-medium text-foreground hover:border-primary/50 hover:text-primary transition-colors"
                                    >
                                        {item.ruleRef}
                                    </a>
                                ) : (
                                    <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
                                        {item.ruleRef}
                                    </span>
                                ))}
                        </div>
                        <div className="min-w-0 [overflow-wrap:anywhere]">
                            <span>{item.text}</span>
                            {item.links && item.links.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                                    {item.links.map((link, linkIdx) => (
                                        <a
                                            key={linkIdx}
                                            href={link.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline decoration-border underline-offset-2 hover:text-primary hover:decoration-primary transition-colors"
                                        >
                                            <span>{link.label}</span>
                                            <ExternalLink className="h-3 w-3 shrink-0" />
                                        </a>
                                    ))}
                                </div>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
        )
    }

    return (
        <ul className="space-y-1.5 text-sm leading-relaxed text-muted-foreground">
            {(entry.notes ?? []).map((note, noteIdx) => (
                <li key={noteIdx} className="flex gap-2.5">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                    <span>{note}</span>
                </li>
            ))}
        </ul>
    )
}

export function RulebookChangelog({ changelog }: { changelog: ChangelogEntry[] }) {
    const [open, setOpen] = useState(false)

    // Auto-expand when user navigates to #changelog or clicks sidebar Changelog link
    useEffect(() => {
        const checkHash = () => {
            if (window.location.hash === "#changelog") {
                setOpen(true)
            }
        }
        const handleOpenEvent = () => setOpen(true)
        checkHash()
        window.addEventListener("hashchange", checkHash)
        window.addEventListener("rulebook:open-changelog", handleOpenEvent)
        return () => {
            window.removeEventListener("hashchange", checkHash)
            window.removeEventListener("rulebook:open-changelog", handleOpenEvent)
        }
    }, [])

    if (changelog.length === 0) return null
    const [latest, ...previous] = changelog

    return (
        <section id="changelog" className="mb-8 scroll-mt-24">
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <button
                    type="button"
                    onClick={() => setOpen((prev) => !prev)}
                    aria-expanded={open}
                    aria-controls="changelog-panel"
                    className="w-full px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-muted/40 transition-colors"
                >
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 min-w-0">
                        <History className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm font-semibold text-foreground">
                            Rule Changelog
                        </span>
                        <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[11px] font-medium text-foreground">
                            {latest.version}
                        </span>
                        {latest.title && (
                            <span className="hidden md:inline text-xs font-medium text-muted-foreground truncate">
                                {latest.title}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground shrink-0">
                        <span>{open ? "Hide" : "View changes"}</span>
                        <ChevronDown
                            className={`h-4 w-4 transition-transform duration-200 ${
                                open ? "rotate-180" : ""
                            }`}
                        />
                    </div>
                </button>

                {open && (
                    <div id="changelog-panel" className="border-t border-border">
                        <div className="px-4 sm:px-5 py-5">
                            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                                {latest.title && (
                                    <h2 className="text-sm font-semibold text-foreground">
                                        {latest.title}
                                    </h2>
                                )}
                                <time
                                    dateTime={latest.date}
                                    className="font-mono text-xs text-muted-foreground"
                                >
                                    {latest.date}
                                </time>
                            </div>
                            <ChangelogItemsList entry={latest} />
                        </div>

                        {previous.length > 0 && (
                            <details className="group border-t border-border">
                                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden px-4 sm:px-5 py-3 flex items-center justify-between bg-muted/20 hover:bg-muted/40 transition-colors">
                                    <span className="text-xs font-semibold text-muted-foreground">
                                        Previous revisions ({previous.length})
                                    </span>
                                    <span className="font-mono text-[11px] text-muted-foreground group-open:hidden">
                                        Show
                                    </span>
                                    <span className="font-mono text-[11px] text-muted-foreground hidden group-open:inline">
                                        Hide
                                    </span>
                                </summary>
                                <div className="border-t border-border px-4 sm:px-5 py-5">
                                    <ol className="space-y-6">
                                        {previous.map((entry, index) => (
                                            <li
                                                key={`${entry.version}-${index}`}
                                                className="relative pl-5 border-l border-border last:border-transparent"
                                            >
                                                <span className="absolute -left-[3.5px] top-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/60 ring-4 ring-card" />
                                                <div className="mb-2.5 flex flex-wrap items-baseline gap-2.5">
                                                    <h3 className="font-mono text-xs font-semibold text-foreground">
                                                        {entry.version}
                                                    </h3>
                                                    {entry.title && (
                                                        <span className="text-xs font-medium text-foreground">
                                                            {entry.title}
                                                        </span>
                                                    )}
                                                    <time
                                                        dateTime={entry.date}
                                                        className="font-mono text-[11px] text-muted-foreground"
                                                    >
                                                        {entry.date}
                                                    </time>
                                                </div>
                                                <ChangelogItemsList entry={entry} />
                                            </li>
                                        ))}
                                    </ol>
                                </div>
                            </details>
                        )}
                    </div>
                )}
            </div>
        </section>
    )
}
