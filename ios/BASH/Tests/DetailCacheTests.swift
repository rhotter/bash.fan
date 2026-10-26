import XCTest
@testable import BASH

private actor RequestProbe {
    var count = 0
    func request(fail: Bool = false) async throws -> Data {
        count += 1
        try await Task.sleep(for: .milliseconds(30))
        if fail { throw URLError(.notConnectedToInternet) }
        return Data("response".utf8)
    }
}

final class DetailCacheTests: XCTestCase {
    @MainActor func testPreloadAndTapShareOneRequestAndRefreshBypassesCache() async throws {
        let cache = DetailResponseCache()
        let probe = RequestProbe()
        async let preload = cache.load(key: "game", maxAge: 60) { try await probe.request() }
        async let tap = cache.load(key: "game", maxAge: 60) { try await probe.request() }
        let (a, b) = try await (preload, tap)
        XCTAssertEqual(a, b)
        _ = try await cache.load(key: "game", maxAge: 60) { try await probe.request() }
        let cachedCount = await probe.count
        XCTAssertEqual(cachedCount, 1)
        _ = try await cache.load(key: "game", maxAge: 0) { try await probe.request() }
        let refreshCount = await probe.count
        XCTAssertEqual(refreshCount, 2)
    }

    @MainActor func testFailureCanRetryAndDifferentResourcesStaySeparate() async throws {
        let cache = DetailResponseCache()
        let probe = RequestProbe()
        do {
            _ = try await cache.load(key: "player", maxAge: 60) { try await probe.request(fail: true) }
            XCTFail("Expected network failure")
        } catch { }
        _ = try await cache.load(key: "player", maxAge: 60) { try await probe.request() }
        _ = try await cache.load(key: "other-player", maxAge: 60) { try await probe.request() }
        let count = await probe.count
        XCTAssertEqual(count, 3)
    }

    @MainActor func testWeekIndexUpdatesWithSnapshot() throws {
        let store = LeagueStore()
        XCTAssertTrue(store.weeks.isEmpty)
        let game = Game(id: "g1", date: "2026-10-24", time: "9:00am", homeTeam: "A", awayTeam: "B", homeSlug: nil, awaySlug: nil, homeScore: 1, awayScore: 0, status: "final", location: "", isOvertime: false, isPlayoff: false)
        store.snapshot = LeagueSnapshot(games: [game], standings: [], lastUpdated: "")
        XCTAssertEqual(store.weeks.map(\.id), ["2026-10-19"])
        store.snapshot = nil
        XCTAssertTrue(store.weeks.isEmpty)
    }
}
