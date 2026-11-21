export interface RuleBlock {
    type: "clause" | "subitem" | "bullet" | "paragraph" | "callout"
    id?: string
    marker?: string
    indent?: number
    text: string
}

export interface RuleEntry {
    id: string
    number: string
    title: string
    fullHeading: string
    blocks: RuleBlock[]
    searchText: string
}

export interface RuleSection {
    id: string
    numberWord: string
    title: string
    fullHeading: string
    introCallout?: string
    rules: RuleEntry[]
}

export interface ParsedRulebook {
    title: string
    revisedLine: string
    foundingNote: string
    sections: RuleSection[]
    footnotes: Record<string, string>
    ruleIdByNumber: Record<string, string>
    clauseIds: string[]
}

export interface ChangelogLink {
    label: string
    url: string
}

export interface ChangelogItem {
    ruleRef?: string
    ruleAnchor?: string
    text: string
    links?: ChangelogLink[]
}

export interface ChangelogEntry {
    date: string
    version: string
    title?: string
    items?: ChangelogItem[]
    notes?: string[]
}

export const RULEBOOK_REFERENCE_LINKS: ChangelogLink[] = [
    {
        label: "BASH Rulebook Doc",
        url: "https://docs.google.com/document/d/1j3rJxF7xN1HqSTDyDUFD_p-AsO42oXfd/edit",
    },
    {
        label: "USA Ball Hockey Rulebook (PDF)",
        url: "https://usaballhockey.com/wp-content/uploads/2024/11/USA-Ball-Hockey-Official-Rule-Book-Revised-07.06.2021.pdf",
    },
    {
        label: "2026–27 NHL Rulebook (PDF)",
        url: "https://media.nhl.com/site/asset/public/ext/2026-27/2026-27Rules.pdf",
    },
]

export function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[’']/g, "")
        .replace(/[^a-z0-9\s-]/g, " ")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
}

const ROMAN_SUBITEM_RE = /^(x{0,2}(?:ix|iv|v?i{0,3}))([.)])\s+(.*)$/i
const NUMBER_SUBITEM_RE = /^(\d+)([.)])\s+(.*)$/
const LETTER_CLAUSE_RE = /^([a-z])\)\s+(.*)$/
const UPPER_ROMAN_RE = /^(I{1,3}|IV|V|VI{0,3})([.):])\s+(.*)$/
const UPPER_LETTER_SUBITEM_RE = /^(\([A-Z]\)|[A-Z]\))\s+(.*)$/

function isRomanNumeral(token: string): boolean {
    return /^(x{0,2}(?:ix|iv|v?i{0,3}))$/i.test(token) && token.length > 0
}

