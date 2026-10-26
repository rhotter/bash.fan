import SwiftUI
import UserNotifications

@MainActor final class NotificationRouter: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    static var cameraOrientation = false
    static func setCameraOrientation(_ enabled: Bool) {
        cameraOrientation = enabled
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            scene.windows.first?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
            var presented = scene.windows.first?.rootViewController?.presentedViewController
            while let controller = presented {
                controller.setNeedsUpdateOfSupportedInterfaceOrientations()
                presented = controller.presentedViewController
            }
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: enabled ? [.portrait, .landscapeLeft, .landscapeRight] : .portrait))
        }
    }
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        Self.cameraOrientation ? [.portrait, .landscapeLeft, .landscapeRight] : .portrait
    }
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        guard identifier == BackgroundUploads.identifier else { completionHandler(); return }
        _ = RecordingLibrary.shared
        BackgroundUploads.shared.attachCompletionHandler(completionHandler)
    }
    static let openGame = Notification.Name("BASHOpenGame")
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        GameAlerts.shared.registered(deviceToken)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        GameAlerts.shared.registrationFailed()
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        if let id = response.notification.request.content.userInfo["gameID"] as? String {
            await MainActor.run {
                UserDefaults.standard.set(id, forKey: "pendingGame")
                NotificationCenter.default.post(name: Self.openGame, object: id)
            }
        }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}

@main struct BASHApp: App {
    @UIApplicationDelegateAdaptor(NotificationRouter.self) var delegate
    @State private var store = LeagueStore()
    @StateObject private var camera = CaptureController()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            Group {
#if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--native-scorekeeper-preview") {
                    ScorekeeperScreen(model: NativeScorekeeper.sample(
                        period: ProcessInfo.processInfo.arguments.contains("--pregame") ? 0 : ProcessInfo.processInfo.arguments.contains("--period-end") ? 3 : 1,
                        gameOver: ProcessInfo.processInfo.arguments.contains("--game-over")
                    ))
                } else { LeagueRoot(store: store) }
#else
                LeagueRoot(store: store)
#endif
            }.environmentObject(camera)
                .task { await camera.library.recoverInterrupted() }
                .onChange(of: camera.recording) { _, recording in UIApplication.shared.isIdleTimerDisabled = recording }
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
                }
                .task(id: phase) {
                    guard phase == .active else { return }
                    while !Task.isCancelled {
                        await camera.library.uploadPending()
                        do { try await Task.sleep(for: .seconds(30)) } catch { break }
                    }
                }
        }
    }
}

// Warm orange from the website, with quiet neutral surfaces around the data.
enum LeagueStyle {
    static let orange = Color(red: 0.80, green: 0.49, blue: 0.13)
    static let background = Color(uiColor: .systemGroupedBackground)
    static let card = Color(uiColor: .secondarySystemGroupedBackground)
}

// Size the whole column for the largest rank, including after search filters rows.
private struct ListRank: View {
    let rank: Int
    let total: Int

    var body: some View {
        Text("\(max(9, total))")
            .hidden()
            .overlay(alignment: .leading) { Text("\(rank)") }
            .font(.caption.weight(.medium))
            .monospacedDigit()
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
            .frame(minWidth: 16, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(rank)")
    }
}

/// A shared native pull gesture with an explicitly retained loading inset.
struct RefreshScrollView<Content: View>: View {
    let action: @MainActor () async -> Void
    @ViewBuilder let content: () -> Content
    var body: some View {
        List {
            content().background(NativeRefreshControl(action: action))
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
        }
        .listStyle(.plain)
        .navigationLinkIndicatorVisibility(.hidden)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 0)
        .scrollBounceBehavior(.always, axes: .vertical)
    }
}

private struct NativeRefreshControl: UIViewRepresentable {
    let action: @MainActor () async -> Void
    func makeUIView(context: Context) -> Probe { Probe(action: action) }
    func updateUIView(_ view: Probe, context: Context) {
        view.action = action
        view.scheduleAttachment()
    }
    static func dismantleUIView(_ view: Probe, coordinator: ()) { view.detach() }

