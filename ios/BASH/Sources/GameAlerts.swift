import SwiftUI
import UserNotifications
import Security

@MainActor final class GameAlerts: ObservableObject {
    static let shared = GameAlerts()
    @Published private(set) var teams = Set(UserDefaults.standard.stringArray(forKey: "pushTeams") ?? [])
    @Published private(set) var games = Set(UserDefaults.standard.stringArray(forKey: "pushGames") ?? [])
    @Published var busy = false
    @Published var message: String?
    @Published var denied = false
    private var token: String? = UserDefaults.standard.string(forKey: "pushToken")
    private let endpoint = URL(string: "https://www.bayareastreethockey.com/api/bash/notifications/devices")!

    private func identity() throws -> (String, String) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "fan.bash.league.push", kSecAttrAccount as String: "installation"]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query.merging([kSecReturnData as String: true]) { _, new in new } as CFDictionary, &result)
        if status == errSecSuccess, let data = result as? Data,
           let value = String(data: data, encoding: .utf8) {
            let parts = value.split(separator: ":").map(String.init)
            if parts.count == 2 { return (parts[0], parts[1]) }
        }
        guard status == errSecItemNotFound else { throw AlertError.unavailable }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw AlertError.unavailable }
        let id = UUID().uuidString, secret = bytes.map { String(format: "%02x", $0) }.joined()
        let add = query.merging([kSecValueData as String: Data("\(id):\(secret)".utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]) { _, new in new }
        guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else { throw AlertError.unavailable }
        return (id, secret)
    }
    enum AlertError: LocalizedError {
        case unavailable
        var errorDescription: String? { "Couldn’t prepare game alerts. Please try again." }
    }
    func refreshAuthorization() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        denied = settings.authorizationStatus == .denied
        if settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional {
            UIApplication.shared.registerForRemoteNotifications()
        } else if denied, token != nil {
            try? await save(teams: teams, games: games, enabled: false)
        }
    }
    func registered(_ data: Data) {
        token = data.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(token, forKey: "pushToken")
        let registeredToken = token
        Task {
            // Serialize token refresh with preference edits; never overwrite a new selection
            // with the preferences from an earlier registration request.
            while busy {
                do { try await Task.sleep(for: .milliseconds(100)) } catch { return }
            }
            guard token == registeredToken else { return }
            busy = true
            defer { busy = false }
            do { try await save(teams: teams, games: games, enabled: !teams.isEmpty || !games.isEmpty) }
            catch { if !teams.isEmpty || !games.isEmpty { message = error.localizedDescription } }
        }
    }
    func registrationFailed() { message = "Couldn’t connect to Apple notifications. Please try again." }
    func toggleTeam(_ slug: String) async {
        var next = teams
        if !next.insert(slug).inserted { next.remove(slug) }
        await update(teams: next, games: games)
    }
    func toggleGame(_ id: String) async {
        var next = games
        if !next.insert(id).inserted { next.remove(id) }
        await update(teams: teams, games: next)
    }
    private func update(teams nextTeams: Set<String>, games nextGames: Set<String>) async {
        guard !busy else { return }
        busy = true; message = nil
        defer { busy = false }
        do {
            let adding = !nextTeams.subtracting(teams).isEmpty || !nextGames.subtracting(games).isEmpty
            if adding {
                guard try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) else {
                    denied = true; message = "Allow notifications in Settings to receive game alerts."; return
                }
                denied = false
                UIApplication.shared.registerForRemoteNotifications()
                // APNs registration is asynchronous; wait briefly without blocking the UI.
                for _ in 0..<30 where token == nil { try await Task.sleep(for: .milliseconds(100)) }
                guard token != nil else { message = "Apple notifications are still connecting. Please try again."; return }
            }
            try await save(teams: nextTeams, games: nextGames, enabled: !nextTeams.isEmpty || !nextGames.isEmpty)
            teams = nextTeams; games = nextGames
            UserDefaults.standard.set(Array(teams), forKey: "pushTeams")
            UserDefaults.standard.set(Array(games), forKey: "pushGames")
        } catch { message = error.localizedDescription }
    }
    private func save(teams: Set<String>, games: Set<String>, enabled: Bool) async throws {
        guard let token else { throw AlertError.unavailable }
        let (id, secret) = try identity()
#if DEBUG
        let environment = "sandbox"
#else
        let environment = "production"
#endif
        var request = URLRequest(url: endpoint)
        request.httpMethod = "PUT"; request.timeoutInterval = 15
        request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["id": id, "token": token, "environment": environment,
            "teams": Array(teams), "games": Array(games), "enabled": enabled])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            let error = (try? JSONSerialization.jsonObject(with: data)) as? [String: String]
            throw NSError(domain: "GameAlerts", code: 1, userInfo: [NSLocalizedDescriptionKey: error?["error"] ?? "Couldn’t save alerts. Please try again."])
        }
    }
}

