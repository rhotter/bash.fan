import "./env"
import { rawSql } from "../lib/db"
import { sql } from "drizzle-orm"

interface ColumnInfo {
  column_name: string
  data_type: string
  is_nullable: string
  column_default: string | null
}

/**
 * Standalone, idempotent migration script for site_banners table.
 * Strictly NO db.transaction() — executes sequentially via rawSql.
 */
async function main() {
  console.log("====================================================")
  console.log("  Deploying Site Banners Schema (Milestone 1)")
  console.log("====================================================")

  console.log("\n[1/4] Creating table 'site_banners' if not exists...")
  await rawSql(sql`
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
  `)
  console.log("  ✓ Table 'site_banners' created or already exists")

  console.log("\n[2/4] Verifying and applying column definitions...")
  const columnsToAdd = [
    sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT ''`,
    sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS mobile_label text`,
    sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS href text NOT NULL DEFAULT '/'`,
    sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS variant text NOT NULL DEFAULT 'default'`,
    sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true`,
    sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS start_date timestamp with time zone`,
    sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS end_date timestamp with time zone`,
    sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS countdown_type text NOT NULL DEFAULT 'none'`,
    sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS countdown_target timestamp with time zone`,
    sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 10`,
    sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS dismiss_version integer NOT NULL DEFAULT 1`,
    sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS hide_on_paths text[] NOT NULL DEFAULT ARRAY['/admin']::text[]`,
    sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now()`,
    sql`ALTER TABLE site_banners ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now()`,
  ]

  for (const alterStmt of columnsToAdd) {
    await rawSql(alterStmt)
  }
  console.log("  ✓ All 15 columns verified and patched if needed")

  console.log("\n[3/4] Creating index 'idx_site_banners_active_priority'...")
  await rawSql(sql`
    DROP INDEX IF EXISTS idx_site_banners_active_priority;
    CREATE INDEX IF NOT EXISTS idx_site_banners_active_priority
      ON site_banners (is_active, priority DESC, updated_at DESC)
  `)
  console.log("  ✓ Index 'idx_site_banners_active_priority' verified")

  console.log("\n[4/4] Verifying database schema integrity...")
  const rows = (await rawSql(sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'site_banners'
    ORDER BY ordinal_position
  `)) as ColumnInfo[]

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
