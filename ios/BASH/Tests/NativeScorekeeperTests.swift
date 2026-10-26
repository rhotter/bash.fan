import XCTest
@testable import BASH

private final class ScoringTransportStub: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let rejected = request.url?.host == "conflict.example"
        let revisionServer = request.url?.host == "revision.example"
        if revisionServer {
            var data = request.httpBody ?? Data()
            if let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: buffer.count); if n <= 0 { break }; data.append(contentsOf: buffer.prefix(n)) }
            }
            let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            XCTAssertEqual(payload?["expectedRevision"] as? Int, 0)
            XCTAssertNotNil(UUID(uuidString: payload?["mutationId"] as? String ?? ""))
        }
        let body = revisionServer ? "{\"ok\":true,\"revision\":1}" : rejected ? "{\"error\":\"A newer state has already been saved\"}" : "{\"ok\":true}"
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
    @MainActor func testSaveAdoptsServerRevisionForNextWrite() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ScoringTransportStub.self]
        let fixture = NativeScorekeeper.sample()
        let model = NativeScorekeeper(game: fixture.game, server: URL(string: "https://revision.example")!, cookies: [], session: URLSession(configuration: config))
        model.payload = fixture.payload; model.state = fixture.state
        model.shot(false, delta: 1)
        let saved = await model.save()
        XCTAssertTrue(saved)
        XCTAssertFalse(model.dirty)
        XCTAssertEqual(model.expected["revision"], .int(1))
        XCTAssertNotNil(UUID(uuidString: model.expected["lastMutationId"]?.text ?? ""))
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