struct GameAlertsScreen: View {
    let games: [Game]
    var game: Game?
    @ObservedObject private var alerts = GameAlerts.shared
    @Environment(\.dismiss) private var dismiss
    @State private var leagueTeams: [Standing] = []
    private var teams: [(slug: String, name: String)] {
        var names: [String: String] = [:]
        for match in games + (game.map { [$0] } ?? []) {
            if let slug = match.homeSlug { names[slug] = match.homeTeam }
            if let slug = match.awaySlug { names[slug] = match.awayTeam }
        }
        for team in leagueTeams { names[team.slug] = team.team }
        for slug in alerts.teams where names[slug] == nil { names[slug] = slug.replacingOccurrences(of: "-", with: " ").capitalized }
        return names.map { (slug: $0.key, name: $0.value) }.sorted { $0.name < $1.name }
    }
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label("Goals, puck drop and final scores", systemImage: "bell.badge")
                        .font(.subheadline)
                } footer: { Text("Choose your team to receive alerts for its games. Tap an alert to open the game.") }
                if let game, game.status != "final" {
                    Section("This game") {
                        selection("\(game.awayTeam) at \(game.homeTeam)", selected: alerts.games.contains(game.id)) {
                            await alerts.toggleGame(game.id)
                        }
                    }
                }
                Section("Teams") {
                    ForEach(teams, id: \.slug) { team in
                        Button { Task { await alerts.toggleTeam(team.slug) } } label: {
                            HStack(spacing: 12) {
                                TeamLogo(slug: team.slug, size: 36)
                                Text(team.name).foregroundStyle(.primary)
                                Spacer()
                                if alerts.teams.contains(team.slug) { Image(systemName: "checkmark").foregroundStyle(.primary) }
                            }
                        }.disabled(alerts.busy)
                        .accessibilityValue(alerts.teams.contains(team.slug) ? "Following" : "Not following")
                    }
                }
                let otherGames = alerts.games.filter { $0 != game?.id }.sorted()
                if !otherGames.isEmpty {
                    Section("Individual games") {
                        ForEach(otherGames, id: \.self) { id in
                            selection(games.first { $0.id == id }.map { "\($0.awayTeam) at \($0.homeTeam)" } ?? "Game \(id)", selected: true) { await alerts.toggleGame(id) }
                        }
                    }
                }
                if let message = alerts.message {
                    Section { Text(message).font(.footnote).foregroundStyle(.secondary) }
                }
                if alerts.denied {
                    Button("Open notification settings") {
                        UIApplication.shared.open(URL(string: UIApplication.openNotificationSettingsURLString)!)
                    }
                }
            }
            .overlay { if alerts.busy { ProgressView().padding(20).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16)) } }
            .navigationTitle("Game alerts").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task {
                await alerts.refreshAuthorization()
                if let snapshot: LeagueSnapshot = try? await LeagueAPI.fetch("", maxAge: 120) { leagueTeams = snapshot.standings }
            }
        }.tint(.primary)
    }
    private func selection(_ title: String, selected: Bool, action: @escaping () async -> Void) -> some View {
        Button { Task { await action() } } label: {
            HStack { Text(title).foregroundStyle(.primary); Spacer(); Image(systemName: selected ? "bell.fill" : "bell").foregroundStyle(.primary) }
        }.disabled(alerts.busy).accessibilityValue(selected ? "Following" : "Not following")
    }
}
