import { NextRequest, NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { desc } from "drizzle-orm"
import { getSession } from "@/lib/admin-session"
import {
  normalizeHideOnPaths,
  normalizeMobileLabel,
  validateBannerInput,
} from "@/lib/banner-helpers"

export async function GET() {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const rows = await db
      .select()
      .from(schema.siteBanners)
      .orderBy(desc(schema.siteBanners.priority), desc(schema.siteBanners.updatedAt))

    return NextResponse.json({ banners: rows })
  } catch (err) {
    console.error("Failed to list banners:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list banners" },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  const isAuthenticated = await getSession()
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const validation = validateBannerInput(body)
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.errors.join(", ") },
        { status: 400 },
      )
    }

    const id =
      typeof body.id === "string" && body.id.trim().length > 0
        ? body.id.trim()
        : `banner-${crypto.randomUUID()}`

    const label = String(body.label).trim()
    const mobileLabel = normalizeMobileLabel(body.mobileLabel)
    const href =
      typeof body.href === "string" && body.href.trim().length > 0
        ? body.href.trim()
        : "/register"
    const variant = body.variant ?? "default"
    const isActive = body.isActive !== undefined ? Boolean(body.isActive) : true
    const startDate = body.startDate ? new Date(body.startDate) : null
    const endDate = body.endDate ? new Date(body.endDate) : null
    const countdownType = body.countdownType ?? "none"
    const countdownTarget = body.countdownTarget
      ? new Date(body.countdownTarget)
      : null
    const priority = body.priority !== undefined ? Number(body.priority) : 10
    const dismissVersion =
      body.dismissVersion !== undefined ? Number(body.dismissVersion) : 1
    const hideOnPaths = normalizeHideOnPaths(body.hideOnPaths)

    const [created] = await db
      .insert(schema.siteBanners)
      .values({
        id,
        label,
        mobileLabel,
        href,
        variant,
        isActive,
        startDate,
        endDate,
        countdownType,
        countdownTarget,
        priority,
        dismissVersion,
        hideOnPaths,
      })
      .returning()

    return NextResponse.json({ banner: created }, { status: 201 })
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      ("code" in err && (err as { code: unknown }).code === "23505" ||
        ("message" in err &&
          typeof (err as { message: unknown }).message === "string" &&
          (err as { message: string }).message.includes("unique")))
    ) {
      return NextResponse.json(
        { error: "A banner with this ID already exists" },
        { status: 409 },
      )
    }

    console.error("Failed to create banner:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create banner" },
      { status: 500 },
    )
  }
}

