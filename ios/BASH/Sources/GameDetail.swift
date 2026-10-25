import SwiftUI

struct BoxSkater: Decodable, Identifiable {
    let id: Int
    let name: String
    let goals: Int
    let assists: Int
    let points: Int
    let pim: Int
    let isSub: Bool
    func player(team: String, slug: String?) -> Skater {
        Skater(teamSlug: slug, id: id, name: name, team: team, gp: 1, goals: goals, assists: assists, points: points)
    }
}
struct BoxGoalie: Decodable, Identifiable {
    let id: Int
    let name: String
    let seconds: Int
    let goalsAgainst: Int
    let shotsAgainst: Int
    let saves: Int
    let savePercentage: String
    let isSub: Bool
}
struct GameDetail: Decodable {
    let homeScore: Int?
    let awayScore: Int?
    let status: String
    let isOvertime: Bool
    let isForfeit: Bool
    let homePlayers: [BoxSkater]
    let awayPlayers: [BoxSkater]
    let homeGoalies: [BoxGoalie]
    let awayGoalies: [BoxGoalie]
    let notes: String?
    let officials: [Official]
    struct Official: Decodable { let name: String; let role: String }
}
struct GameGoal: Decodable, Identifiable {
    let id: String
    let team: String
    let period: Int
    let clock: String
    let scorerId: Int
    let assist1Id: Int?
    let assist2Id: Int?
    let flags: [String]
}
struct GamePenalty: Decodable, Identifiable {
    let id: String
    let team: String
    let period: Int
    let clock: String
    let playerId: Int
    let infraction: String
    let minutes: Int
}
struct GameLive: Decodable {
    let state: State
    let playerNames: [String: String]
    let homeScore: Int?
    let awayScore: Int?
    let status: String
    let goalieIds: [Int]
    let subPlayerIds: [Int]
    struct State: Decodable {
        let period: Int
        let goals: [GameGoal]
        let penalties: [GamePenalty]
        let homeShots: [Int]
        let awayShots: [Int]
        let homeAttendance: [Int]
        let awayAttendance: [Int]
        let threeStars: [Int]?
        let shootout: Shootout?
    }
    struct Shootout: Decodable {
        let homeAttempts: [Attempt]
        let awayAttempts: [Attempt]
    }
    struct Attempt: Decodable { let playerId: Int; let scored: Bool }
    func name(_ id: Int) -> String { playerNames[String(id)] ?? "Player #\(id)" }
    static func clockSeconds(_ value: String) -> Int {
        let parts = value.split(separator: ":").compactMap { Int($0) }
        return parts.count == 2 ? parts[0] * 60 + parts[1] : 0
    }
    var orderedGoals: [GameGoal] {
        state.goals.sorted {
            if $0.period != $1.period { return $0.period < $1.period }
            if Self.clockSeconds($0.clock) != Self.clockSeconds($1.clock) { return Self.clockSeconds($0.clock) > Self.clockSeconds($1.clock) }
            return $0.id < $1.id
        }
    }
    func skaters(home: Bool, slug: String?) -> [BoxSkater] {
        let goals = state.goals.filter { $0.team == slug && $0.period <= 4 }
        let penalties = state.penalties.filter { $0.team == slug }
        let referenced = goals.flatMap { [$0.scorerId, $0.assist1Id, $0.assist2Id].compactMap { $0 } } + penalties.map(\.playerId)
        let ids = Set((home ? state.homeAttendance : state.awayAttendance) + referenced).subtracting(goalieIds)
        return ids.map { id in
            let g = goals.filter { $0.scorerId == id }.count
            let a = goals.filter { $0.assist1Id == id || $0.assist2Id == id }.count
            return BoxSkater(id: id, name: name(id), goals: g, assists: a, points: g + a,
                             pim: penalties.filter { $0.playerId == id }.reduce(0) { $0 + $1.minutes }, isSub: subPlayerIds.contains(id))
        }.sorted { $0.points == $1.points ? $0.name < $1.name : $0.points > $1.points }
    }
}

