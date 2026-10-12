import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { NextConfig } from 'next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import nextConfig from '../next.config.mjs'
import { generateDraftOGImage, generateGameOGImage, generateTeamOGImage } from '@/lib/og-image'

const require = createRequire(import.meta.url)
// Use the same glob implementations/options as Next's file-tracing collector.
const picomatch = require('next/dist/compiled/picomatch')
const glob = require('next/dist/compiled/glob')
const projectRoot = process.cwd()
const temporaryDirectories: string[] = []

function configuredAssets(route: string): string[] {
  const includes = (nextConfig as NextConfig).outputFileTracingIncludes ?? {}
  return Object.entries(includes).flatMap(([pattern, assets]) =>
    picomatch(pattern, { dot: true, contains: true })(route)
      ? assets.flatMap((asset) => glob.sync(asset, { cwd: projectRoot, nodir: true, dot: true }))
      : []
  )
}

function packagedAssets(route: string): string[] {
  // Optional post-build check against the actual deployment manifests:
  // OG_IMAGE_USE_BUILD_TRACES=1 pnpm test:run tests/og-image.test.tsx
  if (process.env.OG_IMAGE_USE_BUILD_TRACES !== '1') return configuredAssets(route)
  const manifest = join(projectRoot, '.next/server/app', route, 'route.js.nft.json')
  const { files } = JSON.parse(readFileSync(manifest, 'utf8')) as { files: string[] }
  return files.map((file) => resolve(dirname(manifest), file))
    .filter((file) => file.startsWith(join(projectRoot, 'public/')))
    .map((file) => file.slice(projectRoot.length + 1))
}

function usePackagedFilesystem(route: string) {
  const root = mkdtempSync(join(tmpdir(), 'bash-og-assets-'))
  temporaryDirectories.push(root)
  for (const asset of packagedAssets(route)) {
    const destination = join(root, asset)
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(join(projectRoot, asset), destination)
  }
  // A serverless function has only traced files, not the whole public directory.
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  return root
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Open Graph assets in serverless functions', () => {
  it.each([
    {
      name: 'draft with date and location', route: '/draft/[season]/opengraph-image',
      assets: ['public/logo.png', 'public/images/draft-logo-sm.png'],
      render: () => generateDraftOGImage({ name: '2026–2027 Draft', date: 'Monday, October 12, 2026', time: '7:00 PM', location: 'The Lick' }),
    },
    {
      name: 'draft without a database record', route: '/draft/[season]/opengraph-image',
      assets: ['public/logo.png', 'public/images/draft-logo-sm.png'],
      render: () => generateDraftOGImage({ name: 'Draft' }),
    },
    {
      name: 'player', route: '/player/[slug]/opengraph-image',
      assets: ['public/logo.png', 'public/team-logos/yetis_1024.png'],
      render: () => generateTeamOGImage('Player Name', 'yetis', 'Yetis | 3G 2A 5PTS'),
    },
    {
      name: 'team', route: '/team/[slug]/opengraph-image',
      assets: ['public/logo.png', 'public/team-logos/yetis_1024.png'],
      render: () => generateTeamOGImage('Yetis', 'yetis'),
    },
    {
      name: 'unknown team fallback', route: '/team/[slug]/opengraph-image',
      assets: ['public/logo.png'],
      render: () => generateTeamOGImage('New Team', 'new-team'),
    },
    {
      name: 'game', route: '/game/[id]/opengraph-image',
      assets: ['public/logo.png', 'public/team-logos/yetis_1024.png', 'public/team-logos/seals_1024.png'],
      render: () => generateGameOGImage({ awayTeam: 'Yetis', homeTeam: 'Seals', awaySlug: 'yetis', homeSlug: 'seals', score: '3 – 2', date: 'October 12, 2026' }),
    },
  ])('renders a complete 1200×630 PNG for $name', async ({ route, assets, render }) => {
    const root = usePackagedFilesystem(route)
    // Consume the stream: merely constructing ImageResponse hides render errors.
    const response = render()
    const image = Buffer.from(await response.arrayBuffer())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(image.readUInt32BE(16)).toBe(1200)
    expect(image.readUInt32BE(20)).toBe(630)
    for (const asset of assets) expect(existsSync(join(root, asset)), asset).toBe(true)
  })

  it('does not add image assets to unrelated page or API functions', () => {
    expect(configuredAssets('/draft/[season]')).toEqual([])
    expect(configuredAssets('/api/bash/banners')).toEqual([])
  })
})
