import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

const root = path.resolve(__dirname, "..")
const dirs: string[] = []

/** An environment with none of the caller's database settings. */
function cleanEnv(extra: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const name of Object.keys(env)) {
    if (name.startsWith("DATABASE_URL") || name === "DB_TARGET" || name === "VERCEL_ENV") delete env[name]
  }
  return { ...env, ...extra }
}

/** Runs the setup script's config step in a directory holding only these env files. */
function readConfig(files: Record<string, string>, env: Record<string, string> = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "local-db-config-"))
  dirs.push(cwd)
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(cwd, name), content)
  return spawnSync(path.join(root, "node_modules/.bin/tsx"), [path.join(root, "scripts/local-db-config.ts")], {
    cwd,
    env: cleanEnv(env),
    encoding: "utf8",
  })
}

describe("local database config", () => {
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it("reads env files as dotenv does: comments, CRLF, and the last of a repeated key", () => {
    const result = readConfig({
      ".env.local": [
        'DATABASE_URL="postgresql://postgres:postgres@localhost:5432/old"',
        'DATABASE_URL="postgresql://postgres:postgres@localhost:54321/bash" # local',
        "",
      ].join("\r\n"),
    })

    expect(result.stdout).toBe("postgresql://postgres:postgres@localhost:54321/bash\nbash\n54321\n")
  })

  it("puts the environment first, then .env.local, then .env, and defaults the port and database", () => {
    const files = {
      ".env.local": "DATABASE_URL=postgresql://localhost/from_local\n",
      ".env": "DATABASE_URL=postgresql://localhost/from_env\n",
    }

    expect(readConfig(files).stdout).toBe("postgresql://localhost/from_local\nfrom_local\n5432\n")
    expect(readConfig(files, { DATABASE_URL: "postgresql://127.0.0.1:6000" }).stdout).toBe(
      "postgresql://127.0.0.1:6000\npostgres\n6000\n"
    )
  })

  it.each([
    "postgresql://user:pass@ep-example.aws.neon.tech/neondb",
    "postgresql://postgres:postgres@localhost:5432/postgres?host=db.example.com",
    "https://localhost/postgres",
    "",
  ])("makes the setup script refuse %j", (url) => {
    const result = spawnSync("bash", ["scripts/setup-local-db.sh"], {
      cwd: root,
      // DATABASE_URL_DEV and DB_TARGET are set so the developer's own env files can't supply them.
      // If the guard ever let a URL through, the missing compose file stops Docker from doing anything.
      env: cleanEnv({ DB_TARGET: "dev", DATABASE_URL_DEV: url, DATABASE_URL: url, COMPOSE_FILE: "/nonexistent.yml" }),
      encoding: "utf8",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("must point at localhost")
  })
})
