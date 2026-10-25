@preconcurrency import AVFoundation
import SwiftUI
import HaishinKit
import RTMPHaishinKit

@MainActor
final class CaptureController: ObservableObject {
    @Published var pairing: Pairing?
    @Published var ready = false
    @Published var recording = false
    @Published var streaming = false
    @Published var busy = false
    @Published var error: String?
    @Published var status = "Pair this phone to a recording session"
    @Published var framesPerSecond = 30
    @Published var liveEnabled = true
    let library = RecordingLibrary()
    let mixer = MediaMixer(captureSessionMode: .single)
    private let connection = RTMPConnection()
    private lazy var stream = RTMPStream(connection: connection)
    private let recorder = StreamRecorder()
    private var recordingTask: Task<Void, Never>?
    private var serviceTask: Task<Void, Never>?
    private var interruptionTask: Task<Void, Never>?
    private var recorderErrorTask: Task<Void, Never>?
    private var current: LocalRecording?
    private var serverOffset: Double = 0
    private var prepared = false

    init() {
        if let key = UserDefaults.standard.string(forKey: "pairingKey") { pairing = CameraKeychain.load(key) }
        UIDevice.current.isBatteryMonitoringEnabled = true
    }
    func pair(_ link: String) async {
        guard !recording && !busy else { return }
        busy = true; defer { busy = false }
        do {
            let pair = try Pairing(link: link)
            let sent = Date().timeIntervalSince1970 * 1000
            let config: CameraConfiguration = try await CaptureAPI.call(pair)
            guard !config.ended else { throw CaptureError.message("This recording session has ended.") }
            serverOffset = config.serverTime - (sent + Date().timeIntervalSince1970 * 1000) / 2
            try CameraKeychain.save(pair); pairing = pair
            UserDefaults.standard.set(pair.key, forKey: "pairingKey")
            error = nil; status = "\(pair.side.capitalized) camera paired"
        } catch { self.error = error.localizedDescription }
    }
    func prepare() async {
        guard !prepared else { return }
        guard await AVCaptureDevice.requestAccess(for: .video), await AVCaptureDevice.requestAccess(for: .audio) else { error = "Allow camera and microphone access in Settings to record."; return }
        do {
            guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else { throw CaptureError.message("A physical iPhone rear camera is required.") }
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playAndRecord, mode: .videoRecording, options: [.defaultToSpeaker])
            try audio.setActive(true)
            try await mixer.attachVideo(camera)
            try await mixer.attachAudio(AVCaptureDevice.default(for: .audio))
            try await mixer.configuration { session in
                guard session.canSetSessionPreset(.hd4K3840x2160) else { throw CaptureError.message("This camera cannot capture 4K.") }
                session.sessionPreset = .hd4K3840x2160
            }
            await mixer.setVideoOrientation(.landscapeRight)
            try await mixer.setFrameRate(Double(framesPerSecond))
            await recorder.setMovieFragmentInterval(10)
            await mixer.addOutput(recorder)
            var liveSettings = await stream.videoSettings
            liveSettings.videoSize = CGSize(width: 1920, height: 1080)
            liveSettings.bitRate = 6_000_000
            liveSettings.maxKeyFrameIntervalDuration = 2
            liveSettings.expectedFrameRate = 30
            liveSettings.frameInterval = VideoCodecSettings.frameInterval30
            try await stream.setVideoSettings(liveSettings)
            await mixer.addOutput(stream)
            await mixer.startRunning()
            prepared = true; ready = true
            interruptionTask = Task { [weak self] in
                guard let self else { return }
                for await interrupted in await mixer.isInterputted {
                    if interrupted && recording { error = "Camera interrupted. Recording stopped; check saved segments before restarting."; await stop() }
                }
            }
        } catch { self.error = error.localizedDescription }
    }
    func start() async {
        guard let pairing, ready, !recording, !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let free = try URL.documentsDirectory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage ?? 0
            guard free > 2_000_000_000 else { throw CaptureError.message("Free at least 2 GB before recording.") }
            let sent = Date().timeIntervalSince1970 * 1000
            let config: CameraConfiguration = try await CaptureAPI.call(pairing)
            guard !config.ended else { throw CaptureError.message("This session has ended.") }
            serverOffset = config.serverTime - (sent + Date().timeIntervalSince1970 * 1000) / 2
            try await mixer.setFrameRate(Double(framesPerSecond))
            try await beginSegment(pairing)
            recording = true; status = "Recording 4K locally"; UIApplication.shared.isIdleTimerDisabled = true
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
                    } catch { self.error = error.localizedDescription; break }
                }
                do { try await finishSegment() } catch { self.error = "Could not finalize the last segment. Existing files are preserved." }
                recording = false; UIApplication.shared.isIdleTimerDisabled = false
                status = "Recording saved on this phone"
                serviceTask?.cancel(); _ = try? await stream.close(); try? await connection.close(); streaming = false
                await sendHeartbeat(pairing)
            }
            serviceTask = Task { [weak self] in
                guard let self else { return }
                while !Task.isCancelled && recording {
                    await sendHeartbeat(pairing)
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
        let item = try library.begin(pairing: pairing, startedAt: Date(timeIntervalSinceNow: serverOffset / 1000))
        current = item
        let settings: [AVMediaType: [String: any Sendable]] = [
            .video: [AVVideoCodecKey: AVVideoCodecType.hevc, AVVideoWidthKey: 3840, AVVideoHeightKey: 2160,
                     AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: framesPerSecond == 60 ? 40_000_000 : 25_000_000, AVVideoMaxKeyFrameIntervalDurationKey: 2]],
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
    private func sendHeartbeat(_ pairing: Pairing) async {
        do {
            let response: HeartbeatResponse = try await CaptureAPI.call(pairing, body: ["action": "heartbeat", "deviceName": UIDevice.current.name, "recording": recording, "streaming": streaming, "battery": UIDevice.current.batteryLevel, "error": error.map { String($0.prefix(300)) } as Any? ?? NSNull()])
            if response.ended { recordingTask?.cancel() }
        } catch { /* Loss of telemetry must not stop local capture. */ }
    }
    func stop() async {
        guard recording else { return }
        busy = true; recordingTask?.cancel(); serviceTask?.cancel()
        await recordingTask?.value
        busy = false
    }
}
