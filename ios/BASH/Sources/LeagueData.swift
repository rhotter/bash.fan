import Foundation
import Observation
import UserNotifications

struct Game: Codable, Identifiable {
    let id: String
    let date: String
    let time: String
    let homeTeam: String
    let awayTeam: String
    let homeSlug: String?
    let awaySlug: String?
    let homeScore: Int?
    let awayScore: Int?
    let status: String
    let location: String
    let isOvertime: Bool
    let isPlayoff: Bool

    var livePeriod: Int? = nil
    var liveClockSeconds: Double? = nil
    var liveClockRunning: Bool? = nil
    var liveClockStartedAt: Double? = nil

    func statusLabel(at now: Date = .now) -> String {
        if status == "final" { return isOvertime ? "Final · OT" : "Final" }
        guard status == "live" else { return time }
        guard let period = livePeriod, let clock = liveClockSeconds, clock.isFinite else { return "Live" }
        let elapsed: Double
        if liveClockRunning == true, let startedAt = liveClockStartedAt, startedAt.isFinite {
            elapsed = max(0, (now.timeIntervalSince1970 * 1000 - startedAt) / 1000)
        } else { elapsed = 0 }
        let remaining = max(0, clock - elapsed)
        guard remaining.isFinite, remaining < Double(Int.max) else { return "Live" }
        let seconds = Int(remaining)
        let label: String
        switch period {
        case 0: label = "Pre-Game"
        case 1...3: label = "P\(period)"
        case 4: label = "OT"
        case 5 where !isPlayoff: label = "SO"
        default: label = isPlayoff ? "\(period - 3)OT" : "P\(period)"
        }
        return "\(label) \(seconds / 60):" + String(format: "%02d", seconds % 60)
    }

    var startsAt: Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "America/Los_Angeles")
        for format in ["yyyy-MM-dd h:mma", "yyyy-MM-dd H:mm", "yyyy-MM-dd HH:mm:ss"] {
            formatter.dateFormat = format
            if let parsed = formatter.date(from: "\(date) \(time.replacingOccurrences(of: " ", with: "").uppercased())") { return parsed }
        }
        return nil
    }
    var dateLabel: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "America/Los_Angeles")
        formatter.dateFormat = "yyyy-MM-dd"
        guard let day = formatter.date(from: date) else { return date }
        formatter.dateFormat = "EEEE, MMM d"
        return formatter.string(from: day)
    }
    var url: URL { URL(string: "https://bash.fan/game/\(id)")! }
}

struct Standing: Codable, Identifiable {
    let team: String
    let slug: String
    let gp: Int
    let w: Int
    let otw: Int
    let l: Int
    let otl: Int
    let gd: Int
    let pts: Int
    var id: String { slug }
}

struct Skater: Codable, Identifiable, Equatable {
    let teamSlug: String?
    let id: Int
    let name: String
    let team: String
    let gp: Int
    let goals: Int
    let assists: Int
    let points: Int
}

extension Skater {
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        teamSlug = try values.decodeIfPresent(String.self, forKey: .teamSlug)
        id = try values.decode(Int.self, forKey: .id)
        name = try values.decode(String.self, forKey: .name)
        team = try values.decodeIfPresent(String.self, forKey: .team) ?? ""
        gp = try values.decode(Int.self, forKey: .gp)
        goals = try values.decode(Int.self, forKey: .goals)
        assists = try values.decode(Int.self, forKey: .assists)
        points = try values.decode(Int.self, forKey: .points)
    }
}

struct LeagueSnapshot: Codable {
    let games: [Game]
    let standings: [Standing]
    let lastUpdated: String
}
struct Goalie: Codable, Identifiable, Equatable {
    let id: Int
    let name: String
    let team: String?
    let teamSlug: String?
    let gp: Int
    let wins: Int
    let losses: Int
    let savePercentage: Double
    let gaa: Double
    let shutouts: Int
    let saves: Int
    let goalsAgainst: Int
    let shotsAgainst: Int
    let goalieAssists: Int

    var player: Skater {
        Skater(teamSlug: teamSlug, id: id, name: name, team: team ?? "", gp: gp, goals: 0, assists: goalieAssists, points: goalieAssists)
    }
}

enum GoalieMetric: String, CaseIterable, Identifiable {
    case savePercentage = "Save percentage", gaa = "Goals against average", wins = "Wins"
    case losses = "Losses", gamesPlayed = "Games played", shutouts = "Shutouts"
    case saves = "Saves", goalsAgainst = "Goals against", shotsAgainst = "Shots against", assists = "Assists"
    var id: String { rawValue }
    func value(_ goalie: Goalie) -> Double {
        switch self {
        case .savePercentage: goalie.savePercentage
        case .gaa: goalie.gaa
        case .wins: Double(goalie.wins)
        case .losses: Double(goalie.losses)
        case .gamesPlayed: Double(goalie.gp)
        case .shutouts: Double(goalie.shutouts)
        case .saves: Double(goalie.saves)
        case .goalsAgainst: Double(goalie.goalsAgainst)
        case .shotsAgainst: Double(goalie.shotsAgainst)
        case .assists: Double(goalie.goalieAssists)
        }
    }
    func display(_ goalie: Goalie) -> String {
        switch self {
        case .savePercentage: String(format: "%.3f", value(goalie))
        case .gaa: String(format: "%.2f", value(goalie))
        default: String(Int(value(goalie)))
        }
    }
    func sorted(_ goalies: [Goalie]) -> [Goalie] {
        goalies.sorted {
            if value($0) != value($1) { return self == .gaa ? value($0) < value($1) : value($0) > value($1) }
            if self == .wins && $0.savePercentage != $1.savePercentage { return $0.savePercentage > $1.savePercentage }
            return $0.id < $1.id
        }
    }
}

