import ActivityKit
import Foundation

struct GameActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var homeScore: Int
        var awayScore: Int
        var period: String
        var clock: String
        var clockEndsAt: Double?
        var final: Bool
        var status: String
        var scorer: String
        var assists: String
    }
    var gameID: String
    var homeTeam: String
    var awayTeam: String
    var homeSlug: String
    var awaySlug: String
}
