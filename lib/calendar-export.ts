/**
 * Client-side iCalendar (.ics) generation and download utility.
 * All BASH games are in America/Los_Angeles.
 */

/** IANA timezone for all BASH game times */
const BASH_TIMEZONE = "America/Los_Angeles"

export interface CalendarEventInput {
  id: string
  date: string // "YYYY-MM-DD"
  time: string // "9:00pm", "14:00", or "TBD"
  homeTeam: string
  awayTeam: string
  location?: string | null
  seasonLocation?: string | null
  title?: string | null
  seasonName?: string
  gameLengthMinutes?: number | null
  durationMinutes?: number
  durationHours?: number
}

/**
 * Format a date/time as an ICS local-time string: YYYYMMDDTHHmmss
 * Used with a TZID parameter — does NOT append "Z".
 */
function formatICSDateTime(y: number, mo: number, d: number, h: number, min: number): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${y}${pad(mo)}${pad(d)}T${pad(h)}${pad(min)}00`
}

/** Format a UTC timestamp for DTSTAMP (appends Z). */
function formatUTCStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

function formatAllDayDate(y: number, mo: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${y}${pad(mo)}${pad(d)}`
}

/**
 * VTIMEZONE component for America/Los_Angeles.
 * Covers standard US DST rules (second Sunday in March → first Sunday in November).
 */
function vtimezoneLA(): string[] {
  return [
    "BEGIN:VTIMEZONE",
    "TZID:America/Los_Angeles",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0800",
    "TZOFFSETTO:-0700",
    "TZNAME:PDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0700",
    "TZOFFSETTO:-0800",
    "TZNAME:PST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ]
}

export function generateICS(events: CalendarEventInput[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bay Area Street Hockey//BASH Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-TIMEZONE:${BASH_TIMEZONE}`,
    ...vtimezoneLA(),
  ]

  const stamp = formatUTCStamp(new Date())

  for (const event of events) {
    const isTBD = event.time === "TBD"
    const [y, m, d] = event.date.split("-").map(Number)
    
    let dtStartLine: string
    let dtEndLine: string

    if (isTBD) {
      // All-day event — DATE values have no timezone
      dtStartLine = `DTSTART;VALUE=DATE:${formatAllDayDate(y, m, d)}`
      // All-day DTEND is exclusive, so next day
      const next = new Date(y, m - 1, d + 1)
      dtEndLine = `DTEND;VALUE=DATE:${formatAllDayDate(next.getFullYear(), next.getMonth() + 1, next.getDate())}`
    } else {
      // Parse time string: handles "14:00", "9:00p", "9:00pm", "9:00 PM", etc.
      let h: number, min: number
      const ampmMatch = event.time.match(/^(\d{1,2}):(\d{2})\s*(a|am|p|pm)$/i)
      if (ampmMatch) {
        h = parseInt(ampmMatch[1], 10)
        min = parseInt(ampmMatch[2], 10)
        const isPM = ampmMatch[3].toLowerCase().startsWith("p")
        if (isPM && h !== 12) h += 12
        else if (!isPM && h === 12) h = 0
      } else {
        ;[h, min] = event.time.split(":").map(Number)
      }

      const startStr = formatICSDateTime(y, m, d, h, min)
      // Event duration: season game length * 2 (or custom durationMinutes/durationHours, defaulting to 120 minutes)
      const durationMinutes =
        event.durationMinutes ??
        (event.gameLengthMinutes != null && event.gameLengthMinutes > 0
          ? Math.round(event.gameLengthMinutes * 2)
          : event.durationHours != null
          ? Math.round(event.durationHours * 60)
          : 120)
      const endDate = new Date(Date.UTC(y, m - 1, d, h, min + durationMinutes))
      const endStr = formatICSDateTime(
        endDate.getUTCFullYear(),
        endDate.getUTCMonth() + 1,
        endDate.getUTCDate(),
        endDate.getUTCHours(),
        endDate.getUTCMinutes()
      )
      dtStartLine = `DTSTART;TZID=${BASH_TIMEZONE}:${startStr}`
      dtEndLine = `DTEND;TZID=${BASH_TIMEZONE}:${endStr}`
    }

    const summary = event.title 
      ? event.title 
      : `BASH: ${event.awayTeam} @ ${event.homeTeam}`
    
    const location = event.seasonLocation || event.location
    if (!location || !location.trim()) {
      throw new Error(`Location is not provided for season: ${event.seasonName || "unknown"}`)
    }
    const description = event.seasonName ? `BASH - ${event.seasonName}` : "BASH"

    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@bayareastreethockey.com`,
      `DTSTAMP:${stamp}`,
      dtStartLine,
      dtEndLine,
      `SUMMARY:${summary.replace(/[,;]/g, "\\$&")}`,
      `LOCATION:${location.replace(/[,;]/g, "\\$&")}`,
      `DESCRIPTION:${description.replace(/[,;]/g, "\\$&")}`,
      "END:VEVENT"
    )
  }

  lines.push("END:VCALENDAR")
  return lines.join("\r\n")
}

export function downloadICS(events: CalendarEventInput[], filename: string) {
  if (events.length === 0) return
  const icsContent = generateICS(events)
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  
  const link = document.createElement("a")
  link.href = url
  link.setAttribute("download", filename.endsWith(".ics") ? filename : `${filename}.ics`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
