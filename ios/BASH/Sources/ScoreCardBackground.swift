import SwiftUI

/// Logo-inspired colors; unknown/historical teams keep a neutral surface.
private enum TeamPalette {
    static func color(_ slug: String?, lift: Double = 0, shade: Double = 0) -> Color {
        let slug = slug?.lowercased() ?? ""
        let rgb: (Double, Double, Double)
        if slug.contains("regretzkys") { rgb = (0.80, 0.15, 0.23) }
        else if slug.contains("yetis") { rgb = (0.22, 0.43, 0.86) }
        else if slug.contains("rinkrats") || slug.contains("rink-rats") { rgb = (0.40, 0.47, 0.53) }
        else if slug.contains("loons") { rgb = (0.15, 0.30, 0.35) }
        else if slug.contains("seals") { rgb = (0.90, 0.69, 0.15) }
        else if slug.contains("landsharks") { rgb = (0.17, 0.64, 0.73) }
        else if slug.contains("bash") { rgb = (0.95, 0.40, 0.15) }
        else { rgb = (0.45, 0.48, 0.52) }
        func channel(_ value: Double) -> Double { (value + (1 - value) * lift) * (1 - shade) }
        return Color(red: channel(rgb.0), green: channel(rgb.1), blue: channel(rgb.2))
    }
}

struct TeamCircleBackground: View {
    let slug: String?
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        ZStack {
            if reduceTransparency {
                Circle().fill(TeamPalette.color(slug, lift: 0.30))
            } else {
                Circle().fill(LinearGradient(stops: [
                    .init(color: TeamPalette.color(slug, lift: 0.55), location: 0),
                    .init(color: TeamPalette.color(slug, lift: 0.30), location: 0.40),
                    .init(color: TeamPalette.color(slug, lift: 0.06), location: 0.78),
                    .init(color: TeamPalette.color(slug, shade: 0.18), location: 1)
                ], startPoint: .topLeading, endPoint: .bottomTrailing))
            }
        }
        .shadow(color: .black.opacity(0.18), radius: 2, y: 1)
        .accessibilityHidden(true)
    }
}