export function parseRulebook(markdown: string): ParsedRulebook {
    const rawLines = markdown.replace(/\r\n/g, "\n").split("\n")

    const footnotes: Record<string, string> = {}
    const contentLines: string[] = []

    for (const line of rawLines) {
        const fnMatch = line.match(/^\[\^(\d+)\]:\s*(.+)$/)
        if (fnMatch) {
            footnotes[fnMatch[1]] = fnMatch[2].trim()
        } else {
            contentLines.push(line)
        }
    }

    let title = "OFFICIAL BAY AREA STREET HOCKEY RULEBOOK"
    let revisedLine = ""
    let foundingNote = ""

    const sections: RuleSection[] = []
    const ruleIdByNumber: Record<string, string> = {}
    const clauseIds: string[] = []

    let currentSection: RuleSection | null = null
    let currentRule: RuleEntry | null = null
    let lastClauseLetter: string | null = null
    let inPreamble = true

    const finalizeRule = () => {
        if (!currentRule) return
        currentRule.searchText = [
            currentRule.fullHeading,
            ...currentRule.blocks.map((b) => `${b.marker ?? ""} ${b.text}`),
        ]
            .join(" ")
            .toLowerCase()
        currentRule = null
        lastClauseLetter = null
    }

    for (const rawLine of contentLines) {
        const trimmed = rawLine.trim()

        // Section heading: # SECTION ONE: The League Charter
        const sectionMatch = trimmed.match(/^#\s+(SECTION\s+(\w+):\s*(.+))$/)
        if (sectionMatch) {
            finalizeRule()
            inPreamble = false
            const fullHeading = sectionMatch[1].trim()
            const numberWord = sectionMatch[2].trim()
            const secTitle = sectionMatch[3].trim()
            currentSection = {
                id: slugify(fullHeading),
                numberWord,
                title: secTitle,
                fullHeading,
                rules: [],
            }
            sections.push(currentSection)
            continue
        }

        // Preamble lines before first section
        if (inPreamble) {
            if (!trimmed) continue
            if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
                title = trimmed.slice(2, -2).trim()
            } else if (/^Revised\s+/i.test(trimmed)) {
                revisedLine = trimmed
            } else {
                foundingNote = foundingNote ? `${foundingNote}\n${trimmed}` : trimmed
            }
            continue
        }

        if (!trimmed) continue

        // Rule heading: ## Rule 621: Leaving the Players’ Bench or Penalty Bench
        const ruleMatch = trimmed.match(/^##\s+(Rule\s+(\d+):\s*(.+))$/)
        if (ruleMatch && currentSection) {
            finalizeRule()
            const fullHeading = ruleMatch[1].trim()
            const number = ruleMatch[2]
            const ruleTitle = ruleMatch[3].trim()
            const id = slugify(`rule ${number} ${ruleTitle}`)
            currentRule = {
                id,
                number,
                title: ruleTitle,
                fullHeading,
                blocks: [],
                searchText: "",
            }
            ruleIdByNumber[number] = id
            currentSection.rules.push(currentRule)
            continue
        }

        // Section-level intro callout/note right after section heading (before first rule)
        if (currentSection && !currentRule) {
            const calloutText = trimmed.replace(/^>\s*/, "").trim()
            currentSection.introCallout = currentSection.introCallout
                ? `${currentSection.introCallout}\n${calloutText}`
                : calloutText
            continue
        }

        if (!currentRule) continue

        // Bullet item (- ... or indented   - ...)
        const bulletMatch = rawLine.match(/^(\s*)-\s+(.*)$/)
        if (bulletMatch) {
            currentRule.blocks.push({
                type: "bullet",
                indent: bulletMatch[1].length >= 2 ? 1 : 0,
                text: bulletMatch[2].trim(),
            })
            continue
        }

        // Handle uppercase "I)" immediately following clause "h)" (e.g., Rule 601)
        const upperIClauseMatch =
            lastClauseLetter === "h" ? trimmed.match(/^I\)\s+(.*)$/) : null
        if (upperIClauseMatch) {
            const clauseId = `rule-${currentRule.number}-i`
            const uniqueId = clauseIds.includes(clauseId) ? undefined : clauseId
            if (uniqueId) {
                clauseIds.push(uniqueId)
            }
            lastClauseLetter = "i"
            currentRule.blocks.push({
                type: "clause",
                id: uniqueId,
                marker: "I)",
                text: upperIClauseMatch[1].trim(),
            })
            continue
        }

        // Uppercase Roman sub-item (I., II., III., IV., V:, I), II), III))
        const upperRomanMatch = trimmed.match(UPPER_ROMAN_RE)
        if (upperRomanMatch) {
            currentRule.blocks.push({
                type: "subitem",
                marker: `${upperRomanMatch[1]}${upperRomanMatch[2]}`,
                text: upperRomanMatch[3].trim(),
            })
            continue
        }

        // Uppercase letter sub-item: (A) ..., A) ...
        const upperLetterMatch = trimmed.match(UPPER_LETTER_SUBITEM_RE)
        if (upperLetterMatch) {
            currentRule.blocks.push({
                type: "subitem",
                marker: upperLetterMatch[1],
                text: upperLetterMatch[2].trim(),
            })
            continue
        }

        // Lettered clause: a), b), c) ...
        // Disambiguate "i)" (letter i after h vs roman numeral i) and "v)" / "x)"
        const letterMatch = trimmed.match(LETTER_CLAUSE_RE)
        if (letterMatch) {
            const letter = letterMatch[1]
            const rest = letterMatch[2].trim()
            const isSequentialLetter =
                letter === "a" ||
                (lastClauseLetter !== null &&
                    letter.charCodeAt(0) === lastClauseLetter.charCodeAt(0) + 1)

            // If it's "i)", "v)", or "x)" and NOT sequential from previous letter (e.g. h->i, u->v),
            // treat it as a roman numeral subitem instead of a top-level letter clause.
            const isAmbiguousRoman = (letter === "i" || letter === "v" || letter === "x") && !isSequentialLetter
            if (!isAmbiguousRoman) {
                const clauseId = `rule-${currentRule.number}-${letter}`
                // Avoid duplicate IDs if a rule repeats a letter (e.g., struck-through duplicate)
                const uniqueId = clauseIds.includes(clauseId) ? undefined : clauseId
                if (uniqueId) {
                    clauseIds.push(uniqueId)
                }
                lastClauseLetter = letter
                currentRule.blocks.push({
                    type: "clause",
                    id: uniqueId,
                    marker: `${letter})`,
                    text: rest,
                })
                continue
            }
        }

        // Roman numeral sub-items: i., ii., iii., i), ii), iii), iv), ...
        const romanMatch = trimmed.match(ROMAN_SUBITEM_RE)
        if (romanMatch && isRomanNumeral(romanMatch[1])) {
            currentRule.blocks.push({
                type: "subitem",
                marker: `${romanMatch[1]}${romanMatch[2]}`,
                text: romanMatch[3].trim(),
            })
            continue
        }

        // Numbered sub-items: 1., 2., 1), ...
        const numMatch = trimmed.match(NUMBER_SUBITEM_RE)
        if (numMatch) {
            currentRule.blocks.push({
                type: "subitem",
                marker: `${numMatch[1]}${numMatch[2]}`,
                text: numMatch[3].trim(),
            })
            continue
        }

        // Default paragraph (including (Note), strikethrough lines, etc.)
        currentRule.blocks.push({
            type: "paragraph",
            text: trimmed,
        })
    }

    finalizeRule()

    return {
        title,
        revisedLine,
        foundingNote,
        sections,
        footnotes,
        ruleIdByNumber,
        clauseIds,
    }
}

