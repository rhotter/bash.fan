import { ImageResponse } from 'next/og'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getTeamLogoUrl } from './team-logos'

export const ogSize = { width: 1200, height: 630 }

function readImageBase64(relativePath: string): string | null {
  const fullPath = join(process.cwd(), 'public', relativePath)
  if (!existsSync(fullPath)) return null
  const data = readFileSync(fullPath)
  const ext = relativePath.split('.').pop()?.toLowerCase()
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : 'image/png'
  return `data:${mime};base64,${data.toString('base64')}`
}

function getTeamLogoBase64(teamSlug: string): string | null {
  const url = getTeamLogoUrl(teamSlug)
  if (!url) return null
  return readImageBase64(url)
}

const bashLogoBase64 = () => readImageBase64('logo.png')!

function BashWatermark() {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 24,
        right: 32,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 600, color: '#999' }}>bayareastreethockey.com</div>
      <img src={bashLogoBase64()} width={36} height={36} alt="" />
    </div>
  )
}

export function generateOGImage(title: string, subtitle?: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f8f9fc',
          position: 'relative',
        }}
      >
        <img src={bashLogoBase64()} width={280} height={280} alt="" />
        <div
          style={{
            fontSize: 80,
            fontWeight: 700,
            color: '#1a1a1a',
            letterSpacing: '-3px',
            textAlign: 'center',
            maxWidth: '90%',
            marginTop: 20,
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: 32,
              color: '#666',
              marginTop: 4,
              textAlign: 'center',
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    ),
    { ...ogSize }
  )
}

export function generateTeamOGImage(title: string, teamSlug: string, subtitle?: string) {
  const teamLogo = getTeamLogoBase64(teamSlug)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f8f9fc',
          position: 'relative',
        }}
      >
        <img src={teamLogo || bashLogoBase64()} width={260} height={260} alt="" />
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            color: '#1a1a1a',
            letterSpacing: '-2px',
            textAlign: 'center',
            maxWidth: '90%',
            marginTop: 20,
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: 32,
              color: '#666',
              marginTop: 4,
              textAlign: 'center',
            }}
          >
            {subtitle}
          </div>
        )}
        <BashWatermark />
      </div>
    ),
    { ...ogSize }
  )
}

export function generateGameOGImage(opts: {
  awayTeam: string
  homeTeam: string
  awaySlug: string
  homeSlug: string
  score?: string
  date: string
}) {
  const awayLogo = getTeamLogoBase64(opts.awaySlug)
  const homeLogo = getTeamLogoBase64(opts.homeSlug)
  const fallback = bashLogoBase64()

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f8f9fc',
          position: 'relative',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 60,
          }}
        >
          {/* Away team */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <img src={awayLogo || fallback} width={220} height={220} alt="" />
            <div style={{ fontSize: 32, fontWeight: 600, color: '#1a1a1a' }}>{opts.awayTeam}</div>
          </div>

          {/* Score or @ */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            {opts.score ? (
              <div style={{ fontSize: 96, fontWeight: 800, color: '#1a1a1a', letterSpacing: '-2px' }}>
                {opts.score}
              </div>
            ) : (
              <div style={{ fontSize: 64, fontWeight: 700, color: '#999' }}>@</div>
            )}
          </div>

          {/* Home team */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <img src={homeLogo || fallback} width={220} height={220} alt="" />
            <div style={{ fontSize: 32, fontWeight: 600, color: '#1a1a1a' }}>{opts.homeTeam}</div>
          </div>
        </div>

        {/* Date */}
        <div style={{ fontSize: 28, color: '#888', marginTop: 16 }}>{opts.date}</div>

        <BashWatermark />
      </div>
    ),
    { ...ogSize }
  )
}

export function generateDraftOGImage(opts: {
  name: string
  date?: string
  time?: string
  location?: string
}) {
  const logoSrc = readImageBase64('images/draft-logo-sm.png') || bashLogoBase64()
  const subtitle = [opts.date, opts.time, opts.location].filter(Boolean).join(' · ')

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f8f9fc',
          position: 'relative',
        }}
      >
        <img src={logoSrc} width={200} height={200} alt="" style={{ borderRadius: 20 }} />
        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            color: '#1a1a1a',
            letterSpacing: '-2px',
            textAlign: 'center',
            maxWidth: '90%',
            marginTop: 20,
          }}
        >
          {`BASH ${opts.name}`}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: 28,
              color: '#666',
              marginTop: 12,
              textAlign: 'center',
            }}
          >
            {subtitle}
          </div>
        )}
        <BashWatermark />
      </div>
    ),
    { ...ogSize }
  )
}

