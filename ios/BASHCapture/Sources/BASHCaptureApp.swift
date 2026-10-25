import SwiftUI
import HaishinKit

private enum BASHStyle {
    static let orange = Color(red: 0.83, green: 0.34, blue: 0.06)
}

@main
struct BASHCaptureApp: App {
    @StateObject private var camera = CaptureController()
    @StateObject private var website = WebsiteConnection()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            CaptureHome(camera: camera, library: camera.library, website: website)
                .tint(BASHStyle.orange)
                .onChange(of: phase) { _, next in
                    if next == .background { Task { await camera.stop(); await camera.suspendPreview() } }
                    if next == .active { Task { await camera.library.uploadPending() } }
                }
                .task(id: phase) {
                    guard phase == .active else { return }
                    while !Task.isCancelled {
                        await camera.library.uploadPending()
                        do { try await Task.sleep(for: .seconds(30)) } catch { break }
                    }
                }
                .onChange(of: camera.library.uploading) { _, _ in
                    UIApplication.shared.isIdleTimerDisabled = camera.recording || camera.library.uploading
                }
                .onChange(of: camera.recording) { _, _ in
                    UIApplication.shared.isIdleTimerDisabled = camera.recording || camera.library.uploading
                }
        }
    }
}

struct CaptureHome: View {
    @ObservedObject var camera: CaptureController
    @ObservedObject var library: RecordingLibrary
    @ObservedObject var website: WebsiteConnection
    @State private var pin = ""
    @State private var showUploads = false
    @State private var showCamera = false
    @State private var selectedGame: CaptureGame?
    @State private var openCameraAfterSetup = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 16) {
                        Image("BASHBadge").resizable().scaledToFit().frame(width: 76, height: 76).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 5) {
                            Text("RINKSIDE").font(.caption.weight(.bold)).tracking(2).foregroundStyle(BASHStyle.orange)
                            Text("You record.\nWe’ll take it from here.").font(.title3.weight(.bold))
                        }
                    }.padding(.vertical, 12)
                }.listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))

                if !library.recordings.isEmpty {
                    Section {
                        Button { showUploads = true } label: {
                            HStack(spacing: 12) {
                                if library.uploading { ProgressView() }
                                else { Image(systemName: library.pending == 0 && library.error == nil ? "checkmark.icloud" : "icloud.and.arrow.up").foregroundStyle(BASHStyle.orange) }
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(library.uploading ? "Uploading to BASH" : library.error != nil ? "Upload needs attention" : library.pending > 0 ? "Waiting to upload" : "Saved to BASH").font(.subheadline.weight(.semibold))
                                    Text(library.pending > 0 ? "\(library.pending) \(library.pending == 1 ? "clip" : "clips") remaining" : library.error != nil ? "Check upload status." : "Uploaded clips cleared from this iPhone.").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                            }.foregroundStyle(.primary)
                        }.buttonStyle(.plain)
                    }
                }
                if let game = camera.configuration?.game, let pairing = camera.pairing, camera.configuration?.ended == false {
                    Section {
                        Button { showCamera = true } label: {
                            Label {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(game.matchup).font(.headline)
                                    Text("Open \(pairing.side) camera").font(.subheadline).foregroundStyle(.secondary)
                                }
                            } icon: { Image(systemName: "video.fill").foregroundStyle(BASHStyle.orange) }
                        }.foregroundStyle(.primary).buttonStyle(.plain)
                    }
                }
                if website.signedIn {
                    Section("Choose a game") {
                        ForEach(website.games) { game in
                            Button { selectedGame = game } label: {
                                HStack(spacing: 12) {
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(game.matchup).font(.headline)
                                        Text("\(game.dateLabel) · \(game.time)").font(.subheadline).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if game.status == "live" { Text("LIVE").font(.caption.bold()).foregroundStyle(BASHStyle.orange) }
                                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                                }.foregroundStyle(.primary).padding(.vertical, 6)
                            }.buttonStyle(.plain)
                        }
                        if website.games.isEmpty { Text("No games available.").foregroundStyle(.secondary) }
                    }
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
                    } header: { Text("Ready to record?") } footer: { Text("Enter the league PIN to choose your game.") }
                }
                if let error = website.error {
                    Section {
                        Text(error).foregroundStyle(.red).font(.callout)
                        if website.signedIn { Button("Try again") { Task { await website.refresh() } } }
                    }
                }
            }
            .navigationTitle("BASH Capture")
            .refreshable { await website.refresh(); await camera.refreshConfiguration(); await library.uploadPending() }
        }
        .sheet(isPresented: $showUploads) { UploadStatusSheet(library: library) }
        .sheet(item: $selectedGame, onDismiss: {
            if openCameraAfterSetup { openCameraAfterSetup = false; showCamera = true }
        }) { game in
            GameSetupSheet(game: game, camera: camera, website: website) { openCameraAfterSetup = true; selectedGame = nil }
        }
        .fullScreenCover(isPresented: $showCamera) { NativeCameraView(camera: camera, library: library) }
        .task { await library.recoverInterrupted(); await camera.refreshConfiguration(); await library.uploadPending() }
    }
    private func signIn() {
        guard !pin.isEmpty, !website.busy else { return }
        Task { await website.signIn(pin: pin); pin = "" }
    }
}

