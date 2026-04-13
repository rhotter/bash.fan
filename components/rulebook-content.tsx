"use client"

import { useMemo, useState, useEffect } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeSlug from "rehype-slug"
import { ChevronDown, ChevronRight, List, ArrowUp, Link2, Search, Menu } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Drawer, DrawerContent, DrawerTrigger, DrawerTitle } from "@/components/ui/drawer"
import { toast } from "sonner"

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
        const sectionMatch = line.match(/^#\s+\*\*SECTION\s+\w+:\s*(.+?)\*\*/)
        if (sectionMatch) {
            const title = sectionMatch[1].trim()
            sections.push({ id: slugify(`section ${title}`), title, rules: [] })
            continue
        }

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

function useScrollSpy(ids: string[], offset = 100) {
    const [activeId, setActiveId] = useState<string>("")

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setActiveId(entry.target.id)
                    }
                })
            },
            { rootMargin: `-${offset}px 0px -80% 0px` }
        )

        const elements = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[]
        elements.forEach((el) => observer.observe(el))

        return () => observer.disconnect()
    }, [ids, offset])

    return activeId
}

function copyToClipboard(id: string) {
    const url = `${window.location.origin}${window.location.pathname}#${id}`
    navigator.clipboard.writeText(url)
        .then(() => toast.success("Link copied to clipboard"))
        .catch(() => toast.error("Failed to copy link"))
}

