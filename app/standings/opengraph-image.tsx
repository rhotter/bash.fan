import { generateOGImage, ogSize } from '@/lib/og-image'

export const size = ogSize
export const contentType = 'image/png'
export const alt = 'Standings | BASH'

export default function OGImage() {
  return generateOGImage('Standings', 'bayareastreethockey.com')
}