struct GameSetupSheet: View {
    let game: CaptureGame
    @ObservedObject var camera: CaptureController
    @ObservedObject var website: WebsiteConnection
    let onConnected: () -> Void
    @Environment(\.dismiss) private var dismiss
    @AppStorage("captureSide") private var side = "left"
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(game.matchup).font(.title2.bold())
                    Text("\(game.dateLabel) · \(game.time)").foregroundStyle(.secondary)
                }
                Section {
                    Picker("Camera position", selection: $side) {
                        Label("Left", systemImage: "arrow.left").tag("left")
                        Label("Right", systemImage: "arrow.right").tag("right")
                    }.pickerStyle(.segmented)
                } header: { Text("Which side is this phone?") } footer: { Text("Facing the rink, choose this phone’s side of the mount.") }
                Section {
                    Button { connect() } label: {
                        HStack { Spacer(); if website.busy { ProgressView().tint(.white) } else { Label("Open camera", systemImage: "video.fill").fontWeight(.semibold) }; Spacer() }.padding(.vertical, 6)
                    }.buttonStyle(.borderedProminent).disabled(website.busy || camera.recording)
                } footer: { Text("Record in 4K. Footage uploads automatically.") }
                if let error = website.error { Section { Text(error).foregroundStyle(.red) } }
            }.navigationTitle("Set up this phone").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
                .confirmationDialog("Replace the \(side) camera?", isPresented: $website.cameraConflict, titleVisibility: .visible) {
                    Button("Replace camera", role: .destructive) { connect(replace: true) }
                } message: { Text("Another phone is assigned to this side. Its saved footage will stay on that phone.") }
        }.presentationDetents([.height(520), .large]).presentationDragIndicator(.visible)
    }
    private func connect(replace: Bool = false) {
        Task { if await website.choose(game, side: side, camera: camera, replace: replace) { onConnected() } }
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
        let view = MTHKView(frame: .zero); view.videoGravity = .resizeAspect
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
    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                let landscape = geometry.size.width > geometry.size.height
                ZStack {
                    Color.black.ignoresSafeArea()
                    CapturePreview(mixer: camera.mixer)
                    VStack {
                        VStack(spacing: 5) {
                            Text(camera.configuration?.game?.matchup ?? camera.configuration?.title ?? "BASH recording").font(.headline)
                            HStack(spacing: 12) {
                                Label("4K · \(camera.framesPerSecond)", systemImage: "video")
                                if camera.streaming { Label("Live", systemImage: "dot.radiowaves.left.and.right").foregroundStyle(.red) }
                                if camera.recording, let start = camera.recordingStartedAt {
                                    Text(start, style: .timer).monospacedDigit().foregroundStyle(.red)
                                }
                            }.font(.caption.weight(.semibold))
                        }.padding(.horizontal, 18).padding(.vertical, 10).captureGlass()
                        Spacer()
                        if !camera.ready {
                            VStack(spacing: 6) {
                                Text("Camera preview").font(.headline)
                                Text(camera.error ?? "Use a physical iPhone to record.").font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                            }.frame(maxWidth: 420)
                            Spacer()
                        } else if let error = camera.error {
                            Text(error).font(.callout).multilineTextAlignment(.center).padding(12).background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                        }
                        if !landscape { Label("Rotate with the volume buttons facing up", systemImage: "rotate.right").font(.callout).padding(10) }
                    }.padding()
                }
                .safeAreaInset(edge: .bottom) {
                    HStack(spacing: 28) {
                        VStack(alignment: .trailing, spacing: 3) {
                            Text(camera.pairing.map { "\($0.side.capitalized) camera" } ?? "Not paired").font(.subheadline.weight(.semibold))
                            Text(camera.recording ? "Recording" : "Ready to record").font(.caption).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, alignment: .trailing)
                        Button {
                            if camera.recording { confirmStop = true } else { Task { await camera.start() } }
                        } label: {
                            ZStack {
                                Circle().strokeBorder(.white, lineWidth: 3).frame(width: 76, height: 76)
                                if camera.recording { RoundedRectangle(cornerRadius: 7).fill(.red).frame(width: 30, height: 30) }
                                else { Circle().fill(.red).frame(width: 64, height: 64) }
                            }
                        }.buttonStyle(.plain).accessibilityLabel(camera.recording ? "Stop recording" : "Start recording")
                            .disabled(camera.busy || !camera.ready || camera.pairing == nil || camera.configuration?.ended == true || (!landscape && !camera.recording))
                            .opacity(camera.ready && landscape ? 1 : 0.45)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(library.uploading ? "Uploading" : library.pending > 0 ? "Upload queued" : "Auto upload").font(.subheadline.weight(.semibold))
                            Text(library.error != nil ? "Saved on iPhone · retry later" : "Keep BASH open").font(.caption).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }.padding(.horizontal, 20).padding(.vertical, 12).captureGlass().padding(.horizontal).padding(.bottom, 8)
                }
            }
            .navigationTitle("BASH Capture").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Close", systemImage: "xmark") { dismiss() }.disabled(camera.recording || camera.busy) }
            }
            .confirmationDialog("Stop recording this camera?", isPresented: $confirmStop, titleVisibility: .visible) { Button("Stop recording", role: .destructive) { Task { await camera.stop() } } }
            .task { await camera.refreshConfiguration(); await camera.prepare() }
            .onDisappear { Task { await camera.suspendPreview() } }
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
                } footer: { Text("Keep BASH open while uploading. Clips are automatically removed from this iPhone once BASH verifies the upload.") }
            }.navigationTitle("Uploads").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }.presentationDetents([.medium, .large])
    }
}
