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
            LeagueRoot(store: store).environmentObject(camera)
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
private enum LeagueStyle {
    static let orange = Color(red: 0.80, green: 0.49, blue: 0.13)
    static let background = Color(uiColor: .systemGroupedBackground)
    static let card = Color(uiColor: .secondarySystemGroupedBackground)
}

struct LeagueRoot: View {
    @Bindable var store: LeagueStore
    @Environment(\.scenePhase) private var phase
    @State private var openedGame: Game?
    @State private var selectedWeek: String?

    var body: some View {
        TabView {
            NavigationStack { gamesScreen }.tabItem { Label { Text("Scores") } icon: { Image(systemName: "rectangle.stack").environment(\.symbolVariants, .none) } }
            NavigationStack { standingsScreen }.tabItem { Label { Text("Standings") } icon: { Image(systemName: "list.number").environment(\.symbolVariants, .none) } }
            NavigationStack { StatsScreen(store: store) }.tabItem { Label { Text("Stats") } icon: { Image(systemName: "chart.bar.xaxis").environment(\.symbolVariants, .none) } }
        }
        .environment(\.symbolVariants, .none)
        .tint(.primary)
        .task {
            // Following is deferred. Clear previously scheduled reminders while
            // there is no visible preference control to manage them.
            await store.setReminders(false)
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
            if phase == .active { Task { await store.refresh(); openPendingGame() } }
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
        guard let id = UserDefaults.standard.string(forKey: "pendingGame"),
              let game = store.snapshot?.games.first(where: { $0.id == id }) else { return }
        openedGame = game
        UserDefaults.standard.removeObject(forKey: "pendingGame")
    }

    private var seasonPicker: some View { SeasonMenu(store: store) }

    private var games: [Game] { store.snapshot?.games ?? [] }
    private var weeks: [GameWeek] { store.weeks }
    private var activeWeek: GameWeek? { weeks.first { $0.id == selectedWeek } ?? GameWeek.defaultWeek(in: weeks) }
    private var weekGames: [Game] { activeWeek?.games ?? [] }
    private var dates: [String] { Array(Set(weekGames.map(\.date))).sorted() }

    private var weekSlider: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(weeks) { week in
                        Button { selectedWeek = week.id } label: {
                            Text(week.label).font(.subheadline.weight(.semibold))
                                .padding(.horizontal, 12).frame(minHeight: 44)
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
            .frame(height: 54)
            .scrollBounceBehavior(.basedOnSize, axes: .vertical)
            .onChange(of: activeWeek?.id, initial: true) {
                if let id = activeWeek?.id {
                    withAnimation(.easeInOut(duration: 0.2)) { proxy.scrollTo(id, anchor: .center) }
                }
            }
        }.accessibilityIdentifier("weekSlider")
    }

    private var gamesScreen: some View {
        Group {
            ScrollView {
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
                                    NavigationLink { GameScreen(game: game, store: store) } label: { GameRow(game: game) }
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
                    .id(activeWeek?.id)
            }
            // Scope pull-to-refresh to the list, excluding the week strip.
            .refreshable { await store.refresh() }
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(spacing: 4) {
                    HStack { seasonPicker; Spacer() }
                        .padding(.horizontal, 12)
                    if !weeks.isEmpty { weekSlider }
                }.background(LeagueStyle.background)
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
        .leagueHeader("Scores", operatorGames: weekGames)
    }

    @ViewBuilder private var statusSection: some View {
        if let error = store.error { Text(error).font(.footnote).foregroundStyle(.secondary) }
        if store.cached { Label("Saved scores · may be out of date", systemImage: "wifi.slash").font(.caption).foregroundStyle(.secondary) }
    }

    private var standingsScreen: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack { seasonPicker; Spacer() }
                statusSection
                if store.snapshot == nil && store.error == nil {
                    LoadingPlaceholder(title: "Loading standings…", rows: 6)
                } else {
                VStack(spacing: 0) {
                    HStack(spacing: 10) {
                        Text("Team"); Spacer(); statColumn("GP"); statColumn("DIF"); statColumn("PTS")
                    }.font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        .padding(.horizontal, 12).padding(.vertical, 12)
                    Divider()
                    ForEach(Array((store.snapshot?.standings ?? []).enumerated()), id: \.element.id) { rank, team in
                        NavigationLink { TeamScreen(team: team, store: store) } label: {
                            HStack(spacing: 10) {
                                Text("\(rank + 1)").font(.caption.weight(.medium)).foregroundStyle(.secondary).frame(width: 20)
                                TeamLogo(slug: team.slug, size: 30)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(team.team).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                                    Text("\(team.w) W · \(team.otw) OTW · \(team.otl) OTL · \(team.l) L")
                                        .font(.caption2).foregroundStyle(.secondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                        .accessibilityLabel("\(team.w) wins, \(team.otw) overtime wins, \(team.otl) overtime losses, \(team.l) losses")
                                }
                                Spacer(minLength: 8)
                                statColumn("\(team.gp)").foregroundStyle(.secondary)
                                statColumn(team.gd > 0 ? "+\(team.gd)" : "\(team.gd)").foregroundStyle(.secondary)
                                statColumn("\(team.pts)").fontWeight(.semibold).foregroundStyle(.primary)
                            }.font(.subheadline).monospacedDigit().padding(.horizontal, 12).padding(.vertical, 12)
                        }.buttonStyle(.plain)
                        if rank < (store.snapshot?.standings.count ?? 0) - 1 { Divider() }
                    }
                }.background(LeagueStyle.card, in: RoundedRectangle(cornerRadius: 18))
                Text("Win 3 pts · OT win 2 · OT loss 1").font(.caption).foregroundStyle(.secondary)
                }
            }.padding(.horizontal, 12).padding(.vertical, 12)
        }.background(LeagueStyle.background).leagueHeader("Standings")
            .refreshable { await store.refresh() }
    }

    private func statColumn(_ value: String) -> some View { Text(value).frame(width: 29, alignment: .trailing) }


}

