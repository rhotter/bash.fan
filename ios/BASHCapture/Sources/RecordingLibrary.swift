import Foundation
import AVFoundation

struct LocalRecording: Codable, Identifiable, Sendable {
    let id: String
    let pairingKey: String
    let startedAt: Date
    var clockAnchor: CaptureClockAnchor?
    var duration: Double?
    var uploaded: Bool
    var file: URL { RecordingLibrary.directory.appending(path: "\(id).mp4") }
}

@MainActor
final class RecordingLibrary: ObservableObject {
    nonisolated static let directory: URL = URL.documentsDirectory.appending(path: "Recordings")
    @Published private(set) var recordings: [LocalRecording] = []
    @Published var uploading = false
    @Published var error: String?
    private var manifestLoaded = true
    private var manifest: URL { Self.directory.appending(path: "manifest.json") }
    var pending: Int { recordings.filter { !$0.uploaded && $0.duration != nil }.count }

    init() {
        do {
            try FileManager.default.createDirectory(at: Self.directory, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: manifest.path) { recordings = try JSONDecoder().decode([LocalRecording].self, from: Data(contentsOf: manifest)) }
        } catch {
            manifestLoaded = false
            self.error = "Recording library could not be loaded. Existing files have been preserved."
        }
    }
    private func persist() throws {
        guard manifestLoaded else { throw CaptureError.message("Recording library needs recovery before recording or uploading. Existing files have been preserved.") }
        try JSONEncoder().encode(recordings).write(to: manifest, options: .atomic)
    }
    func begin(pairing: Pairing, startedAt: Date, clockAnchor: CaptureClockAnchor? = nil) throws -> LocalRecording {
        guard manifestLoaded else { throw CaptureError.message("Recording library needs recovery. Existing files have been preserved.") }
        let item = LocalRecording(id: UUID().uuidString.lowercased(), pairingKey: pairing.key, startedAt: startedAt, clockAnchor: clockAnchor, uploaded: false)
        recordings.append(item); try persist(); return item
    }
    func finalize(_ item: LocalRecording) async throws {
        let asset = AVURLAsset(url: item.file)
        let duration = try await asset.load(.duration).seconds
        guard duration.isFinite && duration > 0 && duration <= 180 else { throw CaptureError.message("Recording duration is invalid. The file was retained for recovery.") }
        if let index = recordings.firstIndex(where: { $0.id == item.id }) { recordings[index].duration = duration; try persist() }
    }
    func recoverInterrupted() async {
        for item in recordings where item.duration == nil {
            do { try await finalize(item) }
            catch { self.error = "An interrupted segment needs review in Files → BASH Capture. Completed segments are safe." }
        }
    }
    func uploadPending() async {
        guard !uploading else { return }
        uploading = true; error = nil
        defer { uploading = false }
        for item in recordings where !item.uploaded && item.duration != nil {
            do {
                guard let pairing = CameraKeychain.load(item.pairingKey) else { throw CaptureError.message("Pair this camera again to upload its recordings.") }
                let bytes = try FileManager.default.attributesOfItem(atPath: item.file.path)[.size] as? Int ?? 0
                let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                let ticket: UploadTicket = try await CaptureAPI.call(pairing, body: ["action": "upload", "segmentId": item.id, "startedAt": formatter.string(from: item.startedAt), "duration": item.duration!, "bytes": bytes])
                if !ticket.alreadyUploaded {
                    guard let raw = ticket.url, let url = URL(string: raw), url.scheme == "https" else { throw CaptureError.message("Invalid upload URL.") }
                    var request = URLRequest(url: url); request.httpMethod = "PUT"; request.timeoutInterval = 300
                    request.setValue("video/mp4", forHTTPHeaderField: "Content-Type")
                    request.setValue(String(bytes), forHTTPHeaderField: "Content-Length")
                    let (_, response) = try await URLSession.shared.upload(for: request, fromFile: item.file)
                    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw CaptureError.message("Upload interrupted. Retry when connected; the recording is still on this phone.") }
                    let confirmation: UploadConfirmation = try await CaptureAPI.call(pairing, body: ["action": "complete", "segmentId": item.id])
                    guard confirmation.verified else { throw CaptureError.message("Upload has not been verified.") }
                }
                if let index = recordings.firstIndex(where: { $0.id == item.id }) { recordings[index].uploaded = true; try persist() }
            } catch { self.error = error.localizedDescription; return }
        }
    }
    func removeVerified() throws {
        guard manifestLoaded else { throw CaptureError.message("Recording library needs recovery. Existing files have been preserved.") }
        for item in recordings where item.uploaded && FileManager.default.fileExists(atPath: item.file.path) { try FileManager.default.removeItem(at: item.file) }
        recordings.removeAll(where: { $0.uploaded }); try persist()
    }
}