    final class Probe: UIView {
        var action: @MainActor () async -> Void
        private let control = UIRefreshControl()
        private let spinner = UIActivityIndicatorView(style: .medium)
        private var restingInset = UIEdgeInsets.zero
        private var restingY: CGFloat = 0
        private var offsetObservation: NSKeyValueObservation?
        private let refreshHeight: CGFloat = 60
        private weak var scroll: UIScrollView?
        private var task: Task<Void, Never>?
        init(action: @escaping @MainActor () async -> Void) {
            self.action = action
            super.init(frame: .zero)
            isUserInteractionEnabled = false
            control.tintColor = .clear
            spinner.color = .secondaryLabel
            spinner.accessibilityLabel = "Refreshing"
            spinner.accessibilityIdentifier = "refreshIndicator"
            spinner.isAccessibilityElement = true
            spinner.hidesWhenStopped = false
            spinner.alpha = 0
            control.addTarget(self, action: #selector(refresh), for: .valueChanged)
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func didMoveToWindow() { super.didMoveToWindow(); scheduleAttachment() }
        override func layoutSubviews() { super.layoutSubviews(); scheduleAttachment() }
        func scheduleAttachment() {
            DispatchQueue.main.async { [weak self] in self?.attach() }
        }
        private func attach() {
            guard window != nil else { return }
            var parent = superview
            while let view = parent {
                if let candidate = view as? UIScrollView {
                    if scroll !== candidate {
                        restingInset = candidate.contentInset
                        restingY = -candidate.adjustedContentInset.top
                        offsetObservation?.invalidate()
                        spinner.removeFromSuperview()
                        candidate.addSubview(spinner)
                        offsetObservation = candidate.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in
                            MainActor.assumeIsolated { self?.updateIndicator() }
                        }
                    }
                    scroll = candidate
                    if candidate.refreshControl !== control {
                        candidate.alwaysBounceVertical = true
                        candidate.refreshControl = control
                        candidate.accessibilityValue = "Ready"
                    }
                    updateIndicator()
                    return
                }
                parent = view.superview
            }
        }
        private func updateIndicator() {
            guard let scroll else { return }
            // Use the same fixed-size glyph throughout the pull and request.
            // Center it in the revealed space, relative to this list's inset.
            let pull = max(0, restingY - scroll.contentOffset.y)
            spinner.bounds = CGRect(x: 0, y: 0, width: 20, height: 20)
            spinner.center = CGPoint(x: scroll.bounds.width / 2,
                                     y: -restingInset.top - pull / 2)
            spinner.alpha = min(1, pull / 20)
            if pull > 0 { spinner.startAnimating() } else { spinner.stopAnimating() }
            scroll.bringSubviewToFront(spinner)
        }
        func detach() {
            offsetObservation?.invalidate()
            offsetObservation = nil
            task?.cancel()
            task = nil
            control.endRefreshing()
            spinner.stopAnimating()
            spinner.removeFromSuperview()
            scroll?.contentInset = restingInset
            if scroll?.refreshControl === control { scroll?.refreshControl = nil }
            scroll = nil
        }
        @objc private func refresh() {
            guard task == nil else { return }
            task = Task { @MainActor [weak self] in
                guard let self, let scroll else { return }
                scroll.accessibilityValue = "Refreshing"
                // SwiftUI resets the native refresh inset when the drag ends.
                // Pin our own inset after release and retain it for the request.
                while scroll.isDragging && !Task.isCancelled {
                    try? await Task.sleep(for: .milliseconds(16))
                }
                guard !Task.isCancelled else { return }
                control.endRefreshing()
                scroll.contentInset = restingInset
                scroll.contentInset.top += refreshHeight
                scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: restingY - refreshHeight), animated: true)
                await action()
                guard !Task.isCancelled else { return }
                let nearTop = scroll.contentOffset.y < restingY + 1
                UIView.animate(withDuration: 0.25) { [self] in
                    scroll.contentInset = restingInset
                    if nearTop { scroll.contentOffset.y = restingY }
                }
                scroll.accessibilityValue = "Ready"
                task = nil
            }
        }
    }
}

