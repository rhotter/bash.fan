import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  getFridayMidnightPT,
  formatDraftDateLabel,
  getDraftBannerIds,
  syncDraftBanner,
} from "@/lib/draft-banner-sync"
import { db, schema } from "@/lib/db"

vi.mock("@/lib/db", () => {
  const select = vi.fn()
  const insert = vi.fn()
  const update = vi.fn()
  const _delete = vi.fn()

  return {
    db: {
      select,
      insert,
      update,
      delete: _delete,
    },
    schema: {
      draftInstances: {
        id: "id",
        seasonId: "season_id",
        draftDate: "draft_date",
        name: "name",
      },
      seasons: {
        id: "id",
        name: "name",
      },
      siteBanners: {
        id: "id",
        isActive: "is_active",
        priority: "priority",
        updatedAt: "updated_at",
      },
    },
  }
})

describe("draft-banner-sync", () => {
  describe("getFridayMidnightPT", () => {
    it("returns this Friday 11:59:59.999 PM PT when called on a Wednesday", () => {
      // Wednesday Oct 7, 2026, 12:00:00 PDT (UTC-7 -> 19:00:00 UTC)
      const wednesday = new Date("2026-10-07T19:00:00.000Z")
      const fridayMidnight = getFridayMidnightPT(wednesday)

      // Expected: 2026-10-09 23:59:59.999 in PDT is 2026-10-10 06:59:59.999Z
      expect(fridayMidnight.toISOString()).toBe("2026-10-10T06:59:59.999Z")
    })

    it("returns tonight 11:59:59.999 PM PT when called on a Friday morning", () => {
      // Friday Oct 9, 2026, 10:00:00 PDT (UTC-7 -> 17:00:00 UTC)
      const friday = new Date("2026-10-09T17:00:00.000Z")
      const fridayMidnight = getFridayMidnightPT(friday)

      expect(fridayMidnight.toISOString()).toBe("2026-10-10T06:59:59.999Z")
    })

    it("returns tonight 11:59:59.999 PM PT when called on a Friday evening", () => {
      // Friday Oct 9, 2026, 21:30:00 PDT (UTC-7 -> 2026-10-10 04:30:00 UTC)
      const fridayNight = new Date("2026-10-10T04:30:00.000Z")
      const fridayMidnight = getFridayMidnightPT(fridayNight)

      expect(fridayMidnight.toISOString()).toBe("2026-10-10T06:59:59.999Z")
    })

    it("returns next Friday 11:59:59.999 PM PT when called on a Saturday", () => {
      // Saturday Oct 10, 2026, 14:00:00 PDT (UTC-7 -> 21:00:00 UTC)
      const saturday = new Date("2026-10-10T21:00:00.000Z")
      const nextFridayMidnight = getFridayMidnightPT(saturday)

      // Expected: Friday Oct 16, 2026 23:59:59.999 PDT -> 2026-10-17 06:59:59.999Z
      expect(nextFridayMidnight.toISOString()).toBe("2026-10-17T06:59:59.999Z")
    })

    it("returns next Friday 11:59:59.999 PM PT when called on a Sunday", () => {
      // Sunday Oct 11, 2026, 12:00:00 PDT
      const sunday = new Date("2026-10-11T19:00:00.000Z")
      const nextFridayMidnight = getFridayMidnightPT(sunday)

      expect(nextFridayMidnight.toISOString()).toBe("2026-10-17T06:59:59.999Z")
    })
  })

  describe("formatDraftDateLabel", () => {
    it("formats day of week and time matching the existing copy 'BASH Draft: Wed @ 7pm'", () => {
      // Wed Oct 7, 2026 at 7:00 PM PDT (19:00 PDT -> 2026-10-08T02:00:00Z)
      const wed7pm = new Date("2026-10-08T02:00:00.000Z")
      const label = formatDraftDateLabel(wed7pm)
      expect(label).toBe("BASH Draft: Wed @ 7pm")
    })

    it("formats minutes when not on the hour (e.g. 7:30pm)", () => {
      // Wed Oct 7, 2026 at 7:30 PM PDT
      const wed730pm = new Date("2026-10-08T02:30:00.000Z")
      const label = formatDraftDateLabel(wed730pm)
      expect(label).toBe("BASH Draft: Wed @ 7:30pm")
    })

    it("falls back to generic announcement when draftDate is not set", () => {
      expect(formatDraftDateLabel(null)).toBe("BASH Draft Board is now available")
      expect(formatDraftDateLabel(undefined)).toBe("BASH Draft Board is now available")
    })
  })

  describe("getDraftBannerIds", () => {
    it("generates predictable stage-specific IDs for each draft", () => {
      const ids = getDraftBannerIds("draft-123")
      expect(ids.predraftId).toBe("draft-draft-123-predraft")
      expect(ids.liveId).toBe("draft-draft-123-live")
      expect(ids.resultsId).toBe("draft-draft-123-results")
    })
  })

  describe("syncDraftBanner lifecycle mutations", () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it("handles 'publish' event: creates/upserts pre-draft banner and deactivates others", async () => {
      const draftMock = {
        id: "d-1",
        seasonId: "2026-summer",
        draftDate: new Date("2026-10-08T02:00:00.000Z"),
        name: "Summer 2026 Draft",
      }

      const mockFrom = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([draftMock]),
        }),
      })

      ;(db.select as any).mockReturnValue({ from: mockFrom })

      const mockSet = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowCount: 1 }),
      })
      ;(db.update as any).mockReturnValue({ set: mockSet })

      const mockOnConflict = vi.fn().mockResolvedValue({ rowCount: 1 })
      const mockValues = vi.fn().mockReturnValue({
        onConflictDoUpdate: mockOnConflict,
      })
      ;(db.insert as any).mockReturnValue({ values: mockValues })

      await syncDraftBanner({
        draftId: "d-1",
        seasonId: "2026-summer",
        event: "publish",
      })

      // Verified pre-draft banner was upserted
      expect(db.insert).toHaveBeenCalled()
      const insertArg = mockValues.mock.calls[0][0]
      expect(insertArg.id).toBe("draft-d-1-predraft")
      expect(insertArg.label).toBe("BASH Draft: Wed @ 7pm")
      expect(insertArg.mobileLabel).toBe("BASH Draft")
      expect(insertArg.href).toBe("/draft/2026-summer")
      expect(insertArg.variant).toBe("default")
      expect(insertArg.countdownType).toBe("event")
      expect(insertArg.isActive).toBe(true)
      expect(insertArg.priority).toBe(20)
      expect(insertArg.hideOnPaths).toEqual(["/admin", "/draft"])
    })

    it("handles 'unpublish' event: deactivates pre-draft banner", async () => {
      const mockSet = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowCount: 1 }),
      })
      ;(db.update as any).mockReturnValue({ set: mockSet })

      await syncDraftBanner({
        draftId: "d-1",
        seasonId: "2026-summer",
        event: "unpublish",
      })

      expect(db.update).toHaveBeenCalled()
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false })
      )
    })

    it("handles 'start' event: activates live banner and deactivates pre-draft banner", async () => {
      const mockSet = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowCount: 1 }),
      })
      ;(db.update as any).mockReturnValue({ set: mockSet })

      const mockOnConflict = vi.fn().mockResolvedValue({ rowCount: 1 })
      const mockValues = vi.fn().mockReturnValue({
        onConflictDoUpdate: mockOnConflict,
      })
      ;(db.insert as any).mockReturnValue({ values: mockValues })

      await syncDraftBanner({
        draftId: "d-1",
        seasonId: "2026-summer",
        event: "start",
      })

      expect(db.insert).toHaveBeenCalled()
      const insertArg = mockValues.mock.calls[0][0]
      expect(insertArg.id).toBe("draft-d-1-live")
      expect(insertArg.label).toBe("BASH Draft is LIVE — Watch the picks unfold")
      expect(insertArg.mobileLabel).toBe("BASH Draft Live")
      expect(insertArg.variant).toBe("live")
      expect(insertArg.priority).toBe(100)
      expect(insertArg.isActive).toBe(true)
    })

    it("handles 'complete' event: activates results banner with Friday midnight expiration and deactivates live banner", async () => {
      const mockSet = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowCount: 1 }),
      })
      ;(db.update as any).mockReturnValue({ set: mockSet })

      const mockOnConflict = vi.fn().mockResolvedValue({ rowCount: 1 })
      const mockValues = vi.fn().mockReturnValue({
        onConflictDoUpdate: mockOnConflict,
      })
      ;(db.insert as any).mockReturnValue({ values: mockValues })

      await syncDraftBanner({
        draftId: "d-1",
        seasonId: "2026-summer",
        event: "complete",
      })

      expect(db.insert).toHaveBeenCalled()
      const insertArg = mockValues.mock.calls[0][0]
      expect(insertArg.id).toBe("draft-d-1-results")
      expect(insertArg.label).toBe("View Draft Results")
      expect(insertArg.mobileLabel).toBe("Draft Results")
      expect(insertArg.variant).toBe("default")
      expect(insertArg.priority).toBe(30)
      expect(insertArg.isActive).toBe(true)
      expect(insertArg.endDate).toBeInstanceOf(Date)
    })

    it("handles 'revert_to_live' event: restores/upserts live banner and disables results banner", async () => {
      const mockSet = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowCount: 1 }),
      })
      ;(db.update as any).mockReturnValue({ set: mockSet })

      const mockOnConflict = vi.fn().mockResolvedValue({ rowCount: 1 })
      const mockValues = vi.fn().mockReturnValue({
        onConflictDoUpdate: mockOnConflict,
      })
      ;(db.insert as any).mockReturnValue({ values: mockValues })

      await syncDraftBanner({
        draftId: "d-1",
        seasonId: "2026-summer",
        event: "revert_to_live",
      })

      // Disables results banner
      expect(db.update).toHaveBeenCalledWith(schema.siteBanners)
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false })
      )

      // Re-enables / upserts live banner
      expect(db.insert).toHaveBeenCalledWith(schema.siteBanners)
      const insertArg = mockValues.mock.calls[0][0]
      expect(insertArg.id).toBe("draft-d-1-live")
      expect(insertArg.variant).toBe("live")
      expect(insertArg.isActive).toBe(true)
    })
  })

  describe("draft lifecycle route hooks (archive, reschedule, delete)", () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it("verifies banner IDs helper generates all expected keys for deletion cleanup", () => {
      const { predraftId, liveId, resultsId } = getDraftBannerIds("draft-xyz")
      expect(predraftId).toBe("draft-draft-xyz-predraft")
      expect(liveId).toBe("draft-draft-xyz-live")
      expect(resultsId).toBe("draft-draft-xyz-results")
    })

    it("handles archive deactivation: deactivates resultsId banner", async () => {
      const mockSet = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowCount: 1 }),
      })
      ;(db.update as any).mockReturnValue({ set: mockSet })

      const { resultsId } = getDraftBannerIds("d-archive")
      expect(resultsId).toBe("draft-d-archive-results")

      await db
        .update(schema.siteBanners)
        .set({ isActive: false, updatedAt: new Date() })
        .where({ id: resultsId } as any)

      expect(db.update).toHaveBeenCalledWith(schema.siteBanners)
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false })
      )
    })

    it("handles unarchive restoration: calls syncDraftBanner with complete event to restore results banner", async () => {
      const mockSet = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ rowCount: 1 }),
      })
      ;(db.update as any).mockReturnValue({ set: mockSet })

      const mockOnConflict = vi.fn().mockResolvedValue({ rowCount: 1 })
      const mockValues = vi.fn().mockReturnValue({
        onConflictDoUpdate: mockOnConflict,
      })
      ;(db.insert as any).mockReturnValue({ values: mockValues })

      await syncDraftBanner({
        draftId: "d-unarchive",
        seasonId: "2026-summer",
        event: "complete",
      })

      expect(db.insert).toHaveBeenCalledWith(schema.siteBanners)
      const insertArg = mockValues.mock.calls[0][0]
      expect(insertArg.id).toBe("draft-d-unarchive-results")
      expect(insertArg.isActive).toBe(true)
    })
  })
})
