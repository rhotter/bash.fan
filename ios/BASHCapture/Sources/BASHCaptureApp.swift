import SwiftUI
import HaishinKit

@main
struct BASHCaptureApp: App {
    @StateObject private var camera = CaptureController()
    @StateObject private var website = WebsiteConnection()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            CaptureHome(camera: camera, library: camera.library, website: website)
                .onChange(of: phase) { _, next in
                    if next == .background { Task { await camera.stop(); await camera.suspendPreview() } }
                }
        }
    }
}

struct CaptureHome: View {
    @ObservedObject var camera: CaptureController
    @ObservedObject var library: RecordingLibrary
    @ObservedObject var website: WebsiteConnection
    @State private var showConnection = false
    @State private var showCamera = false
    @State private var selectedGame: CaptureGame?
    @State private var openCameraAfterSetup = false

    var body: some View {
        TabView {
            NavigationStack {
                List {
                    if let pairing = camera.pairing {
                        Section("This camera") {
                            Button { showCamera = true } label: {
                                HStack(spacing: 14) {
                                    Image(systemName: "video.fill").font(.title2).foregroundStyle(.tint)
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(camera.configuration?.game?.matchup ?? camera.configuration?.title ?? "Connected recording").font(.headline).foregroundStyle(.primary)
                                        Text("\(pairing.side.capitalized) camera · \(camera.configuration?.ended == true ? "Session ended" : "Ready to open")").font(.subheadline).foregroundStyle(.secondary)
                                    }
                                    Spacer(); Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(.tertiary)
                                }.padding(.vertical, 5)
                            }.buttonStyle(.plain)
                        }
                    }
                    if website.signedIn {
                        Section("League schedule") {
                            ForEach(website.games) { game in
                                Button { selectedGame = game } label: {
                                    VStack(alignment: .leading, spacing: 5) {
                                        HStack {
                                            Text(game.matchup).font(.headline).foregroundStyle(.primary)
                                            Spacer()
                                            if game.status == "live" { Text("LIVE").font(.caption.bold()).foregroundStyle(.red) }
                                        }
                                        Text("\(game.dateLabel) · \(game.time)").font(.subheadline).foregroundStyle(.secondary)
                                        if let location = game.location { Text(location).font(.caption).foregroundStyle(.secondary) }
                                    }.padding(.vertical, 5)
                                }.buttonStyle(.plain)
                            }
                            if website.games.isEmpty { Text(website.error == nil ? "No games in the current season." : "The schedule could not be loaded.").foregroundStyle(.secondary) }
                        }
                    } else {
                        Section {
                            ContentUnavailableView("Your rink. Your games.", systemImage: "sportscourt", description: Text("Connect to BASH to choose a game and assign this phone to the left or right camera."))
                            Button("Connect to BASH", systemImage: "link") { showConnection = true }
                                .frame(maxWidth: .infinity).buttonStyle(.borderedProminent).padding(.bottom, 12)
                        }
                    }
                    if let error = website.error {
                        Section {
                            Text(error).foregroundStyle(.red).font(.callout)
                            if website.signedIn { Button("Retry") { Task { await website.refresh() } } }
                        }
                    }
                }
                .navigationTitle("Games")
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Connection", systemImage: "person.crop.circle") { showConnection = true } } }
                .refreshable { await website.refresh(); await camera.refreshConfiguration() }
            }.tabItem { Label("Games", systemImage: "sportscourt") }
            RecordingLibraryView(camera: camera, library: library)
                .tabItem { Label("Recordings", systemImage: "play.rectangle.on.rectangle") }
        }
        .sheet(isPresented: $showConnection) { ConnectionSheet(camera: camera, website: website) }
        .sheet(item: $selectedGame, onDismiss: {
            if openCameraAfterSetup { openCameraAfterSetup = false; showCamera = true }
        }) { game in
            GameSetupSheet(game: game, camera: camera, website: website) { openCameraAfterSetup = true; selectedGame = nil }
        }
        .fullScreenCover(isPresented: $showCamera) { NativeCameraView(camera: camera) }
        .task { await library.recoverInterrupted(); await camera.refreshConfiguration() }
        .onOpenURL { url in Task { await camera.pair(url.absoluteString); if camera.error == nil { showCamera = true } } }
    }
}

