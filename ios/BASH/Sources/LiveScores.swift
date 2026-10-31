import ActivityKit
import SwiftUI

@MainActor final class LiveScores: ObservableObject {
    static let shared = LiveScores()
    @Published private(set) var games: Set<String> = []
    @Published var error: String?
    @Published var busy = false
    private var watchers: [String: Task<Void, Never>] = [:]
    private var states: [String: Task<Void, Never>] = [:]
    private var observing = false

    func restore() {
        guard !observing else { return }
        observing = true
        for activity in Activity<GameActivityAttributes>.activities { observe(activity) }
        Task {
            for await activity in Activity<GameActivityAttributes>.activityUpdates { observe(activity) }
        }
    }
    func start(_ game: Game) async {
        guard !games.contains(game.id), !busy else { return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            error = "Allow Live Activities for BASH in iPhone Settings to follow scores on your Lock Screen."; return
        }
        busy = true; error = nil
        defer { busy = false }
        do {
            let live: GameLive = try await LeagueAPI.fetch("/game/\(game.id)/live", maxAge: 0)
            guard live.status == "live" else { error = "Live scores are available while a game is in progress."; return }
            let period = live.state.period
            let seconds = max(0, live.state.clockSeconds ?? 0)
            let running = live.state.clockRunning == true && live.state.clockStartedAt != nil
            let end = running ? live.state.clockStartedAt! / 1000 + seconds : nil
            let remaining = end.map { max(0, $0 - Date().timeIntervalSince1970) } ?? seconds
            let last = live.orderedGoals.last
            let assists = [last?.assist1Id, last?.assist2Id].compactMap { $0 }.map { live.name($0) }
            let content = GameActivityAttributes.ContentState(homeScore: live.homeScore ?? game.homeScore ?? 0,
                awayScore: live.awayScore ?? game.awayScore ?? 0,
                period: period <= 3 ? "P\(period)" : period == 4 ? "OT" : game.isPlayoff ? "\(period - 3)OT" : "SO",
                clock: String(format: "%d:%02d", Int(remaining) / 60, Int(remaining) % 60), clockEndsAt: end,
                final: false, status: "Live", scorer: last.map { "\(live.name($0.scorerId)) · \($0.clock)" } ?? "",
                assists: assists.isEmpty ? "" : "Assists: \(assists.joined(separator: ", "))")
            let activity = try Activity.request(attributes: GameActivityAttributes(gameID: game.id, homeTeam: game.homeTeam,
                awayTeam: game.awayTeam, homeSlug: game.homeSlug ?? "", awaySlug: game.awaySlug ?? ""),
                content: ActivityContent(state: content, staleDate: Date().addingTimeInterval(180)), pushType: .token)
            observe(activity)
        } catch { self.error = "Couldn’t start live scores. \(error.localizedDescription)" }
    }
    func stop(_ gameID: String) async {
        for activity in Activity<GameActivityAttributes>.activities where activity.attributes.gameID == gameID {
            await activity.end(nil, dismissalPolicy: .immediate)
            try? await GameAlerts.shared.updateActivity(id: activity.id, gameID: gameID, token: nil)
            watchers.removeValue(forKey: activity.id)?.cancel()
        }
        games.remove(gameID)
    }
    private func observe(_ activity: Activity<GameActivityAttributes>) {
        guard watchers[activity.id] == nil, activity.activityState == .active || activity.activityState == .stale else { return }
        games.insert(activity.attributes.gameID)
        watchers[activity.id] = Task {
            if let token = activity.pushToken { await register(token, activity: activity) }
            for await token in activity.pushTokenUpdates {
                guard !Task.isCancelled else { return }
                await register(token, activity: activity)
            }
        }
        states[activity.id] = Task {
            for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
                games.remove(activity.attributes.gameID)
                watchers.removeValue(forKey: activity.id)?.cancel()
                try? await GameAlerts.shared.updateActivity(id: activity.id, gameID: activity.attributes.gameID, token: nil)
                states.removeValue(forKey: activity.id)
                break
            }
        }
    }
    private func register(_ data: Data, activity: Activity<GameActivityAttributes>) async {
        let token = data.map { String(format: "%02x", $0) }.joined()
        while !Task.isCancelled && (activity.activityState == .active || activity.activityState == .stale) {
            do {
                try await GameAlerts.shared.updateActivity(id: activity.id, gameID: activity.attributes.gameID, token: token)
                error = nil; return
            } catch let failure as NSError where failure.domain == "LiveScores" && failure.code == 409 {
                await stop(activity.attributes.gameID)
                error = "This game can no longer be followed on the Lock Screen."
                return
            } catch {
                self.error = "Live score updates couldn’t connect. Retrying…"
                do { try await Task.sleep(for: .seconds(15)) } catch { return }
            }
        }
    }
}

#if DEBUG
struct SportsPreviewScreen: View {
    private let attributes = GameActivityAttributes(gameID: "g208", homeTeam: "Landsharks", awayTeam: "Rink Rats", homeSlug: "landsharks", awaySlug: "rink-rats")
    private let state = GameActivityAttributes.ContentState(homeScore: 1, awayScore: 0, period: "P1", clock: "18:35", final: false, status: "Live", scorer: "Nicholas MacNab · P1 18:35", assists: "Assists: Player A, Player B")
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Lock Screen live score").font(.headline)
                    LiveScoreCard(attributes: attributes, state: state).clipShape(RoundedRectangle(cornerRadius: 24))
                    Text("Expanded goal alert").font(.headline).padding(.top, 14)
                    GoalAlertCard(title: "Landsharks goal!", score: "Rink Rats 0 · Landsharks 1", scorer: state.scorer, assists: state.assists, slug: "landsharks")
                        .clipShape(RoundedRectangle(cornerRadius: 24))
                }.padding()
            }.background(Color(uiColor: .systemGroupedBackground)).navigationTitle("Sports alerts")
        }
    }
}
#endif