function RulebookSidebar({
    sections,
    activeId,
    onLinkClick,
}: {
    sections: TocSection[]
    activeId: string
    onLinkClick?: () => void
}) {
    const [searchQuery, setSearchQuery] = useState("")
    const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0]))

    // Auto-expand sections that have active items
    useEffect(() => {
        if (!activeId || searchQuery) return
        const activeSectionIdx = sections.findIndex(
            (s) => s.id === activeId || s.rules.some((r) => r.id === activeId)
        )
        if (activeSectionIdx >= 0) {
            setExpandedSections((prev) => {
                if (prev.has(activeSectionIdx)) return prev
                return new Set([...prev, activeSectionIdx])
            })
        }
    }, [activeId, sections, searchQuery])

    // Filter sections based on search query
    const filteredSections = useMemo(() => {
        if (!searchQuery.trim()) return sections
        const query = searchQuery.toLowerCase()
        return sections.map(section => {
            if (section.title.toLowerCase().includes(query)) return section
            const matchedRules = section.rules.filter(r => r.title.toLowerCase().includes(query))
            if (matchedRules.length > 0) return { ...section, rules: matchedRules }
            return null
        }).filter(Boolean) as TocSection[]
    }, [sections, searchQuery])

    // Auto-expand all when searching
    useEffect(() => {
        if (searchQuery.trim()) {
            setExpandedSections(new Set(filteredSections.map((_, i) => i)))
        }
    }, [searchQuery, filteredSections])

    const toggleSection = (index: number) => {
        setExpandedSections((prev) => {
            const next = new Set(prev)
            if (next.has(index)) next.delete(index)
            else next.add(index)
            return next
        })
    }

    return (
        <div className="flex flex-col h-full bg-card rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10 shrink-0">
                <div className="flex items-center gap-2.5 mb-4">
                    <List className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Rule Index</h2>
                </div>
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                        type="text"
                        placeholder="Search rules..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 h-8 text-xs bg-secondary/50 focus-visible:ring-1 focus-visible:bg-secondary border-border"
                    />
                </div>
            </div>

            <nav className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
                {filteredSections.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">No matches found.</div>
                ) : (
                    filteredSections.map((section, sectionIdx) => {
                        const isExpanded = expandedSections.has(sectionIdx)
                        const isSectionActive = section.id === activeId

                        return (
                            <div key={section.id}>
                                <button
                                    onClick={() => toggleSection(sectionIdx)}
                                    className={`w-full flex items-center gap-2 py-2 px-2.5 rounded-md text-left text-sm font-semibold transition-colors group
                                        ${isSectionActive ? "text-primary bg-primary/10" : "text-foreground hover:bg-secondary"}
                                    `}
                                >
                                    {isExpanded ? (
                                        <ChevronDown className={`h-3.5 w-3.5 shrink-0 ${isSectionActive ? "text-primary" : "text-muted-foreground"}`} />
                                    ) : (
                                        <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${isSectionActive ? "text-primary" : "text-muted-foreground group-hover:text-primary"}`} />
                                    )}
                                    <a
                                        href={`#${section.id}`}
                                        onClick={(e) => {
                                            if (!isExpanded) toggleSection(sectionIdx)
                                            onLinkClick?.()
                                        }}
                                        className="flex-1 truncate"
                                    >
                                        {section.title}
                                    </a>
                                </button>
                                {isExpanded && section.rules.length > 0 && (
                                    <div className="ml-5 mt-0.5 border-l border-border/60 py-1 pb-1.5">
                                        {section.rules.map((rule) => {
                                            const isRuleActive = rule.id === activeId
                                            return (
                                                <a
                                                    key={rule.id}
                                                    href={`#${rule.id}`}
                                                    onClick={() => onLinkClick?.()}
                                                    className={`relative block py-1.5 pl-4 pr-2 text-xs transition-colors
                                                        ${isRuleActive ? "text-primary font-bold bg-primary/5 border-l-2 -ml-[1px] border-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"}
                                                    `}
                                                >
                                                    {rule.title}
                                                </a>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        )
                    })
                )}
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
                        <span className="truncate">{rule.title}</span>
                    </a>
                ))}
            </div>
        </div>
    )
}

export function RulebookContent({ markdown }: { markdown: string }) {
    const [drawerOpen, setDrawerOpen] = useState(false)
    const sections = useMemo(() => parseToc(markdown), [markdown])

    const sectionChunks = useMemo(() => {
        const lines = markdown.split("\n")
        const chunks: { sectionIdx: number; content: string }[] = []
        let currentLines: string[] = []
        let preambleDone = false
        const preambleLines: string[] = []

        for (let i = 0; i < lines.length; i++) {
            const isSectionHeading = /^#\s+\*\*SECTION\s+\w+:/.test(lines[i])

            if (isSectionHeading) {
                if (!preambleDone) {
                    if (preambleLines.length > 0) {
                        chunks.push({ sectionIdx: -1, content: preambleLines.join("\n") })
                    }
                    preambleDone = true
                }

                if (currentLines.length > 0 && chunks.length > 0 && chunks[chunks.length - 1].sectionIdx >= 0) {
                    // Append to existing
                } else if (currentLines.length > 0) {
                    chunks.push({ sectionIdx: chunks.length - 1, content: currentLines.join("\n") })
                }

                const sectionIdx = sections.findIndex((s) => {
                    const titleInLine = lines[i].match(/^#\s+\*\*SECTION\s+\w+:\s*(.+?)\*\*/)
                    return titleInLine && s.title === titleInLine[1].trim()
                })

                currentLines = [lines[i]]
                let j = i + 1
                while (j < lines.length && !/^#\s+\*\*SECTION\s+\w+:/.test(lines[j])) {
                    if (lines[j].trim() === "#") {
                        j++
                        continue
                    }
                    currentLines.push(lines[j])
                    j++
                }
                chunks.push({ sectionIdx, content: currentLines.join("\n") })
                currentLines = []
                i = j - 1
            } else if (!preambleDone) {
                preambleLines.push(lines[i])
            }
        }

        return chunks
    }, [markdown, sections])

    const allIds = useMemo(() => {
        const ids: string[] = []
        sections.forEach(s => {
            ids.push(s.id)
            s.rules.forEach(r => ids.push(r.id))
        })
        return ids
    }, [sections])

    const activeId = useScrollSpy(allIds, 150)

    const getActiveRuleTitle = () => {
        for (const section of sections) {
            if (section.id === activeId) return section.title
            const rule = section.rules.find(r => r.id === activeId)
            if (rule) return rule.title
        }
        return "Rulebook Index"
    }

    return (
        <div className="relative">
            {/* Mobile Drawer Navigation (Sticky Top) */}
            <div className="lg:hidden sticky top-16 z-20 -mx-4 px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border/60 mb-8 py-3 flex items-center justify-between shadow-sm">
                <span className="text-sm font-semibold truncate pr-4 text-foreground flex-1">
                    {activeId ? (
                        <span className="text-primary truncate block max-w-full text-xs">
                            {getActiveRuleTitle()}
                        </span>
                    ) : (
                        <span className="text-muted-foreground">Rulebook Index</span>
                    )}
                </span>
                <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
                    <DrawerTrigger asChild>
                        <button className="flex items-center gap-1.5 px-3.5 py-1.5 shrink-0 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-bold hover:bg-primary/20 transition-colors">
                            <Menu className="h-3.5 w-3.5" />
                            Index
                        </button>
                    </DrawerTrigger>
                    <DrawerContent className="h-[85vh] outline-none">
                        <DrawerTitle className="sr-only">Rulebook Index</DrawerTitle>
                        <div className="p-4 h-full flex flex-col pt-6 pb-8">
                            <RulebookSidebar sections={sections} activeId={activeId} onLinkClick={() => setDrawerOpen(false)} />
                        </div>
                    </DrawerContent>
                </Drawer>
            </div>

            <div className="flex flex-col lg:flex-row gap-8 xl:gap-12 items-start relative">
                {/* Desktop Sidebar */}
                <aside className="hidden lg:block w-[280px] xl:w-[320px] shrink-0 sticky top-[7rem] h-[calc(100vh-8rem)]">
                    <RulebookSidebar sections={sections} activeId={activeId} />
                </aside>

                {/* Main Content */}
                <div className="flex-1 min-w-0 pr-0">
                    <div className="max-w-[800px]">
                        {sectionChunks.map((chunk, idx) => {
                            const section = chunk.sectionIdx >= 0 ? sections[chunk.sectionIdx] : null

                            return (
                                <div key={idx} className="scroll-mt-24">
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
                                            prose-h1:text-2xl md:prose-h1:text-3xl prose-h1:text-primary prose-h1:border-b prose-h1:border-border prose-h1:pb-4 prose-h1:mb-8 prose-h1:scroll-mt-28
                                            prose-h2:text-lg md:prose-h2:text-xl prose-h2:text-foreground prose-h2:mt-12 prose-h2:mb-5 prose-h2:scroll-mt-32
                                            prose-p:leading-[1.85] prose-p:mb-5 prose-p:text-muted-foreground
                                            prose-li:leading-[1.85] prose-li:mb-2.5 prose-li:text-muted-foreground
                                            prose-a:text-primary hover:prose-a:underline
                                            prose-strong:text-foreground
                                            prose-ol:space-y-2 prose-ul:space-y-2"
                                        id={section?.id}
                                    >
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            rehypePlugins={[rehypeSlug]}
                                            components={{
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
                                                    return (
                                                        <h2 id={id} className="pt-6 border-t border-border/40 group relative flex items-center" {...props}>
                                                            <span className="flex-1">{children}</span>
                                                            <button 
                                                                onClick={(e) => { e.preventDefault(); copyToClipboard(id) }}
                                                                className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-primary shrink-0"
                                                                aria-label="Copy link to rule"
                                                                title="Copy link"
                                                            >
                                                                <Link2 className="h-4 w-4" />
                                                            </button>
                                                        </h2>
                                                    )
                                                },
                                                h1: ({ children, ...props }) => {
                                                    const text = typeof children === "string"
                                                        ? children
                                                        : Array.isArray(children)
                                                            ? children.map((c) => (typeof c === "string" ? c : "")).join("")
                                                            : ""
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

                                        {section && <MiniToc section={section} />}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>
        </div>
    )
}