struct PlayerSnapshot: Codable { let skaters: [Skater]; let goalies: [Goalie] }
struct Season: Codable, Identifiable {
    let id: String
    let name: String
    let isCurrent: Bool
}
struct SeasonSnapshot: Decodable { let seasons: [Season] }

enum LeagueAPI {
    static func fetch<T: Decodable & Sendable>(_ path: String, season: String = "", maxAge: TimeInterval? = nil) async throws -> T {
        var parts = URLComponents(string: "https://www.bayareastreethockey.com/api/bash\(path)")!
        if !season.isEmpty { parts.queryItems = (parts.queryItems ?? []) + [URLQueryItem(name: "season", value: season)] }
        let url = parts.url!
        let loader: @Sendable () async throws -> Data = {
            #if DEBUG
            // Deterministic slow-network UI coverage; absent from release builds.
            if ProcessInfo.processInfo.arguments.contains("--slow-network") { try await Task.sleep(for: .seconds(8)) }
            #endif
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
            if http.statusCode == 404 { throw URLError(.fileDoesNotExist) }
            guard (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
            return data
        }
        let data: Data
        if let maxAge { data = try await DetailResponseCache.shared.load(key: url.absoluteString, maxAge: maxAge, loader: loader) }
        else { data = try await loader() }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

@MainActor @Observable
final class LeagueStore {
    var snapshot: LeagueSnapshot? {
        didSet { weeks = GameWeek.build(snapshot?.games ?? []) }
    }
    private(set) var weeks: [GameWeek] = []
    var players: [Skater] = []
    var goalies: [Goalie] = []
    var seasons: [Season] = UserDefaults.standard.data(forKey: "leagueSeasons")
        .flatMap { try? JSONDecoder().decode([Season].self, from: $0) } ?? []
    var selectedSeason = ""
    var loading = false
    var error: String?
    var playerError: String?
    var cached = false
    var followed: Set<String> = Set(UserDefaults.standard.stringArray(forKey: "followedTeams") ?? [])
    var reminders = UserDefaults.standard.bool(forKey: "gameReminders")
    var reminderMessage: String?
    private var generation = 0

    func follows(_ game: Game) -> Bool {
        [game.homeSlug, game.awaySlug].compactMap { $0 }.contains { followed.contains($0) }
    }

    func toggle(_ slug: String) async {
        if followed.contains(slug) { followed.remove(slug) } else { followed.insert(slug) }
        UserDefaults.standard.set(Array(followed), forKey: "followedTeams")
        await updateReminders()
    }

    func refresh() async {
        generation += 1
        let request = generation
        let season = selectedSeason
        loading = true
        error = nil
        // Stats should not wait for the scores request before starting.
        async let playerResult: PlayerSnapshot = LeagueAPI.fetch("/players", season: season)
        async let seasonResult: SeasonSnapshot? = try? LeagueAPI.fetch("/seasons", maxAge: 120)
        let cacheKey = "leagueCache-\(season)"
        var restoreSaved = true
        #if DEBUG
        restoreSaved = !ProcessInfo.processInfo.arguments.contains("--slow-network")
        #endif
        if restoreSaved, snapshot == nil, let data = UserDefaults.standard.data(forKey: cacheKey),
           let saved = try? JSONDecoder().decode(LeagueSnapshot.self, from: data) {
            snapshot = saved
            cached = true
        }
        do {
            let result: LeagueSnapshot = try await LeagueAPI.fetch("", season: season)
            let metadata = await seasonResult
            guard request == generation else { return }
            if let metadata {
                seasons = metadata.seasons
                if let data = try? JSONEncoder().encode(seasons) {
                    UserDefaults.standard.set(data, forKey: "leagueSeasons")
                }
            }
            snapshot = result
            cached = false
            UserDefaults.standard.set(try JSONEncoder().encode(result), forKey: cacheKey)
        } catch {
            guard request == generation else { return }
            self.error = "Couldn't refresh scores. Pull down to try again."
            cached = snapshot != nil
        }
        guard request == generation else { return }
        do {
            let result = try await playerResult
            guard request == generation else { return }
            players = result.skaters
            goalies = result.goalies
            playerError = nil
        } catch {
            guard request == generation else { return }
            playerError = "Couldn't refresh player stats. Pull down to try again."
        }
        guard request == generation else { return }
        loading = false
        if request == generation { await updateReminders() }
    }

    func setReminders(_ enabled: Bool) async {
        if enabled {
            do {
                let allowed = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
                guard allowed else {
                    reminderMessage = "Notifications are off. Enable them for BASH in iPhone Settings."
                    return
                }
            } catch {
                reminderMessage = "Couldn't enable reminders. Please try again."
                return
            }
        }
        reminders = enabled
        UserDefaults.standard.set(enabled, forKey: "gameReminders")
        await updateReminders()
    }

    func updateReminders() async {
        let center = UNUserNotificationCenter.current()
        // Always use current-season schedules, even while browsing history.
        guard reminders else {
            center.removeAllPendingNotificationRequests()
            return
        }
        let games: [Game]
        if selectedSeason.isEmpty, let snapshot, !cached { games = snapshot.games }
        else {
            guard let current: LeagueSnapshot = try? await LeagueAPI.fetch("") else { return }
            games = current.games
        }
        let upcoming = games.filter { follows($0) && $0.status == "upcoming" }
            .compactMap { game -> (Game, Date)? in
                guard let start = game.startsAt, start.addingTimeInterval(-3600) > Date() else { return nil }
                return (game, start.addingTimeInterval(-3600))
            }.sorted { $0.1 < $1.1 }.prefix(60)
        center.removeAllPendingNotificationRequests()
        for (game, date) in upcoming {
            let content = UNMutableNotificationContent()
            content.title = "Game in one hour"
            content.body = "\(game.awayTeam) at \(game.homeTeam) · \(game.location)"
            content.sound = .default
            content.userInfo = ["gameID": game.id]
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, date.timeIntervalSinceNow), repeats: false)
            do {
                try await center.add(UNNotificationRequest(identifier: "game-\(game.id)", content: content, trigger: trigger))
            } catch { reminderMessage = "Some game reminders couldn't be scheduled. Open the app to retry." }
        }
    }
}

/// Monday–Sunday game weeks, interpreted in the league's Pacific time zone.
struct GameWeek: Identifiable {
    let id: String
    let label: String
    let games: [Game]

    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        return calendar
    }
    private static func formatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = format
        return formatter
    }
    static func key(for date: Date) -> String {
        let day = calendar.startOfDay(for: date)
        let offset = (calendar.component(.weekday, from: day) + 5) % 7
        return formatter("yyyy-MM-dd").string(from: calendar.date(byAdding: .day, value: -offset, to: day)!)
    }
    static func build(_ games: [Game]) -> [GameWeek] {
        let parser = formatter("yyyy-MM-dd")
        // Parse each distinct game day once and reuse formatters for the whole season.
        let calendar = calendar
        let monthDay = formatter("MMM d")
        let dayOnly = formatter("d")
        var groups: [String: [Game]] = [:]
        var dateKeys: [String: String] = [:]
        for game in games {
            let key: String
            if let existing = dateKeys[game.date] { key = existing }
            else {
                guard let date = parser.date(from: game.date) else { continue }
                let offset = (calendar.component(.weekday, from: date) + 5) % 7
                key = parser.string(from: calendar.date(byAdding: .day, value: -offset, to: date)!)
                dateKeys[game.date] = key
            }
            groups[key, default: []].append(game)
        }
        return groups.keys.sorted().map { key in
            let monday = parser.date(from: key)!
            let sunday = calendar.date(byAdding: .day, value: 6, to: monday)!
            let sameMonth = calendar.component(.month, from: monday) == calendar.component(.month, from: sunday)
            let label = monthDay.string(from: monday) + "–" + (sameMonth ? dayOnly : monthDay).string(from: sunday)
            return GameWeek(id: key, label: label, games: groups[key]!)
        }
    }
    static func defaultWeek(in weeks: [GameWeek], now: Date = Date()) -> GameWeek? {
        let today = key(for: now)
        return weeks.last(where: { $0.id <= today }) ?? weeks.first
    }
}

