"use client"

import { memo, useMemo, useState, useEffect, useCallback, useRef } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import {
    ChevronDown,
    ChevronRight,
    List,
    ArrowUp,
    Link2,
    Search,
    Menu,
    X,
    History,
    Check,
    ExternalLink,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { toast } from "sonner"
import {
    parseRulebook,
    linkRuleReferences,
    RULEBOOK_REFERENCE_LINKS,
    type ParsedRulebook,
    type RuleSection,
    type RuleEntry,
    type RuleBlock,
} from "@/lib/rulebook-parser"

const REMARK_PLUGINS = [remarkGfm]

const INLINE_MD_COMPONENTS: Components = {
    p: ({ children }) => <>{children}</>,
    a: ({ href, children }) => {
        const isFootnote = href?.startsWith("#footnote-")
        if (isFootnote) {
            const label =
                typeof children === "string" ? children.replace(/^\^/, "") : children
            return (
                <a
                    href={href}
                    className="ml-0.5 align-super text-[10px] font-semibold text-primary hover:underline"
                    title={`Jump to footnote ${label}`}
                >
                    [{label}]
                </a>
            )
        }
        const isExternal = Boolean(href && /^https?:\/\//i.test(href))
        return (
            <a
                href={href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                className="font-medium text-foreground underline decoration-border underline-offset-2 hover:text-primary hover:decoration-primary transition-colors [overflow-wrap:anywhere]"
            >
                {children}
            </a>
        )
    },
    strong: ({ children }) => (
        <strong className="font-semibold text-foreground">{children}</strong>
    ),
    del: ({ children }) => (
        <del className="text-muted-foreground/70 line-through">{children}</del>
    ),
}

function useScrollSpy(ids: string[], offset = 150) {
    const [activeId, setActiveId] = useState<string>("")

    useEffect(() => {
        if (ids.length === 0) return

        let rafId: number | null = null

        const update = () => {
            rafId = null
            const nearBottom =
                window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4
            if (nearBottom) {
                setActiveId(ids[ids.length - 1])
                return
            }

            let current = ""
            for (const id of ids) {
                const el = document.getElementById(id)
                if (!el) continue
                const top = el.getBoundingClientRect().top
                if (top <= offset) {
                    current = id
                } else {
                    break
                }
            }
            setActiveId(current)
        }

        const onScroll = () => {
            if (rafId === null) {
                rafId = window.requestAnimationFrame(update)
            }
        }

        update()
        window.addEventListener("scroll", onScroll, { passive: true })
        window.addEventListener("resize", onScroll, { passive: true })

        return () => {
            if (rafId !== null) window.cancelAnimationFrame(rafId)
            window.removeEventListener("scroll", onScroll)
            window.removeEventListener("resize", onScroll)
        }
    }, [ids, offset])

    return activeId
}

function copyAnchorLink(id: string, label?: string) {
    const url = `${window.location.origin}${window.location.pathname}#${id}`
    if (window.history?.replaceState) {
        window.history.replaceState(null, "", `#${id}`)
    }
    navigator.clipboard
        .writeText(url)
        .then(() => toast.success(label ? `Copied link to ${label}` : "Link copied to clipboard"))
        .catch(() => toast.error("Failed to copy link"))
}

function prepareInlineMarkdown(
    text: string,
    ruleIdByNumber: Record<string, string>,
    clauseIdSet: Set<string>
): string {
    // Prevent block-level markdown constructs (lists, blockquotes) inside <p>
    const safeInline = text
        .replace(/^([-*+])(\s+)/, "\\$1$2")
        .replace(/^(>)(\s+)/, "\\$1$2")
        .replace(/^(\d+)(\.\s+)/, "$1\\$2")
    // Convert footnote markers [^1] -> [\[1\]](#footnote-1)
    const withFootnotes = safeInline.replace(
        /\[\^(\d+)\]/g,
        (_m, num: string) => `[^${num}](#footnote-${num})`
    )
    return linkRuleReferences(withFootnotes, ruleIdByNumber, clauseIdSet)
}

const InlineMarkdown = memo(function InlineMarkdown({
    text,
    ruleIdByNumber,
    clauseIdSet,
}: {
    text: string
    ruleIdByNumber: Record<string, string>
    clauseIdSet: Set<string>
}) {
    const processed = useMemo(
        () => prepareInlineMarkdown(text, ruleIdByNumber, clauseIdSet),
        [text, ruleIdByNumber, clauseIdSet]
    )

    return (
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={INLINE_MD_COMPONENTS}>
            {processed}
        </ReactMarkdown>
    )
})

function CopyLinkButton({
    id,
    label,
    subtle = false,
}: {
    id: string
    label: string
    subtle?: boolean
}) {
    const [copied, setCopied] = useState(false)
    const timeoutRef = useRef<number | null>(null)

    useEffect(() => {
        return () => {
            if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
        }
    }, [])

    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault()
        copyAnchorLink(id, label)
        setCopied(true)
        if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
        timeoutRef.current = window.setTimeout(() => setCopied(false), 1500)
    }

    return (
        <button
            type="button"
            onClick={handleClick}
            className={
                subtle
                    ? "opacity-40 sm:opacity-0 sm:group-hover/clause:opacity-100 focus:opacity-100 transition-opacity p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
                    : "opacity-60 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
            }
            aria-label={`Copy link to ${label}`}
            title={`Copy link to ${label}`}
        >
            {copied ? (
                <Check className={subtle ? "h-3 w-3 text-primary" : "h-4 w-4 text-primary"} />
            ) : (
                <Link2 className={subtle ? "h-3 w-3" : "h-4 w-4"} />
            )}
        </button>
    )
}

const RuleBlockView = memo(function RuleBlockView({
    block,
    ruleNumber,
    ruleIdByNumber,
    clauseIdSet,
    isHighlighted,
    indentToClause,
}: {
    block: RuleBlock
    ruleNumber: string
    ruleIdByNumber: Record<string, string>
    clauseIdSet: Set<string>
    isHighlighted: boolean
    indentToClause: boolean
}) {
    if (block.type === "clause") {
        return (
            <div
                id={block.id}
                className={`group/clause scroll-mt-28 flex items-start gap-2 sm:gap-2.5 rounded-md py-1 transition-colors ${
                    isHighlighted ? "bg-primary/10 ring-1 ring-primary/30 px-2 -mx-2" : ""
                }`}
            >
                <span className="font-mono text-xs font-semibold text-foreground pt-[3px] w-6 sm:w-7 shrink-0">
                    {block.marker}
                </span>
                <p className="flex-1 min-w-0 [overflow-wrap:anywhere] text-sm md:text-[15px] leading-relaxed text-muted-foreground">
                    <InlineMarkdown
                        text={block.text}
                        ruleIdByNumber={ruleIdByNumber}
                        clauseIdSet={clauseIdSet}
                    />
                </p>
                <div className="w-7 shrink-0 flex justify-end">
                    {block.id && (
                        <CopyLinkButton
                            id={block.id}
                            label={`Rule ${ruleNumber}(${block.marker?.replace(")", "")})`}
                            subtle
                        />
                    )}
                </div>
            </div>
        )
    }

    if (block.type === "subitem") {
        const padClass = indentToClause
            ? "pl-8 sm:pl-[2.375rem] pr-9 sm:pr-[2.375rem]"
            : "pl-4 sm:pl-6 pr-9 sm:pr-[2.375rem]"
        return (
            <div className={`flex items-start gap-2 sm:gap-2.5 ${padClass} py-0.5`}>
                <span className="font-mono text-xs font-medium text-foreground/80 pt-[3px] min-w-[1.5rem] sm:min-w-[1.75rem] shrink-0">
                    {block.marker}
                </span>
                <p className="flex-1 min-w-0 [overflow-wrap:anywhere] text-sm md:text-[15px] leading-relaxed text-muted-foreground">
                    <InlineMarkdown
                        text={block.text}
                        ruleIdByNumber={ruleIdByNumber}
                        clauseIdSet={clauseIdSet}
                    />
                </p>
            </div>
        )
    }

    if (block.type === "bullet") {
        const padClass = indentToClause
            ? block.indent
                ? "pl-12 sm:pl-[3.625rem] pr-9 sm:pr-[2.375rem]"
                : "pl-8 sm:pl-[2.375rem] pr-9 sm:pr-[2.375rem]"
            : block.indent
                ? "pl-8 sm:pl-10 pr-9 sm:pr-[2.375rem]"
                : "pl-4 sm:pl-6 pr-9 sm:pr-[2.375rem]"
        return (
            <div className={`flex items-start gap-2 sm:gap-2.5 ${padClass} py-0.5`}>
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                <p className="flex-1 min-w-0 [overflow-wrap:anywhere] text-sm md:text-[15px] leading-relaxed text-muted-foreground">
                    <InlineMarkdown
                        text={block.text}
                        ruleIdByNumber={ruleIdByNumber}
                        clauseIdSet={clauseIdSet}
                    />
                </p>
            </div>
        )
    }

    const paraPadClass = indentToClause
        ? "pl-8 sm:pl-[2.375rem] pr-9 sm:pr-[2.375rem]"
        : "pr-9 sm:pr-[2.375rem]"
    return (
        <p className={`min-w-0 [overflow-wrap:anywhere] text-sm md:text-[15px] leading-relaxed text-muted-foreground ${paraPadClass}`}>
            <InlineMarkdown
                text={block.text}
                ruleIdByNumber={ruleIdByNumber}
                clauseIdSet={clauseIdSet}
            />
        </p>
    )
})

const RuleCard = memo(function RuleCard({
    rule,
    ruleIdByNumber,
    clauseIdSet,
    activeHighlightId,
}: {
    rule: RuleEntry
    ruleIdByNumber: Record<string, string>
    clauseIdSet: Set<string>
    activeHighlightId: string | null
}) {
    const isRuleHighlighted = activeHighlightId === rule.id
    const hasClauses = rule.blocks.some((b) => b.type === "clause")

    return (
        <article
            id={rule.id}
            className={`scroll-mt-28 pt-7 pb-2 border-t border-border/60 first:border-t-0 first:pt-2 rounded-lg transition-colors ${
                isRuleHighlighted ? "bg-primary/5 ring-1 ring-primary/30 px-3 sm:px-4 sm:-mx-4 pb-4" : ""
            }`}
        >
            <h3 className="group mb-4 flex items-start sm:items-center gap-2 text-base sm:text-lg md:text-xl font-bold tracking-tight text-foreground">
                <a
                    href={`#${rule.id}`}
                    className="flex-1 min-w-0 break-words hover:text-primary transition-colors"
                >
                    <span className="font-mono text-xs sm:text-sm font-semibold text-muted-foreground mr-2">
                        Rule {rule.number}
                    </span>
                    <span>{rule.title}</span>
                </a>
                <CopyLinkButton id={rule.id} label={`Rule ${rule.number}`} />
            </h3>

            {rule.blocks.length > 0 && (
                <div className="space-y-2.5">
                    {rule.blocks.map((block, idx) => (
                        <RuleBlockView
                            key={block.id ?? idx}
                            block={block}
                            ruleNumber={rule.number}
                            ruleIdByNumber={ruleIdByNumber}
                            clauseIdSet={clauseIdSet}
                            isHighlighted={Boolean(block.id && activeHighlightId === block.id)}
                            indentToClause={hasClauses}
                        />
                    ))}
                </div>
            )}
        </article>
    )
})

function RulebookSidebar({
    sections,
    spyIds,
    latestChangelogVersion,
    autoFocusSearch = false,
    variant = "sidebar",
    onNavigate,
}: {
    sections: RuleSection[]
    spyIds: string[]
    latestChangelogVersion?: string
    autoFocusSearch?: boolean
    variant?: "sidebar" | "drawer"
    onNavigate?: (anchorId: string) => void
}) {
    const isDrawer = variant === "drawer"
    const activeId = useScrollSpy(spyIds, 150)
    const [searchQuery, setSearchQuery] = useState("")
    const [isSearchFocused, setIsSearchFocused] = useState(false)
    const searchInputRef = useRef<HTMLInputElement>(null)
    const [expandedSections, setExpandedSections] = useState<Set<string>>(
        () => new Set(sections[0] ? [sections[0].id] : [])
    )

    useEffect(() => {
        if (!autoFocusSearch) return
        const timer = window.setTimeout(() => {
            searchInputRef.current?.focus()
        }, 120)
        return () => window.clearTimeout(timer)
    }, [autoFocusSearch])

    // Auto-expand the section containing the currently scrolled rule
    useEffect(() => {
        if (!activeId || searchQuery.trim()) return
        const activeSection = sections.find(
            (s) => s.id === activeId || s.rules.some((r) => r.id === activeId)
        )
        if (activeSection) {
            setExpandedSections((prev) => {
                if (prev.has(activeSection.id)) return prev
                return new Set([...prev, activeSection.id])
            })
        }
    }, [activeId, sections, searchQuery])

    const filteredSections = useMemo(() => {
        const q = searchQuery.trim().toLowerCase()
        if (!q) return sections
        return sections
            .map((section) => {
                const sectionMatches =
                    section.fullHeading.toLowerCase().includes(q) ||
                    section.title.toLowerCase().includes(q)
                const matchedRules = section.rules.filter((r) => r.searchText.includes(q))
                if (matchedRules.length > 0) {
                    return { ...section, rules: matchedRules }
                }
                if (sectionMatches) return section
                return null
            })
            .filter(Boolean) as RuleSection[]
    }, [sections, searchQuery])

    const totalMatches = useMemo(() => {
        if (!searchQuery.trim()) return null
        return filteredSections.reduce((sum, s) => sum + s.rules.length, 0)
    }, [filteredSections, searchQuery])

    const toggleSection = useCallback((sectionId: string) => {
        setExpandedSections((prev) => {
            const next = new Set(prev)
            if (next.has(sectionId)) next.delete(sectionId)
            else next.add(sectionId)
            return next
        })
    }, [])

    const handleAnchorClick = (e: React.MouseEvent, anchorId: string) => {
        if (anchorId === "changelog") {
            window.dispatchEvent(new CustomEvent("rulebook:open-changelog"))
        }
        if (onNavigate) {
            e.preventDefault()
            onNavigate(anchorId)
        }
    }

    const isSearching = searchQuery.trim().length > 0
    const hideTitleRow = isDrawer && (isSearching || isSearchFocused || autoFocusSearch)

    const referenceDocumentsList = (
        <div className={isDrawer ? "mt-4 border-t border-border pt-3 px-1 pb-2" : "border-t border-border px-3.5 py-2.5 bg-muted/20 shrink-0"}>
            <p className="text-[11px] font-medium text-muted-foreground mb-1.5">
                Reference Documents
            </p>
            <div className={isDrawer ? "flex flex-col gap-1.5 text-sm" : "flex flex-col gap-1 text-xs"}>
                {RULEBOOK_REFERENCE_LINKS.map((link) => (
                    <a
                        key={link.url}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center justify-between gap-2 text-muted-foreground hover:text-foreground transition-colors ${
                            isDrawer ? "py-1" : ""
                        }`}
                    >
                        <span className="truncate">{link.label}</span>
                        <ExternalLink className={isDrawer ? "h-3.5 w-3.5 opacity-70 shrink-0" : "h-3 w-3 opacity-70 shrink-0"} />
                    </a>
                ))}
            </div>
        </div>
    )

    return (
        <div
            className={
                isDrawer
                    ? "flex flex-col h-full min-h-0 overflow-hidden"
                    : "flex flex-col h-full bg-card rounded-xl border border-border overflow-hidden"
            }
        >
            <div
                className={
                    isDrawer
                        ? "px-4 pt-2 pb-3 border-b border-border shrink-0"
                        : "p-4 border-b border-border bg-card shrink-0"
                }
            >
                {!hideTitleRow && (
                    <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                            <List className="h-4 w-4 text-muted-foreground" />
                            <h2 className="text-sm font-semibold text-foreground">Table of Contents</h2>
                        </div>
                        {totalMatches !== null && (
                            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                {totalMatches} {totalMatches === 1 ? "rule" : "rules"}
                            </span>
                        )}
                    </div>
                )}
                <div className="relative">
                    <Search
                        className={
                            isDrawer
                                ? "absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                                : "absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
                        }
                    />
                    <Input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search rule # or keyword..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onFocus={() => setIsSearchFocused(true)}
                        onBlur={() => setIsSearchFocused(false)}
                        aria-label="Search rules by number, title, or text"
                        className={
                            isDrawer
                                ? `pl-9 h-10 text-base bg-muted/50 focus-visible:ring-1 border-border ${
                                      isSearching
                                          ? hideTitleRow
                                              ? "pr-24"
                                              : "pr-9"
                                          : "pr-3"
                                  }`
                                : "pl-8 pr-7 h-8 text-xs bg-muted/50 focus-visible:ring-1 border-border"
                        }
                    />
                    {isSearching && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                            {hideTitleRow && totalMatches !== null && (
                                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                    {totalMatches} {totalMatches === 1 ? "rule" : "rules"}
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={() => setSearchQuery("")}
                                className={
                                    isDrawer
                                        ? "p-1 text-muted-foreground hover:text-foreground"
                                        : "text-muted-foreground hover:text-foreground"
                                }
                                aria-label="Clear search"
                            >
                                <X className={isDrawer ? "h-4 w-4" : "h-3.5 w-3.5"} />
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <nav
                aria-label="Rulebook sections"
                onTouchMove={() => {
                    if (isDrawer && document.activeElement === searchInputRef.current) {
                        searchInputRef.current?.blur()
                    }
                }}
                className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1 custom-scrollbar"
            >
                {latestChangelogVersion && !isSearching && (
                    <a
                        href="#changelog"
                        onClick={(e) => handleAnchorClick(e, "changelog")}
                        className={`mb-2 flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold border border-border bg-muted/40 hover:bg-muted transition-colors ${
                            activeId === "changelog"
                                ? "text-primary border-primary/40"
                                : "text-foreground"
                        }`}
                    >
                        <History className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">Rule Changelog</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {latestChangelogVersion}
                        </span>
                    </a>
                )}

                {filteredSections.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                        No rules matching &ldquo;{searchQuery.trim()}&rdquo;.
                    </div>
                ) : (
                    filteredSections.map((section) => {
                        const isExpanded = isSearching || expandedSections.has(section.id)
                        const isSectionActive = section.id === activeId

                        return (
                            <div key={section.id}>
                                <div
                                    className={`flex items-center gap-1 rounded-md transition-colors ${
                                        isSectionActive
                                            ? "bg-primary/10 text-primary"
                                            : "text-foreground hover:bg-muted/70"
                                    }`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => toggleSection(section.id)}
                                        aria-expanded={isExpanded}
                                        aria-label={`Toggle ${section.title}`}
                                        className="p-2 text-muted-foreground hover:text-foreground shrink-0"
                                    >
                                        {isExpanded ? (
                                            <ChevronDown className="h-3.5 w-3.5" />
                                        ) : (
                                            <ChevronRight className="h-3.5 w-3.5" />
                                        )}
                                    </button>
                                    <a
                                        href={`#${section.id}`}
                                        onClick={(e) => {
                                            if (!isExpanded) toggleSection(section.id)
                                            handleAnchorClick(e, section.id)
                                        }}
                                        className="flex-1 py-2 pr-2.5 text-sm font-semibold truncate"
                                    >
                                        {section.title}
                                    </a>
                                </div>

                                {isExpanded && section.rules.length > 0 && (
                                    <div className="ml-4 mt-0.5 border-l border-border/70 py-1 pb-1.5">
                                        {section.rules.map((rule) => {
                                            const isRuleActive = rule.id === activeId
                                            return (
                                                <a
                                                    key={rule.id}
                                                    href={`#${rule.id}`}
                                                    onClick={(e) => handleAnchorClick(e, rule.id)}
                                                    className={`relative block pl-3.5 pr-2 transition-colors ${
                                                        isDrawer ? "py-2.5 text-sm" : "py-1.5 text-xs"
                                                    } ${
                                                        isRuleActive
                                                            ? "text-primary font-semibold bg-primary/5 border-l-2 -ml-[1px] border-primary"
                                                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                                    }`}
                                                >
                                                    <span
                                                        className={`font-mono mr-1.5 opacity-80 ${
                                                            isDrawer ? "text-xs" : "text-[11px]"
                                                        }`}
                                                    >
                                                        {rule.number}
                                                    </span>
                                                    <span>{rule.title}</span>
                                                </a>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        )
                    })
                )}

                {isDrawer && !isSearching && referenceDocumentsList}
            </nav>

            {!isDrawer && referenceDocumentsList}
        </div>
    )
}

const MiniToc = memo(function MiniToc({ section }: { section: RuleSection }) {
    if (section.rules.length === 0) return null

    return (
        <div className="my-5 rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2.5">In this section</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                {section.rules.map((rule) => (
                    <a
                        key={rule.id}
                        href={`#${rule.id}`}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5 flex items-baseline gap-1.5"
                    >
                        <span className="font-mono text-[11px] text-muted-foreground/80 shrink-0">
                            {rule.number}
                        </span>
                        <span className="truncate">{rule.title}</span>
                    </a>
                ))}
            </div>
        </div>
    )
})

export function RulebookContent({
    markdown,
    latestChangelogVersion,
}: {
    markdown: string
    latestChangelogVersion?: string
}) {
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [focusSearchOnOpen, setFocusSearchOnOpen] = useState(false)
    const [highlightedId, setHighlightedId] = useState<string | null>(null)
    const highlightTimerRef = useRef<number | null>(null)
    const pendingAnchorRef = useRef<string | null>(null)
    const drawerScrollTimerRef = useRef<number | null>(null)

    const parsed: ParsedRulebook = useMemo(() => parseRulebook(markdown), [markdown])
    const clauseIdSet = useMemo(() => new Set(parsed.clauseIds), [parsed.clauseIds])

    const spyIds = useMemo(() => {
        const ids: string[] = []
        if (latestChangelogVersion) ids.push("changelog")
        parsed.sections.forEach((s) => {
            ids.push(s.id)
            s.rules.forEach((r) => ids.push(r.id))
        })
        return ids
    }, [parsed.sections, latestChangelogVersion])

    const scrollToTarget = useCallback(
        (rawAnchor: string) => {
            let targetId = rawAnchor.replace(/^#/, "")
            if (!targetId) return

            const shortRuleMatch = targetId.match(/^rule-(\d+)$/i)
            if (shortRuleMatch && parsed.ruleIdByNumber[shortRuleMatch[1]]) {
                targetId = parsed.ruleIdByNumber[shortRuleMatch[1]]
            }

            const el = document.getElementById(targetId)
            if (!el) return

            el.scrollIntoView({ behavior: "smooth", block: "start" })
            setHighlightedId(targetId)
            if (highlightTimerRef.current !== null) {
                window.clearTimeout(highlightTimerRef.current)
            }
            highlightTimerRef.current = window.setTimeout(() => {
                setHighlightedId((curr) => (curr === targetId ? null : curr))
            }, 2500)
        },
        [parsed.ruleIdByNumber]
    )

    // Support direct #hash navigation, including short aliases like #rule-621
    useEffect(() => {
        const onHash = () => {
            if (window.location.hash) {
                scrollToTarget(window.location.hash)
            }
        }
        onHash()
        window.addEventListener("hashchange", onHash)
        return () => {
            window.removeEventListener("hashchange", onHash)
            if (highlightTimerRef.current !== null) {
                window.clearTimeout(highlightTimerRef.current)
            }
            if (drawerScrollTimerRef.current !== null) {
                window.clearTimeout(drawerScrollTimerRef.current)
            }
        }
    }, [scrollToTarget])

    // Mobile drawer navigation: close drawer first, then scroll after Vaul scroll-lock releases
    const handleDrawerNavigate = useCallback(
        (anchorId: string) => {
            pendingAnchorRef.current = anchorId
            setDrawerOpen(false)
            setFocusSearchOnOpen(false)
            if (window.history?.replaceState) {
                window.history.replaceState(null, "", `#${anchorId}`)
            }
            if (drawerScrollTimerRef.current !== null) {
                window.clearTimeout(drawerScrollTimerRef.current)
            }
            drawerScrollTimerRef.current = window.setTimeout(() => {
                const target = pendingAnchorRef.current
                pendingAnchorRef.current = null
                if (target) scrollToTarget(target)
            }, 240)
        },
        [scrollToTarget]
    )

    const footnoteEntries = Object.entries(parsed.footnotes)

    return (
        <div className="relative">
            {/* Mobile Sticky Table of Contents & Search Bar */}
            <div className="lg:hidden sticky top-12 md:top-14 z-20 -mx-4 px-4 sm:-mx-6 sm:px-6 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border mb-6 py-2.5 flex items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={() => {
                        setFocusSearchOnOpen(false)
                        setDrawerOpen(true)
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 shrink-0 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-semibold hover:bg-primary/20 transition-colors"
                >
                    <Menu className="h-3.5 w-3.5" />
                    Table of Contents
                </button>

                <button
                    type="button"
                    onClick={() => {
                        setFocusSearchOnOpen(true)
                        setDrawerOpen(true)
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 shrink-0 rounded-full bg-muted text-foreground border border-border text-xs font-semibold hover:bg-muted/80 transition-colors"
                    aria-label="Search rulebook"
                >
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    Search
                </button>

                <Drawer
                    open={drawerOpen}
                    onOpenChange={(open) => {
                        setDrawerOpen(open)
                        if (!open) setFocusSearchOnOpen(false)
                    }}
                >
                    <DrawerContent
                        className="h-[90dvh] data-[vaul-drawer-direction=bottom]:mt-8 data-[vaul-drawer-direction=bottom]:max-h-[90dvh] outline-none"
                        onCloseAutoFocus={(e) => {
                            if (pendingAnchorRef.current) e.preventDefault()
                        }}
                    >
                        <DrawerTitle className="sr-only">Table of Contents</DrawerTitle>
                        <div className="flex-1 min-h-0 flex flex-col pt-2 pb-[env(safe-area-inset-bottom)]">
                            <RulebookSidebar
                                sections={parsed.sections}
                                spyIds={spyIds}
                                latestChangelogVersion={latestChangelogVersion}
                                autoFocusSearch={drawerOpen && focusSearchOnOpen}
                                variant="drawer"
                                onNavigate={handleDrawerNavigate}
                            />
                        </div>
                    </DrawerContent>
                </Drawer>
            </div>

            <div className="flex flex-col lg:flex-row gap-8 xl:gap-12 items-start relative">
                {/* Desktop Sidebar */}
                <aside className="hidden lg:block w-[280px] xl:w-[320px] shrink-0 sticky top-[6.5rem] h-[calc(100vh-8rem)]">
                    <RulebookSidebar
                        sections={parsed.sections}
                        spyIds={spyIds}
                        latestChangelogVersion={latestChangelogVersion}
                    />
                </aside>

                {/* Main Rulebook Content */}
                <div className="w-full flex-1 min-w-0">
                    <div className="w-full max-w-[800px]">
                        {/* Preamble / Founding Note */}
                        {parsed.foundingNote && (
                            <div className="mb-10 rounded-xl border border-border bg-muted/30 px-5 py-4">
                                {parsed.revisedLine && (
                                    <p className="font-mono text-xs text-muted-foreground mb-2">
                                        {parsed.revisedLine}
                                    </p>
                                )}
                                <p className="text-sm italic leading-relaxed text-muted-foreground">
                                    {parsed.foundingNote.replace(/^\*|\*$/g, "")}
                                </p>
                            </div>
                        )}

                        {/* Sections */}
                        {parsed.sections.map((section, idx) => (
                            <section key={section.id} className="mb-14">
                                {idx > 0 && (
                                    <div className="my-10 flex items-center gap-4">
                                        <div className="flex-1 border-t border-border" />
                                        <a
                                            href="#top"
                                            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            <ArrowUp className="h-3 w-3" />
                                            Back to top
                                        </a>
                                        <div className="flex-1 border-t border-border" />
                                    </div>
                                )}

                                <div
                                    id={section.id}
                                    className="scroll-mt-28 border-b border-border pb-3 mb-5 flex items-start sm:items-center gap-2 group"
                                >
                                    <h2 className="flex-1 min-w-0 break-words text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground">
                                        {section.fullHeading}
                                    </h2>
                                    <CopyLinkButton id={section.id} label={section.fullHeading} />
                                </div>

                                {section.introCallout && (
                                    <div className="mb-6 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm italic text-foreground">
                                        <InlineMarkdown
                                            text={section.introCallout}
                                            ruleIdByNumber={parsed.ruleIdByNumber}
                                            clauseIdSet={clauseIdSet}
                                        />
                                    </div>
                                )}

                                <MiniToc section={section} />

                                <div className="space-y-4">
                                    {section.rules.map((rule) => {
                                        const ruleHighlight =
                                            highlightedId &&
                                            (highlightedId === rule.id ||
                                                highlightedId.startsWith(`rule-${rule.number}-`))
                                                ? highlightedId
                                                : null
                                        return (
                                            <RuleCard
                                                key={rule.id}
                                                rule={rule}
                                                ruleIdByNumber={parsed.ruleIdByNumber}
                                                clauseIdSet={clauseIdSet}
                                                activeHighlightId={ruleHighlight}
                                            />
                                        )
                                    })}
                                </div>
                            </section>
                        ))}

                        {/* Official Footnotes */}
                        {footnoteEntries.length > 0 && (
                            <section
                                id="footnotes"
                                className="mt-12 pt-8 border-t border-border scroll-mt-28"
                            >
                                <h2 className="text-base font-semibold text-foreground mb-4">
                                    Footnotes
                                </h2>
                                <ol className="space-y-3 text-sm text-muted-foreground">
                                    {footnoteEntries.map(([num, text]) => (
                                        <li
                                            key={num}
                                            id={`footnote-${num}`}
                                            className="scroll-mt-28 flex items-start gap-2.5"
                                        >
                                            <span className="font-mono text-xs font-semibold text-foreground pt-0.5 shrink-0">
                                                [{num}]
                                            </span>
                                            <span className="leading-relaxed">{text}</span>
                                        </li>
                                    ))}
                                </ol>
                            </section>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