struct LeagueRoot: View {
    @Bindable var store: LeagueStore
    @Environment(\.scenePhase) private var phase
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .subheadline) private var weekLabelHeight = 20.0
    @State private var openedGame: Game?
    @State private var selectedWeek: String?
    @State private var selectedGame: Game?
    @State private var selectedTeam: Standing?

    var body: some View {
        TabView {
            NavigationStack { gamesScreen.navigationDestination(optional: $selectedGame) { GameScreen(game: $0, store: store) } }.tabItem { Label { Text("Scores") } icon: { Image(systemName: "rectangle.stack").environment(\.symbolVariants, .none) } }
            NavigationStack { standingsScreen.navigationDestination(optional: $selectedTeam) { TeamScreen(team: $0, store: store) } }.tabItem { Label { Text("Standings") } icon: { Image(systemName: "list.number").environment(\.symbolVariants, .none) } }
            NavigationStack { StatsScreen(store: store) }.tabItem { Label { Text("Stats") } icon: { Image(systemName: "chart.bar.xaxis").environment(\.symbolVariants, .none) } }
        }
        .environment(\.symbolVariants, .none)
        .tint(.primary)
        .task {
            // Retire legacy local reminders; live alerts are delivered by APNs.
            await store.setReminders(false)
            await GameAlerts.shared.refreshAuthorization()
            await store.refresh()
            openPendingGame()
        }
        .task(id: phase) {
            guard phase == .active else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
                await store.refresh()
            }
        }
        .onChange(of: store.selectedSeason) {
            store.snapshot = nil
            store.players = []
            selectedWeek = nil
            Task { await store.refresh() }
        }
        .onChange(of: phase) {
            if phase == .active { Task { await GameAlerts.shared.refreshAuthorization(); await store.refresh(); openPendingGame() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: NotificationRouter.openGame)) { _ in openPendingGame() }
        .sheet(item: $openedGame) { game in
            NavigationStack {
                GameScreen(game: game, store: store)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { openedGame = nil } } }
            }
        }
    }

    private func openPendingGame() {
        guard let id = UserDefaults.standard.string(forKey: "pendingGame") else { return }
        if let game = store.snapshot?.games.first(where: { $0.id == id }) {
            openedGame = game
            UserDefaults.standard.removeObject(forKey: "pendingGame")
        } else {
            Task {
                guard let game: Game = try? await LeagueAPI.fetch("/game/\(id)") else { return }
                openedGame = game
                UserDefaults.standard.removeObject(forKey: "pendingGame")
            }
        }
    }

    private var games: [Game] { store.snapshot?.games ?? [] }
    private var weeks: [GameWeek] { store.weeks }
    private var activeWeek: GameWeek? { weeks.first { $0.id == selectedWeek } ?? GameWeek.defaultWeek(in: weeks) }
    private var weekGames: [Game] { activeWeek?.games ?? [] }

    private var weekSlider: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(weeks) { week in
                        Button { selectedWeek = week.id } label: {
                            Text(week.label).font(.subheadline.weight(.semibold))
                                .fixedSize(horizontal: true, vertical: false)
                                .padding(.horizontal, 12).frame(minHeight: weekLabelHeight + 24)
                                .foregroundStyle(week.id == activeWeek?.id ? Color.white : Color.primary)
                                .background(week.id == activeWeek?.id ? LeagueStyle.orange : Color.clear, in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("week-\(week.id)")
                        .accessibilityLabel("Week of \(week.label)")
                        .accessibilityAddTraits(week.id == activeWeek?.id ? .isSelected : [])
                        .id(week.id)
                    }
                }.padding(.horizontal, 12).padding(.bottom, 10)
            }
            .frame(height: weekLabelHeight + 34)
            .scrollBounceBehavior(.basedOnSize, axes: .vertical)
            .onChange(of: activeWeek?.id, initial: true) {
                if let id = activeWeek?.id {
                    withAnimation(.easeInOut(duration: 0.2)) { proxy.scrollTo(id, anchor: .center) }
                }
            }
        }.accessibilityIdentifier("weekSlider")
    }

    private var gamesScreen: some View {
        VStack(spacing: 0) {
            LeagueHeader(title: "Scores", operatorGames: weekGames)
            VStack(spacing: 4) {
                SeasonHeaderRow(menu: SeasonMenu(store: store))
                if !weeks.isEmpty { weekSlider }
            }
            Group {
                if weeks.isEmpty {
                    scoresPage(nil)
                } else {
                    TabView(selection: Binding(get: { activeWeek?.id ?? "" }, set: { selectedWeek = $0 })) {
                        ForEach(weeks) { week in
                            scoresPage(week).tag(week.id)
                        }
                    }.tabViewStyle(.page(indexDisplayMode: .never))
                        .animation(.easeInOut(duration: 0.22), value: activeWeek?.id)
                }
            }
            .task(id: activeWeek?.id) {
                for game in weekGames.prefix(4) {
                    guard !Task.isCancelled else { return }
                    await GameScreen.prefetch(game)
                }
            }
            .onChange(of: weeks.map(\.id), initial: true) {
                if !weeks.contains(where: { $0.id == selectedWeek }) {
                    selectedWeek = GameWeek.defaultWeek(in: weeks)?.id
                }
            }
        }
        .background(LeagueStyle.background)
        .navigationTitle("Scores")
        .toolbar(.hidden, for: .navigationBar)
    }

    private func scoresPage(_ week: GameWeek?) -> some View {
        let weekGames = week?.games ?? []
        let dates = Array(Set(weekGames.map(\.date))).sorted()
        return RefreshScrollView(action: { await store.refresh() }) {
            LazyVStack(alignment: .leading, spacing: 14) {
                statusSection
                if store.snapshot == nil && store.error == nil {
                    LoadingPlaceholder(title: "Loading scores…", rows: 3, matchups: true)
                }
                ForEach(dates, id: \.self) { date in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text(weekGames.first(where: { $0.date == date })?.dateLabel ?? date).font(.headline)
                            Spacer()
                        }
                        VStack(spacing: 8) {
                            ForEach(weekGames.filter { $0.date == date }) { game in
                                Button { selectedGame = game } label: { GameRow(game: game) }
                                    .buttonStyle(.plain)
                                    .background(LeagueStyle.card, in: RoundedRectangle(cornerRadius: 16))
                            }
                        }
                    }.id(date)
                }
                if store.snapshot != nil && games.isEmpty && !store.loading {
                    ContentUnavailableView("No games yet", systemImage: "rectangle.stack", description: Text("The schedule will appear here when it is published."))
                }
            }.padding(.horizontal, 12).padding(.vertical, 10)

        }
        // The fixed headers sit outside the scroll view so they cannot cover
        // its native pull-to-refresh indicator or inherit its refresh action.
        .scrollBounceBehavior(.always, axes: .vertical)
        .accessibilityIdentifier("scoresList")
    }

    @ViewBuilder private var statusSection: some View {
        if let error = store.error { Text(error).font(.footnote).foregroundStyle(.secondary) }
        if store.cached { Label("Saved scores · may be out of date", systemImage: "wifi.slash").font(.caption).foregroundStyle(.secondary) }
    }

    private var standingsScreen: some View {
        RefreshScrollView(action: { await store.refresh() }) {
            VStack(alignment: .leading, spacing: 18) {
                statusSection
                if store.snapshot == nil && store.error == nil {
                    LoadingPlaceholder(title: "Loading standings…", rows: 6)
                } else {
                VStack(spacing: 0) {
                    if !typeSize.isAccessibilitySize {
                        HStack(spacing: 10) {
                            Text("Team"); Spacer(); statColumn("PTS")
                        }.font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            .padding(.horizontal, 12).padding(.vertical, 12)
                        Divider()
                    }
                    ForEach(Array((store.snapshot?.standings ?? []).enumerated()), id: \.element.id) { rank, team in
                        Button { selectedTeam = team } label: {
                            if typeSize.isAccessibilitySize {
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack {
                                        Text("Rank \(rank + 1)").font(.caption).foregroundStyle(.secondary)
                                        Spacer()
                                        TeamLogo(slug: team.slug, size: 30)
                                    }
                                    Text(team.team).font(.headline)
                                    Text("\(team.pts) points").font(.subheadline.weight(.semibold))
                                    Text("\(team.gp) games played").font(.caption)
                                    Text("\(team.w) W · \(team.otw) OTW · \(team.otl) OTL · \(team.l) L").font(.caption)
                                    Text("Goal difference: \(team.gd > 0 ? "+" : "")\(team.gd)").font(.caption)
                                }
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .foregroundStyle(.primary)
                                .padding(12)
                            } else {
                                HStack(spacing: 10) {
                                    Text("\(rank + 1)")
                                        .font(.caption.weight(.medium))
                                        .foregroundStyle(.secondary)
                                        .frame(minWidth: 16, alignment: .leading)
                                    TeamLogo(slug: team.slug, size: 30)
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(team.team).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                                        Text("\(team.gp) GP · \(team.w)–\(team.otw)–\(team.otl)–\(team.l) · \(team.gd > 0 ? "+" : "")\(team.gd) DIF")
                                            .font(.caption2).foregroundStyle(.secondary)
                                            .lineLimit(1)
                                            .minimumScaleFactor(0.85)
                                            .accessibilityLabel("\(team.gp) games played, \(team.w) wins, \(team.otw) overtime wins, \(team.otl) overtime losses, \(team.l) losses, goal difference \(team.gd)")
                                    }
                                    Spacer(minLength: 8)
                                    statColumn("\(team.pts)").fontWeight(.semibold).foregroundStyle(.primary)
                                }.font(.subheadline).monospacedDigit().padding(.horizontal, 12).padding(.vertical, 10)
                            }
                        }.buttonStyle(.plain)
                        if rank < (store.snapshot?.standings.count ?? 0) - 1 { Divider() }
                    }
                }.background(LeagueStyle.card, in: RoundedRectangle(cornerRadius: 18))
                Text("Record: W–OTW–OTL–L\nWin 3 pts · OT win 2 · OT loss 1").font(.caption).foregroundStyle(.secondary)
                }
            }.padding(.horizontal, 12).padding(.vertical, 12)
        }.accessibilityIdentifier("standingsList")
            .background(LeagueStyle.background).leagueHeader("Standings", season: SeasonMenu(store: store))
    }

    private func statColumn(_ value: String) -> some View { Text(value).frame(width: 29, alignment: .trailing) }


}

