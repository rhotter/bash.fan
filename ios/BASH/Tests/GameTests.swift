import XCTest
@testable import BASH

final class GameTests: XCTestCase {
    func testHistoricalPlayerWithoutTeam() throws {
        let json = #"{"id":148859,"name":"Unknown Player #148859","team":null,"teamSlug":null,"gp":3,"goals":1,"assists":2,"points":3}"#
        let player = try JSONDecoder().decode(Skater.self, from: Data(json.utf8))
        XCTAssertEqual(player.team, "")
        XCTAssertNil(player.teamSlug)
        XCTAssertEqual(player.points, 3)
    }

    private func game(time: String, date: String = "2026-10-25") throws -> Game {
        let json = """
        {"id":"g1","date":"\(date)","time":"\(time)","homeTeam":"Home","awayTeam":"Away","homeSlug":null,"awaySlug":null,"homeScore":null,"awayScore":null,"status":"upcoming","location":"The Lick","isOvertime":false,"isPlayoff":false}
        """
        return try JSONDecoder().decode(Game.self, from: Data(json.utf8))
    }
    func testPacificGameTimes() throws {
        let expected = ISO8601DateFormatter().date(from: "2026-10-25T16:00:00Z")
        XCTAssertEqual(try game(time: "9:00am").startsAt, expected)
        XCTAssertEqual(try game(time: "9:00 AM").startsAt, expected)
        XCTAssertEqual(try game(time: "09:00").startsAt, expected)
        XCTAssertEqual(try game(time: "09:00:00").startsAt, expected)
        XCTAssertNil(try game(time: "TBD").startsAt)
    }
    func testWinterTimeAndUnknownTeams() throws {
        let fixture = try game(time: "12:00pm", date: "2026-12-01")
        XCTAssertEqual(fixture.startsAt, ISO8601DateFormatter().date(from: "2026-12-01T20:00:00Z"))
        XCTAssertNil(fixture.homeSlug)
        XCTAssertNil(fixture.homeScore)
    }
    func testWeekGroupingAcrossMonthAndPacificBoundary() throws {
        let weeks = GameWeek.build([
            try game(time: "9:00am", date: "2026-10-31"),
            try game(time: "9:00am", date: "2026-11-01"),
            try game(time: "9:00am", date: "2026-11-02")
        ])
        XCTAssertEqual(weeks.map(\.id), ["2026-10-26", "2026-11-02"])
        XCTAssertEqual(weeks[0].label, "Oct 26–Nov 1")
        XCTAssertEqual(weeks[0].games.count, 2)
        // UTC Monday is still Pacific Sunday.
        let sunday = ISO8601DateFormatter().date(from: "2026-11-02T03:00:00Z")!
        XCTAssertEqual(GameWeek.defaultWeek(in: weeks, now: sunday)?.id, "2026-10-26")
        let beforeSeason = ISO8601DateFormatter().date(from: "2026-10-01T12:00:00Z")!
        XCTAssertEqual(GameWeek.defaultWeek(in: weeks, now: beforeSeason)?.id, "2026-10-26")
        XCTAssertNil(GameWeek.defaultWeek(in: []))
    }

    func testMetricSortingAndZeroGames() {
        let alice = Skater(teamSlug: nil, id: 1, name: "Alice", team: "A", gp: 4, goals: 2, assists: 6, points: 8)
        let bob = Skater(teamSlug: nil, id: 2, name: "Bob", team: "B", gp: 2, goals: 5, assists: 1, points: 6)
        let zero = Skater(teamSlug: nil, id: 3, name: "Zero", team: "A", gp: 0, goals: 0, assists: 0, points: 0)
        XCTAssertEqual(StatMetric.points.sorted([bob, alice]).map(\.id), [1, 2])
        XCTAssertEqual(StatMetric.goals.sorted([alice, bob]).map(\.id), [2, 1])
        XCTAssertEqual(StatMetric.assists.sorted([bob, alice]).map(\.id), [1, 2])
        XCTAssertEqual(StatMetric.pointsPerGame.sorted([alice, bob, zero]).map(\.id), [2, 1, 3])
        XCTAssertEqual(StatMetric.pointsPerGame.display(zero), "0.00")
    }

    func testSearchMatchesPlayerNamesOnly() {
        let player = Skater(teamSlug: "yetis", id: 1, name: "Alice Smith", team: "Yetis", gp: 1, goals: 1, assists: 0, points: 1)
        XCTAssertTrue(player.matchesPlayerSearch("alice"))
        XCTAssertTrue(player.matchesPlayerSearch("  SMITH  "))
        XCTAssertTrue(player.matchesPlayerSearch("  "))
        XCTAssertFalse(player.matchesPlayerSearch("Yetis"))
    }

