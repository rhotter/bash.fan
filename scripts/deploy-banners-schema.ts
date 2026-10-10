import "./env"
import { neon } from "@neondatabase/serverless"

interface ColumnInfo {
  column_name: string
  data_type: string
  is_nullable: string
  column_default: string | null
}

interface ScriptOptions {
  dbUrl: string
  dryRun: boolean
}

function parseArgs(): ScriptOptions {
  const args = process.argv.slice(2)
  let dbUrl = process.env.PROD_URL || process.env.DATABASE_URL || ""
  let dryRun = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--url" || arg === "--db" || arg === "--prod" || arg === "--to") {
      if (args[i + 1]) dbUrl = args[++i]
    } else if (arg === "--dry-run" || arg === "-n") {
      dryRun = true
    }
  }
  return { dbUrl, dryRun }
}

function describeDbEndpoint(dbUrl: string): { host: string; label: string } {
  try {
    const parsed = new URL(dbUrl)
    const host = parsed.host
    if (process.env.DB_LABEL) {
      return { host, label: process.env.DB_LABEL }
    }
    if (host.includes("ep-frosty-shadow")) {
      return { host, label: "Website Live Production DB (ep-frosty-shadow)" }
    }
    if (host.includes("ep-winter-bird")) {
      return { host, label: "Dev DB (ep-winter-bird / bash_ranger)" }
    }
    return { host, label: "Custom DB" }
  } catch {
    return { host: "unknown", label: process.env.DB_LABEL ?? "Unknown DB" }
  }
}

/**
 * Standalone, idempotent migration script for site_banners table.
 * Strictly NO db.transaction() — executes sequentially via direct neon HTTP connection.
 */