private extension View {
    func navigationDestination<Item, Destination: View>(optional item: Binding<Item?>, @ViewBuilder destination: @escaping (Item) -> Destination) -> some View {
        navigationDestination(isPresented: Binding(get: { item.wrappedValue != nil }, set: { if !$0 { item.wrappedValue = nil } })) {
            if let value = item.wrappedValue { destination(value) }
        }
    }

    func leagueHeader(_ title: String, season: SeasonMenu, operatorGames: [Game]? = nil, searchAction: (() -> Void)? = nil, searching: Bool = false) -> some View {
        VStack(spacing: 0) {
            LeagueHeader(title: title, operatorGames: operatorGames, searchAction: searchAction, searching: searching)
            SeasonHeaderRow(menu: season)
            self
        }
        .navigationTitle(title)
        .toolbar(.hidden, for: .navigationBar)
    }
}

private struct SeasonHeaderRow: View {
    let menu: SeasonMenu

    var body: some View {
        HStack { menu; Spacer() }
            .frame(minHeight: 44)
            .padding(.horizontal, 12)
            .background(LeagueStyle.background)
    }
}

private struct LeagueHeader: View {
    let title: String
    var operatorGames: [Game]?
    var searchAction: (() -> Void)?
    var searching = false

    var body: some View {
        HStack(spacing: 8) {
            Color.clear.frame(width: 44, height: 44).accessibilityHidden(true)
            Text(title)
            .font(.headline)
            .foregroundStyle(.primary)
            .fixedSize(horizontal: false, vertical: true)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            ZStack {
                Color.clear.frame(width: 44, height: 44).accessibilityHidden(true)
                if let operatorGames { OperatorMenu(games: operatorGames) }
                if let searchAction {
                    Button(action: searchAction) {
                        Image(systemName: searching ? "xmark" : "magnifyingglass")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(.primary)
                            .frame(width: 44, height: 44)
                            .background(.quaternary, in: Circle())
                            .overlay(Circle().strokeBorder(.primary.opacity(0.1), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(searching ? "Close search" : "Search players")
                    .accessibilityIdentifier("statsSearchButton")
                }
            }
        }
            .frame(minHeight: 44)
            .padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 12)
        .background(LeagueStyle.background)
    }
}

struct TeamLogo: View {
    @Environment(\.colorScheme) private var colorScheme
    let slug: String?
    var size: CGFloat = 36
    private var asset: String? {
        guard let slug = slug?.lowercased() else { return nil }
        let keys = ["bashers", "bash", "dangleberries", "landsharks", "loons", "regretzkys", "reign", "rinkrats", "rink-rats", "seals", "yetis", "last-licks", "licks", "coxswain-bawls-hockey-club", "team-usa", "team-canada", "dolo-minions", "lazy-skater-dangle", "money-shots", "mitch-a-palooza"]
        guard let key = keys.first(where: { slug.contains($0) }) else { return nil }
        // Alternate team slugs share one bundled logo.
        return ["rink-rats": "rinkrats", "licks": "last-licks"][key] ?? key
    }
    var body: some View {
        Group {
            if let asset {
                Image(asset).resizable().scaledToFit()
                    .background {
                        if asset == "yetis" {
                            // Fill only the interior of the ring in the original 1024px artwork.
                            GeometryReader { geometry in
                                Circle().fill(.white)
                                    .frame(width: geometry.size.width * 0.55, height: geometry.size.height * 0.55)
                                    .position(x: geometry.size.width * 0.492, y: geometry.size.height * 0.501)
                            }
                        }
                    }
            }
            else { Image(systemName: "shield").resizable().scaledToFit().foregroundStyle(colorScheme == .dark ? Color.gray : Color.secondary).padding(5) }
        }
        // Trace the artwork's alpha silhouette, not the gradient circle.
        .compositingGroup()
        .shadow(color: .white, radius: 0, x: -1.1, y: 0)
        .shadow(color: .white, radius: 0, x: 1.1, y: 0)
        .shadow(color: .white, radius: 0, x: 0, y: -1.1)
        .shadow(color: .white, radius: 0, x: 0, y: 1.1)
        .padding(size * 0.10)
        .frame(width: size, height: size)
        .background {
            TeamCircleBackground(slug: slug)
        }
        .accessibilityHidden(true)
    }
}

struct GameRow: View {
    let game: Game
    @Environment(\.dynamicTypeSize) private var typeSize
    private var status: String {
        game.status == "final" ? (game.isOvertime ? "Final · OT" : "Final") : game.status == "live" ? "Live" : game.time
    }
    var body: some View {
        VStack(spacing: 10) {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 16) {
                    Text(status).font(.caption.weight(.semibold))
                        .foregroundStyle(game.status == "live" ? LeagueStyle.orange : .secondary)
                    accessibleSide(game.awayTeam, slug: game.awaySlug, score: game.awayScore)
                    accessibleSide(game.homeTeam, slug: game.homeSlug, score: game.homeScore)
                }.frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(alignment: .center, spacing: 6) {
                    side(game.awayTeam, slug: game.awaySlug)
                    VStack(spacing: 5) {
                        Text(status).font(.caption.weight(.semibold))
                            .foregroundStyle(game.status == "live" ? LeagueStyle.orange : .secondary)
                        if game.status == "upcoming" {
                            Text("vs").font(.title3.weight(.medium)).foregroundStyle(.tertiary)
                        } else {
                            HStack(spacing: 10) {
                                Text(game.awayScore.map(String.init) ?? "–")
                                    .foregroundStyle((game.awayScore ?? 0) >= (game.homeScore ?? 0) ? Color.primary : Color.secondary)
                                Text("–").foregroundStyle(.tertiary).font(.title3)
                                Text(game.homeScore.map(String.init) ?? "–")
                                    .foregroundStyle((game.homeScore ?? 0) >= (game.awayScore ?? 0) ? Color.primary : Color.secondary)
                            }.font(.system(.largeTitle, design: .rounded, weight: .bold)).monospacedDigit()
                        }
                    }.frame(minWidth: 100).layoutPriority(1)
                    side(game.homeTeam, slug: game.homeSlug)
                }
            }
            if game.isPlayoff { Text("Playoffs").font(.caption2).foregroundStyle(.secondary) }
        }
        .padding(.horizontal, 12).padding(.vertical, 14)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("game-\(game.id)")
        .accessibilityLabel("\(game.awayTeam), \(game.awayScore.map(String.init) ?? "no score"), at \(game.homeTeam), \(game.homeScore.map(String.init) ?? "no score"), \(status)")
    }
    private func accessibleSide(_ name: String, slug: String?, score: Int?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                TeamLogo(slug: slug, size: 30)
                if game.status != "upcoming" {
                    Text(score.map(String.init) ?? "–").font(.title2.bold()).monospacedDigit()
                }
            }
            Text(name).font(.subheadline.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
        }.foregroundStyle(.primary)
    }
    private func side(_ name: String, slug: String?) -> some View {
        VStack(spacing: 6) {
            TeamLogo(slug: slug, size: 42)
            Text(name).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                .multilineTextAlignment(.center).lineLimit(typeSize.isAccessibilitySize ? nil : 2)
        }.frame(maxWidth: .infinity)
    }
}

