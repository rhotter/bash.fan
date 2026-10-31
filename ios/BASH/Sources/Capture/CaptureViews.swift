import SwiftUI
import HaishinKit

struct CapturePreview: UIViewRepresentable {
    let mixer: MediaMixer
    final class Coordinator {
        let mixer: MediaMixer
        var attach: Task<Void, Never>?
        init(_ mixer: MediaMixer) { self.mixer = mixer }
    }
    func makeCoordinator() -> Coordinator { Coordinator(mixer) }
    func makeUIView(context: Context) -> MTHKView {
        let view = MTHKView(frame: .zero); view.videoGravity = .resizeAspectFill
        context.coordinator.attach = Task { await mixer.addOutput(view) }
        return view
    }
    func updateUIView(_ view: MTHKView, context: Context) {}
    static func dismantleUIView(_ view: MTHKView, coordinator: Coordinator) {
        Task { await coordinator.attach?.value; await coordinator.mixer.removeOutput(view) }
    }
}

struct NativeCameraView: View {
    @ObservedObject var camera: CaptureController
    @ObservedObject var library: RecordingLibrary
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var confirmStop = false
    @State private var showUploads = false
    @State private var orientation = UIDevice.current.orientation
    private var rotationInstruction: String {
        switch orientation {
        case .landscapeLeft, .landscapeRight: return "Turn the phone 180°"
        case .faceUp, .faceDown: return "Stand the phone upright"
        default: return "Rotate your iPhone"
        }
    }
    var body: some View {
            GeometryReader { geometry in
                // Device orientation is physical; layout alone cannot distinguish the two landscape directions.
                let correctlyOriented = orientation == camera.requiredOrientation && geometry.size.width > geometry.size.height
                ZStack {
                    Color.black.ignoresSafeArea()
                    CapturePreview(mixer: camera.mixer)
                        .ignoresSafeArea()
                    VStack {
                        if let error = camera.error {
                            Spacer()
                            Text(error)
                                .font(.callout)
                                .multilineTextAlignment(.center)
                                .padding(12)
                                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                        } else if !camera.ready && !camera.recording {
                            Spacer()
                            ProgressView("Starting camera…")
                                .padding(12)
                                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                        }
                        if correctlyOriented {
                            Spacer()
                        }
                        if !correctlyOriented {
                            Spacer()
                            VStack(spacing: 6) {
                                Label(rotationInstruction, systemImage: "rotate.right").font(.headline)
                                Text(camera.mountInstruction).font(.callout)
                                if camera.recording { Text("Still recording — return the phone to its mount position.").font(.caption) }
                                else if orientation == camera.requiredOrientation { Text("Turn off Portrait Orientation Lock if the screen stays upright.").font(.caption) }
                            }
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.yellow)
                            .padding(12)
                            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                            .accessibilityElement(children: .combine)
                            Spacer()
                        }
                    }.padding()
                }
                .overlay(alignment: .bottom) {
                    HStack(spacing: 28) {
                        Spacer()
                        Button {
                            if camera.recording { confirmStop = true } else { Task { await camera.start() } }
                        } label: {
                            ZStack {
                                Circle().strokeBorder(.white, lineWidth: 3).frame(width: 76, height: 76)
                                if camera.recording { RoundedRectangle(cornerRadius: 7).fill(.red).frame(width: 30, height: 30) }
                                else { Circle().fill(.red).frame(width: 64, height: 64) }
                            }
                        }.buttonStyle(.plain).accessibilityLabel(camera.recording ? "Stop recording" : "Start recording")
                            .disabled(camera.busy || (!camera.recording && (!camera.ready || camera.pairing == nil || camera.configuration?.ended == true || !correctlyOriented)))
                            .opacity(camera.recording || (camera.ready && correctlyOriented) ? 1 : 0.45)
                        Spacer()
                    }.padding(.horizontal, 20).padding(.vertical, 12).padding(.bottom, 8)
                }
            }
            .overlay(alignment: .topTrailing) {
                CameraStatusPanel(camera: camera, library: library) { showUploads = true }
                    .frame(maxWidth: 290)
                    .padding(.leading, 76).padding(.trailing, 12).padding(.top, 12)
            }
            .sheet(isPresented: $showUploads) { UploadStatusSheet(library: library) }
            .task {
                while !Task.isCancelled {
                    await library.refreshTransferProgress()
                    do { try await Task.sleep(for: .seconds(2)) } catch { return }
                }
            }
            .overlay(alignment: .topLeading) {
                if !camera.recording {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(.white)
                            .frame(width: 48, height: 48)
                            .captureGlass()
                    }
                    .accessibilityLabel("Close camera")
                    .disabled(camera.busy)
                    .padding(16)
                }
            }
            .ignoresSafeArea(.container, edges: .horizontal)
            .statusBarHidden()
            .persistentSystemOverlays(.hidden)
            .confirmationDialog("Stop recording this camera?", isPresented: $confirmStop, titleVisibility: .visible) { Button("Stop recording", role: .destructive) { Task { await camera.stop() } } }
            .task { await camera.prepare(); await camera.refreshConfiguration() }
            .onAppear {
                UIDevice.current.beginGeneratingDeviceOrientationNotifications()
                orientation = UIDevice.current.orientation
            }
            .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in
                orientation = UIDevice.current.orientation
            }
            .onDisappear {
                UIDevice.current.endGeneratingDeviceOrientationNotifications()
                Task { await camera.suspendPreview() }
            }
            .onChange(of: phase) { _, next in if next == .active { Task { await camera.prepare() } } }
            .sensoryFeedback(.impact(weight: .medium), trigger: camera.recording)
            .preferredColorScheme(.dark)
    }
}

