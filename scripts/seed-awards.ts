import "./env"
import { rawSql } from "../lib/db"
import { sql } from "drizzle-orm"
import { execSync } from "child_process"

// ─── Historical award data (1991-2025) from BASH spreadsheet ──────────────────

type AwardEntry = { season: string; winners: string[] }

const HISTORICAL_AWARDS: Record<string, AwardEntry[]> = {
  mvp: [
    { season: "1991-1992", winners: ["Wahl"] },
    { season: "1992-1993", winners: ["Rowean"] },
    { season: "1993-1994", winners: ["Murray"] },
    { season: "1994-1995", winners: ["Rowean"] },
    { season: "1995-1996", winners: ["Rowean"] },
    { season: "1996-1997", winners: ["Rowean"] },
    { season: "1997-1998", winners: ["Rowean"] },
    { season: "1998-1999", winners: ["Clarke"] },
    { season: "1999-2000", winners: ["Roberge"] },
    { season: "2000-2001", winners: ["Roberge"] },
    { season: "2001-2002", winners: ["Suja"] },
    { season: "2002-2003", winners: ["Zilinskas"] },
    { season: "2003-2004", winners: ["Zilinskas"] },
    { season: "2004-2005", winners: ["Zilinskas"] },
    { season: "2005-2006", winners: ["Zilinskas"] },
    { season: "2006-2007", winners: ["Zilinskas"] },
    { season: "2007-2008", winners: ["Zilinskas"] },
    { season: "2008-2009", winners: ["Zilinskas"] },
    { season: "2009-2010", winners: ["Zilinskas"] },
    { season: "2010-2011", winners: ["Zilinskas"] },
    { season: "2011-2012", winners: ["Zilinskas"] },
    { season: "2012-2013", winners: ["Zilinskas"] },
    { season: "2013-2014", winners: ["B. Gornick"] },
    { season: "2014-2015", winners: ["Douglas"] },
    { season: "2015-2016", winners: ["Hatfield"] },
    { season: "2016-2017", winners: ["Hatfield"] },
    { season: "2017-2018", winners: ["C. Jones"] },
    { season: "2018-2019", winners: ["Hatfield"] },
    { season: "2019-2020", winners: ["Cole"] },
    { season: "2021-2022", winners: ["McCann"] },
    { season: "2022-2023", winners: ["C. Jones"] },
    { season: "2023-2024", winners: ["C. Jones"] },
    { season: "2024-2025", winners: ["C. Jones"] },
  ],
  conn_smythe: [
    { season: "1991-1992", winners: ["Smith"] },
    { season: "1992-1993", winners: ["Nailor", "Taylor"] },
    { season: "1993-1994", winners: ["Phillipps", "Wilson"] },
    { season: "1994-1995", winners: ["Palter"] },
    { season: "1995-1996", winners: ["K. Lorie"] },
    { season: "1996-1997", winners: ["Guthro"] },
    { season: "1997-1998", winners: ["Phillipps"] },
    { season: "1998-1999", winners: ["Murray"] },
    { season: "1999-2000", winners: ["Pirani"] },
    { season: "2000-2001", winners: ["Roberge"] },
    { season: "2001-2002", winners: ["Zilinskas"] },
    { season: "2002-2003", winners: ["Palter", "Fletcher"] },
    { season: "2003-2004", winners: ["Parsons"] },
    { season: "2004-2005", winners: ["Roberge"] },
    { season: "2005-2006", winners: ["Fletcher"] },
    { season: "2006-2007", winners: ["Craig"] },
    { season: "2007-2008", winners: ["Zilinskas"] },
    { season: "2008-2009", winners: ["Bateman"] },
    { season: "2009-2010", winners: ["Till", "Mnich"] },
    { season: "2010-2011", winners: ["Roddy"] },
    { season: "2011-2012", winners: ["Zink"] },
    { season: "2012-2013", winners: ["Zilinskas"] },
    { season: "2013-2014", winners: ["K. Jones", "Nesbit"] },
    { season: "2014-2015", winners: ["K. Jones", "Zink"] },
    { season: "2015-2016", winners: ["Shea"] },
    { season: "2016-2017", winners: ["Hatfield"] },
    { season: "2017-2018", winners: ["K. Jones"] },
    { season: "2018-2019", winners: ["Hatfield"] },
    { season: "2021-2022", winners: ["McCann"] },
    { season: "2022-2023", winners: ["Zilinskas"] },
    { season: "2023-2024", winners: ["C. Jones"] },
    { season: "2024-2025", winners: ["Tikku"] },
  ],
  scoring_title: [
    { season: "1991-1992", winners: ["Totman"] },
    { season: "1992-1993", winners: ["Rowean"] },
    { season: "1993-1994", winners: ["Nailor"] },
    { season: "1994-1995", winners: ["Caicco"] },
    { season: "1995-1996", winners: ["Rowean"] },
    { season: "1996-1997", winners: ["Gustafson"] },
    { season: "1997-1998", winners: ["Nailor"] },
    { season: "1998-1999", winners: ["Gustafson"] },
    { season: "1999-2000", winners: ["Roberge"] },
    { season: "2000-2001", winners: ["Roberge"] },
    { season: "2001-2002", winners: ["Millar"] },
    { season: "2002-2003", winners: ["Zilinskas"] },
    { season: "2003-2004", winners: ["Zilinskas"] },
    { season: "2004-2005", winners: ["Zilinskas"] },
    { season: "2005-2006", winners: ["Zilinskas"] },
    { season: "2006-2007", winners: ["Zilinskas"] },
    { season: "2007-2008", winners: ["Zilinskas"] },
    { season: "2008-2009", winners: ["Millar"] },
    { season: "2009-2010", winners: ["Zilinskas"] },
    { season: "2010-2011", winners: ["Zilinskas"] },
    { season: "2011-2012", winners: ["Zilinskas"] },
    { season: "2012-2013", winners: ["Zilinskas"] },
    { season: "2013-2014", winners: ["Zilinskas"] },
    { season: "2014-2015", winners: ["Quick"] },
    { season: "2015-2016", winners: ["Hatfield"] },
    { season: "2016-2017", winners: ["B. Gornick"] },
    { season: "2017-2018", winners: ["C. Jones"] },
    { season: "2018-2019", winners: ["C. Jones"] },
    { season: "2019-2020", winners: ["Cole"] },
    { season: "2021-2022", winners: ["C. Jones"] },
    { season: "2022-2023", winners: ["C. Jones"] },
    { season: "2023-2024", winners: ["C. Jones"] },
    { season: "2024-2025", winners: ["C. Jones"] },
  ],
  best_gaa: [
    { season: "1992-1993", winners: ["Smith"] },
    { season: "1993-1994", winners: ["Murray"] },
    { season: "1994-1995", winners: ["Smith"] },
    { season: "1995-1996", winners: ["Little"] },
    { season: "1996-1997", winners: ["Guthro"] },
    { season: "1997-1998", winners: ["Hocking"] },
    { season: "1998-1999", winners: ["Deming"] },
    { season: "1999-2000", winners: ["Murray"] },
    { season: "2000-2001", winners: ["Murray"] },
    { season: "2001-2002", winners: ["Suja"] },
    { season: "2002-2003", winners: ["Hocking"] },
    { season: "2003-2004", winners: ["Fletcher"] },
    { season: "2004-2005", winners: ["Fletcher"] },
    { season: "2005-2006", winners: ["Fletcher"] },
    { season: "2006-2007", winners: ["Townley"] },
    { season: "2007-2008", winners: ["Schoentrup"] },
    { season: "2008-2009", winners: ["Fletcher"] },
    { season: "2009-2010", winners: ["Fletcher"] },
    { season: "2010-2011", winners: ["Fletcher"] },
    { season: "2011-2012", winners: ["Mnich"] },
    { season: "2012-2013", winners: ["Jones"] },
    { season: "2013-2014", winners: ["Hocking"] },
    { season: "2014-2015", winners: ["Jones"] },
    { season: "2015-2016", winners: ["Jones"] },
    { season: "2016-2017", winners: ["Hocking"] },
    { season: "2017-2018", winners: ["K. Jones"] },
    { season: "2018-2019", winners: ["Casilli"] },
    { season: "2019-2020", winners: ["Tikku"] },
    { season: "2021-2022", winners: ["Casilli"] },
    { season: "2022-2023", winners: ["Peterson"] },
    { season: "2023-2024", winners: ["Reodica"] },
    { season: "2024-2025", winners: ["Casilli"] },
  ],
  vezina: [
    { season: "1991-1992", winners: ["Murray"] },
    { season: "1992-1993", winners: ["Smith"] },
    { season: "1993-1994", winners: ["Murray"] },
    { season: "1994-1995", winners: ["Murray"] },
    { season: "1995-1996", winners: ["Little"] },
    { season: "1996-1997", winners: ["Guthro"] },
    { season: "1997-1998", winners: ["Hocking"] },
    { season: "1998-1999", winners: ["Deming"] },
    { season: "1999-2000", winners: ["Murray"] },
    { season: "2000-2001", winners: ["Murray"] },
    { season: "2001-2002", winners: ["Suja"] },
    { season: "2002-2003", winners: ["Hocking"] },
    { season: "2003-2004", winners: ["Fletcher"] },
    { season: "2004-2005", winners: ["Fletcher"] },
    { season: "2005-2006", winners: ["Hocking"] },
    { season: "2006-2007", winners: ["Townley"] },
    { season: "2007-2008", winners: ["Schoentrup"] },
    { season: "2008-2009", winners: ["Fletcher"] },
    { season: "2009-2010", winners: ["K. Jones"] },
    { season: "2010-2011", winners: ["Fletcher"] },
    { season: "2011-2012", winners: ["Mnich"] },
    { season: "2012-2013", winners: ["Jones"] },
    { season: "2013-2014", winners: ["Hocking"] },
    { season: "2014-2015", winners: ["Jones"] },
    { season: "2015-2016", winners: ["A. Delmonico"] },
    { season: "2016-2017", winners: ["Hocking"] },
    { season: "2017-2018", winners: ["K. Jones"] },
    { season: "2018-2019", winners: ["Casilli"] },
    { season: "2019-2020", winners: ["Tikku"] },
    { season: "2021-2022", winners: ["Peterson"] },
    { season: "2022-2023", winners: ["Peterson"] },
    { season: "2023-2024", winners: ["Reodica"] },
    { season: "2024-2025", winners: ["Crawford"] },
  ],
  norris: [
    { season: "1991-1992", winners: ["Wahl"] },
    { season: "1992-1993", winners: ["Kellstedt"] },
    { season: "1993-1994", winners: ["Adelson"] },
    { season: "1994-1995", winners: ["Phillipps"] },
    { season: "1995-1996", winners: ["Phillipps"] },
    { season: "1996-1997", winners: ["Phillipps"] },
    { season: "1997-1998", winners: ["Phillipps"] },
    { season: "1998-1999", winners: ["Sandy Knapp"] },
    { season: "1999-2000", winners: ["Phillipps"] },
    { season: "2000-2001", winners: ["Sandy Knapp"] },
    { season: "2001-2002", winners: ["Phillipps"] },
    { season: "2002-2003", winners: ["Phillipps"] },
    { season: "2003-2004", winners: ["Phillipps"] },
    { season: "2004-2005", winners: ["Compton"] },
    { season: "2005-2006", winners: ["Schauffel"] },
    { season: "2006-2007", winners: ["Baffy"] },
    { season: "2007-2008", winners: ["Wardynski"] },
    { season: "2008-2009", winners: ["Wardynski"] },
    { season: "2009-2010", winners: ["Mandell"] },
    { season: "2010-2011", winners: ["Grills"] },
    { season: "2011-2012", winners: ["Wardynski"] },
    { season: "2012-2013", winners: ["Casey"] },
    { season: "2013-2014", winners: ["Casey"] },
    { season: "2014-2015", winners: ["Zilinskas"] },
    { season: "2015-2016", winners: ["Graves"] },
    { season: "2016-2017", winners: ["Torres"] },
    { season: "2017-2018", winners: ["J. Wong"] },
    { season: "2018-2019", winners: ["J. Wong"] },
    { season: "2019-2020", winners: ["J. Wong"] },
    { season: "2021-2022", winners: ["J. Wong"] },
    { season: "2022-2023", winners: ["J. Wong"] },
    { season: "2023-2024", winners: ["W. MacInnis"] },
    { season: "2024-2025", winners: ["W. MacInnis"] },
  ],
  calder: [
    { season: "1992-1993", winners: ["Rowean"] },
    { season: "1993-1994", winners: ["Caicco"] },
    { season: "1994-1995", winners: ["Wardynski"] },
    { season: "1995-1996", winners: ["Blanchette"] },
    { season: "1996-1997", winners: ["Reitman"] },
    { season: "1997-1998", winners: ["Palarchio"] },
    { season: "1998-1999", winners: ["Roberge"] },
    { season: "1999-2000", winners: ["Millar"] },
    { season: "2000-2001", winners: ["Daley"] },
    { season: "2001-2002", winners: ["Zilinskas"] },
    { season: "2002-2003", winners: ["Guillemette"] },
    { season: "2003-2004", winners: ["Dusan"] },
    { season: "2004-2005", winners: ["Anderson"] },
    { season: "2005-2006", winners: ["Roddy"] },
    { season: "2006-2007", winners: ["Demmer"] },
    { season: "2007-2008", winners: ["Bush"] },
    { season: "2008-2009", winners: ["Campbell"] },
    { season: "2009-2010", winners: ["Mnich"] },
    { season: "2010-2011", winners: ["Iannucci"] },
    { season: "2011-2012", winners: ["Bigio"] },
    { season: "2012-2013", winners: ["Catalano"] },
    { season: "2013-2014", winners: ["Gornick"] },
    { season: "2014-2015", winners: ["Douglass"] },
    { season: "2015-2016", winners: ["Maxwell"] },
    { season: "2016-2017", winners: ["Strang"] },
    { season: "2017-2018", winners: ["C. Jones"] },
    { season: "2018-2019", winners: ["Schneidman"] },
    { season: "2019-2020", winners: ["Peterson"] },
    { season: "2021-2022", winners: ["Goodale"] },
    { season: "2022-2023", winners: ["Sanrocco"] },
    { season: "2023-2024", winners: ["Crawford"] },
    { season: "2024-2025", winners: ["Hart"] },
  ],
  selke: [
    { season: "1991-1992", winners: ["Wilson"] },
    { season: "1992-1993", winners: ["Wilson"] },
    { season: "1993-1994", winners: ["Wilson"] },
    { season: "1994-1995", winners: ["Wilson"] },
    { season: "1995-1996", winners: ["Rowean"] },
    { season: "1996-1997", winners: ["Rowean"] },
    { season: "1997-1998", winners: ["Wardynski"] },
    { season: "1998-1999", winners: ["Clarke"] },
    { season: "1999-2000", winners: ["Krieger"] },
    { season: "2000-2001", winners: ["Krieger"] },
    { season: "2001-2002", winners: ["Palarchio"] },
    { season: "2002-2003", winners: ["Clarke"] },
    { season: "2003-2004", winners: ["Wardynski"] },
    { season: "2004-2005", winners: ["Zilinskas"] },
    { season: "2005-2006", winners: ["Wardynski"] },
    { season: "2006-2007", winners: ["Guillemette"] },
    { season: "2007-2008", winners: ["Pirani"] },
    { season: "2008-2009", winners: ["Millar"] },
    { season: "2009-2010", winners: ["Shea"] },
    { season: "2010-2011", winners: ["Shea"] },
    { season: "2011-2012", winners: ["Shea"] },
    { season: "2012-2013", winners: ["Shea"] },
    { season: "2013-2014", winners: ["Quick"] },
    { season: "2014-2015", winners: ["Quick"] },
    { season: "2015-2016", winners: ["Shea"] },
    { season: "2016-2017", winners: ["Quick"] },
    { season: "2017-2018", winners: ["Hatfield"] },
    { season: "2018-2019", winners: ["Quick"] },
    { season: "2019-2020", winners: ["Quick"] },
    { season: "2021-2022", winners: ["Hatfield"] },
    { season: "2022-2023", winners: ["Hatfield"] },
    { season: "2023-2024", winners: ["Faibish"] },
    { season: "2024-2025", winners: ["Bryant"] },
  ],
  lady_bing: [
    { season: "2003-2004", winners: ["Watts", "Greer"] },
    { season: "2004-2005", winners: ["Watts"] },
    { season: "2005-2006", winners: ["Moisio"] },
    { season: "2006-2007", winners: ["Suidan"] },
    { season: "2007-2008", winners: ["Dunmore"] },
    { season: "2008-2009", winners: ["Germack"] },
    { season: "2009-2010", winners: ["Fitzgerald"] },
    { season: "2010-2011", winners: ["Delmonico"] },
    { season: "2011-2012", winners: ["Rauh"] },
    { season: "2012-2013", winners: ["Germack"] },
    { season: "2013-2014", winners: ["Alylesworth"] },
    { season: "2014-2015", winners: ["Cerdan"] },
    { season: "2015-2016", winners: ["Del Prete"] },
    { season: "2016-2017", winners: ["Nerland"] },
    { season: "2017-2018", winners: ["McCann"] },
    { season: "2018-2019", winners: ["Del Prete"] },
    { season: "2019-2020", winners: ["Del Prete"] },
    { season: "2021-2022", winners: ["Pratt"] },
    { season: "2022-2023", winners: ["Pennise"] },
    { season: "2023-2024", winners: ["Knupp"] },
    { season: "2024-2025", winners: ["Pennise"] },
  ],
  most_improved: [
    { season: "2013-2014", winners: ["Eligado"] },
    { season: "2014-2015", winners: ["Torres"] },
    { season: "2015-2016", winners: ["Apsay"] },
    { season: "2016-2017", winners: ["Z. Nerland"] },
    { season: "2017-2018", winners: ["Meraz"] },
    { season: "2018-2019", winners: ["Casilli"] },
    { season: "2019-2020", winners: ["Ker"] },
    { season: "2021-2022", winners: ["Faibish"] },
    { season: "2022-2023", winners: ["Hilbich"] },
    { season: "2023-2024", winners: ["Mitchell"] },
    { season: "2024-2025", winners: ["White"] },
  ],
}

