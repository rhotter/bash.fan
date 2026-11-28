/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{
      source: '/optimized-logos/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    }, {
      // The path holds a Manager Link token, which must not reach search engines or other sites.
      source: '/fantasy/m/:path*',
      headers: [
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      ],
    }]
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // OG renderers read these dynamically from disk. Public assets are served by
  // the CDN, but must also be traced into the serverless image functions.
  outputFileTracingIncludes: {
    '**/opengraph-image': ['./public/logo.png'],
    '/draft/*/opengraph-image': ['./public/images/draft-logo-sm.png'],
    '/{player,team,game}/*/opengraph-image': ['./public/team-logos/*.png'],
  },
}

export default nextConfig