struct TeamScreen: View {
    let team: Standing
    @Bindable var store: LeagueStore
    private var currentTeam: Standing { store.snapshot?.standings.first { $0.id == team.id } ?? team }
    var body: some View {
        let team = currentTeam
        List {
            Section {
                HStack(spacing: 16) {
                    TeamLogo(slug: team.slug, size: 64)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(team.team).font(.title2.bold())
                        Text("\(team.pts) points · \(team.gp) games").foregroundStyle(.secondary)
                        Text("\(team.w) W · \(team.otw) OTW · \(team.l) L · \(team.otl) OTL")
                            .font(.caption).foregroundStyle(.secondary)
                            .accessibilityLabel("\(team.w) wins, \(team.otw) overtime wins, \(team.l) losses, \(team.otl) overtime losses")
                    }
                }.padding(.vertical, 8)
            }
            Section("Games") {
                ForEach((store.snapshot?.games ?? []).filter { $0.homeSlug == team.slug || $0.awaySlug == team.slug }) { game in
                    NavigationLink { GameScreen(game: game, store: store) } label: {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(game.dateLabel).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                .padding(.horizontal, 12).padding(.top, 12)
                                .accessibilityIdentifier("team-game-date-\(game.id)")
                            GameRow(game: game)
                        }
                    }
                        .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 16))
                        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                        .alignmentGuide(.listRowSeparatorTrailing) { dimensions in dimensions.width + 16 }
                }
            }
        }.navigationTitle(team.team).navigationBarTitleDisplayMode(.inline).toolbar(.visible, for: .navigationBar)
            .refreshable { await store.refresh() }
    }
}

