import { generateOGImage, ogSize } from '@/lib/og-image'

export const size = ogSize
export const contentType = 'image/png'
export const alt = 'Stats | BASH'

export default function OGImage() {
  return generateOGImage('Stats', 'bayareastreethockey.com')
}