private extension View {
    @ViewBuilder func captureGlass() -> some View {
        if #available(iOS 26, *) { self.glassEffect(.regular, in: .capsule) }
        else { self.background(.ultraThinMaterial, in: Capsule()) }
    }
}

struct UploadStatusSheet: View {
    @ObservedObject var library: RecordingLibrary
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label(library.uploadStatus, systemImage: library.pending == 0 ? "checkmark.icloud" : "icloud.and.arrow.up").font(.headline)
                    if library.pending > 0 { Text("\(library.pending) \(library.pending == 1 ? "clip" : "clips") remaining").foregroundStyle(.secondary) }
                    if let fraction = library.transferFraction, library.pending > 0 {
                        ProgressView(value: fraction)
                        Text("Queued transfers: \(Int(fraction * 100))%").font(.caption).foregroundStyle(.secondary)
                    } else if library.uploading { ProgressView() }
                    if library.transferStalled { Text("No upload progress for 30 seconds. Recording on this phone continues.").font(.callout).foregroundStyle(.orange) }
                    if let error = library.error { Text(error).font(.callout).foregroundStyle(.red) }
                    if !library.uploading && library.pending > 0 { Button("Retry upload") { Task { await library.uploadPending() } } }
                } footer: { Text("Uploads can continue with BASH in the background. Reopen BASH if you force-quit it. Clips are removed after BASH verifies the upload.") }
            }.navigationTitle("Uploads").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }.presentationDetents([.medium, .large])
    }
}


struct CameraStatusPanel: View {
    @ObservedObject var camera: CaptureController
    @ObservedObject var library: RecordingLibrary
    var showUploads: () -> Void
    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 6) {
                    Image(systemName: camera.recording ? "record.circle" : "circle").foregroundStyle(camera.recording ? .red : .white)
                    Text(camera.recording ? "Recording to phone" : "Not recording")
                    Spacer(minLength: 0)
                    if let start = camera.recordingStartedAt { Text(start, style: .timer).monospacedDigit() }
                }
                HStack(spacing: 6) {
                    Image(systemName: "antenna.radiowaves.left.and.right")
                        .foregroundStyle(camera.liveDelivery.isFlowing(now: context.date) && camera.recording && camera.streaming ? .green : .white)
                    Text(camera.demo ? "Demo · no livestream" : !camera.recording ? "Livestream off" : !camera.streaming ? "Connecting livestream" : camera.liveDelivery.label(now: context.date))
                }
                Button(action: showUploads) {
                    HStack(spacing: 6) {
                        Image(systemName: "icloud.and.arrow.up")
                        Text(camera.demo ? "Demo · saved on this phone" : library.uploadStatus)
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.caption2)
                    }.contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityHint("View upload progress and errors")
                if !camera.demo, let fraction = library.transferFraction, library.pending > 0 {
                    ProgressView(value: fraction).tint(.white)
                }
            }
            .font(.caption.weight(.medium)).foregroundStyle(.white)
            .padding(10).background(.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 12))
        }
    }
}