async function main() {
  const { dbUrl, dryRun } = parseArgs()
  if (!dbUrl) {
    throw new Error(
      "Missing database connection URL. Provide via --url '<url>', PROD_URL='<url>', or DATABASE_URL in .env.local."
    )
  }

  const { host, label } = describeDbEndpoint(dbUrl)
  console.log("====================================================")
  console.log(`  Deploying Site Banners Schema ${dryRun ? "[DRY RUN — READ ONLY]" : ""}`)
  console.log(`  Target: ${label}`)
  console.log(`  Host:   ${host}`)
  console.log("====================================================")

  const sql = neon(dbUrl)

  if (dryRun) {
    console.log("\n[DRY RUN] Inspecting target database status (read-only)...")
    const meta = (await sql`
      SELECT current_database() as db_name, current_user as user_name, version() as pg_version
    `) as { db_name: string; user_name: string; pg_version: string }[]
    console.log(`  • Connected Database : ${meta[0]?.db_name}`)
    console.log(`  • Connected Role     : ${meta[0]?.user_name}`)

    const gamesCount = (await sql`SELECT count(*)::text as count FROM games`) as { count: string }[]
    const seasonsCount = (await sql`SELECT count(*)::text as count FROM seasons`) as { count: string }[]
    console.log(`  • Existing Data Check: ${seasonsCount[0]?.count} seasons, ${gamesCount[0]?.count} games present and healthy`)

    const tableCheck = (await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'site_banners'
      ) as exists
    `) as { exists: boolean }[]

    const tableExists = Boolean(tableCheck[0]?.exists)
    console.log(`  • Table 'site_banners' : ${tableExists ? "ALREADY EXISTS" : "NOT FOUND (will be created)"}`)

    if (tableExists) {
      const existingCols = (await sql`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'site_banners'
        ORDER BY ordinal_position
      `) as { column_name: string; data_type: string; is_nullable: string }[]
      console.log(`    Current columns (${existingCols.length}): ${existingCols.map((c) => c.column_name).join(", ")}`)

      const actualNames = existingCols.map((c) => c.column_name)
      const missing = [
        "id", "label", "mobile_label", "href", "variant", "is_active",
        "start_date", "end_date", "countdown_type", "countdown_target",
        "priority", "dismiss_version", "hide_on_paths", "created_at", "updated_at"
      ].filter((col) => !actualNames.includes(col))

      if (missing.length === 0) {
        console.log("    ✓ All 15 required columns are already present.")
      } else {
        console.log(`    Missing columns to add: ${missing.join(", ")}`)
      }
    }

    const indexCheck = (await sql`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'site_banners'
    `) as { indexname: string; indexdef: string }[]
    const hasIndex = indexCheck.some((idx) => idx.indexname === "idx_site_banners_active_priority")
    console.log(`  • Index 'idx_site_banners_active_priority' : ${hasIndex ? "ALREADY EXISTS" : "WILL BE CREATED"}`)

    console.log("\n[DRY RUN] DDL Execution Plan:")
    console.log("  1. CREATE TABLE IF NOT EXISTS site_banners (id text PRIMARY KEY, ...)")
    console.log("  2. ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS (14 columns)")
    console.log("  3. DROP INDEX IF EXISTS idx_site_banners_active_priority")
    console.log("  4. CREATE INDEX IF NOT EXISTS idx_site_banners_active_priority ON site_banners (is_active, priority DESC, updated_at DESC)")
    console.log("  5. Verify 15 columns via information_schema.columns")

    console.log("\n====================================================")
    console.log("  ✓ DRY RUN COMPLETE — 0 mutations executed.")
    console.log("    Database was inspected in read-only mode.")
    console.log("====================================================")
    return
  }

  console.log("\n[1/4] Creating table 'site_banners' if not exists...")
  await sql`
    CREATE TABLE IF NOT EXISTS site_banners (
      id text PRIMARY KEY,
      label text NOT NULL,
      mobile_label text,
      href text NOT NULL,
      variant text NOT NULL DEFAULT 'default',
      is_active boolean NOT NULL DEFAULT true,
      start_date timestamp with time zone,
      end_date timestamp with time zone,
      countdown_type text NOT NULL DEFAULT 'none',
      countdown_target timestamp with time zone,
      priority integer NOT NULL DEFAULT 10,
      dismiss_version integer NOT NULL DEFAULT 1,
      hide_on_paths text[] NOT NULL DEFAULT ARRAY['/admin']::text[],
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `
  console.log("  ✓ Table 'site_banners' created or already exists")

  console.log("\n[2/4] Verifying and applying column definitions...")
  await sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT ''`
  await sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS mobile_label text`
  await sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS href text NOT NULL DEFAULT '/'`
  await sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS variant text NOT NULL DEFAULT 'default'`
  await sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true`
  await sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS start_date timestamp with time zone`
  await sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS end_date timestamp with time zone`
  await sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS countdown_type text NOT NULL DEFAULT 'none'`
  await sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS countdown_target timestamp with time zone`
  await sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 10`
  await sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS dismiss_version integer NOT NULL DEFAULT 1`
  await sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS hide_on_paths text[] NOT NULL DEFAULT ARRAY['/admin']::text[]`
  await sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now()`
  await sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now()`
  console.log("  ✓ All 15 columns verified and patched if needed")

  console.log("\n[3/4] Creating index 'idx_site_banners_active_priority'...")
  await sql`DROP INDEX IF EXISTS idx_site_banners_active_priority`
  await sql`
    CREATE INDEX IF NOT EXISTS idx_site_banners_active_priority
      ON site_banners (is_active, priority DESC, updated_at DESC)
  `
  console.log("  ✓ Index 'idx_site_banners_active_priority' verified")

  console.log("\n[4/4] Verifying database schema integrity...")
  const rows = (await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'site_banners'
    ORDER BY ordinal_position
  `) as ColumnInfo[]

  console.log(`\nTable 'site_banners' contains ${rows.length} columns:`)
  for (const r of rows) {
    console.log(`  - ${r.column_name.padEnd(18)} : ${r.data_type.padEnd(26)} (nullable: ${r.is_nullable})`)
  }

  const expectedColumns = [
    "id",
    "label",
    "mobile_label",
    "href",
    "variant",
    "is_active",
    "start_date",
    "end_date",
    "countdown_type",
    "countdown_target",
    "priority",
    "dismiss_version",
    "hide_on_paths",
    "created_at",
    "updated_at",
  ]

  const actualColumns = rows.map((r) => r.column_name)
  const missing = expectedColumns.filter((col) => !actualColumns.includes(col))

  if (missing.length > 0) {
    throw new Error(`Schema verification failed. Missing columns: ${missing.join(", ")}`)
  }

  console.log("\n====================================================")
  console.log("  ✓ Site Banners Migration completed successfully!")
  console.log("====================================================")
}

main().catch((err) => {
  console.error("\n❌ Migration failed with error:", err)
  process.exit(1)
})
