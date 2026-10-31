import ActivityKit
import WidgetKit
import SwiftUI

@main struct BASHLiveScoreWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GameActivityAttributes.self) { context in
            LiveScoreCard(attributes: context.attributes, state: context.state, stale: context.isStale)
                .activityBackgroundTint(.black)
                .activitySystemActionForegroundColor(.white)
                .widgetURL(URL(string: "bash://game/\(context.attributes.gameID)"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { SportsLogo(slug: context.attributes.awaySlug, size: 32) }
                DynamicIslandExpandedRegion(.trailing) { SportsLogo(slug: context.attributes.homeSlug, size: 32) }
                DynamicIslandExpandedRegion(.center) {
                    Text("\(context.state.awayScore) – \(context.state.homeScore)").font(.title2.bold()).monospacedDigit()
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 3) {
                        if context.state.final { Text("Final").font(.caption) }
                        else { SportsClock(state: context.state, stale: context.isStale).font(.caption) }
                        Text(context.state.scorer).font(.caption).lineLimit(1)
                    }
                }
            } compactLeading: {
                HStack(spacing: 3) { SportsLogo(slug: context.attributes.awaySlug, size: 20); Text("\(context.state.awayScore)") }
            } compactTrailing: {
                HStack(spacing: 3) { Text("\(context.state.homeScore)"); SportsLogo(slug: context.attributes.homeSlug, size: 20) }
            } minimal: {
                Text("\(context.state.awayScore)–\(context.state.homeScore)").font(.caption2).monospacedDigit()
            }
            .widgetURL(URL(string: "bash://game/\(context.attributes.gameID)"))
        }
    }
}
