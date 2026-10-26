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
    /// Include empty completed/current periods, but never future regulation periods in a live game.
    /// Shootout attempts have their own summary rather than a timed period feed.
    var summaryPeriods: [Int] {
        guard status != "upcoming" else { return [] }
        let lastEvent = (state.goals.map(\.period) + state.penalties.map(\.period)).max() ?? 1
        let count = min(4, max(status == "final" ? 3 : 1, state.period, lastEvent))
        return Array(1...count)
    }
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
                        let star = starInfo(id, live: live)
                        HStack(spacing: 10) {
                            ZStack {
                                Image(systemName: "star.fill").font(.system(size: 32)).foregroundStyle(LeagueStyle.orange)
                                Text("\(rank + 1)").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                            }.frame(width: 34).accessibilityLabel("\(rank + 1) star")
                            TeamLogo(slug: star.slug, size: 36)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(live.name(id)).font(.subheadline.weight(.semibold))
                                if let stats = star.stats {
                                    Text(stats).font(.caption).foregroundStyle(.secondary).monospacedDigit()
                                }
                            }
                        }.padding(.vertical, 4).alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                            .accessibilityElement(children: .combine).accessibilityIdentifier("game-star-\(rank + 1)")
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
            } else {
                HStack(spacing: 6) {
                    Text("Player")
                    Spacer(minLength: 4)
                    goalieColumns(["SV", "SA", "GA", "SV%", "TOI"]).padding(.trailing, 22)
                }.font(.caption2).foregroundStyle(.secondary)
            }
            ForEach(goalies) { goalie in
                let time = String(format: "%d:%02d", goalie.seconds / 60, goalie.seconds % 60)
                NavigationLink {
                    PlayerScreen(player: Skater(teamSlug: slug, id: goalie.id, name: goalie.name, team: team, gp: 1, goals: 0, assists: 0, points: 0))
                } label: {
                    HStack(spacing: 6) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(goalie.name).font(.caption.weight(.semibold))
                            if goalie.isSub { Text("Sub").font(.caption2).foregroundStyle(.secondary) }
                        }
                        Spacer(minLength: 4)
                        goalieColumns(["\(goalie.saves)", "\(goalie.shotsAgainst)", "\(goalie.goalsAgainst)", goalie.savePercentage, time])
                    }.font(.caption).foregroundStyle(.primary)
                }
                .accessibilityIdentifier("goalie-stats-\(goalie.id)")
                .accessibilityLabel("\(goalie.name), \(goalie.saves) saves, \(goalie.shotsAgainst) shots against, \(goalie.goalsAgainst) goals against, save percentage \(goalie.savePercentage), time played \(time)")
                .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
            }
        }
    }
    private func goalieColumns(_ values: [String]) -> some View {
        HStack(spacing: 3) {
            ForEach(values.indices, id: \.self) { index in
                Text(values[index]).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.8)
                    .frame(width: index < 3 ? 24 : 42, alignment: .trailing)
            }
        }.fixedSize(horizontal: true, vertical: false)
    }
    @ViewBuilder private var playsContent: some View {
        if let live {
            if current.status == "upcoming" {
                Text("The game has not started yet.").font(.subheadline).foregroundStyle(.secondary)
            } else {
                eventSummary(live, scoring: true)
                eventSummary(live, scoring: false)
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
    private func eventSummary(_ live: GameLive, scoring: Bool) -> some View {
        Section {
            ForEach(live.summaryPeriods, id: \.self) { period in
                let events = live.events.filter { $0.period == period && (scoring ? $0.goal != nil : $0.penalty != nil) }
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text(period == 4 ? "Overtime" : "\(period == 1 ? "1st" : period == 2 ? "2nd" : "3rd") period")
                            .font(.caption.weight(.semibold))
                        Spacer()
                        if events.isEmpty {
                            Text(scoring ? "No scoring" : "No penalties").font(.caption)
                        }
                    }.foregroundStyle(.secondary)
                    ForEach(events) { event in
                        HStack(alignment: .center, spacing: 10) {
                            TeamLogo(slug: event.team, size: 30)
                            VStack(alignment: .leading, spacing: 3) {
                                if let goal = event.goal {
                                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                                        Text(live.name(goal.scorerId)).font(.subheadline.weight(.semibold))
                                        if !goal.flags.isEmpty {
                                            Text(goal.flags.joined(separator: " · ")).font(.caption2.weight(.medium)).foregroundStyle(.secondary)
                                        }
                                    }
                                    let assists = [goal.assist1Id, goal.assist2Id].compactMap { $0 }.map { live.name($0) }
                                    Text(assists.isEmpty ? "Unassisted" : assists.joined(separator: ", "))
                                        .font(.caption).foregroundStyle(.secondary)
                                } else if let penalty = event.penalty {
                                    Text(live.name(penalty.playerId)).font(.subheadline.weight(.semibold))
                                    Text("\(penalty.infraction) · \(penalty.minutes) min").font(.caption).foregroundStyle(.secondary)
                                }
                            }.frame(maxWidth: .infinity, alignment: .leading)
                            Text(event.clock).font(.caption).monospacedDigit().foregroundStyle(.secondary)
                                .frame(width: 38, alignment: .trailing)
                        }.padding(.vertical, 2)
                    }
                }
                .padding(.vertical, 4)
                .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))
                .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
            }
        } header: {
            Text(scoring ? "Scoring summary" : "Penalty summary")
                .font(.headline).foregroundStyle(.primary).textCase(nil)
                .padding(.bottom, 4)
        }
    }
    private func starInfo(_ id: Int, live: GameLive) -> (slug: String?, stats: String?) {
        for home in [false, true] {
            let slug = home ? current.homeSlug : current.awaySlug
            let goalies = (home ? detail?.homeGoalies : detail?.awayGoalies) ?? []
            if let goalie = goalies.first(where: { $0.id == id }) {
                return (slug, "\(goalie.saves) SV · \(goalie.goalsAgainst) GA · \(goalie.savePercentage) SV%")
            }
            let players = current.status == "live" ? live.skaters(home: home, slug: slug) : ((home ? detail?.homePlayers : detail?.awayPlayers) ?? [])
            if let player = players.first(where: { $0.id == id }) {
                return (slug, "\(player.goals) G · \(player.assists) A · \(player.points) PTS")
            }
        }
        let home = live.state.homeAttendance.contains(id)
        let away = live.state.awayAttendance.contains(id)
        let eventTeam = live.state.goals.first { $0.scorerId == id || $0.assist1Id == id || $0.assist2Id == id }?.team
        return (home ? current.homeSlug : away ? current.awaySlug : eventTeam, nil)
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
        HStack(spacing: 6) {
            TeamLogo(slug: slug, size: 26)
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
