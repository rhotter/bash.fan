import SwiftUI

// This is a local sample-data entry code, never a server/admin credential.
// Keep it available in Release builds and document it in App Review notes.
enum AppReviewAccess {
    static func matches(_ passcode: String) -> Bool {
        passcode.trimmingCharacters(in: .whitespacesAndNewlines) == "BASH-REVIEW-2026"
    }
}

private enum OperatorTool: String, Identifiable {
    case scorekeeper, recorder
    var id: String { rawValue }
    var title: String { self == .scorekeeper ? "Scorekeeper" : "Record game" }
    var server: URL {
        switch self {
        case .scorekeeper: URL(string: "https://www.bayareastreethockey.com")!
        case .recorder: try! BASHService.server()
        }
    }
}

struct OperatorMenu: View {
    let games: [Game]
    var game: Game?
    var inToolbar = false
    @State private var tool: OperatorTool?
    @State private var showAlerts = false
    @State private var showAbout = false
    @ObservedObject private var liveScores = LiveScores.shared
    var body: some View {
        Menu {
            Button { showAlerts = true } label: { Label("Game alerts", systemImage: "bell") }
            if let game, game.status == "live" || liveScores.games.contains(game.id) {
                Button {
                    Task {
                        if liveScores.games.contains(game.id) { await liveScores.stop(game.id) }
                        else { await liveScores.start(game) }
                    }
                } label: {
                    Label(liveScores.games.contains(game.id) ? "Stop live score" : "Follow on Lock Screen", systemImage: "sportscourt")
                }.disabled(liveScores.busy)
            }
            Divider()
            Button { tool = .scorekeeper } label: { Label("Scorekeeper", systemImage: "pencil.and.list.clipboard") }
            Button { tool = .recorder } label: { Label("Record game", systemImage: "video") }
            if let game { ShareLink(item: game.url) { Label("Share game", systemImage: "square.and.arrow.up") } }
            Divider()
            Button { showAbout = true } label: { Label("About BASH", systemImage: "info.circle") }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.primary)
                .frame(width: 44, height: 44)
                .background {
                    if !inToolbar {
                        Circle().fill(.quaternary)
                            .overlay(Circle().strokeBorder(.primary.opacity(0.1), lineWidth: 1))
                    }
                }
        }
        .accessibilityLabel("Game tools")
        .accessibilityIdentifier("operatorMenu")
        .alert("Live scores", isPresented: Binding(get: { game != nil && liveScores.error != nil }, set: { if !$0 { liveScores.error = nil } })) {
            Button("OK") { liveScores.error = nil }
        } message: { Text(liveScores.error ?? "") }
        .sheet(isPresented: $showAbout) { AboutBASHScreen() }
        .sheet(isPresented: $showAlerts) { GameAlertsScreen(games: games, game: game) }
        .fullScreenCover(item: $tool) { tool in
            OperatorFlow(tool: tool, games: games, game: game)
        }
    }
}

private struct AboutBASHScreen: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Bay Area Street Hockey")
                    if let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String {
                        LabeledContent("Version", value: version)
                    }
                }
                Section {
                    Link("Privacy policy", destination: URL(string: "https://www.bayareastreethockey.com/mobile/privacy.html")!)
                    Link("App support", destination: URL(string: "https://www.bayareastreethockey.com/mobile/support.html")!)
                }
                .foregroundStyle(.primary)
            }
            .navigationTitle("About BASH")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

private struct OperatorFlow: View {
    let tool: OperatorTool
    let games: [Game]
    @State private var selectedGame: Game?
    @StateObject private var website: WebsiteConnection
    @State private var pin = ""
    @FocusState private var passcodeFocused: Bool
    @State private var showDemo = false
    @Environment(\.dismiss) private var dismiss
    init(tool: OperatorTool, games: [Game], game: Game?) {
        self.tool = tool; self.games = games
        _selectedGame = State(initialValue: game)
        _website = StateObject(wrappedValue: WebsiteConnection(server: tool.server))
    }
    var body: some View {
        Group {
            if !website.signedIn {
                NavigationStack {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 24) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Scorekeeper access").font(.title2.bold())
                                Text(tool == .scorekeeper ? "Enter the scorekeeper passcode. Edits are available on game day and for seven days afterward, Pacific time." : "Enter the scorekeeper passcode to record a game.")
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                            VStack(alignment: .leading, spacing: 10) {
                                Text("Passcode").font(.subheadline.weight(.medium))
                                SecureField("Scorekeeper passcode", text: $pin)
                                    .focused($passcodeFocused)
                                    .textContentType(.password).submitLabel(.go)
                                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                                    .padding(16)
                                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
                                    .disabled(website.busy)
                                    .accessibilityIdentifier("adminPasscode")
                                    .onSubmit { signIn() }
                                if let error = website.error {
                                    Text(error).font(.footnote).foregroundStyle(.red)
                                }
                            }
                            VStack(spacing: 12) {
                                Button(action: signIn) {
                                    HStack(spacing: 10) {
                                        if website.busy { ProgressView() }
                                        Text(website.busy ? "Checking passcode…" : "Continue")
                                    }
                                    .font(.headline).frame(maxWidth: .infinity).frame(minHeight: 36)
                                }
                                .buttonStyle(.borderedProminent).controlSize(.large)
                                .tint(LeagueStyle.orange)
                                .disabled(pin.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || website.busy)
                            }
                        }
                        .frame(maxWidth: 480).padding(.horizontal, 24).padding(.top, 32)
                        .frame(maxWidth: .infinity)
                    }
                    .background(Color(.systemGroupedBackground))
                    .scrollDismissesKeyboard(.interactively)
                    .navigationTitle(tool.title).navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(website.busy) } }
                }
                .task { passcodeFocused = true }
            } else if tool == .recorder {
                LeagueRecorderScreen(website: website)
            } else if let selectedGame {
                ScorekeeperScreen(game: selectedGame, server: tool.server, cookies: website.cookies)
            } else {
                NavigationStack {
                    List {
                        Section("Games this week") {
                            ForEach(games.sorted { $0.date > $1.date }) { game in
                                Button { selectedGame = game } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("\(game.awayTeam) at \(game.homeTeam)").foregroundStyle(.primary)
                                        Text("\(game.dateLabel) · \(game.time)").font(.caption).foregroundStyle(.secondary)
                                    }.padding(.vertical, 4)
                                }
                            }
                        }
                    }
                    .overlay { if games.isEmpty { ContentUnavailableView("No games this week", systemImage: "calendar", description: Text("Choose another week on Scores and try again.")) } }
                    .navigationTitle("Scorekeeper").navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
                }
            }
        }
        .tint(.primary)
        .fullScreenCover(isPresented: $showDemo) {
            if tool == .scorekeeper { ScorekeeperScreen(model: NativeScorekeeper.sample()) }
            else { DemoRecorderScreen() }
        }
        // The flow owns an ephemeral session, discarded when the cover closes.
    }
    private func signIn() {
        guard !website.busy, !pin.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let submitted = pin; pin = ""
        if AppReviewAccess.matches(submitted) {
            website.signOut()
            website.error = nil
            showDemo = true
            return
        }
        Task { await website.signIn(pin: submitted) }
    }
}