/**
 * Converts plain-text rule references like "Rule 102(c)", "Rule 510", "Rule 208 (h)"
 * into internal Markdown anchor links without changing any visible text.
 * Skips existing Markdown links `[...](...)` and raw `http(s)://` URLs.
 */
export function linkRuleReferences(
    text: string,
    ruleIdByNumber: Record<string, string>,
    clauseIdSet: Set<string>
): string {
    return text.replace(
        /(\[[^\]]*\]\([^)]*\)|https?:\/\/\S+)|\b(Rule\s+(\d+)(?:\s*\(([a-z])\))?)/gi,
        (
            fullMatch,
            existingLinkOrUrl: string | undefined,
            _label: string | undefined,
            ruleNum: string | undefined,
            subLetter: string | undefined
        ) => {
            if (existingLinkOrUrl || !ruleNum) return fullMatch
            const ruleAnchor = ruleIdByNumber[ruleNum]
            if (!ruleAnchor) return fullMatch
            if (subLetter) {
                const clauseAnchor = `rule-${ruleNum}-${subLetter.toLowerCase()}`
                if (clauseIdSet.has(clauseAnchor)) {
                    return `[${fullMatch}](#${clauseAnchor})`
                }
            }
            return `[${fullMatch}](#${ruleAnchor})`
        }
    )
}
