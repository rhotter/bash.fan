import XCTest
@testable import BASH

private final class ScoringTransportStub: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let rejected = request.url?.host == "conflict.example"
        let body = rejected ? "{\"error\":\"A newer state has already been saved\"}" : "{\"ok\":true}"
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: rejected ? 409 : 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class NativeScorekeeperTests: XCTestCase {
    @MainActor func testDraftPreservesUnknownStateAndClockUsesWallTime() throws {
        let model = NativeScorekeeper.sample()
        model.state["futureServerField"] = .object(["value": .string("retain")])
        model.state["clockRunning"] = .bool(true)
        model.state["clockStartedAt"] = .number(1_000_000)
        model.state["clockSeconds"] = .int(60)
        XCTAssertEqual(model.clock(at: Date(timeIntervalSince1970: 1010)), 50)
        model.shot(false, delta: 1)
        XCTAssertEqual(model.ids("awayShots"), [4, 0, 0])
        XCTAssertEqual(model.state["futureServerField"], .object(["value": .string("retain")]))
        XCTAssertTrue(model.dirty)
        let roundtrip = try JSONDecoder().decode(ScoringState.self, from: JSONEncoder().encode(model.state))
        XCTAssertEqual(roundtrip, model.state)
    }
    @MainActor func testPowerPlayGoalEndsMinorAndDeletionRestoresIt() {
        let model = NativeScorekeeper.sample()
        model.putEvent(["id": .string("penalty"), "team": .string("landsharks"), "period": .int(1), "clock": .string("18:00"), "playerId": .int(4), "minutes": .int(2), "infraction": .string("Tripping")], collection: "penalties")
        model.putEvent(["id": .string("goal"), "team": .string("seals"), "period": .int(1), "clock": .string("17:00"), "scorerId": .int(1), "assist1Id": .null, "assist2Id": .null, "flags": .array([.string("PPG")])], collection: "goals")
        XCTAssertEqual(model.list("penalties").first?["endedByGoalId"], .string("goal"))
        XCTAssertEqual(model.score(false), 1)
        model.remove("goals", id: "goal")
        XCTAssertNil(model.list("penalties").first?["endedByGoalId"])
        XCTAssertEqual(model.score(false), 0)
    }
    @MainActor func testPeriodTransitionClosesPullsAndKeepsOvertimeShots() {
        let model = NativeScorekeeper.sample()
        model.state["goaliePulls"] = .array([.object(["id": .string("pull"), "returnedAt": .null])])
        model.setPeriod(4)
        XCTAssertEqual(model.clock(), 300)
        XCTAssertFalse(model.running)
        XCTAssertEqual(model.ids("homeShots").count, 4)
        XCTAssertEqual(model.list("goaliePulls").first?["returnedAt"], .string("0:00"))
    }
    @MainActor func testConflictKeepsDraftAndBlocksFurtherEdits() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ScoringTransportStub.self]
        let fixture = NativeScorekeeper.sample()
        let model = NativeScorekeeper(game: fixture.game, server: URL(string: "https://conflict.example")!, cookies: [], session: URLSession(configuration: config))
        model.payload = fixture.payload; model.state = fixture.state
        model.shot(false, delta: 1)
        let saved = await model.save()
        XCTAssertFalse(saved)
        XCTAssertTrue(model.dirty)
        XCTAssertTrue(model.conflict)
        XCTAssertTrue(FileManager.default.fileExists(atPath: model.draftURL.path))
        let before = model.state
        model.shot(false, delta: 1)
        XCTAssertEqual(before, model.state)
        try FileManager.default.removeItem(at: model.draftURL)
    }
}
