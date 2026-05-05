import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin/', '/scorekeeper/', '/api/'],
      },
    ],
    sitemap: 'https://www.bayareastreethockey.com/sitemap.xml',
  }
}
