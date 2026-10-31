import XCTest
@testable import BASH

final class LiveScoreTests: XCTestCase {
    func testRemoteActivityContentUsesUnixSecondsAndKeepsAssists() throws {
        let json = #"{"homeScore":2,"awayScore":1,"period":"P2","clock":"18:35","clockEndsAt":1793466000.5,"final":false,"status":"Live","scorer":"Scorer · P2 18:35","assists":"Assists: First, Second"}"#
        let state = try JSONDecoder().decode(GameActivityAttributes.ContentState.self, from: Data(json.utf8))
        XCTAssertEqual(state.clockEndsAt, 1793466000.5)
        XCTAssertEqual(state.assists, "Assists: First, Second")
        XCTAssertEqual(try JSONDecoder().decode(GameActivityAttributes.ContentState.self, from: JSONEncoder().encode(state)), state)
    }
    func testLogoAliasesAndUnknownTeams() {
        XCTAssertEqual(SportsTeam.asset("2026-rink-rats"), "rinkrats")
        XCTAssertEqual(SportsTeam.asset("landsharks"), "landsharks")
        XCTAssertNil(SportsTeam.asset("new-team"))
    }
}
