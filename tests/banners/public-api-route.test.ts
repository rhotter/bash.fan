import { describe, expect, it, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
}))

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema")
  return {
    db: {
      select: mocks.select,
    },
    schema,
  }
})

import { GET } from "@/app/api/bash/banners/route"

describe("Public Banner API Route: GET /api/bash/banners", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 200 with null banner and Cache-Control headers when no banners match", async () => {
    mocks.select.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      }),
    })

    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=30, stale-while-revalidate=60",
    )
    const data = await res.json()
    expect(data.banner).toBeNull()
  })

  it("returns 200 with top eligible banner and Cache-Control headers", async () => {
    const mockRow = {
      id: "banner-1",
      label: "Playoffs are live!",
      mobileLabel: "Playoffs",
      href: "/standings",
      variant: "live",
      isActive: true,
      startDate: new Date("2026-10-01T00:00:00Z"),
      endDate: new Date("2026-10-15T00:00:00Z"),
      countdownType: "none",
      countdownTarget: null,
      priority: 50,
      dismissVersion: 1,
      hideOnPaths: ["/admin"],
      createdAt: new Date("2026-10-01T00:00:00Z"),
      updatedAt: new Date("2026-10-01T00:00:00Z"),
    }

    mocks.select.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve([mockRow]),
          }),
        }),
      }),
    })

    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=30, stale-while-revalidate=60",
    )
    const data = await res.json()
    expect(data.banner).not.toBeNull()
    expect(data.banner.id).toBe("banner-1")
    expect(data.banner.label).toBe("Playoffs are live!")
    expect(data.banner.mobileLabel).toBe("Playoffs")
    expect(data.banner.variant).toBe("live")
  })

  it("skips deadline-expired banner in query results", async () => {
    const expiredDeadlineRow = {
      id: "deadline-expired",
      label: "Registration Ending",
      mobileLabel: null,
      href: "/register",
      variant: "warning",
      isActive: true,
      startDate: null,
      endDate: null,
      countdownType: "deadline",
      countdownTarget: new Date("2026-01-01T00:00:00Z"), // in past
      priority: 100,
      dismissVersion: 1,
      hideOnPaths: ["/admin"],
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const fallbackRow = {
      id: "general-announcement",
      label: "Summer Season Coming Soon",
      mobileLabel: null,
      href: "/scores",
      variant: "default",
      isActive: true,
      startDate: null,
      endDate: null,
      countdownType: "none",
      countdownTarget: null,
      priority: 10,
      dismissVersion: 1,
      hideOnPaths: ["/admin"],
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    mocks.select.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve([expiredDeadlineRow, fallbackRow]),
          }),
        }),
      }),
    })

    const res = await GET()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.banner).not.toBeNull()
    expect(data.banner.id).toBe("general-announcement")
  })

  it("returns 500 with no-store Cache-Control header when database query fails", async () => {
    mocks.select.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.reject(new Error("Database connection error")),
          }),
        }),
      }),
    })

    const res = await GET()
    expect(res.status).toBe(500)
    expect(res.headers.get("Cache-Control")).toBe("no-store, max-age=0")
    const data = await res.json()
    expect(data.banner).toBeNull()
    expect(data.error).toBe("Failed to query banner")
  })

  it("normalizes unnormalized hideOnPaths in the public banner payload", async () => {
    const rawRow = {
      id: "unnormalized-paths",
      label: "Notice",
      mobileLabel: null,
      href: "/info",
      variant: "default",
      isActive: true,
      startDate: null,
      endDate: null,
      countdownType: "none",
      countdownTarget: null,
      priority: 10,
      dismissVersion: 1,
      hideOnPaths: ["admin", "draft/"],
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    mocks.select.mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve([rawRow]),
          }),
        }),
      }),
    })

    const res = await GET()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.banner.hideOnPaths).toEqual(["/admin", "/draft"])
  })
})
