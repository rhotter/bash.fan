import { describe, expect, it } from "vitest"
import { isLocalDbUrl } from "@/lib/db/is-local-db-url"

describe("isLocalDbUrl", () => {
  it.each([
    "postgresql://postgres:postgres@localhost:54321/postgres",
    "postgres://postgres:postgres@127.0.0.1:5432/postgres",
    "postgres://postgres:postgres@[::1]:5432/postgres",
  ])("treats %s as local", (url) => {
    expect(isLocalDbUrl(url)).toBe(true)
  })

  it.each([
    "postgresql://user:pass@ep-example-pooler.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require",
    "postgresql://user:pass@localhost.example.com/neondb",
    "not a url",
  ])("treats %s as remote", (url) => {
    expect(isLocalDbUrl(url)).toBe(false)
  })
})
