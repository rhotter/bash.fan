import { generateTeamOGImage, ogSize } from '@/lib/og-image'
import { fetchTeamDetail } from '@/lib/fetch-team-detail'

export const size = ogSize
export const contentType = 'image/png'
export const alt = 'Team | BASH'

export default async function OGImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const team = await fetchTeamDetail(slug)

  if (!team) {
    return generateTeamOGImage('Team Not Found', '', 'www.bayareastreethockey.com')
  }

  const r = team.record
  const subtitle = r.gp > 0
    ? `${r.w + r.otw}W-${r.l + r.otl}L | ${r.pts} PTS`
    : 'www.bayareastreethockey.com'

  return generateTeamOGImage(team.name, slug, subtitle)
}
