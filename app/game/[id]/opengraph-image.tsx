import { generateGameOGImage, ogSize } from '@/lib/og-image'
import { fetchGameDetail } from '@/lib/fetch-game-detail'

export const size = ogSize
export const contentType = 'image/png'
export const alt = 'Game | BASH'

export default async function OGImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await fetchGameDetail(id)

  if (!detail) {
    return generateGameOGImage({
      awayTeam: 'Away', homeTeam: 'Home',
      awaySlug: '', homeSlug: '',
      date: 'Game Not Found',
    })
  }

  const ot = detail.isOvertime ? ' OT' : ''
  const score = detail.homeScore != null && detail.awayScore != null
    ? `${detail.awayScore}-${detail.homeScore}${ot}`
    : undefined

  return generateGameOGImage({
    awayTeam: detail.awayTeam,
    homeTeam: detail.homeTeam,
    awaySlug: detail.awaySlug,
    homeSlug: detail.homeSlug,
    score,
    date: detail.date,
  })
}
