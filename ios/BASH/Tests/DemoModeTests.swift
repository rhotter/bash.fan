import XCTest
import SwiftUI
@testable import BASH

final class DemoModeTests: XCTestCase {
    func testReviewerCodeIsExactAndAllowsPastedWhitespace() {
        XCTAssertTrue(AppReviewAccess.matches("BASH-REVIEW-2026"))
        XCTAssertTrue(AppReviewAccess.matches("  BASH-REVIEW-2026\n"))
        for value in ["", " ", "BASH-REVIEW", "bash-review-2026", "BASH-REVIEW-2026x", "preview-only"] {
            XCTAssertFalse(AppReviewAccess.matches(value))
        }
    }

    @MainActor func testScorekeeperDemoSavesAndFinalizesWithoutServerOrDraft() async throws {
        let model = NativeScorekeeper.sample()
        XCTAssertTrue(model.preview)
        XCTAssertFalse(FileManager.default.fileExists(atPath: model.draftURL.path))
        model.shot(true, delta: 1)
        XCTAssertTrue(model.dirty)
        let saved = await model.save()
        XCTAssertTrue(saved)
        await model.finalize()
        XCTAssertTrue(model.final)
        XCTAssertNil(model.error)
        XCTAssertFalse(FileManager.default.fileExists(atPath: model.draftURL.path))
        do {
            _ = try await model.request("state", method: "PUT")
            XCTFail("Demo must reject even a direct transport call")
        } catch { XCTAssertEqual((error as? URLError)?.code, .notConnectedToInternet) }
    }

    @MainActor func testRecorderDemoCannotUseNetworkOrBecomePaired() async throws {
        let camera = CaptureController(demo: true)
        XCTAssertTrue(camera.pairing?.isDemo == true)
        XCTAssertFalse(camera.liveEnabled)
        await camera.pair("bashcapture://pair?server=https://example.com&session=00000000-0000-0000-0000-000000000001&side=left&token=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ")
        XCTAssertTrue(camera.pairing?.isDemo == true)
        await camera.refreshConfiguration()
        XCTAssertFalse(camera.configuration?.ended ?? true)
        XCTAssertNil(camera.configuration?.streamKey)
        do {
            let _: CameraConfiguration = try await CaptureAPI.call(.demo)
            XCTFail("Demo must reject every API request")
        } catch { XCTAssertEqual(error.localizedDescription, "Demo recordings stay on this phone.") }
    }

    func testLocalClipsRemainExcludedFromUploadsAfterRelaunch() throws {
        let clip = LocalRecording(id: "demo-test", pairingKey: Pairing.demo.key, startedAt: .now, duration: 30, uploaded: false, localOnly: true)
        let restored = try JSONDecoder().decode(LocalRecording.self, from: JSONEncoder().encode(clip))
        XCTAssertFalse(restored.needsUpload)
        var production = clip
        production.localOnly = nil
        XCTAssertTrue(production.needsUpload)
        production.duration = nil
        XCTAssertFalse(production.needsUpload)
    }
}

final class CaptureMountTests: XCTestCase {
    private func pairing(_ side: String) throws -> Pairing {
        try Pairing(link: "bashcapture://pair?server=https://example.com&session=00000000-0000-0000-0000-000000000001&side=\(side)&token=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ")
    }

    @MainActor func testMountSidesUseOppositePhysicalAndVideoOrientations() throws {
        let camera = CaptureController()
        camera.pairing = try pairing("left")
        XCTAssertEqual(camera.requiredOrientation, .landscapeRight)
        XCTAssertEqual(camera.videoOrientation, .landscapeLeft)
        XCTAssertTrue(camera.mountInstruction.contains("up"))
        camera.pairing = try pairing("right")
        XCTAssertEqual(camera.requiredOrientation, .landscapeLeft)
        XCTAssertEqual(camera.videoOrientation, .landscapeRight)
        XCTAssertTrue(camera.mountInstruction.contains("down"))
    }

