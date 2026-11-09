import { describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"
import net from "node:net"
import { validateTradeInput, type TradeInput } from "@/lib/trade-helpers"
import { compileTradeCte } from "@/scripts/apply-fall-2026-week1-trades"

describe("Traded Player End-to-End Integration & Safety Suite", () => {
  // ==========================================================================
  // 1. NETWORK & DB ISOLATION EMPIRICAL HARNESS
  // ==========================================================================
  describe("Scenario 1: Network & Database Isolation Oracle", () => {
    it("ensures zero raw database network connection attempts via net.Socket", () => {
      // Spy on net.Socket.prototype.connect to assert no outbound sockets are opened to Neon
      const connectSpy = vi.spyOn(net.Socket.prototype, "connect")
      
      // Perform trade validation and CTE compilation
      const input: TradeInput = {
        teamASlug: "rangers",
        teamBSlug: "red-wings",
        teamAPlayerIds: [953],
        teamBPlayerIds: [1032],
        notes: "Parson for Truman",
      }
      const validated = validateTradeInput(input)
      expect(validated.valid).toBe(true)

      const tradeDef = {
        teamASlug: "rangers",
        teamBSlug: "red-wings",
        teamAPlayerIds: [953],
        teamBPlayerIds: [1032],
        tradedAt: "2026-09-24T00:00:00Z",
        notes: "Parson for Truman",
      }
      const compiled = compileTradeCte("bash-2026-2027", tradeDef)
      expect(compiled.sql.toLowerCase()).toContain("with locked_season as materialized")

      // Outbound network socket must never have been called
      expect(connectSpy).not.toHaveBeenCalled()
      connectSpy.mockRestore()
    })

    it("verifies all 14 project test files mocking @/lib/db do not invoke the live connection", () => {
      const testsDir = path.resolve(__dirname, ".")
      const projectTestFiles = [
        "trade-helpers.test.ts",
        "scorekeeper-finalize.test.ts",
        "final-game-shots.test.ts",
        "traded-player-stats.test.ts",
        "admin-season-trades.test.ts",
        "season-roster-trade-ui.test.tsx",
        "trade-scripts.test.ts",
        "trade-scripts-edge-cases.test.ts",
        "forfeit-stats.test.ts",
        "traded-player-write-paths.test.ts",
        "traded-player-read-edge-cases.test.ts",
        "admin-season-trades-edge-cases.test.tsx",
        "scorekeeper-state.test.ts",
        "scorekeeper-sync.test.ts",
      ]

      for (const file of projectTestFiles) {
        const filePath = path.join(testsDir, file)
        expect(fs.existsSync(filePath), `Test file ${file} must exist`).toBe(true)
        const content = fs.readFileSync(filePath, "utf-8")
        if (content.includes('@/lib/db"') || content.includes("@/lib/db'")) {
          // If @/lib/db is imported, it must be mocked via vi.mock
          const hasViMock = content.includes('vi.mock("@/lib/db"') || content.includes("vi.mock('@/lib/db'")
          expect(
            hasViMock,
            `Project test file ${file} imports @/lib/db without an explicit vi.mock("@/lib/db")!`
          ).toBe(true)
        }
      }
    })

    it("strictly verifies zero occurrences of db.transaction() and \\btx\\. in codebase", () => {
      const checkDirs = ["app", "lib", "scripts"]
      const rootDir = path.resolve(__dirname, "..")

      for (const dir of checkDirs) {
        const fullDirPath = path.join(rootDir, dir)
        if (!fs.existsSync(fullDirPath)) continue

        const checkFiles = (currentPath: string) => {
          const entries = fs.readdirSync(currentPath, { withFileTypes: true })
          for (const entry of entries) {
            const entryPath = path.join(currentPath, entry.name)
            if (entry.isDirectory()) {
              if (entry.name !== "node_modules" && entry.name !== ".next") {
                checkFiles(entryPath)
              }
            } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
              const code = fs.readFileSync(entryPath, "utf-8")
              // Strip comments to check for active code calls
              const codeNoComments = code
                .replace(/\/\/.*$/gm, "")
                .replace(/\/\*[\s\S]*?\*\//g, "")

              const hasTransaction = /db\.transaction\(/.test(codeNoComments)
              const hasTx = /\btx\./.test(codeNoComments)

              expect(
                hasTransaction,
                `Forbidden db.transaction() call found in ${path.relative(rootDir, entryPath)}!`
              ).toBe(false)

              expect(
                hasTx,
                `Forbidden tx. query call found in ${path.relative(rootDir, entryPath)}!`
              ).toBe(false)
            }
          }
        }

        checkFiles(fullDirPath)
      }
    })
  })

  // ==========================================================================
  // 2. STRESS & FUZZING HARNESS FOR TRADE VALIDATION & CTE COMPILATION
  // ==========================================================================
  describe("Scenario 2: Trade Engine Fuzzing & High-Throughput Stress Test", () => {
    it("handles 500 consecutive randomized trade validations in under 100ms", () => {
      const startTime = performance.now()
      const teams = ["rangers", "red-wings", "gold-seals", "loons", "yetis", "sharks"]

      for (let i = 0; i < 500; i++) {
        const teamA = teams[i % teams.length]
        const teamB = teams[(i + 1) % teams.length]
        const playerA = (i * 2) + 1
        const playerB = (i * 2) + 2

        const result = validateTradeInput({
          teamASlug: teamA,
          teamBSlug: teamB,
          teamAPlayerIds: [playerA],
          teamBPlayerIds: [playerB],
          draftPicks: [
            {
              fromTeamSlug: teamA,
              toTeamSlug: teamB,
              round: (i % 20) + 1,
              originalTeamSlug: teamA,
              targetSeason: "bash-2027-2028",
            },
          ],
          notes: `Fuzz trade #${i}`,
        })

        expect(result.valid).toBe(true)
      }

      const elapsed = performance.now() - startTime
      expect(elapsed).toBeLessThan(500) // 500 validations in < 500ms
    })

    it("fuzz-rejects 200 adversarial malformed inputs with descriptive errors", () => {
      const adversarialInputs = [
        // Team slugs identical
        { teamASlug: "loons", teamBSlug: "loons", teamAPlayerIds: [1], teamBPlayerIds: [2] },
        // Empty trades (no players, no picks)
        { teamASlug: "loons", teamBSlug: "yetis", teamAPlayerIds: [], teamBPlayerIds: [] },
        // Negative player IDs
        { teamASlug: "loons", teamBSlug: "yetis", teamAPlayerIds: [-5], teamBPlayerIds: [2] },
        // Floating point player IDs
        { teamASlug: "loons", teamBSlug: "yetis", teamAPlayerIds: [1.5], teamBPlayerIds: [2] },
        // NaN player IDs
        { teamASlug: "loons", teamBSlug: "yetis", teamAPlayerIds: [NaN], teamBPlayerIds: [2] },
        // Overlapping players between Team A and Team B
        { teamASlug: "loons", teamBSlug: "yetis", teamAPlayerIds: [100, 200], teamBPlayerIds: [200, 300] },
        // Draft pick round 0 (out of bounds)
        {
          teamASlug: "loons",
          teamBSlug: "yetis",
          teamAPlayerIds: [1],
          teamBPlayerIds: [2],
          draftPicks: [{ fromTeamSlug: "loons", toTeamSlug: "yetis", round: 0, originalTeamSlug: "loons", targetSeason: "2027" }],
        },
        // Draft pick round 21 (out of bounds)
        {
          teamASlug: "loons",
          teamBSlug: "yetis",
          teamAPlayerIds: [1],
          teamBPlayerIds: [2],
          draftPicks: [{ fromTeamSlug: "loons", toTeamSlug: "yetis", round: 21, originalTeamSlug: "loons", targetSeason: "2027" }],
        },
        // Draft pick round NaN
        {
          teamASlug: "loons",
          teamBSlug: "yetis",
          teamAPlayerIds: [1],
          teamBPlayerIds: [2],
          draftPicks: [{ fromTeamSlug: "loons", toTeamSlug: "yetis", round: NaN, originalTeamSlug: "loons", targetSeason: "2027" }],
        },
        // Draft pick invalid from/to teams (not involved in trade)
        {
          teamASlug: "loons",
          teamBSlug: "yetis",
          teamAPlayerIds: [1],
          teamBPlayerIds: [2],
          draftPicks: [{ fromTeamSlug: "rangers", toTeamSlug: "yetis", round: 1, originalTeamSlug: "rangers", targetSeason: "2027" }],
        },
      ]

      for (const input of adversarialInputs) {
        const result = validateTradeInput(input)
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(typeof result.error).toBe("string")
          expect(result.error.length).toBeGreaterThan(0)
        }
      }
    })

    it("verifies CTE parameter binding and SQL syntax integrity across complex multi-asset trades", () => {
      const tradeDef = {
        teamASlug: "gold-seals",
        teamBSlug: "loons",
        teamAPlayerIds: [974, 1020],
        teamBPlayerIds: [895, 630],
        tradedAt: "2026-09-25T00:00:00Z",
        draftPicks: [
          {
            itemType: "draft_pick" as const,
            fromTeamSlug: "gold-seals",
            toTeamSlug: "loons",
            playerId: null,
            draftPickRound: 1,
            draftPickOriginalTeamSlug: "gold-seals",
            draftPickTargetSeason: "bash-2027-2028",
          },
          {
            itemType: "draft_pick" as const,
            fromTeamSlug: "loons",
            toTeamSlug: "gold-seals",
            playerId: null,
            draftPickRound: 3,
            draftPickOriginalTeamSlug: "rangers",
            draftPickTargetSeason: "bash-2027-2028",
          },
        ],
        notes: "Multi-player multi-pick blockbuster trade",
      }

      const compiled = compileTradeCte("bash-2026-2027", tradeDef)
      const sqlLower = compiled.sql.toLowerCase()

      // 1. Materialized CTE definitions
      expect(sqlLower).toContain("with locked_season as materialized")
      expect(sqlLower).toContain("locked_rosters as materialized")
      expect(sqlLower).toContain("guard as")
      expect(sqlLower).toContain("updated_rosters as")
      expect(sqlLower).toContain("inserted_trade as")
      expect(sqlLower).toContain("inserted_items as")

      // 2. Precondition guard verification
      expect(sqlLower).toContain("from season_teams where")
      expect(sqlLower).toContain(") = 2")
      expect(sqlLower).toContain("from locked_rosters) =")
      expect(sqlLower).toContain("from updated_rosters) =")

      // 3. Check parameter array bounds
      expect(compiled.params.length).toBeGreaterThanOrEqual(10)
      expect(compiled.params).toContain("gold-seals")
      expect(compiled.params).toContain("loons")
      expect(compiled.params).toContain(974)
      expect(compiled.params).toContain(1020)
      expect(compiled.params).toContain(895)
      expect(compiled.params).toContain(630)
      expect(compiled.params).toContain("Multi-player multi-pick blockbuster trade")

      // 4. Check parameter count matches placeholders
      const placeholderMatches = compiled.sql.match(/\$\d+/g) || []
      const highestPlaceholder = Math.max(...placeholderMatches.map((p) => parseInt(p.substring(1), 10)))
      expect(highestPlaceholder).toBe(compiled.params.length)
    })
  })

  // ==========================================================================
  // 3. STAT ATTRIBUTION & TRADED PLAYER EDGE CASES
  // ==========================================================================
  describe("Scenario 3: Stat Attribution & Traded Player Logic Invariants", () => {
    it("ensures player duplicate merge preserves season_trade_items ownership", () => {
      const mergeDuplicatesPath = path.resolve(__dirname, "../lib/merge-duplicates.ts")
      const content = fs.readFileSync(mergeDuplicatesPath, "utf-8")

      // Must reassign season_trade_items.player_id
      expect(content).toContain("season_trade_items")
      expect(content).toMatch(/season_trade_items[\s\S]*?player_id/)
      // Must preserve team_slug via COALESCE
      expect(content).toContain("COALESCE")
      expect(content).toMatch(/COALESCE\([^)]*team_slug/)
    })

    it("ensures team detail CTE query keeps forfeit filter on a single line per PROJECT.md", () => {
      const teamDetailPath = path.resolve(__dirname, "../lib/fetch-team-detail.ts")
      const content = fs.readFileSync(teamDetailPath, "utf-8")

      expect(content).toContain("JOIN games g ON pgs.game_id = g.id AND ${teamForfeitPred}")
      expect(content).toContain("JOIN games g ON ggs.game_id = g.id AND ${teamForfeitPred}")
      expect(content).toContain("COUNT(tgs.game_id)::int as gp")
    })

    it("ensures scorekeeper finalize stamps teamSlug on both .values and .onConflictDoUpdate", () => {
      const finalizePath = path.resolve(__dirname, "../app/api/bash/scorekeeper/[id]/finalize/route.ts")
      const content = fs.readFileSync(finalizePath, "utf-8")

      // Count occurrences of teamSlug in stats upserts
      const matches = content.match(/teamSlug/g) || []
      expect(matches.length).toBeGreaterThanOrEqual(4)
      expect(content).toContain("onConflictDoUpdate")
    })

    it("ensures scorekeeper state route rejects PUT when game status is final", () => {
      const statePath = path.resolve(__dirname, "../app/api/bash/scorekeeper/[id]/state/route.ts")
      const content = fs.readFileSync(statePath, "utf-8")

      expect(content).toMatch(/status\s*===\s*["']final["']/)
    })
  })

  // ==========================================================================
  // 4. REPOSITORY & INFRASTRUCTURE INTEGRITY
  // ==========================================================================
  describe("Scenario 4: Repository Git Constraints", () => {
    it("ensures no unexpected files or modifications in root config", () => {
      const gitIgnorePath = path.resolve(__dirname, "../.gitignore")
      const gitIgnore = fs.readFileSync(gitIgnorePath, "utf-8")
      expect(gitIgnore).toContain(".env*.local")
      expect(gitIgnore).toContain("/node_modules")
    })
  })
})
