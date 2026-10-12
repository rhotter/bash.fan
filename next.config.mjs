/** @type {import('next').NextConfig} */
const nextConfig = {
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
