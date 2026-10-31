import SwiftUI

// Shared by the app, Live Activity, and notification extensions.
enum SportsTeam {
    static func asset(_ slug: String) -> String? {
        let keys = ["bashers", "bash", "dangleberries", "landsharks", "loons", "regretzkys", "reign", "rinkrats", "rink-rats", "seals", "yetis", "last-licks", "licks", "coxswain-bawls-hockey-club", "team-usa", "team-canada", "dolo-minions", "lazy-skater-dangle", "money-shots", "mitch-a-palooza"]
        guard let key = keys.first(where: { slug.lowercased().contains($0) }) else { return nil }
        return ["rink-rats": "rinkrats", "licks": "last-licks"][key] ?? key
    }
}
struct SportsLogo: View {
    var slug: String
    var size: CGFloat = 42
    var body: some View {
        Group {
            if let asset = SportsTeam.asset(slug) {
                Image(asset).resizable().scaledToFit()
            } else { Image(systemName: "shield.fill").resizable().scaledToFit().foregroundStyle(.secondary) }
        }
        .padding(4).frame(width: size, height: size)
        .shadow(color: .white.opacity(0.9), radius: 0.5)
        .accessibilityHidden(true)
    }
}
struct LiveScoreCard: View {
    var attributes: GameActivityAttributes
    var state: GameActivityAttributes.ContentState
    var stale = false
    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Text("BASH").font(.caption2.weight(.semibold))
                Spacer()
                Text(state.final ? "Final" : stale ? "Updating…" : state.status).font(.caption2)
            }.foregroundStyle(.white.opacity(0.8))
            HStack(spacing: 8) {
                team(attributes.awayTeam, slug: attributes.awaySlug)
                VStack(spacing: 5) {
                    Text("\(state.awayScore) – \(state.homeScore)")
                        .font(.system(size: 32, weight: .bold, design: .rounded)).monospacedDigit()
                    if state.final { Text("Final").font(.caption.weight(.semibold)) }
                    else {
                        SportsClock(state: state, stale: stale).font(.caption.weight(.semibold))
                    }
                }.fixedSize(horizontal: false, vertical: true)
                team(attributes.homeTeam, slug: attributes.homeSlug)
            }
            if !state.scorer.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text(state.scorer).font(.subheadline.weight(.semibold)).lineLimit(1)
                    if !state.assists.isEmpty { Text(state.assists).font(.caption).foregroundStyle(.white.opacity(0.8)).lineLimit(1) }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }.foregroundStyle(.white).padding(.horizontal, 16).padding(.vertical, 12)
            .background(LinearGradient(colors: [TeamPalette.color(attributes.awaySlug, shade: 0.60), TeamPalette.color(attributes.homeSlug, shade: 0.55)], startPoint: .leading, endPoint: .trailing))
    }
    private func team(_ name: String, slug: String) -> some View {
        VStack(spacing: 4) {
            SportsLogo(slug: slug, size: 36)
            Text(name).font(.caption).multilineTextAlignment(.center).lineLimit(1)
        }.frame(maxWidth: .infinity)
    }
}
struct SportsClock: View {
    var state: GameActivityAttributes.ContentState
    var stale = false
    var body: some View {
        HStack(spacing: 5) {
            Text(state.period)
            if stale { Text("—:—") }
            else if let end = state.clockEndsAt, end > Date().timeIntervalSince1970 {
                Text(timerInterval: Date()...Date(timeIntervalSince1970: end), countsDown: true, showsHours: false)
                    .monospacedDigit().frame(maxWidth: 55)
            } else { Text(state.clockEndsAt == nil ? state.clock : "0:00").monospacedDigit() }
        }
    }
}
struct GoalAlertCard: View {
    var title: String
    var score: String
    var scorer: String
    var assists: String
    var slug: String
    var body: some View {
        HStack(spacing: 14) {
            SportsLogo(slug: slug, size: 58)
                .background(TeamCircleBackground(slug: slug))
                .overlay(alignment: .bottomTrailing) {
                    Image("NotificationBadge").resizable().frame(width: 22, height: 22)
                        .clipShape(RoundedRectangle(cornerRadius: 5))
                        .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color(uiColor: .secondarySystemBackground), lineWidth: 2))
                }
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(score).font(.subheadline.weight(.medium))
                if !scorer.isEmpty { Text(scorer).font(.subheadline) }
                if !assists.isEmpty { Text(assists).font(.caption).foregroundStyle(.secondary) }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }.padding(16).background(Color(uiColor: .secondarySystemBackground))
    }
}
