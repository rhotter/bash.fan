@preconcurrency import AVFoundation
import SwiftUI
import HaishinKit
import RTMPHaishinKit
import VideoToolbox

enum RecordingQuality: String, CaseIterable, Identifiable, Decodable {
    case hd30, hd60, uhd30, uhd60
    var id: String { rawValue }
    var title: String {
        switch self {
        case .hd30: "1080p · 30 fps"
        case .hd60: "1080p · 60 fps"
        case .uhd30: "4K · 30 fps"
        case .uhd60: "4K · 60 fps"
        }
    }
    var is4K: Bool { self == .uhd30 || self == .uhd60 }
    var fps: Int { self == .hd60 || self == .uhd60 ? 60 : 30 }
    var width: Int { is4K ? 3840 : 1920 }
    var height: Int { is4K ? 2160 : 1080 }
    var bitRate: Int {
        switch self {
        case .hd30: 6_000_000
        case .hd60: 10_000_000
        case .uhd30: 24_000_000
        case .uhd60: 40_000_000
        }
    }
}

// MainActor methods can interleave at every await. Keep entire camera lifecycle
// operations ordered, including a close/reopen while permission or setup is pending.
@MainActor
final class CaptureLifecycle {
    private var tail: Task<Void, Never>?
    @discardableResult
    func enqueue(_ operation: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
        let previous = tail
        let task = Task {
            await previous?.value
            await operation()
        }
        tail = task
        return task
    }
    func run(_ operation: @escaping @MainActor () async -> Void) async {
        await enqueue(operation).value
    }
}

@MainActor
final class CaptureController: ObservableObject {
    @Published var pairing: Pairing?
    @Published var configuration: CameraConfiguration?
    @Published var recordingStartedAt: Date?
    @Published var clockChecked = false
    @Published var ready = false
    @Published var recording = false
    @Published var streaming = false
    @Published var busy = false
    @Published var error: String?
    @Published var status = "Pair this phone to a recording session"
    @Published var quality = RecordingQuality(rawValue: UserDefaults.standard.string(forKey: "recordingQuality") ?? "") ?? .uhd60 {
        didSet { UserDefaults.standard.set(quality.rawValue, forKey: "recordingQuality") }
    }
    var framesPerSecond: Int { quality.fps }
    // Opposite mount orientations put both rear camera clusters at the center.
    var requiredOrientation: UIDeviceOrientation { pairing?.side == "right" ? .landscapeLeft : .landscapeRight }
    var videoOrientation: AVCaptureVideoOrientation { pairing?.side == "right" ? .landscapeRight : .landscapeLeft }
    var mountInstruction: String { "Landscape, with the volume buttons facing \(pairing?.side == "right" ? "down" : "up")." }
    private var preparedQuality: RecordingQuality?
    let demo: Bool
    var liveEnabled: Bool { !demo }
    let library = RecordingLibrary.shared
    let mixer = MediaMixer(captureSessionMode: .single)
    private let connection = RTMPConnection()
    private lazy var stream = RTMPStream(connection: connection)
    private let recorder = StreamRecorder()
    private var recordingTask: Task<Void, Never>?
    private var serviceTask: Task<Void, Never>?
    private var interruptionTask: Task<Void, Never>?
    private var diagnosticsTask: Task<Void, Never>?
    private var publishStatusTask: Task<Void, Never>?
    private var streamStatusTask: Task<Void, Never>?
    private var recorderErrorTask: Task<Void, Never>?
    private var current: LocalRecording?
    private var clockAnchor: CaptureClockAnchor?
    private var prepared = false
    private let lifecycle = CaptureLifecycle()
    private let networkCleanup = CaptureLifecycle()
    private var previewVisible = false

