import { ImageResponse } from 'next/og'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { getTeamLogoUrl } from './team-logos'
import { getTeamChartColor } from './chart-colors'
import type { BracketRoundColumn, BracketSeries, SeriesSide } from './playoff-bracket-utils'
import type { PlayoffOddsSnapshot } from './playoff-odds-types'

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
      <div style={{ fontSize: 20, fontWeight: 600, color: '#999' }}>www.bayareastreethockey.com</div>
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

function renderOGSeriesTeamRow(side: SeriesSide, score: number | string, won: boolean, lost: boolean) {
  const logo = !side.isTbd ? getTeamLogoBase64(side.slug) : null
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        gap: 8,
        opacity: lost ? 0.5 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {logo ? (
          <img src={logo} width={22} height={22} alt="" style={{ objectFit: 'contain' }} />
        ) : (
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: '#e5e7eb',
            }}
          />
        )}
        <div
          style={{
            fontSize: 16,
            fontWeight: won ? 700 : 500,
            color: '#111111',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {side.name}
        </div>
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: won ? 700 : 600,
          color: won ? '#111111' : '#666666',
        }}
      >
        {String(score)}
      </div>
    </div>
  )
}

function renderOGSeriesCard(series: BracketSeries) {
  const isSingleGame = series.games.length === 1
  const singleGame = isSingleGame ? series.games[0] : null
  const seriesLabel =
    series.seriesId === 'play-in' ? 'Play-In' : series.seriesId === 'final' ? 'Final' : series.seriesId.toUpperCase()

  const topScore = isSingleGame
    ? singleGame?.status === 'final' || singleGame?.status === 'live'
      ? (singleGame.awayScore ?? 0)
      : '–'
    : series.top.wins
  const bottomScore = isSingleGame
    ? singleGame?.status === 'final' || singleGame?.status === 'live'
      ? (singleGame.homeScore ?? 0)
      : '–'
    : series.bottom.wins

  return (
    <div
      key={series.seriesId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 10,
        border: '1px solid #e2e4ea',
        backgroundColor: '#ffffff',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '5px 12px',
          backgroundColor: '#f3f4f6',
          borderBottom: '1px solid #e5e7eb',
          fontSize: 12,
          color: '#6b7280',
        }}
      >
        <div style={{ fontWeight: 700 }}>{seriesLabel}</div>
        <div>{isSingleGame ? 'Single Game' : `Best of ${series.games.length}`}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {renderOGSeriesTeamRow(series.top, topScore, series.clinchedBy === 'top', series.clinchedBy === 'bottom')}
        <div style={{ height: 1, backgroundColor: '#f1f5f9' }} />
        {renderOGSeriesTeamRow(series.bottom, bottomScore, series.clinchedBy === 'bottom', series.clinchedBy === 'top')}
      </div>
    </div>
  )
}

export function generatePlayoffBracketOGImage(rounds: BracketRoundColumn[], seasonLabel?: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '32px 40px 64px 40px',
          backgroundColor: '#f8f9fc',
          position: 'relative',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img src={bashLogoBase64()} width={44} height={44} alt="" />
            <div style={{ fontSize: 32, fontWeight: 700, color: '#111111', letterSpacing: '-0.02em' }}>
              Playoff Bracket
            </div>
          </div>
          {seasonLabel && (
            <div style={{ fontSize: 20, fontWeight: 600, color: '#6b7280' }}>
              {seasonLabel}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', flex: 1, gap: 20 }}>
          {rounds.map((col) => (
            <div
              key={col.round}
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                gap: 10,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#6b7280',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {col.label}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  flex: 1,
                  justifyContent: col.round === 'play-in' ? 'flex-start' : 'space-around',
                  gap: 14,
                }}
              >
                {col.series.map((s) => renderOGSeriesCard(s))}
              </div>
            </div>
          ))}
        </div>

        <BashWatermark />
      </div>
    ),
    { ...ogSize }
  )
}