// ─── Hall of Fame data ────────────────────────────────────────────────────────

type HofEntry = {
  name: string
  classYear: number
  wing: "players" | "builders"
  yearsActive: string
  achievements: string
}

const HALL_OF_FAME: HofEntry[] = [
  // Class of 2006
  { name: "Lou Rowean", classYear: 2006, wing: "players", yearsActive: "1993-2001", achievements: "5X MVP, 2X Scoring Title, BASH Champion 1996" },
  { name: "John Wilson", classYear: 2006, wing: "players", yearsActive: "1991-1998", achievements: "4X BASH Champion, 3X Champion Captain" },
  { name: "Charlie Blanchette", classYear: 2006, wing: "players", yearsActive: "1995-2002, 2003-2004", achievements: "Rookie of the Year 1996, 2X BASH Champion" },
  { name: "Mark Adelson", classYear: 2006, wing: "players", yearsActive: "1991-2001", achievements: "Best Defensemen 1994, BASH Champion 1996" },
  { name: "Bill Taylor", classYear: 2006, wing: "players", yearsActive: "1991-2004", achievements: "4X BASH Champion" },
  // Class of 2007
  { name: "Martin Roberge", classYear: 2007, wing: "players", yearsActive: "1998-2005", achievements: "2X League MVP, 2X Playoff MVP, 3X BASH Champion" },
  { name: "Jay Nailor", classYear: 2007, wing: "players", yearsActive: "1991-2006, 2008-2022", achievements: "6X BASH Champion, 200 games played" },
  // Class of 2008
  { name: "Ben Phillipps", classYear: 2008, wing: "players", yearsActive: "1991-2006", achievements: "4X BASH Champion, 8X Best Defenseman" },
  // Class of 2009
  { name: "Brian Smith", classYear: 2009, wing: "players", yearsActive: "1991-1995", achievements: "3 titles in net, 2X Best GAA" },
  { name: "Eddie Murray", classYear: 2009, wing: "players", yearsActive: "1992-2010", achievements: "4X BASH Champion, 2nd all-time wins" },
  // Class of 2010
  { name: "Marty Gustafson", classYear: 2010, wing: "players", yearsActive: "1994-2004", achievements: "3X BASH Champion, 2X Scoring title" },
  // Class of 2011
  { name: "Danny Clarke", classYear: 2011, wing: "players", yearsActive: "1993-2010, 2017-2022", achievements: "6X BASH Champion, 1999 MVP" },
  // Class of 2022
  { name: "Scoter Wardynski", classYear: 2022, wing: "players", yearsActive: "1994-2017", achievements: "BASH Champion 2004, 2X Best Defenseman" },
  { name: "Regan Fletcher", classYear: 2022, wing: "players", yearsActive: "2002-2011", achievements: "5X BASH Champion, 1st all-time GAA" },
  { name: "Bill Millar", classYear: 2022, wing: "players", yearsActive: "1999-2019", achievements: "2X BASH Champion, 20 seasons" },
  // Class of 2023
  { name: "Ben Compton", classYear: 2023, wing: "players", yearsActive: "1995-1997, 2000-2012, 2013-2018", achievements: "6X BASH Champion with 5 different teams" },
  { name: "Alan Palter", classYear: 2023, wing: "players", yearsActive: "1991-2014", achievements: "Original BASHer, 8X BASH Champion" },
  { name: "Karim Pirani", classYear: 2023, wing: "players", yearsActive: "1998-2013", achievements: "3X BASH Champion" },
  { name: "Scott Schauffel", classYear: 2023, wing: "players", yearsActive: "1996-2020", achievements: "3X BASH Champion, 24 seasons" },
  // Class of 2024
  { name: "Don Bateman", classYear: 2024, wing: "players", yearsActive: "1994-1997, 2007-2014", achievements: "3X BASH Champion" },
  { name: "Sandy Knapp", classYear: 2024, wing: "players", yearsActive: "1997-2014", achievements: "2X Best Defenseman Award Winner" },
  { name: "Mike Peterson", classYear: 2024, wing: "players", yearsActive: "1993-2012", achievements: "2X BASH Champion" },
  // Class of 2025
  { name: "Mike Krieger", classYear: 2025, wing: "players", yearsActive: "1991-1993, 1996-2011, 2018-2019", achievements: "Original BASHer, 4X BASH Champion" },
  // Builders Wing
  { name: "Mitchell Friedman", classYear: 2011, wing: "builders", yearsActive: "1991-1997", achievements: "Founded BASH in 1991" },
  { name: "Greg Huntington", classYear: 2023, wing: "builders", yearsActive: "1995-2022", achievements: "3X BASH Champion, 28 seasons, referee 400+ games" },
]

