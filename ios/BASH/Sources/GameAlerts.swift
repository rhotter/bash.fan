import SwiftUI
import UserNotifications
import Security

enum GameAlertKind: String, CaseIterable {
    case goal, start, final
    var title: String {
        switch self {
        case .goal: "Goals"
        case .start: "Puck drop"
        case .final: "Final scores"
        }
    }
}

@MainActor final class GameAlerts: ObservableObject {
    static let shared = GameAlerts()
    @Published private(set) var teams = Set(UserDefaults.standard.stringArray(forKey: "pushTeams") ?? [])
    @Published private(set) var games = Set(UserDefaults.standard.stringArray(forKey: "pushGames") ?? [])
    @Published private(set) var kinds = Set(UserDefaults.standard.stringArray(forKey: "pushKinds") ?? GameAlertKind.allCases.map(\.rawValue))
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
            try? await save(teams: teams, games: games, kinds: kinds, enabled: false)
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
            do { try await save(teams: teams, games: games, kinds: kinds, enabled: !kinds.isEmpty && (!teams.isEmpty || !games.isEmpty)) }
            catch { if !teams.isEmpty || !games.isEmpty { message = error.localizedDescription } }
        }
    }
    func registrationFailed() { message = "Couldn’t connect to Apple notifications. Please try again." }
    func update(teams nextTeams: Set<String>, games nextGames: Set<String>, kinds nextKinds: Set<String>) async -> Bool {
        // Token registration can be saving in the background when Done is tapped.
        while busy {
            do { try await Task.sleep(for: .milliseconds(100)) } catch { return false }
        }
        guard nextTeams != teams || nextGames != games || nextKinds != kinds else { return true }
        busy = true; message = nil
        defer { busy = false }
        do {
            let enabled = !nextKinds.isEmpty && (!nextTeams.isEmpty || !nextGames.isEmpty)
            let adding = !nextTeams.subtracting(teams).isEmpty || !nextGames.subtracting(games).isEmpty || !nextKinds.subtracting(kinds).isEmpty
            if enabled && (adding || token == nil) {
                guard try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) else {
                    denied = true; message = "Allow notifications in Settings to receive game alerts."; return false
                }
                denied = false
                UIApplication.shared.registerForRemoteNotifications()
                // APNs registration is asynchronous; wait briefly without blocking the UI.
                for _ in 0..<30 where token == nil { try await Task.sleep(for: .milliseconds(100)) }
                guard token != nil else { message = "Apple notifications are still connecting. Please try again."; return false }
            }
            // Before APNs registration there is no server subscription to disable.
            if token != nil {
                try await save(teams: nextTeams, games: nextGames, kinds: nextKinds, enabled: enabled)
            }
            teams = nextTeams; games = nextGames; kinds = nextKinds
            UserDefaults.standard.set(Array(teams), forKey: "pushTeams")
            UserDefaults.standard.set(Array(games), forKey: "pushGames")
            UserDefaults.standard.set(Array(kinds), forKey: "pushKinds")
            return true
        } catch { message = error.localizedDescription; return false }
    }
    private func save(teams: Set<String>, games: Set<String>, kinds: Set<String>, enabled: Bool) async throws {
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
            "teams": Array(teams), "games": Array(games), "kinds": Array(kinds), "enabled": enabled])
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
    var onComplete: (() -> Void)?
    @ObservedObject private var alerts = GameAlerts.shared
    @Environment(\.dismiss) private var dismiss
    @State private var leagueTeams: [Standing] = []
    @State private var selectedTeams = GameAlerts.shared.teams
    @State private var selectedGames = GameAlerts.shared.games
    @State private var selectedKinds = GameAlerts.shared.kinds
    @State private var saving = false
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
                if onComplete != nil {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Which alerts do you want?").font(.title2.bold())
                            Text("Choose alert types and the teams you follow. You can change these anytime in Game alerts.")
                                .foregroundStyle(.secondary)
                        }.padding(.vertical, 8)
                    }
                }
                Section {
                    ForEach(GameAlertKind.allCases, id: \.rawValue) { kind in
                        Toggle(kind.title, isOn: Binding(
                            get: { selectedKinds.contains(kind.rawValue) },
                            set: { enabled in
                                if enabled { selectedKinds.insert(kind.rawValue) }
                                else { selectedKinds.remove(kind.rawValue) }
                            }
                        ))
                        .tint(Color(uiColor: .systemYellow))
                        .disabled(saving)
                        .accessibilityIdentifier("alertKind-\(kind.rawValue)")
                    }
                } header: { Text("Alert types") }
                if let game, game.status != "final" {
                    Section("This game") {
                        selection("\(game.awayTeam) at \(game.homeTeam)", selected: selectedGames.contains(game.id)) {
                            toggleGame(game.id)
                        }
                    }
                }
                Section {
                    ForEach(teams, id: \.slug) { team in
                        Button {
                            if !selectedTeams.insert(team.slug).inserted { selectedTeams.remove(team.slug) }
                        } label: {
                            HStack(spacing: 12) {
                                TeamLogo(slug: team.slug, size: 36)
                                Text(team.name).foregroundStyle(.primary)
                                Spacer()
                                if selectedTeams.contains(team.slug) { Image(systemName: "checkmark").foregroundStyle(.primary) }
                            }
                        }.disabled(saving)
                        .accessibilityValue(selectedTeams.contains(team.slug) ? "Following" : "Not following")
                    }
                } header: { Text("Teams") } footer: {
                    Text("Select teams to receive their game alerts.")
                }
                let otherGames = alerts.games.filter { $0 != game?.id }.sorted()
                if !otherGames.isEmpty {
                    Section("Individual games") {
                        ForEach(otherGames, id: \.self) { id in
                            selection(games.first { $0.id == id }.map { "\($0.awayTeam) at \($0.homeTeam)" } ?? "Game \(id)", selected: selectedGames.contains(id)) { toggleGame(id) }
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
            .overlay { if saving { ProgressView().padding(20).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16)) } }
            .navigationTitle("Game alerts").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let onComplete {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Not now", action: onComplete).disabled(saving)
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(onComplete == nil ? "Done" : "Continue") {
                        saving = true
                        Task {
                            if await alerts.update(teams: selectedTeams, games: selectedGames, kinds: selectedKinds) {
                                if let onComplete { onComplete() } else { dismiss() }
                            }
                            saving = false
                        }
                    }.disabled(saving)
                }
            }
            .interactiveDismissDisabled(saving)
            .task {
                await alerts.refreshAuthorization()
                if let snapshot: LeagueSnapshot = try? await LeagueAPI.fetch("", maxAge: 120) { leagueTeams = snapshot.standings }
            }
        }.tint(.primary)
    }
    private func toggleGame(_ id: String) {
        if !selectedGames.insert(id).inserted { selectedGames.remove(id) }
    }
    private func selection(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack { Text(title).foregroundStyle(.primary); Spacer(); Image(systemName: selected ? "bell.fill" : "bell").foregroundStyle(.primary) }
        }.disabled(saving).accessibilityValue(selected ? "Following" : "Not following")
    }
}
