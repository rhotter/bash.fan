import React from "react"
import { formatGameTime } from "@/lib/format-time"
import { BackButton } from "@/app/admin/scoresheet/[gameId]/back-button"

/* ─── Types ─────────────────────────────────────────────────────────── */

export interface ScoresheetGameData {
  id: string
  date: string
  time: string
  location: string | null
  is_playoff: boolean
  game_type: string
  status: string
  home_slug: string
  away_slug: string
  home_name: string
  away_name: string
  season_name: string
  season_id: string
  notes?: string | null
}

export interface ScoresheetRosterPlayer {
  name: string
  is_captain?: boolean | null
  is_goalie?: boolean | null
  is_sub?: boolean | null
}

export interface ScoresheetOfficial {
  name: string
  role: string
}

export interface GameScoresheetProps {
  game: ScoresheetGameData
  homeRoster: ScoresheetRosterPlayer[]
  awayRoster: ScoresheetRosterPlayer[]
  officials: ScoresheetOfficial[]
  id?: string
  className?: string
  showBackButton?: boolean
}

/* ─── Constants ─────────────────────────────────────────────────────── */

const SCORING_ROWS = 11
const PENALTY_ROWS = 11
const GOALIE_ROWS = 3
const SHOT_NUMBERS = Array.from({ length: 24 }, (_, i) => String(i + 1).padStart(2, "0"))

const thStyle: React.CSSProperties = {
  fontSize: "9px",
  fontWeight: "normal",
  padding: "2px 3px",
  textAlign: "center",
  borderBottom: "1px solid #000",
  borderRight: "1px solid #000",
}

/* ─── Sub-Components ─────────────────────────────────────────────────── */

function EmptyRow({ cols, height = "22px" }: { cols: number; height?: string }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td
          key={i}
          style={{
            height,
            borderBottom: "1px solid #000",
            borderRight: i < cols - 1 ? "1px solid #000" : undefined,
          }}
        >
          &nbsp;
        </td>
      ))}
    </tr>
  )
}