/// UIKit's standard search field keeps native appearance, clear button, and editing behavior.
private struct NativePlayerSearch: UIViewRepresentable {
    @Binding var text: String
    var autofocus = false
    func makeCoordinator() -> Coordinator { Coordinator(text: $text) }
    func makeUIView(context: Context) -> UISearchBar {
        let bar = UISearchBar()
        bar.searchBarStyle = .minimal
        bar.placeholder = "Search players"
        bar.autocorrectionType = .no
        bar.delegate = context.coordinator
        bar.searchTextField.accessibilityIdentifier = "playerSearch"
        bar.searchTextField.returnKeyType = .done
        if autofocus { DispatchQueue.main.async { bar.becomeFirstResponder() } }
        return bar
    }
    func updateUIView(_ bar: UISearchBar, context: Context) {
        context.coordinator.text = $text
        if bar.text != text { bar.text = text }
    }
    final class Coordinator: NSObject, UISearchBarDelegate {
        var text: Binding<String>
        init(text: Binding<String>) { self.text = text }
        func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) { text.wrappedValue = searchText }
        func searchBarSearchButtonClicked(_ searchBar: UISearchBar) { searchBar.resignFirstResponder() }
    }
}

private struct SeasonMenu: View {
    @Bindable var store: LeagueStore
    var allowsAllTime = false
    @Binding var allTime: Bool
    init(store: LeagueStore, allowsAllTime: Bool = false, allTime: Binding<Bool> = .constant(false)) {
        self.store = store; self.allowsAllTime = allowsAllTime; self._allTime = allTime
    }
    private var seasonName: String {
        allTime ? "All time" : (store.seasons.first(where: { store.selectedSeason.isEmpty ? $0.isCurrent : $0.id == store.selectedSeason })?.name ?? "Current season")
    }

