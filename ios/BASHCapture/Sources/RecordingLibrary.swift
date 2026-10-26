import Foundation
import AVFoundation
import UIKit

struct LocalRecording: Codable, Identifiable, Sendable {
    let id: String
    let pairingKey: String
    let startedAt: Date
    var clockAnchor: CaptureClockAnchor?
    var duration: Double?
    var uploadedToStorage: Bool?
    var uploaded: Bool
    var localOnly: Bool? = nil
    var needsUpload: Bool { localOnly != true && !uploaded && duration != nil }
    var file: URL { RecordingLibrary.directory.appending(path: "\(id).mp4") }
}

@MainActor
final class RecordingLibrary: ObservableObject {
    static let shared = RecordingLibrary()
    private var scheduling = false
    private var scheduleAgain = false
    private var active: Set<String> = []
    nonisolated static let directory: URL = URL.documentsDirectory.appending(path: "Recordings")
    @Published private(set) var recordings: [LocalRecording] = []
    @Published var uploading = false
    @Published var error: String?
    private var manifestLoaded = true
    private var manifest: URL { Self.directory.appending(path: "manifest.json") }
    var pending: Int { recordings.filter { $0.needsUpload }.count }

    init() {
        do {
            try FileManager.default.createDirectory(at: Self.directory, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: manifest.path) { recordings = try JSONDecoder().decode([LocalRecording].self, from: Data(contentsOf: manifest)) }
        } catch {
            manifestLoaded = false
            self.error = "Recording library could not be loaded. Existing files have been preserved."
        }
        if manifestLoaded { clearVerifiedFiles() }
    }
    private func persist() throws {
        guard manifestLoaded else { throw CaptureError.message("Recording library needs recovery before recording or uploading. Existing files have been preserved.") }
        try JSONEncoder().encode(recordings).write(to: manifest, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func begin(pairing: Pairing, startedAt: Date, clockAnchor: CaptureClockAnchor? = nil) throws -> LocalRecording {
        guard manifestLoaded else { throw CaptureError.message("Recording library needs recovery. Existing files have been preserved.") }
        let item = LocalRecording(id: UUID().uuidString.lowercased(), pairingKey: pairing.key, startedAt: startedAt, clockAnchor: clockAnchor, uploaded: false, localOnly: pairing.isDemo)
        recordings.append(item); try persist(); return item
    }
    func finalize(_ item: LocalRecording) async throws {
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: item.file.path)
        let asset = AVURLAsset(url: item.file)
        let duration = try await asset.load(.duration).seconds
        guard duration.isFinite && duration > 0 && duration <= 180 else { throw CaptureError.message("Recording duration is invalid. The file was retained for recovery.") }
        if let index = recordings.firstIndex(where: { $0.id == item.id }) { recordings[index].duration = duration; try persist() }
    }
    func recoverInterrupted() async {
        for item in recordings where item.duration == nil {
            do { try await finalize(item) }
            catch {
                let name = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "BASH"
                self.error = "An interrupted segment needs review in Files → \(name). Completed segments are safe."
            }
        }
    }
    func uploadPending() async {
        guard manifestLoaded else { return }
        if scheduling { scheduleAgain = true; return }
        scheduling = true
        defer {
            scheduling = false
            uploading = !active.isEmpty
            if scheduleAgain {
                scheduleAgain = false
                Task { await uploadPending() }
            }
        }
        clearVerifiedFiles()
        // Reattach to OS-owned tasks before creating any replacements after relaunch.
        let tasks = await BackgroundUploads.shared.session.allTasks
        active.formUnion(tasks.compactMap(\.taskDescription))
        for item in recordings where item.needsUpload && !active.contains(item.id) {
            active.insert(item.id)
            uploading = true
            do {
                if item.uploadedToStorage == true {
                    try await verify(item)
                    active.remove(item.id)
                    continue
                }
                guard let pairing = CameraKeychain.load(item.pairingKey) else { throw CaptureError.message("Pair this camera again to upload its recordings.") }
                let bytes = try FileManager.default.attributesOfItem(atPath: item.file.path)[.size] as? Int ?? 0
                let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                let ticket: UploadTicket = try await CaptureAPI.call(pairing, body: ["action": "upload", "segmentId": item.id, "startedAt": formatter.string(from: item.startedAt), "duration": item.duration!, "bytes": bytes])
                if ticket.alreadyUploaded {
                    try markVerified(item.id)
                    active.remove(item.id)
                } else {
                    guard let raw = ticket.url, let url = URL(string: raw), url.scheme == "https" else { throw CaptureError.message("Invalid upload URL.") }
                    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: item.file.path)
                    var request = URLRequest(url: url); request.httpMethod = "PUT"
                    request.setValue("video/mp4", forHTTPHeaderField: "Content-Type")
                    request.setValue(String(bytes), forHTTPHeaderField: "Content-Length")
                    let task = BackgroundUploads.shared.session.uploadTask(with: request, fromFile: item.file)
                    task.taskDescription = item.id
                    task.resume()
                }
            } catch {
                active.remove(item.id)
                self.error = error.localizedDescription
            }
        }
        if pending == 0 { error = nil }
    }

