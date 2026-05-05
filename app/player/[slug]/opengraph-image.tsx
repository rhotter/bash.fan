import { generateTeamOGImage, ogSize } from '@/lib/og-image'
import { fetchPlayerDetail } from '@/lib/fetch-player-detail'

export const size = ogSize
export const contentType = 'image/png'
export const alt = 'Player | BASH'

export default async function OGImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const player = await fetchPlayerDetail(slug)

  if (!player) {
    return generateTeamOGImage('Player Not Found', '', 'bayareastreethockey.com')
  }

  const subtitle = player.seasonStats
    ? `${player.team} | ${player.seasonStats.goals}G ${player.seasonStats.assists}A ${player.seasonStats.points}PTS`
    : player.team

  return generateTeamOGImage(player.name, player.teamSlug, subtitle)
}
