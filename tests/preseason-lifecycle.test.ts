import { describe, expect, it } from "vitest"
import fs from "fs"
import path from "path"

describe("R1: Season Detail Page Header Actions", () => {
  const filePath = path.resolve(__dirname, "../components/admin/season-header-actions.tsx")
  const content = fs.readFileSync(filePath, "utf-8")

  it("defines SeasonHeaderActions component with required props", () => {
    expect(content).toContain("export function SeasonHeaderActions")
    expect(content).toContain("seasonId: string")
    expect(content).toContain("seasonName: string")
    expect(content).toContain("isCurrent: boolean")
  })

  it("renders Current Season (Homepage) badge when isCurrent is true", () => {
    expect(content).toContain("Current Season (Homepage)")
    expect(content).toContain("border-primary/40 text-primary bg-primary/5")
  })

  it("renders Set as Current Season button when isCurrent is false", () => {
    expect(content).toContain("Set as Current Season")
  })

  it("contains exact required confirmation dialog title and copy", () => {
    expect(content).toContain("<AlertDialogTitle>Set as Current Season?</AlertDialogTitle>")
    expect(content).toContain("This will make <strong>{seasonName}</strong>")
    expect(content.replace(/\s+/g, " ")).toContain(
      "This will make <strong>{seasonName}</strong> the default season on the public homepage, displaying its tryout games and announcements. The season will remain in Draft status, so teams, rosters, drafts, and schedules remain fully editable."
    )
  })

  it("dispatches PUT request with isCurrent: true and refreshes router", () => {
    expect(content).toContain("fetch(`/api/bash/admin/seasons/${seasonId}`")
    expect(content).toContain('body: JSON.stringify({ isCurrent: true })')
    expect(content).toContain('toast.success("Season set as current")')
    expect(content).toContain("router.refresh()")
  })
})

describe("R2: Season Settings Form Updates", () => {
  const filePath = path.resolve(__dirname, "../components/admin/season-form.tsx")
  const content = fs.readFileSync(filePath, "utf-8")

  it("includes Featured on Homepage toggle card with Switch and status badge", () => {
    expect(content).toContain("Featured on Homepage")
    expect(content).toContain("Current Season (Homepage)")
    expect(content).toContain("Not Featured")
    expect(content).toContain('<Switch')
    expect(content).toContain('id="isCurrent"')
  })

  it("matches active status description in STATUS_OPTIONS exactly", () => {
    const expectedDescription =
      "Move to Active after the draft is finalized and you're ready for regular season games to begin. Official standings, stats tracking, and regular season scoring will be enabled."
    expect(content).toContain(expectedDescription)
  })

  it("matches active transition prompt description exactly", () => {
    const expectedDescription =
      "Move to Active after the draft is finalized and you're ready for regular season games to begin. Official standings, stats tracking, and regular season scoring will be enabled."
    // Appears in both STATUS_OPTIONS and promptStatusTransition
    const occurrences = content.split(expectedDescription).length - 1
    expect(occurrences).toBe(2)
  })
})

describe("R3: Season Activation Checklist Copy Update", () => {
  const filePath = path.resolve(__dirname, "../components/admin/season-activation-checklist.tsx")
  const content = fs.readFileSync(filePath, "utf-8")

  it("matches exact Ready for Week 1 confirmation dialog description", () => {
    const expected =
      "This indicates the league is Ready for Week 1: the draft is finalized, regular season schedule is confirmed, and official standings and stats tracking will begin. Are you sure you want to proceed?"
    expect(content.replace(/\s+/g, " ")).toContain(expected)
  })
})



describe("R6 & Global Hygiene", () => {
  it("ensures .agents/teamwork/ is ignored in .gitignore", () => {
    const gitignorePath = path.resolve(__dirname, "../.gitignore")
    const gitignore = fs.readFileSync(gitignorePath, "utf-8")
    expect(gitignore).toContain(".agents/teamwork/")
  })

  it("ensures Toaster is mounted in app/layout.tsx for site-wide toast feedback", () => {
    const layoutPath = path.resolve(__dirname, "../app/layout.tsx")
    const layoutContent = fs.readFileSync(layoutPath, "utf-8")
    expect(layoutContent).toContain("import { Toaster } from '@/components/ui/sonner'")
    expect(layoutContent).toContain("<Toaster />")
  })

  it("ensures build script in package.json uses next build --webpack to prevent Turbopack Google Fonts fetch failure", () => {
    const pkgPath = path.resolve(__dirname, "../package.json")
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
    expect(pkg.scripts.build).toBe("next build --webpack")
  })
})

describe("R7: Current Season Fallback to Last Completed Season", () => {
  const filePath = path.resolve(__dirname, "../lib/seasons.ts")
  const content = fs.readFileSync(filePath, "utf-8")

  it("checks for isCurrent: true first", () => {
    expect(content).toContain("schema.seasons.isCurrent, true")
  })

  it("falls back to querying status: 'completed' when no season is current", () => {
    expect(content).toContain('schema.seasons.status, "completed"')
  })

  it("orders completed seasons chronologically by max game date with season ID tie-breaker", () => {
    expect(content).toContain("SELECT MAX(date) FROM games WHERE games.season_id = seasons.id")
    expect(content).toContain("DESC NULLS LAST")
    expect(content).toContain("desc(schema.seasons.id)")
  })

  it("includes ultimate fallback to newest season by ID if no completed seasons exist", () => {
    expect(content).toContain("const fallback = await db.query.seasons.findFirst({ orderBy: [desc(schema.seasons.id)] })")
  })
})

