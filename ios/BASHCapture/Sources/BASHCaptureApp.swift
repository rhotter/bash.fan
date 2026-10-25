import SwiftUI
import HaishinKit

private enum BASHStyle {
    static let orange = Color(red: 0.83, green: 0.34, blue: 0.06)
}

@main
struct BASHCaptureApp: App {
    @UIApplicationDelegateAdaptor(CaptureAppDelegate.self) private var appDelegate
    @StateObject private var camera = CaptureController()
    @StateObject private var website = WebsiteConnection()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            CaptureHome(camera: camera, library: camera.library, website: website)
                .tint(BASHStyle.orange)
                .onChange(of: phase) { _, next in
                    if next == .background {
                        let handoff = UploadHandoff()
                        Task {
                            defer { handoff.end() }
                            await camera.stop()
                            await camera.suspendPreview()
                            await camera.library.uploadPending()
                        }
                    }
                    if next == .active { Task { await camera.library.uploadPending() } }
                }
                .task(id: phase) {
                    guard phase == .active else { return }
                    while !Task.isCancelled {
                        await camera.library.uploadPending()
                        do { try await Task.sleep(for: .seconds(30)) } catch { break }
                    }
                }
                .onChange(of: camera.recording) { _, _ in
                    UIApplication.shared.isIdleTimerDisabled = camera.recording
                }
        }
    }
}

struct CaptureHome: View {
    @ObservedObject var camera: CaptureController
    @ObservedObject var library: RecordingLibrary
    @ObservedObject var website: WebsiteConnection
    @State private var showUploads = false
    @State private var showSetup = false
    @State private var showCamera = false
    @State private var cameraAfterSetup = false

    var body: some View {
        GeometryReader { geometry in
            let landscape = geometry.size.width > geometry.size.height
            ScrollView {
                Group {
                    if landscape {
                        HStack(spacing: 48) {
                            welcome(compact: true).frame(maxWidth: .infinity)
                            homeActions.frame(maxWidth: 360)
                        }
                    } else {
                        VStack(spacing: 24) {
                            Spacer(minLength: 24)
                            welcome(compact: false)
                            Spacer(minLength: 48)
                            homeActions
                        }
                    }
                }
                .frame(maxWidth: landscape ? 860 : 440)
                .frame(minHeight: max(0, geometry.size.height - 48))
                .frame(maxWidth: .infinity)
                .padding(24)
            }
            .background {
                Color(uiColor: .systemGroupedBackground)
                    .overlay {
                        RadialGradient(colors: [BASHStyle.orange.opacity(0.12), .clear],
                                       center: .top, startRadius: 0, endRadius: 500)
                    }
                    .ignoresSafeArea()
            }
            .refreshable { await camera.refreshConfiguration(); await library.uploadPending() }
        }
        .sheet(isPresented: $showUploads) { UploadStatusSheet(library: library) }
        .sheet(isPresented: $showSetup, onDismiss: {
            if cameraAfterSetup { cameraAfterSetup = false; showCamera = true }
        }) {
            RecordingSetupSheet(camera: camera, website: website) { cameraAfterSetup = true }
        }
        .fullScreenCover(isPresented: $showCamera) { NativeCameraView(camera: camera, library: library) }
        .task { await library.recoverInterrupted(); await camera.refreshConfiguration(); await library.uploadPending() }
    }

    private func welcome(compact: Bool) -> some View {
        VStack(spacing: 24) {
            let size: CGFloat = compact ? 120 : 164
            Image("BASHBadge")
                .resizable().scaledToFit().frame(width: size, height: size)
                .clipShape(Circle().inset(by: size * 0.084))
                .shadow(color: .black.opacity(0.08), radius: 20, y: 8)
                .accessibilityHidden(true)
            Text("Welcome to BASH")
                .font(.largeTitle.weight(.bold))
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
        }
    }

