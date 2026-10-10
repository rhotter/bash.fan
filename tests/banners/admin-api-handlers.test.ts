import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}))

vi.mock("@/lib/admin-session", () => ({
  getSession: () => mocks.getSession(),
}))

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema")
  return {
    db: {
      select: mocks.select,
      insert: mocks.insert,
      update: mocks.update,
      delete: mocks.delete,
    },
    schema,
  }
})

import { GET, POST } from "@/app/api/bash/admin/banners/route"
import { PUT, DELETE } from "@/app/api/bash/admin/banners/[id]/route"

describe("Live Route Handlers: /api/bash/admin/banners", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("GET /api/bash/admin/banners", () => {
    it("returns 401 Unauthorized if getSession() returns false", async () => {
      mocks.getSession.mockResolvedValue(false)
      const res = await GET()
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBe("Unauthorized")
    })

    it("returns 200 with banners array when authenticated", async () => {
      mocks.getSession.mockResolvedValue(true)
      const mockBanners = [
        { id: "b1", label: "Banner 1", priority: 10 },
        { id: "b2", label: "Banner 2", priority: 5 },
      ]
      mocks.select.mockReturnValue({
        from: () => ({
          orderBy: () => Promise.resolve(mockBanners),
        }),
      })

      const res = await GET()
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.banners).toEqual(mockBanners)
    })
  })

  describe("POST /api/bash/admin/banners", () => {
    it("returns 401 Unauthorized if getSession() returns false", async () => {
      mocks.getSession.mockResolvedValue(false)
      const req = new NextRequest("http://localhost/api/bash/admin/banners", {
        method: "POST",
        body: JSON.stringify({ label: "Test" }),
      })
      const res = await POST(req)
      expect(res.status).toBe(401)
    })

    it("returns 400 Bad Request if label is missing", async () => {
      mocks.getSession.mockResolvedValue(true)
      const req = new NextRequest("http://localhost/api/bash/admin/banners", {
        method: "POST",
        body: JSON.stringify({ label: "" }),
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain("label is required")
    })

    it("creates a banner and returns 201 with created record", async () => {
      mocks.getSession.mockResolvedValue(true)
      const createdBanner = {
        id: "banner-custom-123",
        label: "Registration Open",
        mobileLabel: "Register Now",
        href: "/register",
        variant: "live",
        isActive: true,
        priority: 20,
        dismissVersion: 1,
        hideOnPaths: ["/admin"],
      }

      mocks.insert.mockReturnValue({
        values: () => ({
          returning: () => Promise.resolve([createdBanner]),
        }),
      })

      const req = new NextRequest("http://localhost/api/bash/admin/banners", {
        method: "POST",
        body: JSON.stringify({
          id: "banner-custom-123",
          label: "Registration Open",
          mobileLabel: "Register Now",
          href: "/register",
          variant: "live",
          priority: 20,
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.banner).toEqual(createdBanner)
    })

    it("returns 409 Conflict if duplicate id exists", async () => {
      mocks.getSession.mockResolvedValue(true)
      mocks.insert.mockReturnValue({
        values: () => ({
          returning: () =>
            Promise.reject({
              code: "23505",
              message: "duplicate key value violates unique constraint",
            }),
        }),
      })

      const req = new NextRequest("http://localhost/api/bash/admin/banners", {
        method: "POST",
        body: JSON.stringify({
          id: "banner-duplicate",
          label: "Duplicate Banner",
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.error).toBe("A banner with this ID already exists")
    })
  })

  describe("PUT /api/bash/admin/banners/[id]", () => {
    const context = { params: Promise.resolve({ id: "banner-123" }) }

    it("returns 401 Unauthorized if getSession() returns false", async () => {
      mocks.getSession.mockResolvedValue(false)
      const req = new NextRequest("http://localhost/api/bash/admin/banners/banner-123", {
        method: "PUT",
        body: JSON.stringify({ label: "Updated" }),
      })
      const res = await PUT(req, context)
      expect(res.status).toBe(401)
    })

    it("returns 404 if banner does not exist", async () => {
      mocks.getSession.mockResolvedValue(true)
      mocks.select.mockReturnValue({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      })

      const req = new NextRequest("http://localhost/api/bash/admin/banners/banner-123", {
        method: "PUT",
        body: JSON.stringify({ label: "Updated" }),
      })
      const res = await PUT(req, context)
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.error).toBe("Banner not found")
    })

    it("returns 400 Bad Request if update fails validation", async () => {
      mocks.getSession.mockResolvedValue(true)
      const existing = {
        id: "banner-123",
        label: "Valid Label",
        dismissVersion: 1,
        priority: 10,
        variant: "default",
      }

      mocks.select.mockReturnValue({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([existing]),
          }),
        }),
      })

      const req = new NextRequest("http://localhost/api/bash/admin/banners/banner-123", {
        method: "PUT",
        body: JSON.stringify({ variant: "invalid-variant" }),
      })

      const res = await PUT(req, context)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain("invalid variant")
    })

    it("updates banner and increments dismissVersion if resetDismissals is true", async () => {
      mocks.getSession.mockResolvedValue(true)
      const existing = {
        id: "banner-123",
        label: "Old Label",
        dismissVersion: 2,
        priority: 10,
        variant: "default",
      }

      mocks.select.mockReturnValue({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([existing]),
          }),
        }),
      })

      const updated = {
        ...existing,
        label: "New Label",
        dismissVersion: 3,
      }

      mocks.update.mockReturnValue({
        set: (vals: any) => {
          expect(vals.dismissVersion).toBe(3)
          return {
            where: () => ({
              returning: () => Promise.resolve([updated]),
            }),
          }
        },
      })

      const req = new NextRequest("http://localhost/api/bash/admin/banners/banner-123", {
        method: "PUT",
        body: JSON.stringify({
          label: "New Label",
          resetDismissals: true,
        }),
      })

      const res = await PUT(req, context)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.banner.dismissVersion).toBe(3)
    })
  })

  describe("DELETE /api/bash/admin/banners/[id]", () => {
    const context = { params: Promise.resolve({ id: "banner-123" }) }

    it("returns 401 Unauthorized if getSession() returns false", async () => {
      mocks.getSession.mockResolvedValue(false)
      const req = new NextRequest("http://localhost/api/bash/admin/banners/banner-123", {
        method: "DELETE",
      })
      const res = await DELETE(req, context)
      expect(res.status).toBe(401)
    })

    it("returns 404 if banner does not exist", async () => {
      mocks.getSession.mockResolvedValue(true)
      mocks.delete.mockReturnValue({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      })

      const req = new NextRequest("http://localhost/api/bash/admin/banners/banner-123", {
        method: "DELETE",
      })
      const res = await DELETE(req, context)
      expect(res.status).toBe(404)
    })

    it("deletes banner and returns 200 with success", async () => {
      mocks.getSession.mockResolvedValue(true)
      mocks.delete.mockReturnValue({
        where: () => ({
          returning: () => Promise.resolve([{ id: "banner-123" }]),
        }),
      })

      const req = new NextRequest("http://localhost/api/bash/admin/banners/banner-123", {
        method: "DELETE",
      })
      const res = await DELETE(req, context)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
    })
  })
})

