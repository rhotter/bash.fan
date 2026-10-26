import XCTest
@testable import BASH

private final class OperatorAuthStub: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let host = request.url!.host!
        let login = request.url!.path.hasSuffix("/login")
        let rejected = host == "rejected.example"
        let data = Data((rejected ? "{\"error\":\"Invalid PIN\"}" : login ? "{\"ok\":true}" : "{\"isAdmin\":\(host == "admin.example")}").utf8)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: rejected ? 401 : 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class OperatorAccessTests: XCTestCase {
    @MainActor private func connection(host: String, requiresAdmin: Bool = true) -> WebsiteConnection {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OperatorAuthStub.self]
        return WebsiteConnection(server: URL(string: "https://\(host)")!, requiresAdmin: requiresAdmin, session: URLSession(configuration: configuration))
    }
    @MainActor func testAdminSessionIsVerifiedBeforeUnlocking() async {
        let website = connection(host: "admin.example")
        await website.signIn(pin: "test-fixture")
        XCTAssertTrue(website.signedIn)
        XCTAssertFalse(website.busy)
        website.signOut()
        XCTAssertFalse(website.signedIn)
        XCTAssertTrue(website.cookies.isEmpty)
    }
    @MainActor func testReviewPasscodeDoesNotUnlockLeagueAdminTools() async {
        let website = connection(host: "review.example")
        await website.signIn(pin: "test-fixture")
        XCTAssertFalse(website.signedIn)
        XCTAssertNotNil(website.error)
    }
    @MainActor func testRejectedPINStaysLocked() async {
        let website = connection(host: "rejected.example")
        await website.signIn(pin: "test-fixture")
        XCTAssertFalse(website.signedIn)
        XCTAssertEqual(website.error, "Invalid PIN")
    }
    @MainActor func testStandaloneCaptureRetainsReviewAccess() async {
        let website = connection(host: "review.example", requiresAdmin: false)
        await website.signIn(pin: "test-fixture")
        XCTAssertTrue(website.signedIn)
    }
}
