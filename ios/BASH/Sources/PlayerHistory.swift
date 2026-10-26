import SwiftUI

struct CareerStats: Decodable {
    let gp: Int
    let goals: Int
    let assists: Int
    let points: Int
    let ptsPg: String
    let pim: Int
}

struct CareerSeason: Decodable, Identifiable {
    let seasonId: String
    let seasonName: String
    let teamName: String
    let teamSlug: String
    let stats: CareerStats
    var id: String { "\(seasonId)-\(teamSlug)" }
}

struct CareerGoalieStats: Decodable {
    let gp: Int
    let wins: Int
    let losses: Int
    let gaa: String
    let savePercentage: String
    let shutouts: Int
}

struct CareerGoalieSeason: Decodable, Identifiable {
    let seasonId: String
    let seasonName: String
    let teamName: String
    let teamSlug: String
    let stats: CareerGoalieStats
    var id: String { "\(seasonId)-\(teamSlug)" }
}

struct PlayerGameLog: Decodable, Identifiable {
    let gameId: String
    let date: String
    let opponent: String
    let opponentSlug: String
    let isHome: Bool
    let teamScore: Int?
    let opponentScore: Int?
    let result: String?
    let goals: Int?
    let assists: Int?
    let points: Int?
    let saves: Int?
    let goalsAgainst: Int?
    let savePercentage: String?
    var id: String { gameId }
    var score: String {
        guard let teamScore, let opponentScore else { return "–" }
        return "\(result ?? "") \(teamScore)–\(opponentScore)".trimmingCharacters(in: .whitespaces)
    }
    var dateLabel: String {
        let parts = date.prefix(10).split(separator: "-")
        guard parts.count == 3, let month = Int(parts[1]), let day = Int(parts[2]) else { return date }
        return "\(month)/\(day)"
    }
}

struct PlayerCareer: Decodable {
    let perSeasonStats: [CareerSeason]
    let playoffPerSeasonStats: [CareerSeason]
    let perSeasonGoalieStats: [CareerGoalieSeason]
    let playoffPerSeasonGoalieStats: [CareerGoalieSeason]
    // The API's career totals deliberately count fall seasons only.
    let allTimeStats: CareerStats?
    let playoffAllTimeStats: CareerStats?
    // With season=all, these logs are scoped by the API to the current season.
    let games: [PlayerGameLog]?
    let playoffGames: [PlayerGameLog]?
    let goalieGames: [PlayerGameLog]?
    let playoffGoalieGames: [PlayerGameLog]?
}

extension Skater {
    var slug: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            .replacingOccurrences(of: "['’]", with: "", options: .regularExpression)
            .replacingOccurrences(of: "[^a-z0-9\\s-]", with: "", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: "-", options: .regularExpression)
            .replacingOccurrences(of: "-+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    }
}

actor PlayerCareerCache {
    static let shared = PlayerCareerCache()
    func load(slug: String, force: Bool = false) async throws -> PlayerCareer {
        try await LeagueAPI.fetch("/player/\(slug)", season: "all", maxAge: force ? 0 : 120)
    }
}

struct PlayerScreen: View {
    let player: Skater
    @Bindable var store: LeagueStore
    @State private var career: PlayerCareer?
    @State private var error: String?
    @State private var loading = false
    @State private var playoffs = false
    @State private var selectedSeasonID: String?
    @State private var selectedGameID: String?
    private var seasons: [CareerSeason] { (playoffs ? career?.playoffPerSeasonStats : career?.perSeasonStats) ?? [] }
    private var goalieSeasons: [CareerGoalieSeason] { (playoffs ? career?.playoffPerSeasonGoalieStats : career?.perSeasonGoalieStats) ?? [] }
    private var selectedSeason: CareerSeason? { seasons.first { $0.id == selectedSeasonID } ?? seasons.first }