struct LeagueRecorderScreen: View {
    @EnvironmentObject private var camera: CaptureController
    @ObservedObject var website: WebsiteConnection
    @Environment(\.dismiss) private var dismiss
    @AppStorage("captureSide") private var side = "left"
    @State private var showCamera = false
    @State private var showUploads = false
    @State private var replaceRequested = false
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Camera position", selection: $side) {
                        Text("Left").tag("left")
                        Text("Right").tag("right")
                    }.pickerStyle(.segmented).disabled(website.busy)
                } header: { Text("This phone") } footer: { Text("Facing the rink, choose this phone’s side of the mount.") }
                Section {
                    Picker("Quality", selection: $camera.quality) {
                        ForEach(RecordingQuality.allCases) { Text($0.title).tag($0) }
                    }.disabled(website.busy || camera.recording)
                }
                Section { Button { showUploads = true } label: { Label("Uploads", systemImage: "icloud.and.arrow.up") } }
                if let error = website.error { Section { Text(error).foregroundStyle(.red) } }
            }
            .safeAreaInset(edge: .bottom) {
                OpenCameraAction(busy: website.busy, disabled: website.busy || camera.recording) { connect() }
            }
            .navigationTitle("Record game").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() }.disabled(website.busy || camera.recording) } }
        }
        .sheet(isPresented: $showUploads) { UploadStatusSheet(library: camera.library) }
        .fullScreenCover(isPresented: $showCamera) {
            NativeCameraView(camera: camera, library: camera.library)
                .onAppear { NotificationRouter.setCameraOrientation(true) }
                .onDisappear { NotificationRouter.setCameraOrientation(false) }
                .interactiveDismissDisabled(camera.recording || camera.busy)
        }
        .task { await camera.library.recoverInterrupted(); await camera.library.uploadPending() }
        .alert("Camera settings don’t match", isPresented: Binding(get: { website.qualityMismatch != nil }, set: { if !$0 { website.qualityMismatch = nil } }), presenting: website.qualityMismatch) { mismatch in
            Button("Match other camera") { camera.quality = mismatch.quality; connect(replace: replaceRequested) }
            Button("Use my settings") { connect(replace: replaceRequested, allowMismatch: true) }
            Button("Cancel", role: .cancel) { website.qualityMismatch = nil }
        } message: { mismatch in Text("The \(mismatch.side) camera uses \(mismatch.quality.title). Matching settings gives more consistent replays.") }
        .confirmationDialog("Replace the \(side) camera?", isPresented: $website.cameraConflict, titleVisibility: .visible) {
            Button("Replace camera", role: .destructive) { connect(replace: true) }
        } message: { Text("Another phone is assigned to this side. Its unuploaded footage stays on that phone.") }
    }
    private func connect(replace: Bool = false, allowMismatch: Bool = false) {
        replaceRequested = replace
        Task {
            if await website.connect(side: side, camera: camera, replace: replace, allowQualityMismatch: allowMismatch) { showCamera = true }
        }
    }
}

struct OpenCameraAction: View {
    var busy = false
    var disabled = false
    let action: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Button(action: action) {
                HStack(spacing: 10) {
                    if busy { ProgressView() }
                    Label("Open camera", systemImage: "video.fill")
                }
                .font(.headline).frame(maxWidth: .infinity).frame(minHeight: 36)
            }
            .buttonStyle(.borderedProminent).controlSize(.large)
            .tint(LeagueStyle.orange)
            .disabled(disabled)
        }
        .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 12)
        .background(.bar)
    }
}