    init(demo: Bool = false) {
        self.demo = demo
        if demo { pairing = .demo }
        else if let key = UserDefaults.standard.string(forKey: "pairingKey"), let saved = CameraKeychain.load(key),
           saved.server == (try? BASHService.server()) { pairing = saved }
        UIDevice.current.isBatteryMonitoringEnabled = true
    }
    func pair(_ link: String) async {
        guard !demo, !recording && !busy else { return }
        busy = true; defer { busy = false }
        await networkCleanup.run {}
        do {
            let pair = try Pairing(link: link)
            let config: CameraConfiguration = try await CaptureAPI.call(pair)
            guard !config.ended else { throw CaptureError.message("This recording session has ended.") }
            try CameraKeychain.save(pair); pairing = pair
            configuration = config
            UserDefaults.standard.set(pair.key, forKey: "pairingKey")
            error = nil; status = "\(pair.side.capitalized) camera paired"
        } catch { self.error = error.localizedDescription }
    }
    func refreshConfiguration() async {
        guard let pairing, !recording else { return }
        if demo {
            configuration = CameraConfiguration(title: "Demo recording", game: nil, ended: false, serverTime: Date().timeIntervalSince1970 * 1000, rtmpsUrl: nil, streamKey: nil)
            return
        }
        configuration = nil
        do {
            configuration = try await CaptureAPI.call(pairing)
            status = configuration?.ended == true ? "Recording session ended" : "Ready to set up this camera"
        } catch { self.error = error.localizedDescription }
    }
    func prepare() async {
        previewVisible = true
        await lifecycle.run { await self.prepareCapture() }
    }
    private func prepareCapture() async {
        guard previewVisible, !recording else { return }
        ready = false
        let selectedQuality = quality
        await mixer.setVideoOrientation(videoOrientation)
        if prepared && preparedQuality == selectedQuality {
            // startRunning alone is a no-op when the mixer is running but its
            // capture session has stopped (dismissal or a system interruption).
            await mixer.startRunning()
            await mixer.startCapturing()
            ready = await mixer.isCapturing
            if !ready { error = "Camera could not start. Close and reopen the camera to retry." }
            return
        }
        error = nil
        if prepared { await mixer.stopRunning() }
        guard await AVCaptureDevice.requestAccess(for: .video), await AVCaptureDevice.requestAccess(for: .audio) else { error = "Allow camera and microphone access in Settings to record."; return }
        do {
            let cameras = AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInUltraWideCamera], mediaType: .video, position: .back)
            guard let camera = cameras.devices.first else { throw CaptureError.message("Recording requires an iPhone with a rear 0.5× ultra-wide camera.") }
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playAndRecord, mode: .videoRecording, options: [.defaultToSpeaker])
            try audio.setActive(true)
            try await mixer.attachVideo(camera)
            try await mixer.attachAudio(AVCaptureDevice.default(for: .audio))
            try await mixer.configuration { session in
                let preset: AVCaptureSession.Preset = selectedQuality.is4K ? .hd4K3840x2160 : .hd1920x1080
                guard session.canSetSessionPreset(preset) else { throw CaptureError.message("This iPhone’s 0.5× camera does not support \(selectedQuality.title). Choose another recording quality.") }
                session.sessionPreset = preset
            }
            // Device and capture landscape directions are opposite.
            await mixer.setVideoOrientation(videoOrientation)
            guard let format = camera.formats.first(where: { format in
                let size = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
                return size.width == selectedQuality.width && size.height == selectedQuality.height && format.videoSupportedFrameRateRanges.contains {
                    $0.minFrameRate <= Double(selectedQuality.fps) && $0.maxFrameRate >= Double(selectedQuality.fps)
                }
            }) else { throw CaptureError.message("This iPhone’s 0.5× camera does not support \(selectedQuality.title). Choose another recording quality.") }
            // The physical ultra-wide lens is the Camera app's 0.5× view.
            // AVFoundation uses 1.0 for this lens's full, uncropped field of view.
            try await mixer.configuration(video: 0) { video in
                guard let device = video.device else { return }
                try device.lockForConfiguration()
                defer { device.unlockForConfiguration() }
                device.activeFormat = format
                device.videoZoomFactor = 1.0
            }
            try await mixer.setFrameRate(Double(selectedQuality.fps))
            await recorder.setMovieFragmentInterval(10)
            if !prepared { await mixer.addOutput(recorder) }
            var liveSettings = await stream.videoSettings
            liveSettings.videoSize = CGSize(width: 1920, height: 1080)
            // The library defaults to level 3.1, which cannot encode 1080p.
            // Let VideoToolbox choose a level for the selected 30/60 fps output.
            liveSettings.profileLevel = kVTProfileLevel_H264_Baseline_AutoLevel as String
            liveSettings.bitRate = selectedQuality.fps == 60 ? 9_000_000 : 5_000_000
            liveSettings.maxKeyFrameIntervalDuration = 2
            liveSettings.expectedFrameRate = Double(selectedQuality.fps)
            // Keep the livestream at the selected capture frame rate.
            liveSettings.frameInterval = 0
            try await stream.setVideoSettings(liveSettings)
            if !prepared { await mixer.addOutput(stream) }
            await mixer.startRunning()
            prepared = true; preparedQuality = selectedQuality; ready = await mixer.isCapturing
            if !ready { error = "Camera could not start. Close and reopen the camera to retry." }
            interruptionTask?.cancel()
            interruptionTask = Task { [weak self] in
                guard let self else { return }
                for await interrupted in await mixer.isInterputted {
                    if interrupted {
                        ready = false
                        error = recording
                            ? "Camera interrupted. Recording stopped; check saved segments before restarting."
                            : "Camera interrupted. The preview will resume when the camera is available."
                        if recording { await stop() }
                    } else if previewVisible {
                        await lifecycle.run { await self.prepareCapture() }
                    }
                }
            }
        } catch { self.error = error.localizedDescription }
    }
    func suspendPreview() async {
        previewVisible = false
        await lifecycle.run {
            guard !self.previewVisible, !self.recording else { return }
            self.ready = false
            // Keep the mixer's foreground observer alive so it can reattach a
            // camera suspended by iOS while this screen was being dismissed.
            await self.mixer.stopCapturing()
        }
    }
    func start() async {
        await lifecycle.run { await self.startRecording() }
    }
    private func startRecording() async {
        guard previewVisible, pairing != nil, ready, preparedQuality == quality, !recording, !busy else { return }
        guard UIDevice.current.orientation == requiredOrientation else {
            error = mountInstruction
            return
        }
        busy = true; error = nil
        defer { busy = false }
        // A previous livestream must finish closing before we reuse its connection,
        // but closing the camera should only wait for the local file to be saved.
        await networkCleanup.run {}
        guard previewVisible, let pairing else { return }
        do {
            let free = try URL.documentsDirectory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage ?? 0
            guard free > 2_000_000_000 else { throw CaptureError.message("Free at least 2 GB before recording.") }
            if demo {
                clockAnchor = nil; clockChecked = false
            } else {
                let config: CameraConfiguration = try await CaptureAPI.call(pairing)
                guard !config.ended else { throw CaptureError.message("This session has ended.") }
                configuration = config
                clockAnchor = try await CaptureAPI.synchronize(pairing); clockChecked = true
            }
            try await mixer.setFrameRate(Double(framesPerSecond))
            guard UIDevice.current.orientation == requiredOrientation else {
                throw CaptureError.message(mountInstruction)
            }
            try await beginSegment(pairing)
            if !demo {
                let diagnostics = CaptureDiagnostics.shared
                diagnostics.event("recording_started", detail: quality.rawValue)
                diagnostics.resetStream()
                diagnosticsTask?.cancel()
                diagnosticsTask = Task { [weak self] in
                    while !Task.isCancelled {
                        guard let self else { return }
                        let info = await stream.info
                        diagnostics.sampleStream(fps: Int(await stream.currentFPS), bytes: info.byteCount, rate: info.currentBytesPerSecond)
                        do { try await Task.sleep(for: .seconds(1)) } catch { return }
                    }
                }
                publishStatusTask?.cancel()
                publishStatusTask = Task { [weak self] in
                    guard let self else { return }
                    for await status in await stream.status {
                        if Task.isCancelled { return }
                        diagnostics.event("publish_status", detail: status.code)
                    }
                }
                streamStatusTask?.cancel()
                streamStatusTask = Task { [weak self] in
                    guard let self else { return }
                    for await status in await connection.status {
                        if Task.isCancelled { return }
                        diagnostics.event("rtmp_status", detail: status.code)
                    }
                }
            }
            recordingStartedAt = Date(); recording = true; status = "Recording \(quality.title) locally"; UIApplication.shared.isIdleTimerDisabled = true
            recordingTask = Task { [weak self] in
                guard let self else { return }
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(60)) } catch { break }
                    do {
                        try await finishSegment()
                        if Task.isCancelled { break }
                        let free = try URL.documentsDirectory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage ?? 0
                        guard free > 1_000_000_000, ProcessInfo.processInfo.thermalState != .critical else { throw CaptureError.message("Recording stopped: low storage or critical temperature.") }
                        try await beginSegment(pairing)
                        if !demo { Task { await library.uploadPending() } }
                    } catch { self.error = error.localizedDescription; break }
                }
                do { try await finishSegment() } catch { self.error = "Could not finalize the last segment. Existing files are preserved." }
                if !demo { CaptureDiagnostics.shared.event("recording_stopped") }
                diagnosticsTask?.cancel(); streamStatusTask?.cancel(); publishStatusTask?.cancel()
                recording = false; recordingStartedAt = nil; UIApplication.shared.isIdleTimerDisabled = false
                status = self.pairing == nil ? "Camera disconnected; recording saved on this phone" : "Recording saved on this phone"
                let previousService = serviceTask
                previousService?.cancel()
                streaming = false
                networkCleanup.enqueue {
                    await previousService?.value
                    _ = try? await self.stream.close()
                    try? await self.connection.close()
                    await self.sendHeartbeat(pairing)
                }
                if !demo { Task { await library.uploadPending() } }
            }
            serviceTask = Task { [weak self] in
                guard let self, !demo else { return }
                while !Task.isCancelled && recording {
                    guard await sendHeartbeat(pairing) else { break }
                    if !recording || Task.isCancelled { break }
                    if liveEnabled {
                        do {
                            let connected = await connection.connected
                            if Task.isCancelled { break }
                            if !connected {
                                streaming = false
                                let config: CameraConfiguration = try await CaptureAPI.call(pairing)
                                if Task.isCancelled { break }
                                if let url = config.rtmpsUrl, let key = config.streamKey {
                                    CaptureDiagnostics.shared.event("rtmp_connect_attempt")
                                    _ = try await connection.connect(url)
                                    if Task.isCancelled { break }
                                    _ = try await stream.publish(key)
                                    if Task.isCancelled { break }
                                    streaming = true
                                    CaptureDiagnostics.shared.event("rtmp_published")
                                }
                            } else { streaming = true }
                        } catch {
                            if Task.isCancelled { break }
                            CaptureDiagnostics.shared.failure("rtmp_failure", error)
                            streaming = false; self.error = "Livestream unavailable. Local recording continues; retrying automatically."; try? await connection.close()
                        }
                    }
                    do { try await Task.sleep(for: .seconds(8)) } catch { break }
                }
            }
        } catch { self.error = error.localizedDescription }
    }
    private func beginSegment(_ pairing: Pairing) async throws {
        let item = try library.begin(pairing: pairing, startedAt: clockAnchor?.serverDate ?? Date(), clockAnchor: clockAnchor)
        current = item
        let settings: [AVMediaType: [String: any Sendable]] = [
            .video: [AVVideoCodecKey: AVVideoCodecType.hevc, AVVideoWidthKey: quality.width, AVVideoHeightKey: quality.height,
                     AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: quality.bitRate, AVVideoExpectedSourceFrameRateKey: framesPerSecond, AVVideoMaxKeyFrameIntervalDurationKey: 2]],
            .audio: [AVFormatIDKey: Int(kAudioFormatMPEG4AAC), AVSampleRateKey: 48000, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 96000]
        ]
        try await recorder.startRecording(item.file, settings: settings)
        recorderErrorTask?.cancel()
        recorderErrorTask = Task { [weak self] in
            guard let self else { return }
            for await _ in await recorder.error {
                if !demo { CaptureDiagnostics.shared.event("recorder_write_failed") }
                self.error = "The camera could not write a recording segment. Files have been retained."
                recordingTask?.cancel()
            }
        }
    }
    private func finishSegment() async throws {
        guard let current else { return }
        self.current = nil
        _ = try await recorder.stopRecording()
        try await library.finalize(current)
        if !demo { CaptureDiagnostics.shared.event("segment_finalized") }
    }
    private var heartbeatError: String? {
        let errors = [("Camera", error), ("Uploads", library.error)].compactMap { label, message -> String? in
            guard let message, !message.isEmpty else { return nil }
            return "\(label): \(message)"
        }
        guard !errors.isEmpty else { return nil }
        // Share the API's 300 UTF-16-unit budget so a long camera error cannot
        // hide an upload error. Count like JavaScript/Zod, including emoji.
        let limit = (300 - (errors.count - 1) * 3) / errors.count
        return errors.map { message in
            var result = ""
            for character in message {
                guard result.utf16.count + String(character).utf16.count <= limit else { break }
                result.append(character)
            }
            return result
        }.joined(separator: " | ")
    }
    @discardableResult
    func sendHeartbeat(_ pairing: Pairing,
                       send: (@MainActor (Pairing, [String: Any]) async throws -> HeartbeatResponse)? = nil) async -> Bool {
        guard !demo else { return true }
        do {
            let request: @MainActor (Pairing, [String: Any]) async throws -> HeartbeatResponse = send ?? { pairing, body in try await CaptureAPI.call(pairing, body: body) }
            var body: [String: Any] = ["action": "heartbeat", "deviceName": UIDevice.current.name, "recording": recording, "streaming": streaming, "battery": UIDevice.current.batteryLevel, "error": heartbeatError as Any? ?? NSNull()]
            // Keep test-injected heartbeats deterministic and free of OS background-session work.
            if send == nil {
                let tasks = await BackgroundUploads.shared.session.allTasks
                body["diagnostics"] = CaptureDiagnostics.shared.snapshot(tasks: tasks, pending: library.pending, quality: quality.rawValue, connected: await connection.connected)
            }
            let response = try await request(pairing, body)
            if response.ended { recordingTask?.cancel(); return false }
        } catch let failure as CaptureAPIError where failure.statusCode == 401 {
            // A replacement rotates the token. Stop the old capture, but keep its files
            // and keychain entry so saved clips are never deleted by disconnection.
            recordingTask?.cancel()
            serviceTask?.cancel()
            self.pairing = nil
            configuration = nil
            UserDefaults.standard.removeObject(forKey: "pairingKey")
            error = "This camera was replaced or its pairing expired. Recording stopped; saved clips remain on this phone."
            return false
        } catch {
            CaptureDiagnostics.shared.failure("heartbeat_failed", error)
            // Temporary network/telemetry failures must not stop local capture.
        }
        return true
    }
    func stop() async {
        guard recording else { return }
        busy = true; recordingTask?.cancel(); serviceTask?.cancel()
        await recordingTask?.value
        busy = false
    }
}