    var body: some View {
        RefreshScrollView(action: { await load(force: true) }) {
            VStack(alignment: .leading, spacing: 22) {
                HStack(spacing: 14) {
                    TeamLogo(slug: player.teamSlug, size: 54)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(player.name).font(.title.bold())
                        Text(player.team).font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }.padding(.top, 4)
                if let career {
                    if let season = selectedSeason {
                        VStack(alignment: .leading, spacing: 18) {
                            HStack {
                                Menu {
                                    ForEach(seasons) { item in
                                        Button("\(item.seasonName) · \(item.teamName)") { selectedSeasonID = item.id }
                                    }
                                } label: {
                                    HStack(spacing: 6) {
                                        Text(season.seasonName).font(.subheadline.weight(.semibold))
                                        Image(systemName: "chevron.down").font(.caption.weight(.semibold))
                                    }
                                }.accessibilityIdentifier("playerSeasonPicker")
                                Spacer()
                                TeamLogo(slug: season.teamSlug, size: 24)
                            }
                            HStack(spacing: 0) {
                                headline("Games played", "\(season.stats.gp)")
                                headline("Goals", "\(season.stats.goals)")
                                headline("Assists", "\(season.stats.assists)")
                                headline("Points", "\(season.stats.points)")
                            }
                        }.padding(16).background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18))
                    }
                    gameLog(career)
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Season history").font(.title3.bold())
                        Picker("Competition", selection: $playoffs) {
                            Text("Regular season").tag(false)
                            Text("Playoffs").tag(true)
                        }.pickerStyle(.segmented).accessibilityIdentifier("careerCompetition")
                    }
                    if !seasons.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            ScrollView(.horizontal) {
                                VStack(spacing: 0) {
                                    historyRow("Season / team", values: ["GP", "G", "A", "PTS", "P/G", "PIM"], header: true)
                                    ForEach(seasons) { season in
                                        Divider()
                                        Button { selectedSeasonID = season.id } label: {
                                            historyRow(season.seasonName, subtitle: season.teamName, slug: season.teamSlug,
                                                values: skaterValues(season.stats), selected: selectedSeason?.id == season.id)
                                        }.buttonStyle(.plain).accessibilityIdentifier("career-season-\(season.id)")
                                    }
                                    if let total = playoffs ? career.playoffAllTimeStats : career.allTimeStats, total.gp > 0 {
                                        Divider()
                                        historyRow("Career", subtitle: "Fall seasons only", values: skaterValues(total), header: true)
                                    }
                                }
                            }.background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
                            Text("GP games · G goals · A assists · PTS points · P/G points per game · PIM penalty minutes")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    if !goalieSeasons.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Goalie stats").font(.title3.bold())
                            ScrollView(.horizontal) {
                                VStack(spacing: 0) {
                                    historyRow("Season / team", values: ["GP", "W", "L", "GAA", "SV%", "SO"], header: true)
                                    ForEach(goalieSeasons) { season in
                                        Divider()
                                        historyRow(season.seasonName, subtitle: season.teamName, slug: season.teamSlug,
                                            values: ["\(season.stats.gp)", "\(season.stats.wins)", "\(season.stats.losses)", season.stats.gaa, season.stats.savePercentage, "\(season.stats.shutouts)"])
                                    }
                                }
                            }.background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
                            Text("GAA goals against average · SV% save percentage · SO shutouts").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    if seasons.isEmpty && goalieSeasons.isEmpty {
                        ContentUnavailableView("No recorded stats", systemImage: "chart.bar", description: Text("No \(playoffs ? "playoff" : "regular-season") history is available for this player."))
                    }
                } else if let error {
                    Text(error).foregroundStyle(.secondary)
                    Button("Retry") { Task { await load() } }
                } else {
                    LoadingPlaceholder(title: "Loading career stats…", rows: 4)
                }
            }.padding(.horizontal, 12).padding(.bottom, 24)
        }
        .background(Color(.systemGroupedBackground))
        .tint(.primary)
        .navigationTitle("Player stats").navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar(.visible, for: .tabBar)
        .onChange(of: playoffs) { selectedSeasonID = nil }
        .task(id: player.id) { await load() }
        .navigationDestination(isPresented: Binding(
            get: { selectedGameID != nil },
            set: { if !$0 { selectedGameID = nil } }
        )) {
            if let selectedGameID {
                PlayerLogGameScreen(gameID: selectedGameID, store: store)
            }
        }
    }
    @ViewBuilder private func gameLog(_ career: PlayerCareer) -> some View {
        let games = (playoffs ? career.playoffGames : career.games) ?? []
        let goalies = (playoffs ? career.playoffGoalieGames : career.goalieGames) ?? []
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Game log").font(.title3.bold())
                Spacer()
                Text("Current season").font(.caption).foregroundStyle(.secondary)
            }
            if games.isEmpty && goalies.isEmpty {
                Text("No \(playoffs ? "playoff" : "regular-season") games recorded this season.")
                    .font(.subheadline).foregroundStyle(.secondary).padding(.vertical, 8)
            }
            if !games.isEmpty { gameLogTable(games, goalie: false) }
            if !goalies.isEmpty {
                Text("Goalies").font(.subheadline.weight(.semibold))
                gameLogTable(goalies, goalie: true)
            }
        }
    }
    private func gameLogTable(_ games: [PlayerGameLog], goalie: Bool) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text("Date / opponent").frame(maxWidth: .infinity, alignment: .leading)
                Text("Result").frame(width: 62, alignment: .trailing)
                logNumbers(goalie ? ["SV", "GA", "SV%"] : ["G", "A", "PTS"], goalie: goalie)
            }.font(.caption).foregroundStyle(.secondary).padding(12)
            ForEach(games) { game in
                Divider()
                Button { selectedGameID = game.id } label: {
                    HStack(spacing: 6) {
                        HStack(spacing: 8) {
                            TeamLogo(slug: game.opponentSlug, size: 24)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(game.opponent).font(.subheadline.weight(.medium))
                                Text("\(game.dateLabel) · \(game.isHome ? "Home" : "Away")").font(.caption2).foregroundStyle(.secondary)
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading)
                        Text(game.score).font(.caption.weight(.medium)).monospacedDigit().frame(width: 62, alignment: .trailing)
                        logNumbers(goalie ? [game.saves.map(String.init) ?? "–", game.goalsAgainst.map(String.init) ?? "–", game.savePercentage ?? "–"] : [game.goals.map(String.init) ?? "–", game.assists.map(String.init) ?? "–", game.points.map(String.init) ?? "–"], goalie: goalie)
                            .font(.subheadline)
                    }.padding(12).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("player-log-\(game.id)")
            }
        }.background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    }
    private func logNumbers(_ values: [String], goalie: Bool) -> some View {
        HStack(spacing: 4) {
            ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                Text(value).monospacedDigit().frame(width: goalie && index == 2 ? 44 : 24, alignment: .trailing)
            }
        }
    }
    private func headline(_ label: String, _ value: String) -> some View {
        VStack(spacing: 5) {
            Text(value).font(.system(.title, design: .rounded, weight: .bold)).monospacedDigit()
            Text(label).font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity).accessibilityElement(children: .combine)
    }
    private func skaterValues(_ stats: CareerStats) -> [String] {
        ["\(stats.gp)", "\(stats.goals)", "\(stats.assists)", "\(stats.points)", stats.ptsPg, "\(stats.pim)"]
    }
    private func historyRow(_ title: String, subtitle: String? = nil, slug: String? = nil, values: [String], header: Bool = false, selected: Bool = false) -> some View {
        HStack(spacing: 0) {
            HStack(spacing: 8) {
                if let slug { TeamLogo(slug: slug, size: 24) }
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.subheadline.weight(header || selected ? .semibold : .regular))
                    if let subtitle { Text(subtitle).font(.caption2).foregroundStyle(.secondary) }
                }
            }.frame(width: 144, alignment: .leading)
            ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                Text(value).font(.subheadline.weight(header || index == 3 ? .semibold : .regular))
                    .monospacedDigit().frame(width: index == 4 ? 58 : 38, alignment: .trailing)
            }
        }.padding(.horizontal, 12).padding(.vertical, header ? 12 : 10)
            .accessibilityElement(children: .combine)
    }
    @MainActor private func load(force: Bool = false) async {
        guard !loading else { return }
        loading = true
        error = nil
        defer { loading = false }
        do { career = try await PlayerCareerCache.shared.load(slug: player.slug, force: force) }
        catch is CancellationError { }
        catch { self.error = "Couldn't load career stats. Please try again." }
    }
}

// Resolve by ID so logs still open when browsing a different Scores season.
private struct PlayerLogGameScreen: View {
    let gameID: String
    @Bindable var store: LeagueStore
    @State private var game: Game?
    @State private var failed = false

    var body: some View {
        Group {
            if let game = game ?? store.snapshot?.games.first(where: { $0.id == gameID }) {
                GameScreen(game: game, store: store)
            } else if failed {
                ContentUnavailableView {
                    Label("Couldn't load game", systemImage: "exclamationmark.triangle")
                } actions: {
                    Button("Try again") { Task { await load() } }
                }
            } else {
                ProgressView("Loading game")
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard game == nil, store.snapshot?.games.contains(where: { $0.id == gameID }) != true else { return }
        failed = false
        do {
            game = try await LeagueAPI.fetch("/game/\(gameID)", maxAge: 45)
        } catch is CancellationError {
        } catch {
            failed = true
        }
    }
}
