import { NextResponse } from "next/server"
import { db, schema } from "@/lib/db"
import { and, desc, eq, gt, gte, isNull, lte, ne, or } from "drizzle-orm"
import {
  BannerVariant,
  CountdownType,
  PublicBanner,
  normalizeHideOnPaths,
} from "@/lib/banner-helpers"

export const dynamic = "force-dynamic"

export async function GET() {
  const now = new Date()

  try {
    const rows = await db
      .select()
      .from(schema.siteBanners)
      .where(
        and(
          eq(schema.siteBanners.isActive, true),
          or(
            isNull(schema.siteBanners.startDate),
            lte(schema.siteBanners.startDate, now),
          ),
          or(
            isNull(schema.siteBanners.endDate),
            gte(schema.siteBanners.endDate, now),
          ),
          or(
            ne(schema.siteBanners.countdownType, "deadline"),
            gt(schema.siteBanners.countdownTarget, now),
          ),
        ),
      )
      .orderBy(
        desc(schema.siteBanners.priority),
        desc(schema.siteBanners.updatedAt),
      )
      .limit(10)

    // Filter out expired deadline banners (defense-in-depth)
    const eligibleBanner = rows.find((r) => {
      if (r.countdownType === "deadline") {
        if (!r.countdownTarget) return false
        const targetMs = new Date(r.countdownTarget).getTime()
        return !isNaN(targetMs) && targetMs > now.getTime()
      }
      return true
    })

    const headers = {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      "Content-Type": "application/json",
    }

    if (!eligibleBanner) {
      return NextResponse.json({ banner: null }, { headers })
    }

    const payload: PublicBanner = {
      id: eligibleBanner.id,
      label: eligibleBanner.label,
      mobileLabel: eligibleBanner.mobileLabel ?? null,
      href: eligibleBanner.href,
      variant: eligibleBanner.variant as BannerVariant,
      countdownType: eligibleBanner.countdownType as CountdownType,
      countdownTarget: (() => {
        if (!eligibleBanner.countdownTarget) return null
        const d = new Date(eligibleBanner.countdownTarget)
        return isNaN(d.getTime()) ? null : d.toISOString()
      })(),
      dismissVersion: eligibleBanner.dismissVersion,
      hideOnPaths: normalizeHideOnPaths(eligibleBanner.hideOnPaths),
    }

    return NextResponse.json({ banner: payload }, { headers })
  } catch (err) {
    console.error("Failed to query public banner:", err)
    return NextResponse.json(
      { banner: null, error: "Failed to query banner" },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    )
  }
}
