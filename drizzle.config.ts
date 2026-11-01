import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Defined in lib/push/schema.sql, not schema.ts, so push must not offer to drop them.
  tablesFilter: ["!push_*"],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