enum StatMetric: String, CaseIterable, Identifiable {
    case points = "Points"
    case goals = "Goals"
    case assists = "Assists"
    case gamesPlayed = "Games played"
    case pointsPerGame = "Points per game"
    var id: String { rawValue }
    func value(_ player: Skater) -> Double {
        switch self {
        case .points: Double(player.points)
        case .goals: Double(player.goals)
        case .assists: Double(player.assists)
        case .gamesPlayed: Double(player.gp)
        case .pointsPerGame: player.gp > 0 ? Double(player.points) / Double(player.gp) : 0
        }
    }
    func display(_ player: Skater) -> String {
        self == .pointsPerGame ? String(format: "%.2f", value(player)) : String(Int(value(player)))
    }
    func sorted(_ players: [Skater]) -> [Skater] {
        players.sorted {
            if value($0) != value($1) { return value($0) > value($1) }
            // NHL summary ordering; keep aligned with lib/stats-sort.ts.
            if self == .points {
                if $0.goals != $1.goals { return $0.goals > $1.goals }
                if $0.assists != $1.assists { return $0.assists > $1.assists }
            }
            return $0.id < $1.id
        }
    }
}

extension Skater {
    func matchesPlayerSearch(_ query: String) -> Bool {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty || name.localizedCaseInsensitiveContains(trimmed)
    }
}
