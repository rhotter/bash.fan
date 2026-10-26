import XCTest
@testable import BASH

final class DemoModeTests: XCTestCase {
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
