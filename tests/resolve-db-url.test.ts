import { describe, expect, it } from "vitest"
import { resolveDbUrl } from "@/lib/db/resolve-db-url"

describe("resolveDbUrl", () => {
  const urls = { DATABASE_URL: "postgres://plain", DATABASE_URL_DEV: "postgres://dev", DATABASE_URL_PROD: "postgres://prod" }

  it("prefers the dev URL outside Vercel production", () => {
    expect(resolveDbUrl(urls)).toEqual({ target: "dev", targetVar: "DATABASE_URL_DEV", source: "DATABASE_URL_DEV", url: "postgres://dev" })
  })

  it("prefers the prod URL on Vercel production", () => {
    expect(resolveDbUrl({ ...urls, VERCEL_ENV: "production" }).url).toBe("postgres://prod")
  })

  it("lets DB_TARGET choose, in any case", () => {
    expect(resolveDbUrl({ ...urls, DB_TARGET: "PROD" }).url).toBe("postgres://prod")
  })

  it("falls back to DATABASE_URL", () => {
    expect(resolveDbUrl({ DATABASE_URL: "postgres://plain" })).toMatchObject({ source: "DATABASE_URL", url: "postgres://plain" })
  })
})
