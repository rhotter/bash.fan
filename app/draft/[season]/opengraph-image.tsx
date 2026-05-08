import { generateDraftOGImage, ogSize } from '@/lib/og-image'
import { db } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const size = ogSize
export const contentType = 'image/png'
export const alt = 'BASH Draft'

export default async function OGImage({ params }: { params: Promise<{ season: string }> }) {
  const { season: seasonSlug } = await params

  try {
    const draft = await db.query.draftInstances.findFirst({
      where: eq(schema.draftInstances.seasonId, seasonSlug),
    })

    if (!draft) {
      return generateDraftOGImage({ name: 'Draft' })
    }

    // Format the date nicely
    let dateStr: string | undefined
    let timeStr: string | undefined

    if (draft.draftDate) {
      const d = new Date(draft.draftDate)
      dateStr = d.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'America/Los_Angeles',
      })
      timeStr = d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Los_Angeles',
      })
    }

    return generateDraftOGImage({
      name: draft.name,
      date: dateStr,
      time: timeStr,
      location: draft.location || undefined,
    })
  } catch {
    return generateDraftOGImage({ name: 'Draft' })
  }
}