    var body: some View {
        Menu {
            Picker("Season", selection: Binding(get: { allTime ? "all" : store.selectedSeason }, set: { value in
                allTime = value == "all"
                if value != "all" { store.selectedSeason = value }
            })) {
                if allowsAllTime { Text("All time").tag("all") }
                Text("Current season").tag("")
                ForEach(store.seasons) { Text($0.name).tag($0.id) }
            }
        } label: {
            HStack(spacing: 6) {
                Text(seasonName).font(.subheadline.weight(.medium))
                    .fixedSize(horizontal: false, vertical: true)
                Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold))
                    .fixedSize()
            }.foregroundStyle(Color.primary).padding(.vertical, 10)
        }.tint(.primary).accessibilityLabel("Season: \(seasonName)")
            .accessibilityIdentifier("seasonPicker")
    }

}

private struct StatsScreen: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var selectedPlayer: Skater?
    @Bindable var store: LeagueStore
    @State private var search = ""
    @State private var searching = false
    @State private var allTime = false
    @State private var showGoalies = false
    @State private var goalieMetric: GoalieMetric = .savePercentage
    @State private var allTimeGoalies: [Goalie] = []
    private var statsGoalies: [Goalie] { allTime ? allTimeGoalies : store.goalies }
    @State private var allTimePlayers: [Skater] = []
    @State private var allTimeLoading = false
    @State private var allTimeError: String?
    private var statsPlayers: [Skater] { allTime ? allTimePlayers : store.players }
    private var statsLoading: Bool { allTime ? allTimeLoading : store.loading }
    private var statsError: String? { allTime ? allTimeError : store.playerError }
    @MainActor private func loadAllTime(force: Bool = false) async {
        guard allTime else { return }
        allTimeLoading = true
        allTimeError = nil
        allTimePlayers = []
        allTimeGoalies = []
        do {
            let result: PlayerSnapshot = try await LeagueAPI.fetch("/players", season: "all", maxAge: force ? 0 : 120)
            try Task.checkCancellation()
            allTimePlayers = result.skaters
            allTimeGoalies = result.goalies
            allTimeLoading = false
        } catch {
            guard !Task.isCancelled else { return }
            allTimeError = "Couldn't load all-time stats. Pull down to retry."
            allTimeLoading = false
        }
    }
    @State private var statMetric: StatMetric = .points
    @State private var selectedTeam = ""
    private var teamNames: [String] { Array(Set(showGoalies ? statsGoalies.map { $0.team ?? "" } : statsPlayers.map(\.team))).filter { !$0.isEmpty }.sorted() }
    @State private var rankedPlayers: [Skater] = []
    private func updateRanking() {
        if showGoalies {
            rankedPlayers = goalieMetric.sorted(statsGoalies.filter { allTime || selectedTeam.isEmpty || $0.team == selectedTeam }).map(\.player)
        } else {
            rankedPlayers = statMetric.sorted(statsPlayers.filter { allTime || selectedTeam.isEmpty || $0.team == selectedTeam })
        }
    }
    private var visiblePlayers: [(offset: Int, element: Skater)] {
        Array(rankedPlayers.enumerated()).filter { $0.element.matchesPlayerSearch(search) }
    }

    private var filterLayout: AnyLayout {
        typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16)) : AnyLayout(HStackLayout())
    }

    private func rowSummary(_ player: Skater) -> String {
        if showGoalies, let goalie = statsGoalies.first(where: { $0.id == player.id }) {
            return "\(goalie.gp) GP · \(goalie.wins) W · \(GoalieMetric.gaa.display(goalie)) GAA · \(GoalieMetric.savePercentage.display(goalie)) SV%"
        }
        return "\(player.goals) Goals · \(player.assists) Assists · \(player.points) Points"
    }
    private func rowValue(_ player: Skater) -> String {
        if showGoalies, let goalie = statsGoalies.first(where: { $0.id == player.id }) { return goalieMetric.display(goalie) }
        return statMetric.display(player)
    }

    var body: some View {
        let rows = visiblePlayers
        RefreshScrollView(action: { if allTime { await loadAllTime(force: true) } else { await store.refresh() } }) {
            // This content is a single List row. Lazy stacks change its measured
            // height while scrolling, which can shift the list past the search bar.
            VStack(alignment: .leading, spacing: 12) {
                Picker("Player type", selection: $showGoalies) {
                    Text("Skaters").tag(false)
                    Text("Goalies").tag(true)
                }.pickerStyle(.segmented).accessibilityIdentifier("statsPlayerType")
                if allTime {
                    Text("Fall regular seasons only")
                        .font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 12)
                        .accessibilityIdentifier("allTimeScope")
                }
                if searching { NativePlayerSearch(text: $search, autofocus: true).frame(height: 44) }
                if let error = statsError { Text(error).font(.footnote).foregroundStyle(.secondary) }
                filterLayout {
                    if !allTime { Menu {
                        Picker("Team", selection: $selectedTeam) {
                            Text("All teams").tag("")
                            ForEach(teamNames, id: \.self) { Text($0).tag($0) }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text(selectedTeam.isEmpty ? "All teams" : selectedTeam)
                                .fixedSize(horizontal: false, vertical: true)
                                .multilineTextAlignment(.leading)
                            Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold)).fixedSize()
                        }.font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                    }.tint(.primary).accessibilityLabel("Team: \(selectedTeam.isEmpty ? "All teams" : selectedTeam)")
                        .accessibilityIdentifier("teamFilter")
                    }
                    if !typeSize.isAccessibilitySize { Spacer() }
                    Menu {
                        if showGoalies {
                            Picker("Sort by", selection: $goalieMetric) {
                                ForEach(GoalieMetric.allCases) { Text($0.rawValue).tag($0) }
                            }
                        } else {
                            Picker("Sort by", selection: $statMetric) {
                                ForEach(StatMetric.allCases) { Text($0.rawValue).tag($0) }
                            }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text(showGoalies ? goalieMetric.rawValue : statMetric.rawValue)
                                .fixedSize(horizontal: false, vertical: true)
                                .multilineTextAlignment(.leading)
                            Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold)).fixedSize()
                        }.font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                    }.tint(.primary).accessibilityLabel("Sort by: \(showGoalies ? goalieMetric.rawValue : statMetric.rawValue)")
                        .accessibilityIdentifier("statSort")
                }.padding(.horizontal, 12).frame(minHeight: 44)
                VStack(spacing: 0) {
                    ForEach(rows, id: \.element.id) { rank, player in
                        Button { selectedPlayer = player } label: {
                            if typeSize.isAccessibilitySize {
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack {
                                        Text("Rank \(rank + 1)").font(.caption).foregroundStyle(.secondary)
                                        Spacer()
                                        TeamLogo(slug: player.teamSlug, size: 30)
                                    }
                                    Text(player.name).font(.subheadline.weight(.semibold))
                                    Text("\(showGoalies ? goalieMetric.rawValue : statMetric.rawValue): \(rowValue(player))")
                                        .font(.subheadline.weight(.semibold)).monospacedDigit()
                                    Text(rowSummary(player)).font(.caption).foregroundStyle(.secondary)
                                }
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .foregroundStyle(.primary).padding(12).contentShape(Rectangle())
                            } else {
                                HStack(spacing: 10) {
                                    ListRank(rank: rank + 1, total: rankedPlayers.count)
                                    TeamLogo(slug: player.teamSlug, size: 30)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(player.name).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                                        Text(rowSummary(player))
                                            .font(.caption).foregroundStyle(.secondary)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
                                    Spacer(minLength: 8)
                                    Text(rowValue(player)).font(.subheadline.weight(.semibold))
                                        .foregroundStyle(.primary).monospacedDigit()
                                }.padding(.horizontal, 12).padding(.vertical, 10)
                                    .contentShape(Rectangle())
                            }
                        }.buttonStyle(.plain).accessibilityIdentifier("player-\(player.id)")
                        if player.id != rows.last?.element.id { Divider() }
                    }
                }.background(LeagueStyle.card, in: RoundedRectangle(cornerRadius: 18))
                if rankedPlayers.isEmpty && statsLoading && statsError == nil { LoadingPlaceholder(title: "Loading stats…", rows: 6) }
                if rows.isEmpty && !statsLoading && statsError == nil {
                    ContentUnavailableView("No matching players", systemImage: "magnifyingglass", description: Text("Try a different player name or change the team filter."))
                }
            }.padding(.horizontal, 12).padding(.vertical, 12)
        }.accessibilityIdentifier("statsList")
            .background(LeagueStyle.background).leagueHeader("Stats", season: SeasonMenu(store: store, allowsAllTime: true, allTime: $allTime), searchAction: {
                searching.toggle()
                if !searching { search = "" }
            }, searching: searching)
            .scrollDismissesKeyboard(.interactively)
            .navigationDestination(optional: $selectedPlayer) { PlayerScreen(player: $0, store: store, prefersGoalieStats: showGoalies) }
            .task(id: allTime) { await loadAllTime() }
            .onChange(of: allTime) { selectedTeam = ""; updateRanking() }
            .task(id: Array(rankedPlayers.prefix(4).map(\.id))) {
                // Warm a small visible set, not the entire league roster.
                for player in rankedPlayers.prefix(4) {
                    guard !Task.isCancelled else { return }
                    _ = try? await PlayerCareerCache.shared.load(slug: player.slug)
                }
            }
            .onChange(of: statsPlayers, initial: true) { updateRanking() }
            .onChange(of: statsGoalies) { updateRanking() }
            .onChange(of: showGoalies) { selectedTeam = ""; updateRanking() }
            .onChange(of: goalieMetric) { updateRanking() }
            .onChange(of: statMetric) { updateRanking() }
            .onChange(of: selectedTeam) { updateRanking() }
            .onChange(of: store.selectedSeason) { selectedTeam = "" }
    }

}
