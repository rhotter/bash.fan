import XCTest
@testable import BASH

final class GameTests: XCTestCase {
    func testGoalieDecodingAndRanking() throws {
        let json = #"{"skaters":[],"goalies":[{"id":2,"name":"Zoe","team":null,"teamSlug":null,"gp":4,"wins":3,"losses":1,"savePercentage":0.920,"gaa":1.5,"shutouts":1,"saves":92,"goalsAgainst":8,"shotsAgainst":100,"goalieAssists":2},{"id":1,"name":"Amy","team":"A","teamSlug":"a","gp":5,"wins":4,"losses":1,"savePercentage":0.900,"gaa":2.0,"shutouts":0,"saves":90,"goalsAgainst":10,"shotsAgainst":100,"goalieAssists":0}]}"#
        let snapshot = try JSONDecoder().decode(PlayerSnapshot.self, from: Data(json.utf8))
        XCTAssertEqual(GoalieMetric.savePercentage.sorted(snapshot.goalies).map(\.id), [2, 1])
        XCTAssertEqual(GoalieMetric.gaa.sorted(snapshot.goalies).map(\.id), [2, 1])
        XCTAssertEqual(GoalieMetric.wins.sorted(snapshot.goalies).map(\.id), [1, 2])
        XCTAssertEqual(GoalieMetric.losses.sorted(snapshot.goalies).map(\.id), [1, 2])
        XCTAssertEqual(GoalieMetric.savePercentage.display(snapshot.goalies[0]), "0.920")
        XCTAssertEqual(GoalieMetric.gaa.display(snapshot.goalies[0]), "1.50")
        XCTAssertEqual(snapshot.goalies[0].player.team, "")
        XCTAssertTrue(snapshot.goalies[0].player.matchesPlayerSearch("zo"))
    }

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
    func testLiveClockDecodingAndCountdown() throws {
        let json = """
        {"id":"g1","date":"2026-10-31","time":"9:00am","homeTeam":"Home","awayTeam":"Away","homeScore":1,"awayScore":0,"status":"live","location":"The Lick","isOvertime":false,"isPlayoff":false,"livePeriod":2,"liveClockSeconds":185.9,"liveClockRunning":true,"liveClockStartedAt":1000000}
        """
        var game = try JSONDecoder().decode(Game.self, from: Data(json.utf8))
        XCTAssertEqual(game.statusLabel(at: Date(timeIntervalSince1970: 1005)), "P2 3:00")
        XCTAssertEqual(game.statusLabel(at: Date(timeIntervalSince1970: 2000)), "P2 0:00")
        game.liveClockRunning = false
        XCTAssertEqual(game.statusLabel(), "P2 3:05")
        game.livePeriod = 4
        XCTAssertEqual(game.statusLabel(), "OT 3:05")
        game.livePeriod = 5
        XCTAssertEqual(game.statusLabel(), "SO 3:05")
        game.liveClockSeconds = nil
        XCTAssertEqual(game.statusLabel(), "Live")
        XCTAssertNil(try self.game(time: "9:00am").liveClockSeconds)
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

    func testStatsTieBreakersMatchWeb() {
        let alice = Skater(teamSlug: nil, id: 1, name: "Alice", team: "A", gp: 10, goals: 2, assists: 6, points: 8)
        let bob = Skater(teamSlug: nil, id: 2, name: "Bob", team: "B", gp: 10, goals: 5, assists: 3, points: 8)
        let bobAgain = Skater(teamSlug: nil, id: 3, name: "Bob", team: "B", gp: 10, goals: 5, assists: 3, points: 8)
        XCTAssertEqual(StatMetric.points.sorted([alice, bobAgain, bob]).map(\.id), [2, 3, 1])
        XCTAssertEqual(StatMetric.gamesPlayed.sorted([alice, bobAgain, bob]).map(\.id), [1, 2, 3])
        let roundedLower = Skater(teamSlug: nil, id: 4, name: "Aaron", team: "A", gp: 200, goals: 1, assists: 0, points: 201)
        let roundedHigher = Skater(teamSlug: nil, id: 5, name: "Zoe", team: "A", gp: 199, goals: 1, assists: 0, points: 200)
        XCTAssertEqual(StatMetric.pointsPerGame.sorted([roundedLower, roundedHigher]).map(\.id), [5, 4])
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

final class LiveGoalieTests: XCTestCase {
    private func live(_ overrides: [String: Any] = [:], goalieIds: [Int] = [3, 4]) throws -> GameLive {
        var state: [String: Any] = [
            "period": 2, "goals": [goal(team: "away")], "penalties": [],
            "homeShots": [4, 2, 0], "awayShots": [6, 4, 0],
            "homeAttendance": [1, 3], "awayAttendance": [2, 4],
            "homeGoalieId": 3, "awayGoalieId": 4
        ]
        state.merge(overrides) { _, new in new }
        let json: [String: Any] = [
            "state": state, "playerNames": ["1": "Skater", "3": "Home goalie", "4": "Away goalie", "5": "Relief goalie"],
            "homeScore": 0, "awayScore": 1, "status": "live", "goalieIds": goalieIds, "subPlayerIds": [4]
        ]
        return try JSONDecoder().decode(GameLive.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private func goal(team: String, period: Int = 1, clock: String = "15:00", flags: [String] = []) -> [String: Any] {
        ["id": "\(team)-\(period)-\(clock)", "team": team, "period": period, "clock": clock,
         "scorerId": 2, "assist1Id": NSNull(), "assist2Id": NSNull(), "flags": flags]
    }

    private func change(snapshot: Bool = true) -> [String: Any] {
        var value: [String: Any] = ["team": "home", "period": 1, "clock": "10:00", "outGoalieId": 3, "inGoalieId": 5]
        if snapshot { value["shotSnapshot"] = ["period": 1, "clock": "10:00", "opponentShots": [4, 0, 0]] }
        return value
    }

    func testBothTeamsShowLiveGoaliesBeforeFinalizedStatsExist() throws {
        let game = try live()
        let home = try XCTUnwrap(game.goalies(home: true, slug: "home", opponentSlug: "away").first)
        XCTAssertEqual(home.id, 3)
        XCTAssertEqual(home.name, "Home goalie")
        XCTAssertEqual(home.goalsAgainst, 1)
        XCTAssertEqual(home.shotsAgainst, 10)
        XCTAssertEqual(home.saves, 9)
        XCTAssertEqual(home.savePercentage, "0.900")
        XCTAssertNil(home.seconds, "Live TOI is unknown, rather than zero")
        let away = try XCTUnwrap(game.goalies(home: false, slug: "away", opponentSlug: "home").first)
        XCTAssertEqual(away.id, 4)
        XCTAssertEqual(away.goalsAgainst, 0)
        XCTAssertEqual(away.saves, 6)
        XCTAssertTrue(away.isSub)
    }

    func testLiveUpdatesReplacePreviousShotTotals() throws {
        let game = try live(["awayShots": [6, 7, 0]])
        let goalie = try XCTUnwrap(game.goalies(home: true, slug: "home", opponentSlug: "away").first)
        XCTAssertEqual(goalie.shotsAgainst, 13)
        XCTAssertEqual(goalie.saves, 12)
        XCTAssertEqual(goalie.savePercentage, "0.923")
    }

    func testEmptyNetAndShootoutGoalsAreNotChargedToGoalie() throws {
        let goals = [goal(team: "away"), goal(team: "away", period: 3, flags: ["ENG"]), goal(team: "away", period: 5)]
        let game = try live(["period": 5, "goals": goals, "awayShots": [6, 4, 1, 2]])
        let goalie = try XCTUnwrap(game.goalies(home: true, slug: "home", opponentSlug: "away").first)
        XCTAssertEqual(goalie.goalsAgainst, 1)
        XCTAssertEqual(goalie.shotsAgainst, 12)
        XCTAssertEqual(goalie.saves, 11)
    }

    func testPlayoffExtraOvertimeGoalCounts() throws {
        let game = try live(["period": 5, "goals": [goal(team: "away", period: 5)]])
        XCTAssertEqual(game.goalies(home: true, slug: "home", opponentSlug: "away", isPlayoff: true).first?.goalsAgainst, 1)
        XCTAssertEqual(game.goalies(home: true, slug: "home", opponentSlug: "away").first?.goalsAgainst, 0)
    }

    func testZeroShotsAndAssignedGoalieWithoutAttendance() throws {
        let game = try live(["goals": [], "awayShots": [0, 0, 0], "homeAttendance": [1]])
        let goalie = try XCTUnwrap(game.goalies(home: true, slug: "home", opponentSlug: "away").first)
        XCTAssertEqual(goalie.id, 3)
        XCTAssertEqual(goalie.saves, 0)
        XCTAssertEqual(goalie.savePercentage, "0.000")
    }

    func testLegacyPayloadAndNoAssignedGoalie() throws {
        let game = try live(["homeGoalieId": NSNull(), "awayGoalieId": NSNull()])
        XCTAssertEqual(game.goalies(home: true, slug: "home", opponentSlug: "away").map(\.id), [3])
        let empty = try live(["homeGoalieId": NSNull()], goalieIds: [4])
        XCTAssertTrue(empty.goalies(home: true, slug: "home", opponentSlug: "away").isEmpty)
    }

    func testSubstitutionSplitsShotsAndGoalsAndKeepsBothGoaliesOutOfSkaters() throws {
        let game = try live([
            "homeGoalieId": 5, "homeAttendance": [1, 3, 5], "goalieChanges": [change()],
            "goals": [goal(team: "away"), goal(team: "away", clock: "5:00")]
        ], goalieIds: [5, 4])
        let goalies = game.goalies(home: true, slug: "home", opponentSlug: "away")
        XCTAssertEqual(goalies.map(\.id), [3, 5])
        XCTAssertEqual(goalies.map(\.goalsAgainst), [1, 1])
        XCTAssertEqual(goalies.map(\.shotsAgainst), [4, 6])
        XCTAssertEqual(goalies.map(\.saves), [3, 5])
        XCTAssertEqual(game.skaters(home: true, slug: "home").map(\.id), [1])
    }

    func testUnknownSubstitutionSplitKeepsNamesWithoutInventingSaves() throws {
        let game = try live(["homeGoalieId": 5, "goalieChanges": [change(snapshot: false)]])
        let goalies = game.goalies(home: true, slug: "home", opponentSlug: "away")
        XCTAssertEqual(goalies.map(\.name), ["Home goalie", "Relief goalie"])
        XCTAssertTrue(goalies.allSatisfy { $0.shotsAgainst == nil && $0.saves == nil && $0.savePercentage == "–" })
    }

    func testReturningGoalieCombinesStints() throws {
        let returning: [String: Any] = ["team": "home", "period": 2, "clock": "18:00", "outGoalieId": 5, "inGoalieId": 3,
                                        "shotSnapshot": ["period": 2, "clock": "18:00", "opponentShots": [6, 1, 0]]]
        let game = try live(["goalieChanges": [change(), returning],
                             "goals": [goal(team: "away"), goal(team: "away", clock: "5:00"), goal(team: "away", period: 2)]])
        let goalies = game.goalies(home: true, slug: "home", opponentSlug: "away")
        XCTAssertEqual(goalies.map(\.shotsAgainst), [7, 3])
        XCTAssertEqual(goalies.map(\.goalsAgainst), [2, 1])
        XCTAssertEqual(goalies.map(\.saves), [5, 2])
    }

    func testLegacyShotSplitBecomesUnavailableWhenLiveShotsChange() throws {
        let split: [String: Any] = ["homeGoalieId": 5, "goalieChanges": [change(snapshot: false)], "goalieShotsAgainst": ["3": 4, "5": 6]]
        let game = try live(split)
        XCTAssertEqual(game.goalies(home: true, slug: "home", opponentSlug: "away").map(\.shotsAgainst), [4, 6])
        var updated = split
        updated["awayShots"] = [6, 5, 0]
        let refreshed = try live(updated)
        XCTAssertTrue(refreshed.goalies(home: true, slug: "home", opponentSlug: "away").allSatisfy { $0.saves == nil })
    }

    func testEditedSubstitutionDoesNotReuseOldShotSnapshot() throws {
        var edited = change()
        edited["clock"] = "11:00"
        let game = try live(["homeGoalieId": 5, "goalieChanges": [edited]])
        XCTAssertTrue(game.goalies(home: true, slug: "home", opponentSlug: "away").allSatisfy { $0.shotsAgainst == nil })
    }

    func testGoalEnteredBeforeShotsDoesNotCreateNegativeSaves() throws {
        let game = try live(["awayShots": [0, 0, 0]])
        let goalie = try XCTUnwrap(game.goalies(home: true, slug: "home", opponentSlug: "away").first)
        XCTAssertEqual(goalie.goalsAgainst, 1)
        XCTAssertNil(goalie.saves)
        XCTAssertNil(goalie.shotsAgainst)
    }

    func testFinalizedGoalieStatsStillDecodeTimeAndFullTotals() throws {
        let json = #"{"id":3,"name":"Home goalie","seconds":3600,"goalsAgainst":1,"shotsAgainst":20,"saves":19,"savePercentage":"0.950","isSub":false}"#
        let goalie = try JSONDecoder().decode(BoxGoalie.self, from: Data(json.utf8))
        XCTAssertEqual(goalie.seconds, 3600)
        XCTAssertEqual(goalie.shotsAgainst, 20)
        XCTAssertEqual(goalie.saves, 19)
        XCTAssertEqual(goalie.savePercentage, "0.950")
    }
}
