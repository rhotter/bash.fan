import SwiftUI
import AVKit

/// Uses the real capture pipeline, with a separate controller that never authenticates,
/// streams, sends telemetry, or queues its clips for upload.
struct DemoRecorderScreen: View {
    @StateObject private var camera = CaptureController(demo: true)
    @ObservedObject private var library = RecordingLibrary.shared
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var showCamera = false
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Try recording without a league account. Video and audio stay on this iPhone and are never streamed or uploaded.")
                    Text("Use Files → BASH → Recordings to manage or delete demo clips.")
                        .foregroundStyle(.secondary)
                }
                Section {
                    Picker("Quality", selection: $camera.quality) {
                        ForEach(RecordingQuality.allCases) { Text($0.title).tag($0) }
                    }
                    Button("Open camera") { showCamera = true }
                } footer: {
                    Text("Requires a physical iPhone with a rear ultra-wide camera. In Simulator, you can review settings and the camera screen, but cannot record.")
                }
                Section("Demo recordings on this phone") {
                    let clips = library.recordings.filter { $0.localOnly == true && $0.duration != nil }
                    if clips.isEmpty { Text("No demo recordings yet").foregroundStyle(.secondary) }
                    ForEach(clips) { clip in
                        NavigationLink {
                            DemoPlayback(url: clip.file)
                        } label: {
                            VStack(alignment: .leading) {
                                Text(clip.startedAt, style: .date)
                                Text("\(Int(clip.duration ?? 0)) seconds · Local only").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Demo recorder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() }.disabled(camera.recording || camera.busy) } }
        }
        .fullScreenCover(isPresented: $showCamera) {
            NativeCameraView(camera: camera, library: library)
                .onAppear { NotificationRouter.setCameraOrientation(true) }
                .onDisappear { NotificationRouter.setCameraOrientation(false) }
                .interactiveDismissDisabled(camera.recording || camera.busy)
        }
        .onChange(of: phase) { _, next in
            if next != .active { Task { await camera.stop(); await camera.suspendPreview() } }
        }
    }
}

private struct DemoPlayback: View {
    @State private var player: AVPlayer
    init(url: URL) { _player = State(initialValue: AVPlayer(url: url)) }
    var body: some View {
        VideoPlayer(player: player).navigationTitle("Demo clip")
            .onDisappear { player.pause() }
    }
}
