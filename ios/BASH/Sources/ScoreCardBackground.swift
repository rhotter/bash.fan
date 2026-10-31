import SwiftUI

/// Team/franchise hues from the website, tuned for small logo backgrounds.
/// Unknown teams retain a neutral surface rather than guessing from their artwork.
enum TeamPalette {
    private static let colors: [(String, UInt32)] = [
        ("coxswain-bawls-hockey-club", 0xFA9B2B),
        ("lazy-skater-dangle", 0xEBEBEB),
        ("mitch-a-palooza", 0xFBFF30),
        ("dangleberries", 0x227EFD), ("dolo-minions", 0x080808),
        ("money-shots", 0x00A010), ("regretzkys", 0xF11616),
        ("landsharks", 0x252525), ("land-sharks", 0x000000),
        ("rink-rats", 0x365DA6), ("rinkrats", 0x365DA6),
        ("team-canada", 0xE60000), ("team-usa", 0x0004DB),
        ("team-dark", 0x303030), ("team-light", 0xD1D1D1),
        ("cherry-bomb", 0xF82020), ("red-army", 0xF82020), ("red-leafs", 0xF82020),
        ("roadrunners", 0xF9FAFB), ("bruins", 0xF9D806), ("kings", 0xF9D806),
        ("yetis", 0xD3D3D3), ("loons", 0xE5D500), ("seals", 0x95B893),
        ("reign", 0x7F1DEE), ("haze", 0xF88F16), ("bash", 0xF36527)
    ]
    static func color(_ slug: String?, lift: Double = 0, shade: Double = 0) -> Color {
        let slug = slug?.lowercased() ?? ""
        let hex = colors.first { slug.contains($0.0) }?.1 ?? 0x737A85
        let rgb = (Double((hex >> 16) & 255) / 255,
                   Double((hex >> 8) & 255) / 255,
                   Double(hex & 255) / 255)
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
                Circle().fill(TeamPalette.color(slug))
            } else {
                Circle().fill(LinearGradient(stops: [
                    .init(color: TeamPalette.color(slug, lift: 0.12), location: 0),
                    .init(color: TeamPalette.color(slug, lift: 0), location: 0.40),
                    .init(color: TeamPalette.color(slug, shade: 0.12), location: 0.78),
                    .init(color: TeamPalette.color(slug, shade: 0.30), location: 1)
                ], startPoint: .topLeading, endPoint: .bottomTrailing))
            }
        }
        .shadow(color: .black.opacity(0.18), radius: 2, y: 1)
        .accessibilityHidden(true)
    }
}
