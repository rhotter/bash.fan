"use client"

import { useMemo, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeSlug from "rehype-slug"
import { ChevronDown, ChevronRight, List, ArrowUp } from "lucide-react"

interface TocSection {
    id: string
    title: string
    rules: { id: string; title: string }[]
}

function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .trim()
}

function parseToc(markdown: string): TocSection[] {
    const sections: TocSection[] = []
    const lines = markdown.split("\n")

    for (const line of lines) {
        // Match # **SECTION ...: Title**
        const sectionMatch = line.match(/^#\s+\*\*SECTION\s+\w+:\s*(.+?)\*\*/)
        if (sectionMatch) {
            const title = sectionMatch[1].trim()
            sections.push({ id: slugify(`section ${title}`), title, rules: [] })
            continue
        }

        // Match ## **Rule NNN: Title**
        const ruleMatch = line.match(/^##\s+\*\*Rule\s+(\d+):\s*(.+?)\*\*/)
        if (ruleMatch && sections.length > 0) {
            const ruleNum = ruleMatch[1]
            const ruleTitle = ruleMatch[2].replace(/\\?\)/g, ")").replace(/\\\\/g, "")
            sections[sections.length - 1].rules.push({
                id: slugify(`rule ${ruleNum} ${ruleTitle}`),
                title: `Rule ${ruleNum}: ${ruleTitle}`,
            })
        }
    }

    return sections
}

function TableOfContents({ sections }: { sections: TocSection[] }) {
    const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0]))

    const toggleSection = (index: number) => {
        setExpandedSections((prev) => {
            const next = new Set(prev)
            if (next.has(index)) next.delete(index)
            else next.add(index)
            return next
        })
    }

    const expandAll = () => {
        setExpandedSections(new Set(sections.map((_, i) => i)))
    }

    const collapseAll = () => {
        setExpandedSections(new Set())
    }

    return (
        <div className="rounded-xl border border-border bg-card p-5 mb-8">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                    <List className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Table of Contents</h2>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={expandAll}
                        className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Expand all
                    </button>
                    <span className="text-muted-foreground/30">|</span>
                    <button
                        onClick={collapseAll}
                        className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Collapse
                    </button>
                </div>
            </div>

            <nav className="space-y-1">
                {sections.map((section, sectionIdx) => {
                    const isExpanded = expandedSections.has(sectionIdx)
                    return (
                        <div key={section.id}>
                            <button
                                onClick={() => toggleSection(sectionIdx)}
                                className="w-full flex items-center gap-2 py-2 px-2.5 rounded-md text-left text-sm font-semibold text-foreground hover:bg-secondary transition-colors group"
                            >
                                {isExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5 text-primary shrink-0" />
                                ) : (
                                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
                                )}
                                <a
                                    href={`#${section.id}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="hover:text-primary transition-colors"
                                >
                                    {section.title}
                                </a>
                            </button>
                            {isExpanded && section.rules.length > 0 && (
                                <div className="ml-6 pl-3 border-l-2 border-border space-y-0.5 pb-1">
                                    {section.rules.map((rule) => (
                                        <a
                                            key={rule.id}
                                            href={`#${rule.id}`}
                                            className="block py-1 px-2 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                                        >
                                            {rule.title}
                                        </a>
                                    ))}
                                </div>
                            )}
                        </div>
                    )
                })}
            </nav>
        </div>
    )
}

function MiniToc({ section }: { section: TocSection }) {
    if (section.rules.length === 0) return null

    return (
        <div className="not-prose my-6 rounded-lg border border-border/60 bg-secondary/30 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground mb-2.5">In this section</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                {section.rules.map((rule) => (
                    <a
                        key={rule.id}
                        href={`#${rule.id}`}
                        className="text-xs text-muted-foreground hover:text-primary transition-colors py-0.5 flex items-center gap-1.5"
                    >
                        <span className="h-1 w-1 rounded-full bg-primary/40 shrink-0" />
                        {rule.title}
                    </a>
                ))}
            </div>
        </div>
    )
}