private extension View {
    func leagueHeader(_ title: String, operatorGames: [Game]? = nil) -> some View {
        self.navigationTitle(title)
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) {
                HStack(spacing: 10) {
                    Image("LeagueLogo").resizable().scaledToFit()
                        .scaleEffect(1.15).offset(y: 0.35).frame(width: 34, height: 34)
                        .clipShape(Circle()).overlay(Circle().strokeBorder(.white, lineWidth: 1))
                        .accessibilityHidden(true)
                    Text(title).font(.system(size: 28, weight: .bold)).foregroundStyle(.primary)
                    Spacer()
                    if let operatorGames { OperatorMenu(games: operatorGames) }
                }
                .padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 12)
                .background(LeagueStyle.background)
            }
    }
}

struct TeamLogo: View {
    @Environment(\.colorScheme) private var colorScheme
    let slug: String?
    var size: CGFloat = 36
    private var asset: String? {
        guard let slug = slug?.lowercased() else { return nil }
        let keys = ["bashers", "bash", "dangleberries", "landsharks", "loons", "regretzkys", "reign", "rinkrats", "rink-rats", "seals", "yetis", "last-licks", "licks", "coxswain-bawls-hockey-club", "team-usa", "team-canada", "dolo-minions", "lazy-skater-dangle", "money-shots", "mitch-a-palooza"]
        return keys.first { slug.contains($0) }
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
            if game.isPlayoff { Text("Playoffs").font(.caption2).foregroundStyle(.secondary) }
        }
        .padding(.horizontal, 12).padding(.vertical, 14)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("game-\(game.id)")
        .accessibilityLabel("\(game.awayTeam), \(game.awayScore.map(String.init) ?? "no score"), at \(game.homeTeam), \(game.homeScore.map(String.init) ?? "no score"), \(status)")
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
    var body: some View {
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
                    NavigationLink { GameScreen(game: game, store: store) } label: { GameRow(game: game) }
                        .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 16))
                }
            }
        }.navigationTitle(team.team).navigationBarTitleDisplayMode(.inline).toolbar(.visible, for: .navigationBar)
    }
}

/// UIKit's standard search field keeps native appearance, clear button, and editing behavior.
private struct NativePlayerSearch: UIViewRepresentable {
    @Binding var text: String
    func makeCoordinator() -> Coordinator { Coordinator(text: $text) }
    func makeUIView(context: Context) -> UISearchBar {
        let bar = UISearchBar()
        bar.searchBarStyle = .minimal
        bar.placeholder = "Search players"
        bar.autocorrectionType = .no
        bar.delegate = context.coordinator
        bar.searchTextField.accessibilityIdentifier = "playerSearch"
        bar.searchTextField.returnKeyType = .done
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
                Image(systemName: "chevron.down").font(.caption2.weight(.bold))
            }.foregroundStyle(Color.primary).padding(.vertical, 10)
        }.tint(.primary).accessibilityLabel("Season: \(seasonName)")
            .accessibilityIdentifier("seasonPicker")
    }

}

