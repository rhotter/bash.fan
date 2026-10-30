@preconcurrency import AVFoundation
import SwiftUI
import HaishinKit
import RTMPHaishinKit

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
    private var recorderErrorTask: Task<Void, Never>?
    private var current: LocalRecording?
    private var clockAnchor: CaptureClockAnchor?
    private var prepared = false

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
        guard !recording else { return }
        await mixer.setVideoOrientation(videoOrientation)
        if prepared && ready && preparedQuality == quality { await mixer.startRunning(); return }
        ready = false
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
            let selectedQuality = quality
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
            try camera.lockForConfiguration()
            camera.activeFormat = format
            camera.videoZoomFactor = 1.0
            camera.unlockForConfiguration()
            try await mixer.setFrameRate(Double(framesPerSecond))
            await recorder.setMovieFragmentInterval(10)
            if !prepared { await mixer.addOutput(recorder) }
            var liveSettings = await stream.videoSettings
            liveSettings.videoSize = CGSize(width: 1920, height: 1080)
            liveSettings.bitRate = framesPerSecond == 60 ? 9_000_000 : 5_000_000
            liveSettings.maxKeyFrameIntervalDuration = 2
            liveSettings.expectedFrameRate = Double(framesPerSecond)
            // Keep the livestream at the selected capture frame rate.
            liveSettings.frameInterval = 0
            try await stream.setVideoSettings(liveSettings)
            if !prepared { await mixer.addOutput(stream) }
            await mixer.startRunning()
            prepared = true; preparedQuality = quality; ready = true
            interruptionTask?.cancel()
            interruptionTask = Task { [weak self] in
                guard let self else { return }
                for await interrupted in await mixer.isInterputted {
                    if interrupted && recording { error = "Camera interrupted. Recording stopped; check saved segments before restarting."; await stop() }
                }
            }
        } catch { self.error = error.localizedDescription }
    }
    func suspendPreview() async {
        guard !recording else { return }
        await mixer.stopRunning()
    }
    func start() async {
        guard let pairing, ready, preparedQuality == quality, !recording, !busy else { return }
        guard UIDevice.current.orientation == requiredOrientation else {
            error = mountInstruction
            return
        }
        busy = true; error = nil
        defer { busy = false }
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
                recording = false; recordingStartedAt = nil; UIApplication.shared.isIdleTimerDisabled = false
                status = self.pairing == nil ? "Camera disconnected; recording saved on this phone" : "Recording saved on this phone"
                serviceTask?.cancel(); _ = try? await stream.close(); try? await connection.close(); streaming = false
                await sendHeartbeat(pairing)
                if !demo { Task { await library.uploadPending() } }
            }
            serviceTask = Task { [weak self] in
                guard let self, !demo else { return }
                while !Task.isCancelled && recording {
                    guard await sendHeartbeat(pairing) else { break }
                    if !recording || Task.isCancelled { break }
                    if liveEnabled {
                        do {
                            if !(await connection.connected) {
                                streaming = false
                                let config: CameraConfiguration = try await CaptureAPI.call(pairing)
                                if let url = config.rtmpsUrl, let key = config.streamKey {
                                    _ = try await connection.connect(url)
                                    _ = try await stream.publish(key)
                                    streaming = true
                                }
                            } else { streaming = true }
                        } catch { streaming = false; self.error = "Livestream unavailable. Local recording continues; retrying automatically."; try? await connection.close() }
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
    }
    @discardableResult
    func sendHeartbeat(_ pairing: Pairing,
                       send: (@MainActor (Pairing, [String: Any]) async throws -> HeartbeatResponse)? = nil) async -> Bool {
        guard !demo else { return true }
        do {
            let request: @MainActor (Pairing, [String: Any]) async throws -> HeartbeatResponse = send ?? { pairing, body in try await CaptureAPI.call(pairing, body: body) }
            let response = try await request(pairing, ["action": "heartbeat", "deviceName": UIDevice.current.name, "recording": recording, "streaming": streaming, "battery": UIDevice.current.batteryLevel, "error": error.map { String($0.prefix(300)) } as Any? ?? NSNull()])
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
        } catch { /* Temporary network/telemetry failures must not stop local capture. */ }
        return true
    }
    func stop() async {
        guard recording else { return }
        busy = true; recordingTask?.cancel(); serviceTask?.cancel()
        await recordingTask?.value
        busy = false
    }
}