// ─── Fuzzy name matching ──────────────────────────────────────────────────────

function normalize(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/['\u2019.\-]/g, "")
    .replace(/\s+/g, " ")
}

function matchPlayerByLastName(
  awardName: string,
  players: { id: number; name: string }[],
  seasonId: string,
  playerSeasons: Map<string, Set<number>>
): number | null {
  const normAward = normalize(awardName)
  const seasonPlayerIds = playerSeasons.get(seasonId)

  // 1. Exact full-name match (prioritize players in that season)
  for (const p of players) {
    if (normalize(p.name) === normAward) {
      if (!seasonPlayerIds || seasonPlayerIds.has(p.id)) return p.id
    }
  }
  // Exact match but not in season
  for (const p of players) {
    if (normalize(p.name) === normAward) return p.id
  }

  // 2. Last-name match with optional first initial
  // Handle "K. Jones" -> initial "k", last "jones"
  // Handle "B. Gornick" -> initial "b", last "gornick"
  // Handle "Zilinskas" -> no initial, last "zilinskas"
  const parts = normAward.split(" ")
  let initial: string | null = null
  let lastName: string

  if (parts.length >= 2 && parts[0].length <= 2) {
    // First part is an initial like "k" or "b"
    initial = parts[0].replace(/\./g, "")
    lastName = parts.slice(1).join(" ")
  } else if (parts.length >= 2) {
    // Full first + last name
    lastName = parts[parts.length - 1]
    initial = parts[0][0]
  } else {
    lastName = parts[0]
  }

  // Find all players matching this last name
  const lastNameMatches = players.filter((p) => {
    const normName = normalize(p.name)
    const pParts = normName.split(" ")
    if (pParts.length < 2) return normName === lastName
    return pParts[pParts.length - 1] === lastName
  })

  if (lastNameMatches.length === 1) return lastNameMatches[0].id

  // Multiple matches — filter by initial if available
  if (initial && lastNameMatches.length > 1) {
    const initialMatches = lastNameMatches.filter((p) => {
      const firstName = normalize(p.name).split(" ")[0]
      return firstName.startsWith(initial!)
    })
    // Prefer match in season
    if (seasonPlayerIds) {
      const inSeason = initialMatches.filter((p) => seasonPlayerIds.has(p.id))
      if (inSeason.length === 1) return inSeason[0].id
    }
    if (initialMatches.length === 1) return initialMatches[0].id
    if (initialMatches.length > 1) {
      // Prefer player in that season
      if (seasonPlayerIds) {
        const inSeason = initialMatches.filter((p) => seasonPlayerIds.has(p.id))
        if (inSeason.length >= 1) return inSeason[0].id
      }
      return initialMatches[0].id
    }
  }

  // Prefer match in season for last-name-only matches
  if (seasonPlayerIds && lastNameMatches.length > 1) {
    const inSeason = lastNameMatches.filter((p) => seasonPlayerIds.has(p.id))
    if (inSeason.length >= 1) return inSeason[0].id
  }

  if (lastNameMatches.length > 0) return lastNameMatches[0].id

  return null
}

// ─── Auto-compute post-2022 awards from game data ─────────────────────────────

// Seasons after 2021-2022 that are regular (not summer) seasons
const POST_2022_SEASONS = [
  "2022-2023",
  "2023-2024",
  "2024-2025",
  "2025-2026",
]

const MIN_GOALIE_GAMES = 5

async function computePostSeasonAwards(): Promise<{ awardType: string; seasonId: string; playerName: string; playerId: number }[]> {
  const results: { awardType: string; seasonId: string; playerName: string; playerId: number }[] = []

  for (const seasonId of POST_2022_SEASONS) {
    // Check if season has any completed games
    const gameCount = await rawSql(sql`
      SELECT COUNT(*)::int as count FROM games
      WHERE season_id = ${seasonId} AND status = 'final' AND NOT is_playoff
    `)
    if (gameCount[0].count === 0) continue

    // Scoring Title: player with most points in regular season
    const topScorer = await rawSql(sql`
      SELECT p.id, p.name, SUM(pgs.points)::int as total_points
      FROM player_game_stats pgs
      JOIN games g ON pgs.game_id = g.id AND g.season_id = ${seasonId} AND NOT g.is_playoff AND g.status = 'final'
      JOIN players p ON pgs.player_id = p.id
      GROUP BY p.id, p.name
      ORDER BY total_points DESC
      LIMIT 1
    `)
    if (topScorer.length > 0 && topScorer[0].total_points > 0) {
      results.push({
        awardType: "scoring_title",
        seasonId,
        playerName: topScorer[0].name,
        playerId: topScorer[0].id,
      })
    }

    // Best GAA: goalie with lowest GAA (min games threshold)
    const bestGoalie = await rawSql(sql`
      SELECT p.id, p.name,
        COUNT(*)::int as gp,
        SUM(ggs.goals_against)::float / NULLIF(SUM(ggs.minutes), 0) * 60 as gaa
      FROM goalie_game_stats ggs
      JOIN games g ON ggs.game_id = g.id AND g.season_id = ${seasonId} AND NOT g.is_playoff AND g.status = 'final'
      JOIN players p ON ggs.player_id = p.id
      GROUP BY p.id, p.name
      HAVING COUNT(*) >= ${MIN_GOALIE_GAMES} AND SUM(ggs.minutes) > 0
      ORDER BY gaa ASC
      LIMIT 1
    `)
    if (bestGoalie.length > 0) {
      results.push({
        awardType: "best_gaa",
        seasonId,
        playerName: bestGoalie[0].name,
        playerId: bestGoalie[0].id,
      })
    }
  }

  return results
}

// ─── Main seeding function ────────────────────────────────────────────────────

async function main() {
  console.log("Pushing schema via drizzle-kit...")
  execSync("npx drizzle-kit push", { stdio: "inherit" })
  console.log("Schema applied.")

  console.log("Loading players...")
  const players = await rawSql(sql`SELECT id, name FROM players ORDER BY id`) as { id: number; name: string }[]
  console.log(`Found ${players.length} players in database`)

  // Build season -> player_id map for better matching
  const playerSeasonsRows = await rawSql(sql`SELECT player_id, season_id FROM player_seasons`)
  const playerSeasons = new Map<string, Set<number>>()
  for (const row of playerSeasonsRows) {
    if (!playerSeasons.has(row.season_id)) playerSeasons.set(row.season_id, new Set())
    playerSeasons.get(row.season_id)!.add(row.player_id)
  }

  // ─── Seed historical awards ───────────────────────────────────────────
  console.log("\nSeeding historical awards...")
  let insertedAwards = 0
  let unmatchedAwards: string[] = []

  for (const [awardType, entries] of Object.entries(HISTORICAL_AWARDS)) {
    for (const entry of entries) {
      for (const winner of entry.winners) {
        const playerId = matchPlayerByLastName(winner, players, entry.season, playerSeasons)
        if (!playerId) {
          unmatchedAwards.push(`${awardType} ${entry.season}: "${winner}"`)
        }

        try {
          await rawSql(sql`
            INSERT INTO player_awards (player_name, player_id, season_id, award_type)
            VALUES (${winner}, ${playerId}, ${entry.season}, ${awardType})
            ON CONFLICT (player_name, season_id, award_type) DO NOTHING
          `)
          insertedAwards++
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`  Failed to insert ${awardType} ${entry.season} "${winner}": ${msg}`)
        }
      }
    }
  }

  console.log(`Inserted ${insertedAwards} historical awards`)
  if (unmatchedAwards.length > 0) {
    console.log(`\nUnmatched award winners (${unmatchedAwards.length}):`)
    for (const u of unmatchedAwards) {
      console.log(`  - ${u}`)
    }
  }

  // ─── Auto-compute post-2022 awards ────────────────────────────────────
  console.log("\nComputing post-2022 awards from game data...")
  const computed = await computePostSeasonAwards()

  for (const award of computed) {
    try {
      await rawSql(sql`
        INSERT INTO player_awards (player_name, player_id, season_id, award_type)
        VALUES (${award.playerName}, ${award.playerId}, ${award.seasonId}, ${award.awardType})
        ON CONFLICT (player_name, season_id, award_type) DO NOTHING
      `)
      console.log(`  ${award.awardType} ${award.seasonId}: ${award.playerName} (id=${award.playerId})`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`  Failed: ${msg}`)
    }
  }

  // ─── Seed Hall of Fame ────────────────────────────────────────────────
  console.log("\nSeeding Hall of Fame...")
  let insertedHof = 0
  let unmatchedHof: string[] = []

  for (const entry of HALL_OF_FAME) {
    const playerId = matchPlayerByLastName(entry.name, players, "", playerSeasons)
    if (!playerId) {
      unmatchedHof.push(`${entry.name} (Class of ${entry.classYear})`)
    }

    try {
      await rawSql(sql`
        INSERT INTO hall_of_fame (player_name, player_id, class_year, wing, years_active, achievements)
        VALUES (${entry.name}, ${playerId}, ${entry.classYear}, ${entry.wing}, ${entry.yearsActive ?? null}, ${entry.achievements ?? null})
        ON CONFLICT (player_name, class_year) DO NOTHING
      `)
      insertedHof++
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`  Failed to insert HOF "${entry.name}": ${msg}`)
    }
  }

  console.log(`Inserted ${insertedHof} Hall of Fame entries`)
  if (unmatchedHof.length > 0) {
    console.log(`\nUnmatched HOF inductees (${unmatchedHof.length}):`)
    for (const u of unmatchedHof) {
      console.log(`  - ${u}`)
    }
  }

  console.log("\nDone!")
}

main().catch(console.error)