    func transferCompleted(id: String, succeeded: Bool) async {
        defer { active.remove(id); uploading = !active.isEmpty }
        guard let index = recordings.firstIndex(where: { $0.id == id && !$0.uploaded }) else { return }
        guard succeeded else {
            error = "Upload paused. Reopen BASH to retry; footage is safe on this iPhone."
            return
        }
        do {
            // Persist successful transfer before verification, so a restart never needs to resend it.
            recordings[index].uploadedToStorage = true
            try persist()
            try await verify(recordings[index])
            if pending == 0 { error = nil }
        } catch { self.error = error.localizedDescription }
    }

    private func verify(_ item: LocalRecording) async throws {
        guard let pairing = CameraKeychain.load(item.pairingKey) else { throw CaptureError.message("Pair this camera again to verify its recordings.") }
        let confirmation: UploadConfirmation = try await CaptureAPI.call(pairing, body: ["action": "complete", "segmentId": item.id])
        guard confirmation.verified else { throw CaptureError.message("Upload has not been verified. Footage remains on this iPhone.") }
        try markVerified(item.id)
    }

    private func markVerified(_ id: String) throws {
        guard let index = recordings.firstIndex(where: { $0.id == id }) else { return }
        recordings[index].uploaded = true
        do { try persist() }
        catch { recordings[index].uploaded = false; throw error }
        clearVerifiedFiles()
    }
    private func clearVerifiedFiles() {
        guard manifestLoaded else { return }
        let message = "Footage is saved to BASH. Freeing local storage will retry automatically."
        do {
            for item in recordings where item.uploaded && FileManager.default.fileExists(atPath: item.file.path) {
                try FileManager.default.removeItem(at: item.file)
            }
            // Keep the small upload receipts, so a restart can safely retry cleanup.
            if error == message { error = nil }
        } catch { self.error = message }
    }
}

// URLSession performs file transfers in a separate system process, including while locked.
@MainActor
final class BackgroundUploads: NSObject, URLSessionTaskDelegate {
    static let shared = BackgroundUploads()
    #if BASH_LEAGUE
    static let identifier = "fan.bash.league.recording-uploads"
    #else
    static let identifier = "fan.bash.capture.recording-uploads"
    #endif
    var completionHandler: (() -> Void)?
    private var pendingCallbacks = 0
    private var eventsFinished = false
    lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.background(withIdentifier: Self.identifier)
        configuration.isDiscretionary = false
        configuration.sessionSendsLaunchEvents = true
        configuration.waitsForConnectivity = true
        configuration.httpMaximumConnectionsPerHost = 2
        configuration.timeoutIntervalForResource = 24 * 60 * 60
        return URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    }()

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let id = task.taskDescription
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        let succeeded = error == nil && (200..<300).contains(status)
        // Delegate callbacks arrive serially on the main queue. Count before starting async verification.
        MainActor.assumeIsolated {
            pendingCallbacks += 1
            Task {
                if let id { await RecordingLibrary.shared.transferCompleted(id: id, succeeded: succeeded) }
                pendingCallbacks -= 1
                finishEventsIfReady()
            }
        }
    }

    nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        MainActor.assumeIsolated {
            eventsFinished = true
            finishEventsIfReady()
        }
    }

    func attachCompletionHandler(_ handler: @escaping () -> Void) {
        completionHandler = handler
        _ = session
        finishEventsIfReady()
    }

    private func finishEventsIfReady() {
        guard eventsFinished, pendingCallbacks == 0, let handler = completionHandler else { return }
        eventsFinished = false
        completionHandler = nil
        handler()
    }
}

final class CaptureAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        guard identifier == BackgroundUploads.identifier else { completionHandler(); return }
        _ = RecordingLibrary.shared
        BackgroundUploads.shared.attachCompletionHandler(completionHandler)
    }
}

@MainActor
final class UploadHandoff {
    private var identifier: UIBackgroundTaskIdentifier = .invalid
    init() {
        identifier = UIApplication.shared.beginBackgroundTask(withName: "Save and queue recording") { [weak self] in
            self?.end()
        }
    }
    func end() {
        guard identifier != .invalid else { return }
        UIApplication.shared.endBackgroundTask(identifier)
        identifier = .invalid
    }
}