struct GameEvent: Identifiable {
    let goal: GameGoal?
    let penalty: GamePenalty?
    var id: String { goal.map { "goal-" + $0.id } ?? "penalty-" + (penalty?.id ?? "") }
    var period: Int { goal?.period ?? penalty?.period ?? 1 }
    var clock: String { goal?.clock ?? penalty?.clock ?? "" }
    var team: String { goal?.team ?? penalty?.team ?? "" }
}
extension GameLive {
    var events: [GameEvent] {
        (state.goals.map { GameEvent(goal: $0, penalty: nil) } + state.penalties.map { GameEvent(goal: nil, penalty: $0) }).sorted {
            if $0.period != $1.period { return $0.period < $1.period }
            if Self.clockSeconds($0.clock) != Self.clockSeconds($1.clock) { return Self.clockSeconds($0.clock) > Self.clockSeconds($1.clock) }
            return $0.id < $1.id
        }
    }
}

struct GameScreen: View {
    let game: Game
    @Bindable var store: LeagueStore
    @Environment(\.scenePhase) private var phase
    @State private var detail: GameDetail?
    @State private var live: GameLive?
    @State private var error: String?
    @State private var eventsError = false
    @State private var loading = false
    @State private var hasLoaded = false
    @State private var homeSelected = false
    @State private var page = "Summary"
    private var current: Game {
        let base = store.snapshot?.games.first(where: { $0.id == game.id }) ?? game
        guard let detail else { return base }
        let live = eventsError ? nil : live
        return Game(id: base.id, date: base.date, time: base.time, homeTeam: base.homeTeam, awayTeam: base.awayTeam,
                    homeSlug: base.homeSlug, awaySlug: base.awaySlug, homeScore: live?.homeScore ?? detail.homeScore,
                    awayScore: live?.awayScore ?? detail.awayScore, status: live?.status ?? detail.status,
                    location: base.location, isOvertime: detail.isOvertime, isPlayoff: base.isPlayoff)
    }
    private var team: String { homeSelected ? current.homeTeam : current.awayTeam }
    private var slug: String? { homeSelected ? current.homeSlug : current.awaySlug }
    private var skaters: [BoxSkater] {
        if current.status == "live", let live { return live.skaters(home: homeSelected, slug: slug) }
        return (homeSelected ? detail?.homePlayers : detail?.awayPlayers) ?? []
    }
    private var goalies: [BoxGoalie] { (homeSelected ? detail?.homeGoalies : detail?.awayGoalies) ?? [] }
    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 4) {
                GameRow(game: current)
                HStack(spacing: 0) {
                    ForEach(["Summary", "Stats"], id: \.self) { title in
                        Button { page = title } label: {
                            VStack(spacing: 10) {
                                Text(title).font(.subheadline.weight(page == title ? .semibold : .regular))
                                    .foregroundStyle(page == title ? Color.primary : .secondary)
                                Capsule().fill(page == title ? Color.primary : .clear).frame(height: 2)
                            }.frame(maxWidth: .infinity).contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityIdentifier("gameTab-\(title)")
                            .accessibilityAddTraits(page == title ? .isSelected : [])
                    }
                }.padding(.horizontal, 16)
            }.background(Color(.systemBackground))
            Divider()
            List {
                if let error { Section { Text(error).foregroundStyle(.secondary); Button("Retry") { Task { await load() } } } }
                if !hasLoaded && error == nil {
                    LoadingPlaceholder(title: page == "Stats" ? "Loading game stats…" : "Loading game…", rows: 4)
                        .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                } else {
                switch page {
                case "Stats": statsContent
                default: summaryContent
                }
                }
            }.id(page).listStyle(.insetGrouped).listSectionSpacing(12).contentMargins(.top, 12)
                .refreshable { await load(force: true) }
        }.tint(.primary).navigationTitle(current.dateLabel).navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .toolbar(.visible, for: .tabBar)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { OperatorMenu(games: store.snapshot?.games ?? [], game: current) } }
            .task(id: phase) {
                guard phase == .active else { return }
                await load()
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(current.status == "live" ? 15 : 60)) } catch { return }
                    await load()
                }
            }
    }
    @ViewBuilder private var summaryContent: some View {
        if detail?.isForfeit == true { Text("Forfeit").foregroundStyle(.secondary) }
        if let live, current.status != "upcoming" {
            Section("Scoring by period") { periodTable(live, shots: false) }
            Section("Shots on goal") { periodTable(live, shots: true) }
            if let stars = live.state.threeStars, !stars.isEmpty {
                Section("Three stars") {
                    ForEach(Array(stars.enumerated()), id: \.offset) { rank, id in
                        HStack(spacing: 14) {
                            Text("\(rank + 1)").font(.subheadline).foregroundStyle(.secondary).frame(width: 20)
                            Text(live.name(id)).font(.subheadline.weight(.semibold))
                        }.padding(.vertical, 4).alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                    }
                }
            }
        }
        playsContent
        Section {
            DisclosureGroup("Game details") {
                LabeledContent("Date", value: current.dateLabel)
                LabeledContent("Time", value: current.time)
                if let detail {
                    ForEach(Array(detail.officials.enumerated()), id: \.offset) { _, official in LabeledContent(official.role.capitalized, value: official.name) }
                    if let notes = detail.notes, !notes.isEmpty { Text(notes).font(.subheadline).foregroundStyle(.secondary) }
                }
                Link("Replay on the web", destination: current.url)
            }.font(.subheadline)
        }
    }
    @ViewBuilder private var statsContent: some View {
        Section {
            Picker("Team", selection: $homeSelected) {
                Text(current.awayTeam).tag(false)
                Text(current.homeTeam).tag(true)
            }.pickerStyle(.segmented).accessibilityIdentifier("boxTeam")
        }.listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
        Section {
            if skaters.isEmpty {
                Text(current.status == "upcoming" ? "Player stats will appear when the game starts." : "Player stats have not been posted yet.")
                .font(.subheadline).foregroundStyle(.secondary)
            } else {
                HStack { Text("Player"); Spacer(); columns(["G", "A", "PTS", "PIM"]).padding(.trailing, 22) }.font(.caption).foregroundStyle(.secondary)
                ForEach(skaters) { player in
                    NavigationLink { PlayerScreen(player: player.player(team: team, slug: slug)) } label: {
                        HStack(spacing: 6) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(player.name).font(.subheadline.weight(.semibold))
                                if player.isSub { Text("Sub").font(.caption2).foregroundStyle(.secondary) }
                            }
                            Spacer(minLength: 4)
                            columns(["\(player.goals)", "\(player.assists)", "\(player.points)", "\(player.pim)"])
                        }.font(.subheadline).foregroundStyle(.primary)
                    }.alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                }
            }
        }
        Section("Goalies") {
            if goalies.isEmpty {
                Text("Goalie stats have not been posted yet.").font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(goalies) { goalie in
                DisclosureGroup {
                    LabeledContent("Saves / shots against", value: "\(goalie.saves) / \(goalie.shotsAgainst)")
                    LabeledContent("Goals against", value: "\(goalie.goalsAgainst)")
                    LabeledContent("Save percentage", value: goalie.savePercentage)
                    LabeledContent("Time played", value: String(format: "%d:%02d", goalie.seconds / 60, goalie.seconds % 60))
                    NavigationLink("Player history") {
                        PlayerScreen(player: Skater(teamSlug: slug, id: goalie.id, name: goalie.name, team: team, gp: 1, goals: 0, assists: 0, points: 0))
                    }
                } label: {
                    HStack { Text(goalie.name); Spacer(); Text("\(goalie.saves) saves").foregroundStyle(.secondary) }.font(.subheadline)
                }.tint(.primary)
            }
        }
    }
    @ViewBuilder private var playsContent: some View {
        if let live {
            let periods = Set(live.state.goals.map(\.period) + live.state.penalties.map(\.period)).sorted()
            if periods.isEmpty { Text("No plays recorded yet.").foregroundStyle(.secondary) }
            ForEach(periods, id: \.self) { period in
                Section(periodLabel(period)) {
                    ForEach(live.events.filter { $0.period == period }) { event in
                        HStack(alignment: .center, spacing: 10) {
                            Text(event.clock).font(.caption).monospacedDigit().foregroundStyle(.secondary).frame(width: 40, alignment: .leading)
                            TeamLogo(slug: event.team, size: 26)
                            VStack(alignment: .leading, spacing: 2) {
                                if let goal = event.goal {
                                    Text("Goal · \(live.name(goal.scorerId))").font(.subheadline.weight(.semibold))
                                    let assists = [goal.assist1Id, goal.assist2Id].compactMap { $0 }.map { live.name($0) }
                                    Text(assists.isEmpty ? "Unassisted" : assists.joined(separator: ", ")).font(.caption).foregroundStyle(.secondary)
                                    if !goal.flags.isEmpty { Text(goal.flags.joined(separator: " · ")).font(.caption2).foregroundStyle(.secondary) }
                                } else if let penalty = event.penalty {
                                    Text(live.name(penalty.playerId)).font(.subheadline.weight(.semibold))
                                    Text("\(penalty.infraction) · \(penalty.minutes) min").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }.listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                            .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                    }
                }
            }
            if let shootout = live.state.shootout, !shootout.homeAttempts.isEmpty || !shootout.awayAttempts.isEmpty {
                Section("Shootout") {
                    attempts(shootout.awayAttempts, team: current.awayTeam, live: live)
                    attempts(shootout.homeAttempts, team: current.homeTeam, live: live)
                }
            }
        } else if !loading {
            ContentUnavailableView("No play-by-play", systemImage: "list.bullet.rectangle", description: Text("Recorded goals and penalties will appear here when available."))
        }
        if eventsError { Text("Couldn't refresh plays. Pull down to retry.").font(.caption).foregroundStyle(.secondary) }
    }
    private func columns(_ values: [String]) -> some View {
        HStack(spacing: 6) { ForEach(Array(values.enumerated()), id: \.offset) { _, value in Text(value).frame(width: 28, alignment: .trailing) } }.monospacedDigit()
    }
    private func periodLabel(_ period: Int) -> String { period == 4 ? "OT" : period == 5 ? "SO" : "P\(period)" }
    private func periodTable(_ live: GameLive, shots: Bool) -> some View {
        let count = min(4, max(3, live.state.period, live.state.homeShots.count, live.state.awayShots.count))
        return VStack(spacing: 16) {
            HStack {
                Text("Team"); Spacer()
                ForEach(1...count, id: \.self) { Text($0 == 4 ? "OT" : "\($0)").frame(width: 28) }
                Text("Total").frame(width: 36)
            }.font(.caption).foregroundStyle(.secondary)
            periodRow(current.awayTeam, slug: current.awaySlug, shots: shots ? live.state.awayShots : nil, count: count, live: live, total: current.awayScore)
            periodRow(current.homeTeam, slug: current.homeSlug, shots: shots ? live.state.homeShots : nil, count: count, live: live, total: current.homeScore)
        }.padding(.vertical, 6)
    }
    private func periodRow(_ name: String, slug: String?, shots: [Int]?, count: Int, live: GameLive, total: Int?) -> some View {
        HStack {
            Text(name).font(.subheadline.weight(.medium)).lineLimit(1).minimumScaleFactor(0.8)
            Spacer(minLength: 2)
            ForEach(1...count, id: \.self) { p in
                Text(shots.map { p <= $0.count ? "\($0[p - 1])" : "–" } ?? "\(live.state.goals.filter { $0.team == slug && $0.period == p }.count)")
                    .frame(width: 28)
            }
            Text(shots.map { "\($0.reduce(0, +))" } ?? total.map(String.init) ?? "–").fontWeight(.semibold).frame(width: 36)
        }.font(.subheadline).monospacedDigit()
    }
    private func attempts(_ values: [GameLive.Attempt], team: String, live: GameLive) -> some View {
        ForEach(Array(values.enumerated()), id: \.offset) { _, attempt in
            LabeledContent("\(live.name(attempt.playerId)) · \(team)", value: attempt.scored ? "Goal" : "No goal").font(.subheadline)
        }
    }
    @MainActor private func load(force: Bool = false) async {
        guard !loading else { return }
        loading = true
        defer { loading = false; hasLoaded = true }
        async let events = fetchEvents(maxAge: force ? 0 : (current.status == "live" ? 10 : 45))
        do {
            let result: GameDetail = try await LeagueAPI.fetch("/game/\(game.id)", maxAge: force ? 0 : (current.status == "live" ? 10 : 45))
            detail = result
            error = nil
        } catch { self.error = detail == nil ? "Couldn't load the box score. Please try again." : "Couldn't refresh. Showing the last loaded box score." }
        do { live = try await events; eventsError = false }
        catch { eventsError = true }
    }
    static func prefetch(_ game: Game) async {
        let age: TimeInterval = game.status == "live" ? 10 : 45
        async let detail: GameDetail? = try? LeagueAPI.fetch("/game/\(game.id)", maxAge: age)
        async let events: GameLive? = try? LeagueAPI.fetch("/game/\(game.id)/live", maxAge: age)
        _ = await (detail, events)
    }
    private func fetchEvents(maxAge: TimeInterval) async throws -> GameLive? {
        do { return try await LeagueAPI.fetch("/game/\(game.id)/live", maxAge: maxAge) }
        catch let error as URLError where error.code == .fileDoesNotExist { return nil }
    }
}
