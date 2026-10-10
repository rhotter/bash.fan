import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { eq } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"
import {
  normalizeHideOnPaths,
  normalizeMobileLabel,
  validateBannerInput,
} from "@/lib/banner-helpers"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { id = "" } = await context.params

    const body = await request.json()

    // 1. Fetch existing banner
    const [existing] = await db
      .select()
      .from(schema.siteBanners)
      .where(eq(schema.siteBanners.id, id))
      .limit(1)

    if (!existing) {
      return NextResponse.json({ error: "Banner not found" }, { status: 404 })
    }

    // 2. Validate merged input
    const merged = { ...existing, ...body }
    const validation = validateBannerInput(merged)
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.errors.join(", ") },
        { status: 400 },
      )
    }

    // 3. Resolve dismissVersion (increment if resetDismissals is true)
    let nextDismissVersion = existing.dismissVersion
    if (body.resetDismissals === true) {
      nextDismissVersion += 1
    } else if (body.dismissVersion !== undefined) {
      nextDismissVersion = Number(body.dismissVersion)
    }

    const updates: Partial<typeof schema.siteBanners.$inferInsert> = {
      updatedAt: new Date(),
      dismissVersion: nextDismissVersion,
    }

    if (body.label !== undefined) updates.label = String(body.label).trim()
    if (body.mobileLabel !== undefined)
      updates.mobileLabel = normalizeMobileLabel(body.mobileLabel)
    if (body.href !== undefined) {
      const trimmedHref = String(body.href).trim()
      if (trimmedHref.length > 0) {
        updates.href = trimmedHref
      }
    }
    if (body.variant !== undefined) updates.variant = body.variant
    if (body.isActive !== undefined) updates.isActive = Boolean(body.isActive)
    if (body.startDate !== undefined)
      updates.startDate = body.startDate ? new Date(body.startDate) : null
    if (body.endDate !== undefined)
      updates.endDate = body.endDate ? new Date(body.endDate) : null
    if (body.countdownType !== undefined) {
      updates.countdownType = body.countdownType
      if (body.countdownType === "none" && body.countdownTarget === undefined) {
        updates.countdownTarget = null
      }
    }
    if (body.countdownTarget !== undefined)
      updates.countdownTarget = body.countdownTarget
        ? new Date(body.countdownTarget)
        : null
    if (body.priority !== undefined) updates.priority = Number(body.priority)
    if (body.hideOnPaths !== undefined)
      updates.hideOnPaths = normalizeHideOnPaths(body.hideOnPaths)

    const [updated] = await db
      .update(schema.siteBanners)
      .set(updates)
      .where(eq(schema.siteBanners.id, id))
      .returning()

    if (!updated) {
      return NextResponse.json({ error: "Banner not found" }, { status: 404 })
    }

    return NextResponse.json({ banner: updated }, { status: 200 })
  } catch (err) {
    console.error("Failed to update banner:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update banner" },
      { status: 500 },
    )
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { id = "" } = await context.params

    const [deleted] = await db
      .delete(schema.siteBanners)
      .where(eq(schema.siteBanners.id, id))
      .returning()

    if (!deleted) {
      return NextResponse.json({ error: "Banner not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (err) {
    console.error("Failed to delete banner:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete banner" },
      { status: 500 },
    )
  }
}