struct ConnectionSheet: View {
    @ObservedObject var camera: CaptureController
    @ObservedObject var website: WebsiteConnection
    @Environment(\.dismiss) private var dismiss
    @State private var pin = ""
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Website", text: $website.serverText).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().disabled(website.signedIn)
                    if website.signedIn {
                        Label("Connected to the league schedule", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                        Button("Sign out", role: .destructive) { website.signOut() }
                    } else {
                        SecureField("League PIN", text: $pin)
                        Button { Task { await website.signIn(pin: pin); pin = ""; if website.signedIn { dismiss() } } } label: {
                            if website.busy { ProgressView() } else { Text("Connect") }
                        }.disabled(pin.isEmpty || website.busy)
                    }
                } header: { Text("BASH website") } footer: { Text("Uses the same game schedule and operator PIN as the website. Your PIN is never saved.") }
                if let error = website.error ?? camera.error { Section { Text(error).foregroundStyle(.red) } }
            }.navigationTitle("Connection").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct GameSetupSheet: View {
    let game: CaptureGame
    @ObservedObject var camera: CaptureController
    @ObservedObject var website: WebsiteConnection
    let onConnected: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var side = "left"
    @State private var confirmEnd = false
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(game.matchup).font(.headline)
                    Label("\(game.dateLabel) · \(game.time)", systemImage: "calendar")
                    if let location = game.location { Label(location, systemImage: "mappin.and.ellipse") }
                }
                Section {
                    Picker("Camera position", selection: $side) { Text("Left").tag("left"); Text("Right").tag("right") }.pickerStyle(.segmented)
                    Toggle("Livestream", isOn: $camera.liveEnabled)
                } header: { Text("This iPhone") } footer: { Text("Choose the same game on both phones, then assign one to each side of the fixed mount. 4K originals stay on each phone.") }
                Section {
                    Button { Task { if await website.choose(game, side: side, camera: camera) { onConnected() } } } label: {
                        if website.busy { ProgressView() } else { Label("Open camera", systemImage: "video") }
                    }.disabled(website.busy || camera.recording)
                    if camera.configuration?.game?.id == game.id && camera.configuration?.ended == false {
                        Button("End game recording", role: .destructive) { confirmEnd = true }.disabled(website.busy || camera.recording)
                    }
                }
                if let error = website.error { Section { Text(error).foregroundStyle(.red) } }
            }.navigationTitle("Record game").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
                .confirmationDialog("Replace the \(side) camera?", isPresented: $website.cameraConflict, titleVisibility: .visible) {
                    Button("Replace camera", role: .destructive) { Task { if await website.choose(game, side: side, camera: camera, replace: true) { onConnected() } } }
                } message: { Text("The previous phone will lose its connection. Stop it first; its saved recordings stay on that phone.") }
                .confirmationDialog("End recording for both cameras?", isPresented: $confirmEnd, titleVisibility: .visible) {
                    Button("End game recording", role: .destructive) { Task { if await website.endRecording(camera: camera) { dismiss() } } }
                } message: { Text("Connected cameras stop at their next check-in. Stop offline cameras on the phones. Saved recordings can still upload.") }
        }
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
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var showSettings = false
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
                            Text(camera.recording ? "Recording on iPhone" : "Ready when you are").font(.caption).foregroundStyle(.secondary)
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
                            Text(camera.clockChecked ? "Clock checked" : "Local + live").font(.subheadline.weight(.semibold))
                            Text(camera.liveEnabled ? "1080p broadcast" : "Local recording only").font(.caption).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }.padding(.horizontal, 20).padding(.vertical, 12).captureGlass().padding(.horizontal).padding(.bottom, 8)
                }
            }
            .navigationTitle("Camera").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Close", systemImage: "xmark") { dismiss() }.disabled(camera.recording || camera.busy) }
                ToolbarItem(placement: .topBarTrailing) { Button("Capture settings", systemImage: "slider.horizontal.3") { showSettings = true }.disabled(camera.recording) }
            }
            .sheet(isPresented: $showSettings) { CaptureSettings(camera: camera) }
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

struct CaptureSettings: View {
    @ObservedObject var camera: CaptureController
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                Section("Recording") {
                    LabeledContent("Resolution", value: "4K HEVC")
                    Picker("Frame rate", selection: $camera.framesPerSecond) { Text("30 fps").tag(30); Text("60 fps").tag(60) }
                    Toggle("Livestream at 1080p", isOn: $camera.liveEnabled)
                }
                Section { Text("Use the same frame rate on both phones. Keep them fixed with overlapping views, and record a clap near the mount before play for alignment.").font(.callout) }
            }.navigationTitle("Capture settings").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }.presentationDetents([.medium, .large])
    }
}

struct RecordingLibraryView: View {
    @ObservedObject var camera: CaptureController
    @ObservedObject var library: RecordingLibrary
    @State private var confirmCleanup = false
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button { Task { await library.uploadPending() } } label: { Label(library.uploading ? "Uploading…" : "Upload recordings", systemImage: "icloud.and.arrow.up") }.disabled(library.uploading || camera.recording || library.pending == 0)
                    LabeledContent("Waiting to upload", value: "\(library.pending)")
                } footer: { Text("Upload after the game. Keep the app open until uploads finish.") }
                if library.recordings.isEmpty { ContentUnavailableView("No recordings yet", systemImage: "film.stack", description: Text("Your recordings stay on this iPhone until you choose to remove saved copies.")) }
                Section("On this iPhone") {
                    ForEach(library.recordings.reversed()) { item in
                        HStack {
                            Image(systemName: item.uploaded ? "checkmark.icloud" : "film").foregroundStyle(item.uploaded ? .green : .secondary)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.startedAt, format: .dateTime.month().day().hour().minute())
                                Text(item.duration.map { "\(Int($0)) seconds" } ?? "Needs recovery").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(); Text(item.uploaded ? "Saved" : "On iPhone").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if let error = library.error { Section { Text(error).foregroundStyle(.red) } }
            }.navigationTitle("Recordings")
                .toolbar { ToolbarItem(placement: .topBarTrailing) {
                    Menu("Library options", systemImage: "ellipsis") { Button("Remove saved local copies", role: .destructive) { confirmCleanup = true }.disabled(camera.recording || library.uploading || !library.recordings.contains(where: { $0.uploaded })) }
                } }
                .confirmationDialog("Remove local copies already saved to BASH?", isPresented: $confirmCleanup, titleVisibility: .visible) { Button("Remove local copies", role: .destructive) { do { try library.removeVerified() } catch { library.error = error.localizedDescription } } }
        }
    }
}
