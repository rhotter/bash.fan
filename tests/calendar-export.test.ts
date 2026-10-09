import { describe, it, expect } from "vitest"
import { generateICS, type CalendarEventInput } from "@/lib/calendar-export"

describe("iCalendar Export (generateICS)", () => {
  it("generates a 2-hour event by default for morning games", () => {
    const event: CalendarEventInput = {
      id: "g1",
      date: "2026-10-10",
      time: "9:00am",
      homeTeam: "Yetis",
      awayTeam: "No ReGretzkys",
      seasonLocation: "The Lick",
      seasonName: "BASH 2026-2027",
    }

    const ics = generateICS([event])
    expect(ics).toContain("DTSTART;TZID=America/Los_Angeles:20261010T090000")
    expect(ics).toContain("DTEND;TZID=America/Los_Angeles:20261010T110000")
    expect(ics).toContain("SUMMARY:BASH: No ReGretzkys @ Yetis")
    expect(ics).toContain("LOCATION:The Lick")
    expect(ics).toContain("DESCRIPTION:BASH - BASH 2026-2027")
  })

  it("generates a 2-hour event by default for afternoon 12-hour games", () => {
    const event: CalendarEventInput = {
      id: "g2",
      date: "2026-10-10",
      time: "1:00pm",
      homeTeam: "Landsharks",
      awayTeam: "Reign",
      seasonLocation: "The Lick",
    }

    const ics = generateICS([event])
    expect(ics).toContain("DTSTART;TZID=America/Los_Angeles:20261010T130000")
    expect(ics).toContain("DTEND;TZID=America/Los_Angeles:20261010T150000")
  })

  it("generates a 2-hour event for 24-hour formatted time (14:00 -> 16:00)", () => {
    const event: CalendarEventInput = {
      id: "g3",
      date: "2026-10-10",
      time: "14:00",
      homeTeam: "Seals",
      awayTeam: "Loons",
      seasonLocation: "The Lick",
    }

    const ics = generateICS([event])
    expect(ics).toContain("DTSTART;TZID=America/Los_Angeles:20261010T140000")
    expect(ics).toContain("DTEND;TZID=America/Los_Angeles:20261010T160000")
  })

  it("scales event duration to gameLengthMinutes * 2 (45 min game -> 90 min event)", () => {
    const event: CalendarEventInput = {
      id: "g4a",
      date: "2026-10-10",
      time: "9:00am",
      homeTeam: "Yetis",
      awayTeam: "Seals",
      seasonLocation: "The Lick",
      gameLengthMinutes: 45,
    }

    const ics = generateICS([event])
    expect(ics).toContain("DTSTART;TZID=America/Los_Angeles:20261010T090000")
    expect(ics).toContain("DTEND;TZID=America/Los_Angeles:20261010T103000")
  })

  it("scales event duration to gameLengthMinutes * 2 (60 min game -> 120 min event)", () => {
    const event: CalendarEventInput = {
      id: "g4b",
      date: "2026-10-10",
      time: "10:30am",
      homeTeam: "Yetis",
      awayTeam: "Seals",
      seasonLocation: "The Lick",
      gameLengthMinutes: 60,
    }

    const ics = generateICS([event])
    expect(ics).toContain("DTSTART;TZID=America/Los_Angeles:20261010T103000")
    expect(ics).toContain("DTEND;TZID=America/Los_Angeles:20261010T123000")
  })

  it("honors custom durationMinutes override when specified", () => {
    const event: CalendarEventInput = {
      id: "g4c",
      date: "2026-10-10",
      time: "9:00am",
      homeTeam: "Yetis",
      awayTeam: "Seals",
      seasonLocation: "The Lick",
      durationMinutes: 150,
    }

    const ics = generateICS([event])
    expect(ics).toContain("DTSTART;TZID=America/Los_Angeles:20261010T090000")
    expect(ics).toContain("DTEND;TZID=America/Los_Angeles:20261010T113000")
  })

  it("honors custom durationHours when specified", () => {
    const event: CalendarEventInput = {
      id: "g4",
      date: "2026-10-10",
      time: "9:00am",
      homeTeam: "Yetis",
      awayTeam: "Seals",
      seasonLocation: "The Lick",
      durationHours: 3,
    }

    const ics = generateICS([event])
    expect(ics).toContain("DTSTART;TZID=America/Los_Angeles:20261010T090000")
    expect(ics).toContain("DTEND;TZID=America/Los_Angeles:20261010T120000")
  })

  it("handles midnight rollover accurately across day and month boundary", () => {
    const event: CalendarEventInput = {
      id: "g5",
      date: "2026-10-31",
      time: "11:00pm",
      homeTeam: "Yetis",
      awayTeam: "Rats",
      location: "The Lick",
    }

    const ics = generateICS([event])
    expect(ics).toContain("DTSTART;TZID=America/Los_Angeles:20261031T230000")
    expect(ics).toContain("DTEND;TZID=America/Los_Angeles:20261101T010000")
  })

  it("handles year boundary rollover accurately", () => {
    const event: CalendarEventInput = {
      id: "g6",
      date: "2026-12-31",
      time: "11:00pm",
      homeTeam: "Yetis",
      awayTeam: "Rats",
      location: "The Lick",
    }

    const ics = generateICS([event])
    expect(ics).toContain("DTSTART;TZID=America/Los_Angeles:20261231T230000")
    expect(ics).toContain("DTEND;TZID=America/Los_Angeles:20270101T010000")
  })

  it("falls back to event.location when seasonLocation is missing", () => {
    const event: CalendarEventInput = {
      id: "g7",
      date: "2026-10-10",
      time: "11:00am",
      homeTeam: "Yetis",
      awayTeam: "Loons",
      location: "The Lick",
    }

    const ics = generateICS([event])
    expect(ics).toContain("LOCATION:The Lick")
  })

  it("throws an error when neither seasonLocation nor location is provided", () => {
    const event: CalendarEventInput = {
      id: "g8",
      date: "2026-10-10",
      time: "11:00am",
      homeTeam: "Yetis",
      awayTeam: "Loons",
      seasonName: "Summer 2026",
    }

    expect(() => generateICS([event])).toThrowError("Location is not provided for season: Summer 2026")
  })

  it("correctly formats all-day TBD events", () => {
    const event: CalendarEventInput = {
      id: "g9",
      date: "2026-10-10",
      time: "TBD",
      homeTeam: "Yetis",
      awayTeam: "Loons",
      seasonLocation: "The Lick",
    }

    const ics = generateICS([event])
    expect(ics).toContain("DTSTART;VALUE=DATE:20261010")
    expect(ics).toContain("DTEND;VALUE=DATE:20261011")
  })
})