export function generatePlayoffOddsOGImage(snapshot: PlayoffOddsSnapshot, seasonLabel?: string) {
  const allTeamsQualify = snapshot.format.allTeamsQualify
  const title = allTeamsQualify ? 'Projected Seed' : 'Chance Will Make Playoffs'

  const orderedTeams = [...snapshot.teams]
    .sort((a, b) => b.playoffPct - a.playoffPct || a.avgSeed - b.avgSeed || b.pts - a.pts)
    .map((t) => {
      const { stroke, outline } = getTeamChartColor(t.slug, snapshot.teamColors)
      return {
        slug: t.slug,
        name: t.name,
        playoffPct: t.playoffPct,
        avgSeed: t.avgSeed,
        color: stroke,
        outline,
        logo: getTeamLogoBase64(t.slug),
      }
    })

  const timeline = snapshot.timeline
  const chartW = 700
  const chartH = 380
  const plotW = chartW
  const plotH = chartH

  const teamCount = Math.max(2, snapshot.format.teamCount)
  const yForValue = (val: number) => {
    if (allTeamsQualify) {
      const clamped = Math.max(1, Math.min(teamCount, val))
      return 8 + ((clamped - 1) / (teamCount - 1)) * (plotH - 16)
    }
    const clamped = Math.max(0, Math.min(100, val))
    return 8 + (1 - clamped / 100) * (plotH - 16)
  }

  const xForIndex = (idx: number) => {
    if (timeline.length <= 1) return plotW / 2
    return 8 + (idx / (timeline.length - 1)) * (plotW - 16)
  }

  const yTicks = allTeamsQualify
    ? Array.from({ length: teamCount }, (_, i) => i + 1)
    : [100, 75, 50, 25, 0]

  const xTickIndices: number[] = []
  if (timeline.length > 0) {
    const step = Math.max(1, Math.floor((timeline.length - 1) / 4))
    for (let i = 0; i < timeline.length; i += step) xTickIndices.push(i)
    if (xTickIndices[xTickIndices.length - 1] !== timeline.length - 1) {
      xTickIndices.push(timeline.length - 1)
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '32px 40px 56px 40px',
          backgroundColor: '#f8f9fc',
          position: 'relative',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img src={bashLogoBase64()} width={42} height={42} alt="" />
            <div style={{ fontSize: 30, fontWeight: 700, color: '#111111', letterSpacing: '-0.02em' }}>
              {title}
            </div>
          </div>
          {seasonLabel && (
            <div style={{ fontSize: 20, fontWeight: 600, color: '#6b7280' }}>
              {seasonLabel}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', flex: 1, gap: 24, alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#ffffff',
              borderRadius: 12,
              border: '1px solid #e2e4ea',
              padding: '20px 24px 16px 16px',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'row', gap: 10 }}>
              {/* Y-axis labels */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  height: chartH,
                  width: 44,
                  alignItems: 'flex-end',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#6b7280',
                }}
              >
                {yTicks.map((tick) => (
                  <div key={tick}>{allTeamsQualify ? `#${tick}` : `${tick}%`}</div>
                ))}
              </div>

              {/* SVG plot */}
              <svg width={chartW} height={chartH} viewBox={`0 0 ${chartW} ${chartH}`}>
                {yTicks.map((tick) => {
                  const y = yForValue(tick)
                  return (
                    <line
                      key={tick}
                      x1={0}
                      y1={y}
                      x2={chartW}
                      y2={y}
                      stroke="#eef0f5"
                      strokeWidth={1.5}
                    />
                  )
                })}

                {orderedTeams.flatMap((t) => {
                  const coords = timeline.map((pt, idx) => {
                    const entry = pt.teams[t.slug]
                    const rawVal = allTeamsQualify ? (entry?.avgSeed ?? teamCount) : (entry?.playoffPct ?? 0)
                    return [xForIndex(idx), yForValue(rawVal)] as const
                  })
                  const pathD = coords
                    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`)
                    .join(' ')
                  const lastCoord = coords[coords.length - 1]
                  const els = []
                  if (t.outline) {
                    els.push(
                      <path
                        key={`${t.slug}-outline`}
                        fill="none"
                        stroke={t.outline}
                        strokeWidth={5.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d={pathD}
                      />,
                    )
                  }
                  els.push(
                    <path
                      key={t.slug}
                      fill="none"
                      stroke={t.color}
                      strokeWidth={3.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d={pathD}
                    />,
                  )
                  if (lastCoord) {
                    els.push(
                      <circle
                        key={`${t.slug}-dot`}
                        cx={lastCoord[0]}
                        cy={lastCoord[1]}
                        r={4.5}
                        fill={t.color}
                        stroke={t.outline ?? '#ffffff'}
                        strokeWidth={1.5}
                      />,
                    )
                  }
                  return els
                })}
              </svg>
            </div>

            {/* X-axis labels */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingLeft: 54,
                fontSize: 13,
                fontWeight: 500,
                color: '#6b7280',
              }}
            >
              {xTickIndices.map((idx) => (
                <div key={idx}>{timeline[idx].label}</div>
              ))}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              gap: 10,
              justifyContent: 'center',
            }}
          >
            {orderedTeams.map((t) => (
              <div
                key={t.slug}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e4ea',
                  borderRadius: 8,
                  padding: '8px 12px',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: t.color,
                      ...(t.outline ? { border: `1px solid ${t.outline}` } : {}),
                    }}
                  />
                  {t.logo && <img src={t.logo} width={22} height={22} alt="" style={{ objectFit: 'contain' }} />}
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: '#111111',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.name}
                  </div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#111111' }}>
                  {allTeamsQualify ? `#${t.avgSeed.toFixed(1)}` : `${Math.round(t.playoffPct)}%`}
                </div>
              </div>
            ))}
          </div>
        </div>

        <BashWatermark />
      </div>
    ),
    { ...ogSize }
  )
}

