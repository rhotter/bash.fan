// Standalone simulator harness. Network verification is stubbed; the real manifest/file lifecycle runs.
import Foundation
import Combine
import UIKit

struct CaptureAPIError: Error { let statusCode: Int }
struct CaptureClockAnchor: Codable, Sendable {}
struct Pairing { let key: String; var isDemo: Bool { false } }
enum CameraKeychain { static func load(_ key: String) -> Pairing? { Pairing(key: key) } }
enum CaptureError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}
struct UploadTicket: Decodable { let url: String?; let alreadyUploaded: Bool }
struct UploadConfirmation: Decodable { let verified: Bool }
@MainActor enum CaptureAPI {
    static var verified = true
    static var calls = 0
    static func call<T: Decodable>(_ pairing: Pairing, body: [String: Any]? = nil) async throws -> T {
        precondition(body?["action"] as? String == "complete", "Recovery must verify without reuploading")
        calls += 1
        return UploadConfirmation(verified: verified) as! T
    }
}

@main struct UploadRecoveryChecks {
    @MainActor static func main() async throws {
        let directory = RecordingLibrary.directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let library = RecordingLibrary()
        func clip() throws -> LocalRecording {
            let item = try library.begin(pairing: Pairing(key: "test"), startedAt: Date())
            try Data("test-video".utf8).write(to: item.file)
            return item
        }
        let success = try clip()
        await library.transferCompleted(id: success.id, succeeded: true)
        precondition(!FileManager.default.fileExists(atPath: success.file.path))
        precondition(RecordingLibrary().recordings.first { $0.id == success.id }?.uploaded == true)
        print("PASS: verified upload persists receipt before deleting local video")

        CaptureAPI.verified = false
        let unverified = try clip()
        await library.transferCompleted(id: unverified.id, succeeded: true)
        precondition(FileManager.default.fileExists(atPath: unverified.file.path))
        let reloaded = RecordingLibrary()
        precondition(reloaded.recordings.first { $0.id == unverified.id }?.uploadedToStorage == true)
        precondition(reloaded.recordings.first { $0.id == unverified.id }?.uploaded == false)
        CaptureAPI.verified = true
        await reloaded.transferCompleted(id: unverified.id, succeeded: true)
        precondition(!FileManager.default.fileExists(atPath: unverified.file.path))
        print("PASS: interrupted verification retains file and survives relaunch")

        let failed = try clip()
        let before = CaptureAPI.calls
        await library.transferCompleted(id: failed.id, succeeded: false)
        precondition(FileManager.default.fileExists(atPath: failed.file.path))
        precondition(CaptureAPI.calls == before)
        print("PASS: failed transfer neither verifies nor deletes footage")

        var legacy = try JSONSerialization.jsonObject(with: JSONEncoder().encode(failed)) as! [String: Any]
        legacy.removeValue(forKey: "uploadedToStorage")
        let decoded = try JSONDecoder().decode(LocalRecording.self, from: JSONSerialization.data(withJSONObject: legacy))
        precondition(decoded.uploadedToStorage == nil && !decoded.uploaded)
        print("PASS: existing manifests remain compatible")
    }
}