private struct StatsScreen: View {
    @Bindable var store: LeagueStore
    @State private var search = ""
    @State private var allTime = false
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
        do {
            let result: PlayerSnapshot = try await LeagueAPI.fetch("/players", season: "all", maxAge: force ? 0 : 120)
            try Task.checkCancellation()
            allTimePlayers = result.skaters
            allTimeLoading = false
        } catch {
            guard !Task.isCancelled else { return }
            allTimeError = "Couldn't load all-time stats. Pull down to retry."
            allTimeLoading = false
        }
    }
    @State private var statMetric: StatMetric = .points
    @State private var selectedTeam = ""
    private var teamNames: [String] { Array(Set(statsPlayers.map(\.team))).filter { !$0.isEmpty }.sorted() }
    @State private var rankedPlayers: [Skater] = []
    private func updateRanking() {
        rankedPlayers = statMetric.sorted(statsPlayers.filter { allTime || selectedTeam.isEmpty || $0.team == selectedTeam })
    }
    private var visiblePlayers: [(offset: Int, element: Skater)] {
        Array(rankedPlayers.enumerated()).filter { $0.element.matchesPlayerSearch(search) }
    }

    var body: some View {
        let rows = visiblePlayers
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                HStack { SeasonMenu(store: store, allowsAllTime: true, allTime: $allTime); Spacer() }
                NativePlayerSearch(text: $search).frame(height: 44)
                if let error = statsError { Text(error).font(.footnote).foregroundStyle(.secondary) }
                HStack {
                    if !allTime { Menu {
                        Picker("Team", selection: $selectedTeam) {
                            Text("All teams").tag("")
                            ForEach(teamNames, id: \.self) { Text($0).tag($0) }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text(selectedTeam.isEmpty ? "All teams" : selectedTeam)
                            Image(systemName: "chevron.down").font(.caption2.weight(.bold))
                        }.font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                    }.tint(.primary).accessibilityLabel("Team: \(selectedTeam.isEmpty ? "All teams" : selectedTeam)")
                        .accessibilityIdentifier("teamFilter")
                    }
                    Spacer()
                    Menu {
                        Picker("Sort by", selection: $statMetric) {
                            ForEach(StatMetric.allCases) { Text($0.rawValue).tag($0) }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text(statMetric.rawValue)
                            Image(systemName: "chevron.down").font(.caption2.weight(.bold))
                        }.font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                    }.tint(.primary).accessibilityLabel("Sort by: \(statMetric.rawValue)")
                        .accessibilityIdentifier("statSort")
                }.padding(.horizontal, 12).frame(minHeight: 44)
                LazyVStack(spacing: 0) {
                    ForEach(rows, id: \.element.id) { rank, player in
                        NavigationLink { PlayerScreen(player: player) } label: {
                            HStack(spacing: 10) {
                                Text("\(rank + 1)").font(.caption.weight(.medium)).foregroundStyle(.secondary).frame(width: 20)
                                TeamLogo(slug: player.teamSlug, size: 30)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(player.name).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                                    Text("\(player.goals) Goals · \(player.assists) Assists · \(player.points) Points")
                                        .font(.caption).foregroundStyle(.secondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                Spacer(minLength: 8)
                                Text(statMetric.display(player)).font(.subheadline.weight(.semibold))
                                    .foregroundStyle(.primary).monospacedDigit()
                            }.padding(.horizontal, 12).padding(.vertical, 12)
                                .contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityIdentifier("player-\(player.id)")
                        if player.id != rows.last?.element.id { Divider() }
                    }
                }.background(LeagueStyle.card, in: RoundedRectangle(cornerRadius: 18))
                if statsPlayers.isEmpty && statsLoading && statsError == nil { LoadingPlaceholder(title: "Loading stats…", rows: 6) }
                if rows.isEmpty && !statsLoading && (!search.isEmpty || !selectedTeam.isEmpty) {
                    ContentUnavailableView("No matching players", systemImage: "magnifyingglass", description: Text("Try a different player name or change the team filter."))
                }
            }.padding(.horizontal, 12).padding(.vertical, 12)
        }.background(LeagueStyle.background).leagueHeader("Stats")
            .scrollDismissesKeyboard(.interactively)
            .refreshable { if allTime { await loadAllTime(force: true) } else { await store.refresh() } }
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
            .onChange(of: statMetric) { updateRanking() }
            .onChange(of: selectedTeam) { updateRanking() }
            .onChange(of: store.selectedSeason) { selectedTeam = "" }
    }

}