function ScoringTable({ teamName }: { teamName: string }) {
  return (
    <div>
      <div style={{ fontWeight: "bold", fontSize: "11px", marginBottom: "2px" }}>
        {teamName} Scoring
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #000" }}>
        <thead>
          <tr style={{ backgroundColor: "#f5f5f5" }}>
            <th style={{ ...thStyle, width: "10%" }}>Per</th>
            <th style={{ ...thStyle, width: "20%" }}>Time</th>
            <th style={{ ...thStyle, width: "20%" }}>Goal</th>
            <th style={{ ...thStyle, width: "20%" }}>Assist</th>
            <th style={{ ...thStyle, width: "20%" }}>Assist</th>
            <th style={{ ...thStyle, width: "10%" }}>Note</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: SCORING_ROWS }).map((_, i) => (
            <EmptyRow key={i} cols={6} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PenaltyTable({ teamName }: { teamName: string }) {
  return (
    <div>
      <div style={{ fontWeight: "bold", fontSize: "11px", marginBottom: "2px" }}>
        {teamName} Penalties
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #000" }}>
        <thead>
          <tr style={{ backgroundColor: "#f5f5f5" }}>
            <th style={{ ...thStyle, width: "8%", whiteSpace: "nowrap" }}>Per</th>
            <th style={{ ...thStyle, width: "20%", whiteSpace: "nowrap" }}>Player</th>
            <th style={{ ...thStyle, width: "28%", whiteSpace: "nowrap" }}>Infraction</th>
            <th style={{ ...thStyle, width: "8%", whiteSpace: "nowrap" }}>Min</th>
            <th style={{ ...thStyle, width: "18%", whiteSpace: "nowrap" }}>Time St</th>
            <th style={{ ...thStyle, width: "18%", whiteSpace: "nowrap" }}>Time Exp</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: PENALTY_ROWS }).map((_, i) => (
            <EmptyRow key={i} cols={6} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GoalieTable({ teamName }: { teamName: string }) {
  return (
    <div>
      <div style={{ fontWeight: "bold", fontSize: "11px", marginBottom: "2px" }}>
        {teamName} Goalies
      </div>
      <table style={{ width: "95%", borderCollapse: "collapse", border: "1px solid #000" }}>
        <thead>
          <tr style={{ backgroundColor: "#f5f5f5" }}>
            <th style={{ ...thStyle, width: "40%" }}>Goalie</th>
            <th style={{ ...thStyle, width: "15%" }}>Min</th>
            <th style={{ ...thStyle, width: "15%" }}>Sh</th>
            <th style={{ ...thStyle, width: "15%" }}>Sv</th>
            <th style={{ ...thStyle, width: "15%" }}>Dec</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: GOALIE_ROWS }).map((_, i) => (
            <EmptyRow key={i} cols={5} height="20px" />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ShotGrid({ label }: { label: string }) {
  const row1 = SHOT_NUMBERS.slice(0, 8)
  const row2 = SHOT_NUMBERS.slice(8, 16)
  const row3 = SHOT_NUMBERS.slice(16, 24)

  return (
    <td style={{ width: "50%", verticalAlign: "top", padding: "2px 4px", border: "1px solid #000" }}>
      <div style={{ fontSize: "9.5px", fontWeight: "bold", marginBottom: "1px" }}>{label}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <tbody>
          {[row1, row2, row3].map((row, rIdx) => (
            <tr key={rIdx}>
              {row.map((num) => (
                <td
                  key={num}
                  style={{
                    width: "12.5%",
                    textAlign: "center",
                    fontSize: "9.5px",
                    lineHeight: "1.3",
                    padding: "0",
                    border: "none",
                  }}
                >
                  {num}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </td>
  )
}

function ShootingPair({ title, labels }: { title: string; labels: [string, string] }) {
  return (
    <div>
      <div style={{ fontWeight: "bold", fontSize: "11px", marginBottom: "2px" }}>{title}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #000" }}>
        <tbody>
          <tr>
            <ShotGrid label={labels[0]} />
            <ShotGrid label={labels[1]} />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function TeamSection({
  side,
  teamName,
  roster,
}: {
  side: "H" | "A"
  teamName: string
  roster: ScoresheetRosterPlayer[]
}) {
  const isHugeRoster = roster.length > 24
  const isVeryLargeRoster = roster.length > 20
  const isLargeRoster = roster.length > 16

  const rosterFontSize = isHugeRoster ? "8.5px" : isVeryLargeRoster ? "9.5px" : isLargeRoster ? "10px" : "11px"
  const rosterLineHeight = isHugeRoster ? "1.18" : isVeryLargeRoster ? "1.22" : isLargeRoster ? "1.28" : "1.38"

  return (
    <>
      {/* First Row: Roster (Left), Scoring (Center), Penalties (Right) */}
      <tr>
        {/* Left Column: Roster */}
        <td style={{ verticalAlign: "top", width: "28%", padding: "0 4px" }}>
          <div style={{ fontWeight: "bold", fontSize: "11px", marginBottom: "2px" }}>
            {side} - {teamName} Roster
          </div>
          <div style={{ fontSize: rosterFontSize, lineHeight: rosterLineHeight }}>
            {roster.length > 0 ? (
              roster.map((p, i) => (
                <span
                  key={i}
                  style={{
                    display: "block",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {p.is_captain ? "(c) " : ""}
                  {p.is_goalie ? "(g) " : ""}
                  {p.name}
                  {p.is_sub ? " (sub)" : ""}
                </span>
              ))
            ) : (
              <span style={{ color: "#999", fontStyle: "italic" }}>No roster available</span>
            )}
          </div>
        </td>

        {/* Center Column: Scoring + Per 1 & Per 2 shooting (spans 2 rows) */}
        <td style={{ verticalAlign: "top", width: "36%", padding: "0 4px" }} rowSpan={2}>
          <ScoringTable teamName={teamName} />
          <div style={{ marginTop: "4px" }}>
            <ShootingPair title={`${teamName} Shooting`} labels={["Per 1", "Per 2"]} />
          </div>
        </td>

        {/* Right Column: Penalties + Timeouts / Per 3 & OT shooting (spans 2 rows) */}
        <td style={{ verticalAlign: "top", width: "36%", padding: "0 4px" }} rowSpan={2}>
          <PenaltyTable teamName={teamName} />
          <div style={{ marginTop: "4px" }}>
            <ShootingPair
              title={`${teamName} Timeouts\u00A0\u00A0\u00A0\u00A01\u00A0\u00A0\u00A0\u00A02`}
              labels={["Per 3", "OT"]}
            />
          </div>
        </td>
      </tr>

      {/* Second Row: Goalie Table (Left) */}
      <tr>
        {/* Left Column: Goalies (valigned bottom to align with bottom of center/right columns) */}
        <td style={{ verticalAlign: "bottom", width: "28%", padding: "0 4px", paddingTop: "4px" }}>
          <GoalieTable teamName={teamName} />
        </td>
      </tr>
    </>
  )
}

/* ─── Main Component ─────────────────────────────────────────────────── */

export function GameScoresheet({
  game,
  homeRoster,
  awayRoster,
  officials,
  id,
  className,
  showBackButton = false,
}: GameScoresheetProps) {
  const refs = officials.filter((o) => o.role === "ref")
  const scorekeepers = officials.filter((o) => o.role === "scorekeeper")

  const homeName = game.home_name || "TBD"
  const awayName = game.away_name || "TBD"
  const seasonName = game.season_name || "Season"

  let dateStr = game.date || ""
  if (game.date) {
    try {
      const datePart = game.date.split("T")[0].trim()
      if (datePart.includes("-")) {
        const parts = datePart.split("-").map(Number)
        if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
          const [y, m, d] = parts[0] > 1000 ? [parts[0], parts[1], parts[2]] : [parts[2], parts[0], parts[1]]
          dateStr = `${m}/${d}/${y}`
        }
      } else {
        const parsed = new Date(game.date)
        if (!isNaN(parsed.getTime())) {
          dateStr = `${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()}/${parsed.getUTCFullYear()}`
        }
      }
    } catch {
      // Keep dateStr fallback
    }
  }

  return (
    <div
      id={id}
      className={`scoresheet-page ${className || ""}`}
      style={{
        fontFamily: "Tahoma, Verdana, Arial, sans-serif",
        color: "#000",
        backgroundColor: "#fff",
        padding: "8px 12px",
        fontSize: "11px",
      }}
    >
      {showBackButton && <BackButton />}

      {/* Header */}
      <table style={{ width: "100%", marginBottom: "4px" }}>
        <tbody>
          <tr>
            <td style={{ width: "15%", verticalAlign: "middle" }}>
              <img
                src="/team-logos/bash_transparent_1024.png"
                alt="BASH"
                style={{ width: "64px", height: "64px" }}
              />
            </td>
            <td style={{ textAlign: "center", verticalAlign: "middle" }}>
              <div style={{ fontWeight: "bold", fontSize: "17px", letterSpacing: "0.2px" }}>
                BASH - {seasonName} Game Scoresheet
              </div>
              <div style={{ fontWeight: "bold", fontSize: "14px", marginTop: "4px" }}>
                {awayName} at {homeName}
              </div>
            </td>
            <td
              style={{
                width: "25%",
                textAlign: "right",
                verticalAlign: "middle",
                fontSize: "12px",
                fontWeight: "bold",
              }}
            >
              <div>
                {dateStr}&nbsp;&nbsp;&nbsp;{formatGameTime(game.time)}
              </div>
              <div style={{ marginTop: "2px" }}>{game.location || "The Lick"}</div>
            </td>
          </tr>
        </tbody>
      </table>

      <hr style={{ border: "none", borderTop: "1px solid #000", margin: "5px 0" }} />

      {/* ── Home Team Section ── */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <TeamSection side="H" teamName={homeName} roster={homeRoster} />
        </tbody>
      </table>

      <hr style={{ border: "none", borderTop: "1px solid #000", margin: "4px 0" }} />

      {/* ── Away Team Section ── */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <TeamSection side="A" teamName={awayName} roster={awayRoster} />
        </tbody>
      </table>

      <hr style={{ border: "none", borderTop: "1px solid #000", margin: "4px 0" }} />

      {/* ── Footer ── */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            {/* Signatures */}
            <td style={{ verticalAlign: "top", width: "28%", padding: "0 4px" }}>
              <div style={{ fontWeight: "bold", fontSize: "11px", marginBottom: "2px" }}>
                Signatures
              </div>
              <table style={{ width: "95%", borderCollapse: "collapse", border: "1px solid #000" }}>
                <tbody>
                  <tr>
                    <td
                      style={{
                        padding: "5px 6px",
                        borderBottom: "1px solid #000",
                        fontSize: "10px",
                        height: "24px",
                      }}
                    >
                      Off 1: {refs[0]?.name || ""}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        padding: "5px 6px",
                        borderBottom: "1px solid #000",
                        fontSize: "10px",
                        height: "24px",
                      }}
                    >
                      Off 2: {refs[1]?.name || ""}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "5px 6px", fontSize: "10px", height: "24px" }}>
                      SKpr: {scorekeepers[0]?.name || ""}
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>

            {/* Scoring Summary */}
            <td style={{ verticalAlign: "top", width: "36%", padding: "0 4px" }}>
              <div style={{ fontWeight: "bold", fontSize: "11px", marginBottom: "2px" }}>
                Scoring Summary
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #000" }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: "20%", textAlign: "left" }}>GOALS</th>
                    <th style={thStyle}>1</th>
                    <th style={thStyle}>2</th>
                    <th style={thStyle}>3</th>
                    <th style={thStyle}>OT</th>
                    <th style={thStyle}>TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td
                      style={{
                        fontSize: "9px",
                        padding: "3px 4px",
                        borderBottom: "1px solid #000",
                        borderRight: "1px solid #000",
                      }}
                    >
                      Home
                    </td>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <td
                        key={i}
                        style={{
                          borderBottom: "1px solid #000",
                          borderRight: i < 4 ? "1px solid #000" : undefined,
                          height: "20px",
                        }}
                      >
                        &nbsp;
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td
                      style={{
                        fontSize: "9px",
                        padding: "3px 4px",
                        borderRight: "1px solid #000",
                      }}
                    >
                      Away
                    </td>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <td
                        key={i}
                        style={{
                          borderRight: i < 4 ? "1px solid #000" : undefined,
                          height: "20px",
                        }}
                      >
                        &nbsp;
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </td>

            {/* Shots Summary */}
            <td style={{ verticalAlign: "top", width: "36%", padding: "0 4px" }}>
              <div style={{ fontWeight: "bold", fontSize: "11px", marginBottom: "2px" }}>
                Shots Summary
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #000" }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: "20%", textAlign: "left" }}>SHOTS</th>
                    <th style={thStyle}>1</th>
                    <th style={thStyle}>2</th>
                    <th style={thStyle}>3</th>
                    <th style={thStyle}>OT</th>
                    <th style={thStyle}>TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td
                      style={{
                        fontSize: "9px",
                        padding: "3px 4px",
                        borderBottom: "1px solid #000",
                        borderRight: "1px solid #000",
                      }}
                    >
                      Home
                    </td>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <td
                        key={i}
                        style={{
                          borderBottom: "1px solid #000",
                          borderRight: i < 4 ? "1px solid #000" : undefined,
                          height: "20px",
                        }}
                      >
                        &nbsp;
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td
                      style={{
                        fontSize: "9px",
                        padding: "3px 4px",
                        borderRight: "1px solid #000",
                      }}
                    >
                      Away
                    </td>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <td
                        key={i}
                        style={{
                          borderRight: i < 4 ? "1px solid #000" : undefined,
                          height: "20px",
                        }}
                      >
                        &nbsp;
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── Game Stars ── */}
      <div style={{ marginTop: "6px" }}>
        <div style={{ fontWeight: "bold", fontSize: "11px", marginBottom: "2px" }}>Game Stars</div>
        <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #000" }}>
          <tbody>
            <tr>
              <td
                style={{
                  width: "33.3%",
                  padding: "6px 8px",
                  fontSize: "10px",
                  borderRight: "1px solid #000",
                  height: "28px",
                }}
              >
                Star #1:
              </td>
              <td
                style={{
                  width: "33.3%",
                  padding: "6px 8px",
                  fontSize: "10px",
                  borderRight: "1px solid #000",
                  height: "28px",
                }}
              >
                Star #2:
              </td>
              <td style={{ width: "33.4%", padding: "6px 8px", fontSize: "10px", height: "28px" }}>
                Star #3:
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