    private var homeActions: some View {
        VStack(spacing: 16) {
            if library.uploading || library.pending > 0 || library.error != nil {
                Button { showUploads = true } label: {
                    HStack(spacing: 12) {
                        if library.uploading { ProgressView() }
                        else { Image(systemName: "icloud.and.arrow.up").foregroundStyle(BASHStyle.orange) }
                        VStack(alignment: .leading, spacing: 3) {
                            Text(library.error != nil ? "Upload needs attention" : library.uploading ? "Uploading to BASH" : "Waiting to upload")
                                .font(.subheadline.weight(.semibold))
                            if library.pending > 0 {
                                Text("\(library.pending) \(library.pending == 1 ? "clip" : "clips") remaining")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                    .foregroundStyle(.primary)
                    .padding(18)
                    .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
                }.buttonStyle(.plain)
            }
            Button { showSetup = true } label: {
                Text("Set up recording")
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, minHeight: 36)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .disabled(camera.recording)
        }
    }

}

private struct RecordingSetupSheet: View {
    @ObservedObject var camera: CaptureController
    @ObservedObject var website: WebsiteConnection
    let onReady: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var pin = ""
    @AppStorage("captureSide") private var side = "left"

    var body: some View {
        NavigationStack {
            Form {
                if website.signedIn {
                    Section {
                        Picker("Camera position", selection: $side) {
                            Label("Left", systemImage: "arrow.left").tag("left")
                            Label("Right", systemImage: "arrow.right").tag("right")
                        }.pickerStyle(.segmented)
                    } header: { Text("Which side is this phone?") } footer: { Text("Facing the rink, choose this phone’s side of the mount.") }
                    Section {
                        Button { connect() } label: {
                            HStack {
                                Spacer()
                                if website.busy { ProgressView().tint(.white) }
                                else { Label("Open camera", systemImage: "video.fill").fontWeight(.semibold).foregroundStyle(.white).tint(.white) }
                                Spacer()
                            }.padding(.vertical, 6)
                        }.buttonStyle(.borderedProminent).disabled(website.busy || camera.recording)
                    } footer: { Text("Record through the games. BASH matches footage to the scorekeeper automatically.") }
                } else {
                    Section {
                        SecureField("League PIN", text: $pin).textContentType(.password).submitLabel(.go)
                            .onSubmit { signIn() }
                        Button(action: signIn) {
                            HStack {
                                Spacer()
                                if website.busy { ProgressView().tint(.white) } else { Text("Continue").fontWeight(.semibold) }
                                Spacer()
                            }.padding(.vertical, 6)
                        }.buttonStyle(.borderedProminent).disabled(pin.isEmpty || website.busy)
                    } header: { Text("Ready to record?") } footer: { Text("Enter the league PIN to connect this camera.") }
                }
                if let error = website.error {
                    Section {
                        Text(error).foregroundStyle(.red).font(.callout)
                    }
                }
            }
            .navigationTitle("Set up recording")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(website.busy)
                }
            }
        }
        .interactiveDismissDisabled(website.busy)
        .confirmationDialog("Replace the \(side) camera?", isPresented: $website.cameraConflict, titleVisibility: .visible) {
            Button("Replace camera", role: .destructive) { connect(replace: true) }
        } message: { Text("Another phone is assigned to this side. Its unuploaded footage stays on that phone.") }
    }
    private func connect(replace: Bool = false) {
        Task {
            if await website.connect(side: side, camera: camera, replace: replace) {
                onReady(); dismiss()
            }
        }
    }
    private func signIn() {
        guard !pin.isEmpty, !website.busy else { return }
        Task { await website.signIn(pin: pin); pin = "" }
    }
}

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
    @State private var orientation = UIDevice.current.orientation
    private var rotationInstruction: String {
        switch orientation {
        case .landscapeLeft: return "Turn the phone 180°"
        case .faceUp, .faceDown: return "Stand the phone upright"
        default: return "Rotate your iPhone"
        }
    }
    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                // Device orientation is physical; layout alone cannot distinguish the two landscape directions.
                let correctlyOriented = orientation == .landscapeRight && geometry.size.width > geometry.size.height
                ZStack {
                    Color.black.ignoresSafeArea()
                    CapturePreview(mixer: camera.mixer)
                        .ignoresSafeArea()
                    VStack {
                        if correctlyOriented {
                            Spacer()
                            if let error = camera.error {
                                Text(error)
                                    .font(.callout)
                                    .multilineTextAlignment(.center)
                                    .padding(12)
                                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                            }
                            Spacer()
                        }
                        if !correctlyOriented {
                            Spacer()
                            VStack(spacing: 6) {
                                Label(rotationInstruction, systemImage: "rotate.right").font(.headline)
                                Text("Landscape, with the volume buttons facing up.").font(.callout)
                                if camera.recording { Text("Still recording — return the phone to its mount position.").font(.caption) }
                                else if orientation == .landscapeRight { Text("Turn off Portrait Orientation Lock if the screen stays upright.").font(.caption) }
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
            .toolbar(.hidden, for: .navigationBar)
            .statusBarHidden()
            .persistentSystemOverlays(.hidden)
            .confirmationDialog("Stop recording this camera?", isPresented: $confirmStop, titleVisibility: .visible) { Button("Stop recording", role: .destructive) { Task { await camera.stop() } } }
            .task { await camera.refreshConfiguration(); await camera.prepare() }
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
        }.preferredColorScheme(.dark)
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
                    Label(library.uploading ? "Uploading to BASH" : library.pending > 0 ? "Waiting to upload" : "All footage uploaded", systemImage: library.pending == 0 ? "checkmark.icloud" : "icloud.and.arrow.up").font(.headline)
                    if library.pending > 0 { Text("\(library.pending) \(library.pending == 1 ? "clip" : "clips") remaining").foregroundStyle(.secondary) }
                    if library.uploading { ProgressView() }
                    if let error = library.error { Text(error).font(.callout).foregroundStyle(.red) }
                    if !library.uploading && library.pending > 0 { Button("Retry upload") { Task { await library.uploadPending() } } }
                } footer: { Text("Uploads can continue with BASH in the background. Reopen BASH if you force-quit it. Clips are removed after BASH verifies the upload.") }
            }.navigationTitle("Uploads").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }.presentationDetents([.medium, .large])
    }
}
