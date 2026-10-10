import { db, schema } from "@/lib/db"
import { desc } from "drizzle-orm"
import { BannersClient, type BannerRow } from "@/components/admin/banners-client"
import { BannerVariant, CountdownType, normalizeHideOnPaths } from "@/lib/banner-helpers"

export const metadata = {
  title: "Banners | Admin",
  description: "Manage Bay Area Street Hockey announcement banners, schedules, and countdown alerts.",
}

export default async function AdminBannersPage() {
  const rows = await db
    .select()
    .from(schema.siteBanners)
    .orderBy(desc(schema.siteBanners.priority), desc(schema.siteBanners.updatedAt))

  const banners: BannerRow[] = rows.map((r) => ({
    id: r.id,
    label: r.label,
    mobileLabel: r.mobileLabel,
    href: r.href,
    variant: r.variant as BannerVariant,
    isActive: r.isActive,
    startDate: r.startDate && !isNaN(new Date(r.startDate).getTime()) ? new Date(r.startDate).toISOString() : null,
    endDate: r.endDate && !isNaN(new Date(r.endDate).getTime()) ? new Date(r.endDate).toISOString() : null,
    countdownType: r.countdownType as CountdownType,
    countdownTarget: r.countdownTarget && !isNaN(new Date(r.countdownTarget).getTime()) ? new Date(r.countdownTarget).toISOString() : null,
    priority: r.priority,
    dismissVersion: r.dismissVersion,
    hideOnPaths: normalizeHideOnPaths(r.hideOnPaths),
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : new Date().toISOString(),
  }))

  return (
    <div className="space-y-6">
      <BannersClient initial={banners} />
    </div>
  )
}
