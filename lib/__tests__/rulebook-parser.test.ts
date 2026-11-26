import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { parseRulebook, linkRuleReferences, type ChangelogEntry } from "@/lib/rulebook-parser"

const markdown = fs.readFileSync(
    path.join(process.cwd(), "public", "bash_rulebook_current.md"),
    "utf-8"
)
const changelog: ChangelogEntry[] = JSON.parse(
    fs.readFileSync(
        path.join(process.cwd(), "public", "rulebooks", "changelog.json"),
        "utf-8"
    )
)

describe("parseRulebook", () => {
    const parsed = parseRulebook(markdown)

    it("parses preamble metadata", () => {
        expect(parsed.title).toBe("OFFICIAL BAY AREA STREET HOCKEY RULEBOOK")
        expect(parsed.revisedLine).toBe("Revised November, 2026")
        expect(parsed.foundingNote).toContain("Mitchell Friedman")
    })

    it("parses all 6 official sections", () => {
        expect(parsed.sections).toHaveLength(6)
        expect(parsed.sections.map((s) => s.id)).toEqual([
            "section-one-the-league-charter",
            "section-two-league-administration",
            "section-three-officials-and-teams",
            "section-four-officials-and-playing-rules",
            "section-five-penalty-categories",
            "section-six-infractions",
        ])
    })

    it("preserves Section Four and Section Five intro notes", () => {
        const sec4 = parsed.sections[3]
        expect(sec4.introCallout).toContain("USA Ball Hockey rulebook")
        expect(sec4.introCallout).toContain("NHL rulebook")

        const sec5 = parsed.sections[4]
        expect(sec5.introCallout).toContain("brief overview of the nature and hierarchy")
    })

    it("preserves every non-empty line from the markdown (zero dropped paragraphs)", () => {
        const nonEmptyLines = markdown
            .replace(/\r\n/g, "\n")
            .split("\n")
            .filter((l) => l.trim().length > 0).length
        const parsedCount =
            (parsed.title ? 1 : 0) +
            (parsed.revisedLine ? 1 : 0) +
            (parsed.foundingNote ? parsed.foundingNote.split("\n").length : 0) +
            Object.keys(parsed.footnotes).length +
            parsed.sections.reduce(
                (sum, sec) =>
                    sum +
                    1 +
                    (sec.introCallout ? sec.introCallout.split("\n").length : 0) +
                    sec.rules.reduce((rSum, r) => rSum + 1 + r.blocks.length, 0),
                0
            )
        expect(parsedCount).toBe(nonEmptyLines)
    })

    it("preserves native list numbering/lettering in Rules 204, 219, 220, 411, 417, 601, and 616", () => {
        // Rule 616 clauses a)-e)
        const rule616 = parsed.sections[5].rules.find((r) => r.number === "616")!
        const rule616Clauses = rule616.blocks.filter((b) => b.type === "clause")
        expect(rule616Clauses.map((c) => c.id)).toEqual([
            "rule-616-a",
            "rule-616-b",
            "rule-616-c",
            "rule-616-d",
            "rule-616-e",
        ])

        // Rule 601 uppercase I) following h)
        const rule601 = parsed.sections[5].rules.find((r) => r.number === "601")!
        expect(rule601.blocks.some((b) => b.type === "clause" && b.id === "rule-601-i")).toBe(true)

        // Rule 220 a) and Rule 417 a)
        expect(parsed.clauseIds).toContain("rule-220-a")
        expect(parsed.clauseIds).toContain("rule-417-a")

        // Rule 203(c)(i) unescaped #
        expect(markdown).not.toContain("\\#")
    })

    it("parses all 86 official rules including Rule 221, 416, 417, 621, and 628", () => {
        const allRules = parsed.sections.flatMap((s) => s.rules)
        expect(allRules).toHaveLength(86)

        expect(parsed.ruleIdByNumber["221"]).toBe("rule-221-deleted")
        expect(parsed.ruleIdByNumber["416"]).toBe("rule-416-video-photo-review")
        expect(parsed.ruleIdByNumber["417"]).toBe("rule-417-rule-challenges")
        expect(parsed.ruleIdByNumber["621"]).toBe(
            "rule-621-leaving-the-players-bench-or-penalty-bench"
        )
        expect(parsed.ruleIdByNumber["628"]).toBe("rule-628-sean-avery-rule")
    })

    it("keeps Rule 621 verbatim with all clauses (a, b, etc.)", () => {
        const sec6 = parsed.sections[5]
        const rule621 = sec6.rules.find((r) => r.number === "621")
        expect(rule621).toBeDefined()
        const clauses = rule621!.blocks.filter((b) => b.type === "clause")
        expect(clauses.length).toBeGreaterThanOrEqual(4)
        expect(clauses[0].id).toBe("rule-621-a")
        expect(clauses[1].id).toBe("rule-621-b")
        expect(clauses[1].text).toContain("major plus a game misconduct penalty")
    })

    it("disambiguates roman numeral i) from lettered clause i)", () => {
        const sec2 = parsed.sections[1]
        // Rule 210 has a), then i), ii), iii), then b), c)
        const rule210 = sec2.rules.find((r) => r.number === "210")!
        const rule210Clauses = rule210.blocks.filter((b) => b.type === "clause")
        expect(rule210Clauses.map((c) => c.id)).toEqual([
            "rule-210-a",
            "rule-210-b",
            "rule-210-c",
        ])
        const rule210Subitems = rule210.blocks.filter((b) => b.type === "subitem")
        expect(rule210Subitems.map((s) => s.marker)).toEqual(["i)", "ii)", "iii)"])

        // Rule 211 has a) through i)
        const rule211 = sec2.rules.find((r) => r.number === "211")!
        const rule211Clauses = rule211.blocks.filter((b) => b.type === "clause")
        expect(rule211Clauses.map((c) => c.id)).toContain("rule-211-i")
    })

    it("extracts both official footnotes", () => {
        expect(parsed.footnotes["1"]).toContain("abstentions")
        expect(parsed.footnotes["2"]).toContain("6-team league")
    })

    it("links Rule references without corrupting existing markdown links or URLs", () => {
        const clauseSet = new Set(parsed.clauseIds)
        expect(
            linkRuleReferences("[see Rule 102(c)]", parsed.ruleIdByNumber, clauseSet)
        ).toBe("[see [Rule 102(c)](#rule-102-c)]")
        expect(
            linkRuleReferences("[see Rule 621]", parsed.ruleIdByNumber, clauseSet)
        ).toBe("[see [Rule 621](#rule-621-leaving-the-players-bench-or-penalty-bench)]")
        expect(
            linkRuleReferences("[See Rule 102](https://example.com)", parsed.ruleIdByNumber, clauseSet)
        ).toBe("[See Rule 102](https://example.com)")
    })

    it("validates standardized changelog schema and resolves every changelog anchor", () => {
        const validIds = new Set<string>([
            ...parsed.sections.map((s) => s.id),
            ...parsed.sections.flatMap((s) => s.rules.map((r) => r.id)),
            ...parsed.clauseIds,
        ])
        expect(changelog.length).toBeGreaterThanOrEqual(1)
        for (const entry of changelog) {
            expect(entry.version).toMatch(/^v\d{4}\.\d{2}$/)
            expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
            expect(entry.title).toBeTruthy()
            expect(entry.items && entry.items.length > 0).toBe(true)
            for (const item of entry.items ?? []) {
                expect(item.ruleRef).toBeTruthy()
                expect(item.text).toBeTruthy()
                if (item.ruleAnchor) {
                    expect(validIds.has(item.ruleAnchor)).toBe(true)
                }
            }
        }
    })
})
