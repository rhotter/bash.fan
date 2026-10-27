import SwiftUI

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
                }
                Section {
                    Picker("Quality", selection: $camera.quality) {
                        ForEach(RecordingQuality.allCases) { Text($0.title).tag($0) }
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                OpenCameraAction(disabled: camera.recording || camera.busy,
                                 detail: "Requires a physical iPhone with a rear ultra-wide camera.") { showCamera = true }
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