    func testPlayerSlugMatchesWebsiteRules() {
        let player = Skater(teamSlug: nil, id: 1, name: "  O’Neil -- D'Arcy Jr.  ", team: "", gp: 0, goals: 0, assists: 0, points: 0)
        XCTAssertEqual(player.slug, "oneil-darcy-jr")
    }

    func testCareerDecodingKeepsCompetitionsSeparate() throws {
        let json = """
        {"perSeasonStats":[{"seasonId":"2025-fall","seasonName":"Fall 2025","teamName":"Yetis","teamSlug":"yetis","stats":{"gp":5,"goals":2,"assists":3,"points":5,"ptsPg":"1.00","pim":2}}],"playoffPerSeasonStats":[],"perSeasonGoalieStats":[{"seasonId":"2024-fall","seasonName":"Fall 2024","teamName":"Loons","teamSlug":"loons","stats":{"gp":3,"wins":2,"losses":1,"gaa":"1.25","savePercentage":"0.950","shutouts":1}}],"playoffPerSeasonGoalieStats":[],"allTimeStats":null,"playoffAllTimeStats":null}
        """
        let career = try JSONDecoder().decode(PlayerCareer.self, from: Data(json.utf8))
        XCTAssertEqual(career.perSeasonStats.first?.stats.points, 5)
        XCTAssertEqual(career.perSeasonGoalieStats.first?.stats.savePercentage, "0.950")
        XCTAssertTrue(career.playoffPerSeasonStats.isEmpty)
        XCTAssertNil(career.allTimeStats)
    }

    func testLiveBoxScoreAndChronologicalGoals() throws {
        let json = """
        {"state":{"period":5,"goals":[
          {"id":"late","team":"home","period":2,"clock":"2:23","scorerId":1,"assist1Id":2,"assist2Id":null,"flags":[]},
          {"id":"early","team":"home","period":2,"clock":"19:21","scorerId":2,"assist1Id":1,"assist2Id":null,"flags":["PPG"]},
          {"id":"so","team":"home","period":5,"clock":"0:00","scorerId":1,"assist1Id":null,"assist2Id":null,"flags":[]}],
          "penalties":[{"id":"p","team":"home","period":1,"clock":"5:00","playerId":2,"infraction":"Tripping","minutes":2}],
          "homeShots":[3,4,5],"awayShots":[2,3,4],"homeAttendance":[1,2,3],"awayAttendance":[]},
          "playerNames":{"1":"Alice","2":"Bob","3":"Goalie"},"homeScore":3,"awayScore":2,"status":"live","goalieIds":[3],"subPlayerIds":[2]}
        """
        let live = try JSONDecoder().decode(GameLive.self, from: Data(json.utf8))
        XCTAssertEqual(live.orderedGoals.map(\.id), ["early", "late", "so"])
        XCTAssertEqual(live.events.map(\.id), ["penalty-p", "goal-early", "goal-late", "goal-so"])
        XCTAssertEqual(live.summaryPeriods, [1, 2, 3, 4])
        let emptyJSON = """
        {"state":{"period":2,"goals":[],"penalties":[],"homeShots":[0,0,0],"awayShots":[0,0,0],"homeAttendance":[],"awayAttendance":[]},"playerNames":{},"homeScore":0,"awayScore":0,"status":"live","goalieIds":[],"subPlayerIds":[]}
        """
        let empty = try JSONDecoder().decode(GameLive.self, from: Data(emptyJSON.utf8))
        XCTAssertEqual(empty.summaryPeriods, [1, 2])
        let final = try JSONDecoder().decode(GameLive.self, from: Data(emptyJSON.replacingOccurrences(of: "\"live\"", with: "\"final\"").utf8))
        XCTAssertEqual(final.summaryPeriods, [1, 2, 3])
        let upcoming = try JSONDecoder().decode(GameLive.self, from: Data(emptyJSON.replacingOccurrences(of: "\"live\"", with: "\"upcoming\"").utf8))
        XCTAssertTrue(upcoming.summaryPeriods.isEmpty)
        let players = live.skaters(home: true, slug: "home")
        XCTAssertEqual(players.map(\.id), [1, 2])
        XCTAssertEqual(players[0].goals, 1) // Shootout attempts do not count in skater totals.
        XCTAssertEqual(players[0].assists, 1)
        XCTAssertEqual(players[1].points, 2)
        XCTAssertEqual(players[1].pim, 2)
        XCTAssertTrue(players[1].isSub)
        XCTAssertNil(live.state.threeStars)
        XCTAssertNil(live.state.shootout)
    }

}
