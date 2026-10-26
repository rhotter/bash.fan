import SwiftUI
import WebKit

private enum OperatorTool: String, Identifiable {
    case scorekeeper, recorder
    var id: String { rawValue }
    var title: String { self == .scorekeeper ? "Keep score" : "Record game" }
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
    @State private var tool: OperatorTool?
    var body: some View {
        Menu {
            Button { tool = .scorekeeper } label: { Label("Keep score", systemImage: "pencil.and.list.clipboard") }
            Button { tool = .recorder } label: { Label("Record game", systemImage: "video") }
            if let game { ShareLink(item: game.url) { Label("Share game", systemImage: "square.and.arrow.up") } }
        } label: {
            Image(systemName: "ellipsis").frame(minWidth: 32, minHeight: 32)
        }
        .accessibilityLabel("Game tools")
        .accessibilityIdentifier("operatorMenu")
        .fullScreenCover(item: $tool) { tool in
            OperatorFlow(tool: tool, games: games, game: game)
        }
    }
}

private struct OperatorFlow: View {
    let tool: OperatorTool
    let games: [Game]
    @State private var selectedGame: Game?
    @StateObject private var website: WebsiteConnection
    @State private var pin = ""
    @Environment(\.dismiss) private var dismiss
    init(tool: OperatorTool, games: [Game], game: Game?) {
        self.tool = tool; self.games = games
        _selectedGame = State(initialValue: game)
        _website = StateObject(wrappedValue: WebsiteConnection(server: tool.server, requiresAdmin: true))
    }
    var body: some View {
        Group {
            if !website.signedIn {
                NavigationStack {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 24) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Admin access").font(.title2.bold())
                                Text("Enter the league’s admin passcode to \(tool == .scorekeeper ? "keep score" : "record a game").")
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                            VStack(alignment: .leading, spacing: 10) {
                                Text("Passcode").font(.subheadline.weight(.medium))
                                SecureField("Admin passcode", text: $pin)
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
                                        if website.busy { ProgressView().tint(.black) }
                                        Text(website.busy ? "Checking passcode…" : "Continue")
                                    }
                                    .font(.headline).frame(maxWidth: .infinity).frame(minHeight: 36)
                                }
                                .buttonStyle(.borderedProminent).controlSize(.large)
                                .tint(LeagueStyle.orange).foregroundStyle(.black)
                                .disabled(pin.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || website.busy)
                                Text("Your passcode isn’t saved.").font(.footnote).foregroundStyle(.secondary)
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
                    .navigationTitle("Keep score").navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
                }
            }
        }
        .tint(.primary)
        // The flow owns an ephemeral session, discarded when the cover closes.
    }
    private func signIn() {
        guard !website.busy, !pin.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let submitted = pin; pin = ""
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
                Section {
                    Button { connect() } label: {
                        HStack {
                            Label("Open camera", systemImage: "video.fill").fontWeight(.semibold)
                            Spacer()
                            if website.busy { ProgressView() }
                        }.padding(.vertical, 4)
                    }.disabled(website.busy || camera.recording)
                } footer: {
                    Text("Record continuously across games. Uploads resume automatically.")
                }
                Section { Button { showUploads = true } label: { Label("Uploads", systemImage: "icloud.and.arrow.up") } }
                if let error = website.error { Section { Text(error).foregroundStyle(.red) } }
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

@MainActor private final class ScorekeeperBrowser: NSObject, ObservableObject, WKNavigationDelegate {
    let webView: WKWebView
    let url: URL
    let cookies: [HTTPCookie]
    @Published var loading = true
    @Published var error: String?
    init(server: URL, gameID: String, cookies: [HTTPCookie]) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        // Keep the existing scorekeeper controls, without a second site shell.
        // This is presentation-only; authentication and writes remain server-side.
        configuration.userContentController.addUserScript(WKUserScript(source: """
            const style = document.createElement('style');
            style.textContent = `
              body > header, body > footer, a[href^="/game/"] { display: none !important; }
              @media (prefers-color-scheme: dark) {
                :root, .dark {
                  --background: #000 !important; --foreground: #f5f5f7 !important;
                  --card: #1c1c1e !important; --card-foreground: #f5f5f7 !important;
                  --popover: #242426 !important; --popover-foreground: #f5f5f7 !important;
                  --secondary: #242426 !important; --secondary-foreground: #f5f5f7 !important;
                  --muted: #242426 !important; --muted-foreground: #a1a1a6 !important;
                  --accent: #2c2c2e !important; --accent-foreground: #f5f5f7 !important;
                  --border: #38383a !important; --input: #38383a !important;
                }
              }
            `;
            document.head.appendChild(style);
            """, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: configuration)
        url = server.appending(path: "scorekeeper/\(gameID)")
        self.cookies = cookies
        super.init()
        webView.navigationDelegate = self
        webView.isOpaque = false
    }
    func load() async {
        loading = true; error = nil
        for cookie in cookies { await webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) }
        webView.load(URLRequest(url: url))
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loading = false }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.isForMainFrame, let response = navigationResponse.response as? HTTPURLResponse, response.statusCode >= 400 {
            loading = false
            error = "The scorekeeper is unavailable for this game. Try again shortly."
            decisionHandler(.cancel)
        } else { decisionHandler(.allow) }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }
    private func failed(_ error: Error) { loading = false; self.error = "Couldn’t load the scorekeeper. Check your connection and retry." }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let destination = navigationAction.request.url,
              destination.scheme == url.scheme, destination.host == url.host,
              destination.path == url.path else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
}

private struct ScorekeeperWebView: UIViewRepresentable {
    let browser: ScorekeeperBrowser
    func makeUIView(context: Context) -> WKWebView { browser.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

private struct ScorekeeperScreen: View {
    let game: Game
    @StateObject private var browser: ScorekeeperBrowser
    @State private var confirmClose = false
    @Environment(\.dismiss) private var dismiss
    init(game: Game, server: URL, cookies: [HTTPCookie]) {
        self.game = game
        _browser = StateObject(wrappedValue: ScorekeeperBrowser(server: server, gameID: game.id, cookies: cookies))
    }
    var body: some View {
        NavigationStack {
            ZStack {
                ScorekeeperWebView(browser: browser)
                if browser.loading { ProgressView("Loading scorekeeper…").padding(24).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16)) }
                if let error = browser.error {
                    ContentUnavailableView { Label("Scorekeeper unavailable", systemImage: "wifi.exclamationmark") } description: { Text(error) } actions: { Button("Retry") { Task { await browser.load() } } }
                        .background(Color(uiColor: .systemBackground))
                }
            }
            .navigationTitle("Keep score").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { confirmClose = true } } }
        }
        .task { await browser.load() }
        .confirmationDialog("Leave scorekeeper?", isPresented: $confirmClose, titleVisibility: .visible) {
            Button("Leave scorekeeper") { dismiss() }
        } message: { Text("Finish any edits and check that they’ve saved before leaving.") }
    }
}
