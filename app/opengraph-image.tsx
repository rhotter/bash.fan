import { generateOGImage, ogSize } from '@/lib/og-image'

export const size = ogSize
export const contentType = 'image/png'
export const alt = 'BASH - Bay Area Street Hockey'

export default function OGImage() {
  return generateOGImage('bash.fan', 'Scores, standings, and stats')
}