    @MainActor func testRejectedHeartbeatDisconnectsButNetworkFailuresKeepCaptureAlive() async throws {
        let camera = CaptureController()
        let pair = try pairing("right")
        camera.pairing = pair
        for failure in [URLError(.notConnectedToInternet) as Error,
                        CaptureAPIError(statusCode: 503, message: "Unavailable")] {
            let keepRunning = await camera.sendHeartbeat(pair) { _, _ in throw failure }
            XCTAssertTrue(keepRunning)
            XCTAssertNotNil(camera.pairing)
        }
        let keepRunning = await camera.sendHeartbeat(pair) { _, body in
            XCTAssertEqual(body["action"] as? String, "heartbeat")
            throw CaptureAPIError(statusCode: 401, message: "Pair this camera again")
        }
        XCTAssertFalse(keepRunning)
        XCTAssertNil(camera.pairing)
        XCTAssertNil(camera.configuration)
        XCTAssertTrue(camera.error?.contains("replaced") == true)
        XCTAssertNil(UserDefaults.standard.string(forKey: "pairingKey"))
    }

    @MainActor func testEndedHeartbeatPreventsLivestreamReconnect() async throws {
        let camera = CaptureController()
        let keepRunning = await camera.sendHeartbeat(try pairing("left")) { _, _ in
            HeartbeatResponse(ended: true, serverTime: 0)
        }
        XCTAssertFalse(keepRunning)
    }
}

final class CaptureScreenshotTests: XCTestCase {
    @MainActor func testMountGuidanceScreenshots() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let window = UIWindow(windowScene: scene)
        window.frame = scene.coordinateSpace.bounds
        defer { window.isHidden = true }
        for side in ["left", "right"] {
            let camera = CaptureController(demo: true)
            camera.pairing = try Pairing(link: "bashcapture://pair?server=https://example.com&session=00000000-0000-0000-0000-000000000001&side=\(side)&token=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ")
            window.rootViewController = UIHostingController(rootView: NativeCameraView(camera: camera, library: camera.library))
            window.makeKeyAndVisible()
            try await Task.sleep(for: .seconds(2))
            let screenshot = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
                window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
            }
            let attachment = XCTAttachment(image: screenshot)
            attachment.name = "\(side)-camera-mount"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }
}

final class CaptureLifecycleTests: XCTestCase {
    @MainActor func testCloseAndReopenWaitForPendingSetup() async {
        let lifecycle = CaptureLifecycle()
        let entered = expectation(description: "Setup began")
        var resume: CheckedContinuation<Void, Never>?
        var events: [String] = []
        let setup = Task {
            await lifecycle.run {
                events.append("setup")
                await withCheckedContinuation { continuation in
                    resume = continuation
                    entered.fulfill()
                }
                events.append("ready")
            }
        }
        await fulfillment(of: [entered], timeout: 2)
        let close = Task { await lifecycle.run { events.append("stop") } }
        // Let the close request enqueue while setup is suspended.
        await Task.yield()
        let reopen = Task { await lifecycle.run { events.append("restart") } }
        await Task.yield()
        XCTAssertEqual(events, ["setup"])
        resume?.resume()
        await setup.value
        await close.value
        await reopen.value
        XCTAssertEqual(events, ["setup", "ready", "stop", "restart"])
    }

    @MainActor func testCancellingViewTaskDoesNotLetCloseOvertakeSetup() async {
        let lifecycle = CaptureLifecycle()
        let entered = expectation(description: "Setup began")
        var resume: CheckedContinuation<Void, Never>?
        var events: [String] = []
        let setup = Task {
            await lifecycle.run {
                await withCheckedContinuation { continuation in
                    resume = continuation
                    entered.fulfill()
                }
                events.append("ready")
            }
        }
        await fulfillment(of: [entered], timeout: 2)
        setup.cancel()
        let close = Task { await lifecycle.run { events.append("stop") } }
        await Task.yield()
        XCTAssertTrue(events.isEmpty)
        resume?.resume()
        await setup.value
        await close.value
        XCTAssertEqual(events, ["ready", "stop"])
    }

    @MainActor func testDismissedPreviewIsNotReadyToRecord() async {
        let camera = CaptureController(demo: true)
        camera.ready = true
        await camera.suspendPreview()
        XCTAssertFalse(camera.ready)
    }

    @MainActor func testDismissDoesNotStopAnActiveRecording() async {
        let camera = CaptureController(demo: true)
        camera.ready = true
        camera.recording = true
        await camera.suspendPreview()
        XCTAssertTrue(camera.recording)
        XCTAssertTrue(camera.ready)
    }
}
