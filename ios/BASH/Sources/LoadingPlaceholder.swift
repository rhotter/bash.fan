import SwiftUI

/// Static placeholders avoid the rendering cost and motion of an animated shimmer.
struct LoadingPlaceholder: View {
    let title: String
    var rows = 4
    var matchups = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(title).font(.subheadline).foregroundStyle(.secondary)
            }
            VStack(spacing: matchups ? 12 : 0) {
                ForEach(0..<rows, id: \.self) { index in
                    HStack(spacing: 12) {
                        Circle().fill(.quaternary).frame(width: matchups ? 40 : 30, height: matchups ? 40 : 30)
                        VStack(alignment: .leading, spacing: 8) {
                            bar(width: matchups ? 65 : 130)
                            if matchups { bar(width: 45) }
                        }
                        Spacer()
                        bar(width: matchups ? 50 : 30)
                        if matchups { Circle().fill(.quaternary).frame(width: 40, height: 40) }
                    }.padding(14).frame(minHeight: matchups ? 94 : 58)
                        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
                    if !matchups && index < rows - 1 { Divider().padding(.horizontal, 14) }
                }
            }.background(matchups ? Color.clear : Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
                .accessibilityHidden(true)
        }.accessibilityElement(children: .ignore).accessibilityLabel(title)
            .accessibilityIdentifier("loadingPlaceholder")
            .allowsHitTesting(false)
    }
    private func bar(width: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4).fill(.quaternary).frame(width: width, height: 10)
    }
}