export function RulebookContent({ markdown }: { markdown: string }) {
    const sections = useMemo(() => parseToc(markdown), [markdown])

    // Split markdown into per-section chunks
    const sectionChunks = useMemo(() => {
        const lines = markdown.split("\n")
        const chunks: { sectionIdx: number; content: string }[] = []
        let currentLines: string[] = []
        let preambleDone = false

        // Collect preamble (content before first section)
        const preambleLines: string[] = []

        for (let i = 0; i < lines.length; i++) {
            const isSectionHeading = /^#\s+\*\*SECTION\s+\w+:/.test(lines[i])

            if (isSectionHeading) {
                if (!preambleDone) {
                    // Push preamble as chunk with sectionIdx -1
                    if (preambleLines.length > 0) {
                        chunks.push({ sectionIdx: -1, content: preambleLines.join("\n") })
                    }
                    preambleDone = true
                }

                // Push previous section's content
                if (currentLines.length > 0 && chunks.length > 0 && chunks[chunks.length - 1].sectionIdx >= 0) {
                    // Append to last real section
                } else if (currentLines.length > 0) {
                    chunks.push({ sectionIdx: chunks.length - 1, content: currentLines.join("\n") })
                }

                // Start new section
                const sectionIdx = sections.findIndex((s) => {
                    const titleInLine = lines[i].match(/^#\s+\*\*SECTION\s+\w+:\s*(.+?)\*\*/)
                    return titleInLine && s.title === titleInLine[1].trim()
                })

                currentLines = [lines[i]]
                // Read until the next section heading or end
                let j = i + 1
                while (j < lines.length && !/^#\s+\*\*SECTION\s+\w+:/.test(lines[j])) {
                    // Skip empty h1 spacers (lines that are just "#")
                    if (lines[j].trim() === "#") {
                        j++
                        continue
                    }
                    currentLines.push(lines[j])
                    j++
                }
                chunks.push({ sectionIdx, content: currentLines.join("\n") })
                currentLines = []
                i = j - 1 // will be incremented by loop
            } else if (!preambleDone) {
                preambleLines.push(lines[i])
            }
        }

        return chunks
    }, [markdown, sections])

    return (
        <div>
            <TableOfContents sections={sections} />

            {sectionChunks.map((chunk, idx) => {
                const section = chunk.sectionIdx >= 0 ? sections[chunk.sectionIdx] : null

                return (
                    <div key={idx}>
                        {/* Section divider for non-preamble */}
                        {section && idx > 0 && (
                            <div className="my-10 flex items-center gap-4">
                                <div className="flex-1 border-t border-border" />
                                <a
                                    href="#top"
                                    className="not-prose flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 hover:text-primary transition-colors"
                                >
                                    <ArrowUp className="h-3 w-3" />
                                    Back to top
                                </a>
                                <div className="flex-1 border-t border-border" />
                            </div>
                        )}

                        <div
                            className="prose prose-sm md:prose-base prose-slate dark:prose-invert max-w-none
                prose-headings:font-bold prose-headings:tracking-tight
                prose-h1:text-xl prose-h1:md:text-2xl prose-h1:text-primary prose-h1:border-b prose-h1:border-border prose-h1:pb-3 prose-h1:mb-6 prose-h1:mt-2
                prose-h2:text-base prose-h2:md:text-lg prose-h2:text-foreground prose-h2:mt-14 prose-h2:mb-4 prose-h2:scroll-mt-20
                prose-p:leading-[2.15] prose-p:mb-5
                prose-li:leading-[2.15] prose-li:mb-2.5
                prose-a:text-primary hover:prose-a:underline
                prose-strong:text-foreground
                prose-ol:space-y-2 prose-ul:space-y-2"
                            id={section?.id}
                        >
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[rehypeSlug]}
                                components={{
                                    // Add ids to h2 for direct linking
                                    h2: ({ children, ...props }) => {
                                        const text = typeof children === "string"
                                            ? children
                                            : Array.isArray(children)
                                                ? children.map((c) => (typeof c === "string" ? c : "")).join("")
                                                : ""
                                        const ruleMatch = text.match(/Rule\s+(\d+):\s*(.+)/)
                                        const id = ruleMatch
                                            ? slugify(`rule ${ruleMatch[1]} ${ruleMatch[2]}`)
                                            : slugify(text)
                                        return <h2 id={id} className="pt-6 border-t border-border/40" {...props}>{children}</h2>
                                    },
                                    h1: ({ children, ...props }) => {
                                        const text = typeof children === "string"
                                            ? children
                                            : Array.isArray(children)
                                                ? children.map((c) => (typeof c === "string" ? c : "")).join("")
                                                : ""
                                        // Skip empty spacer h1s
                                        if (!text.trim()) return null
                                        const sectionMatch = text.match(/SECTION\s+\w+:\s*(.+)/)
                                        const id = sectionMatch
                                            ? slugify(`section ${sectionMatch[1]}`)
                                            : slugify(text)
                                        return <h1 id={id} {...props}>{children}</h1>
                                    },
                                }}
                            >
                                {chunk.content}
                            </ReactMarkdown>

                            {/* Mini TOC after the section heading */}
                            {section && <MiniToc section={section} />}
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