// A compare-and-swap server that can lose a response after accepting a write.
private final class AutosyncServer: @unchecked Sendable {
    private let lock = NSLock()
    private var payload: ScoringPayload
    private var requests: [ScoringState] = []
    private var offline = false
    private var loseResponse = false
    var delay: TimeInterval = 0
    init(payload: ScoringPayload) { self.payload = payload }
    var writes: [ScoringState] { lock.withLock { requests } }
    func setOffline(_ value: Bool) { lock.withLock { offline = value } }
    func loseNextResponse() { lock.withLock { loseResponse = true } }
    func remoteEdit() { lock.withLock { payload.state?["notes"] = .string("Another scorer changed this") } }
    func respond(_ request: URLRequest, body: Data) -> (Int, Data?, URLError?) {
        lock.withLock {
            if offline { return (0, nil, URLError(.notConnectedToInternet)) }
            if request.httpMethod == "GET" { return (200, try! JSONEncoder().encode(payload), nil) }
            let sent = try! JSONDecoder().decode(ScoringState.self, from: body)
            requests.append(sent)
            let expected = sent["expectedState"]!.object.filter { $0.key != "timing" }
            let remote = (payload.state ?? [:]).filter { $0.key != "timing" }
            guard expected == remote else { return (409, Data(#"{"error":"Newer state"}"#.utf8), nil) }
            payload.state = sent["state"]!.object
            if var timing = payload.state?["timing"]?.object { timing["entries"] = .array([]); payload.state?["timing"] = .object(timing) }
            if loseResponse { loseResponse = false; return (0, nil, URLError(.networkConnectionLost)) }
            return (200, Data(#"{"ok":true}"#.utf8), nil)
        }
    }
}
private final class AutosyncTransport: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var servers: [String: AutosyncServer] = [:]
    static func register(_ server: AutosyncServer, host: String) { lock.withLock { servers[host] = server } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let server = Self.lock.withLock { Self.servers[request.url!.host!]! }
        var body = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }; body.append(contentsOf: buffer.prefix(n))
            }
        }
        let response = server.respond(request, body: body)
        DispatchQueue.global().asyncAfter(deadline: .now() + server.delay) { [self] in
            if let error = response.2 { client?.urlProtocol(self, didFailWithError: error); return }
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: response.0, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: response.1!)
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() {}
}

extension NativeScorekeeperTests {
    @MainActor private func autosyncFixture() async -> (NativeScorekeeper, AutosyncServer) {
        let fixture = NativeScorekeeper.sample()
        let host = "\(UUID().uuidString.lowercased()).example"
        let server = AutosyncServer(payload: fixture.payload!)
        AutosyncTransport.register(server, host: host)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [AutosyncTransport.self]
        let model = NativeScorekeeper(game: fixture.game, server: URL(string: "https://\(host)")!, cookies: [], session: URLSession(configuration: config))
        await model.load()
        return (model, server)
    }
    @MainActor private func eventually(_ check: () -> Bool) async throws {
        for _ in 0..<200 {
            if check() { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("Condition did not become true")
    }
    @MainActor func testSetupRequiresBothRostersAndPresentGoalies() {
        let model = NativeScorekeeper.sample(period: 0)
        model.startGame()
        XCTAssertEqual(model.period, 0)
        model.change { state in
            state["homeAttendance"] = .array([.int(4)])
            state["awayAttendance"] = .array([.int(1)])
            state["homeGoalieId"] = .int(4); state["awayGoalieId"] = .int(3)
        }
        XCTAssertFalse(model.readyToStart)
        model.change { $0["awayGoalieId"] = .int(1) }
        XCTAssertTrue(model.readyToStart)
        model.startGame()
        XCTAssertEqual(model.period, 1)
        XCTAssertFalse(model.running)
        XCTAssertEqual(model.clock(), 1200)
    }
    @MainActor func testEditsAutomaticallySyncWithoutSaveButton() async throws {
        let (model, server) = await autosyncFixture()
        model.shot(false, delta: 1)
        try await eventually { !model.dirty }
        XCTAssertEqual(server.writes.count, 1)
        XCTAssertEqual(server.writes[0]["state"]?.object["awayShots"]?.array.first, .int(4))
        XCTAssertFalse(FileManager.default.fileExists(atPath: model.draftURL.path))
    }
    @MainActor func testEditsDuringSyncAreSentInNextSnapshotWithoutLosingTiming() async throws {
        let (model, server) = await autosyncFixture()
        server.delay = 0.2
        model.shot(false, delta: 1)
        let saving = Task { await model.save() }
        try await eventually { server.writes.count == 1 }
        XCTAssertTrue(model.syncing)
        XCTAssertTrue(model.editable)
        model.shot(false, delta: 1)
        let result = await saving.value
        XCTAssertTrue(result)
        XCTAssertEqual(server.writes.count, 2)
        XCTAssertEqual(model.ids("awayShots")[0], 5)
        XCTAssertFalse(model.dirty)
        for write in server.writes { XCTAssertEqual(write["state"]?.object["timing"]?.object["entries"]?.array.count, 1) }
        XCTAssertEqual(server.writes[1]["expectedState"]?.object["awayShots"]?.array.first, .int(4))
    }
    @MainActor func testOfflineDraftAutomaticallyRetriesAndRestoresOnReopen() async throws {
        let (model, server) = await autosyncFixture()
        server.setOffline(true)
        model.shot(true, delta: 1)
        let result = await model.save()
        XCTAssertFalse(result)
        XCTAssertTrue(model.dirty)
        XCTAssertNotNil(model.syncIssue)
        model.setSyncActive(false)
        let reopened = NativeScorekeeper(game: model.game, server: model.server, cookies: [], session: model.session)
        await reopened.load()
        XCTAssertEqual(reopened.ids("homeShots")[0], 5)
        XCTAssertTrue(reopened.editable)
        server.setOffline(false)
        reopened.setSyncActive(true)
        try await eventually { !reopened.dirty }
        XCTAssertEqual(server.writes.count, 1)
        XCTAssertNil(reopened.syncIssue)
        XCTAssertFalse(reopened.conflict)
    }
    @MainActor func testOfflineSyncRetriesAutomaticallyWhileScreenStaysOpen() async throws {
        let (model, server) = await autosyncFixture()
        server.setOffline(true)
        model.shot(false, delta: 1)
        _ = await model.save()
        XCTAssertNotNil(model.syncIssue)
        server.setOffline(false)
        try await eventually { !model.dirty }
        XCTAssertEqual(server.writes.count, 1)
        XCTAssertNil(model.syncIssue)
    }
    @MainActor func testLostAcknowledgementCanRecoverAfterRelaunch() async throws {
        let (model, server) = await autosyncFixture()
        server.loseNextResponse()
        model.shot(false, delta: 1)
        let result = await model.save()
        XCTAssertFalse(result)
        model.setSyncActive(false)
        let reopened = NativeScorekeeper(game: model.game, server: model.server, cookies: [], session: model.session)
        await reopened.load()
        XCTAssertFalse(reopened.conflict)
        reopened.shot(false, delta: 1)
        let recovered = await reopened.save()
        XCTAssertTrue(recovered)
        XCTAssertFalse(reopened.dirty)
        XCTAssertEqual(reopened.ids("awayShots")[0], 5)
        XCTAssertEqual(server.writes.count, 3)
        XCTAssertEqual(server.writes[0]["mutationId"], server.writes[1]["mutationId"])
    }
    @MainActor func testRetryNeverOverwritesAnotherScorersChange() async throws {
        let (model, server) = await autosyncFixture()
        server.loseNextResponse()
        model.shot(false, delta: 1)
        _ = await model.save()
        model.setSyncActive(false)
        server.remoteEdit()
        let result = await model.save()
        XCTAssertFalse(result)
        XCTAssertTrue(model.conflict)
        XCTAssertTrue(model.dirty)
        XCTAssertEqual(server.writes.count, 1)
        try FileManager.default.removeItem(at: model.draftURL)
    }
    @MainActor func testFinalCorrectionsStayLocalUntilExplicitFinalization() async throws {
        let (model, server) = await autosyncFixture()
        model.payload?.status = "final"; model.editingFinal = true
        model.shot(false, delta: 1)
        try await Task.sleep(for: .milliseconds(800))
        XCTAssertTrue(model.dirty)
        XCTAssertEqual(server.writes.count, 0)
        XCTAssertTrue(FileManager.default.fileExists(atPath: model.draftURL.path))
        try FileManager.default.removeItem(at: model.draftURL)
    }
}
