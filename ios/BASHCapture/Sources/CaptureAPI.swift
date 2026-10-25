import Foundation
import Security
import CryptoKit

func captureServerURL(_ text: String) throws -> URL {
    guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
          let host = url.host, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
          url.path.isEmpty || url.path == "/" else { throw CaptureError.message("Enter the website address, for example https://bash.fan.") }
    let parts = host.split(separator: ".", omittingEmptySubsequences: false)
    let octets = parts.compactMap { Int($0) }
    let privateIP = parts.count == 4 && octets.count == 4 && octets.allSatisfy { (0...255).contains($0) } && (octets[0] == 10 || (octets[0] == 192 && octets[1] == 168) || (octets[0] == 172 && (16...31).contains(octets[1])))
    let local = host == "localhost" || host == "127.0.0.1" || host.hasSuffix(".local") || privateIP
    guard url.scheme == "https" || (url.scheme == "http" && local) else { throw CaptureError.message("Use HTTPS, or your local development server.") }
    return url
}

struct Pairing: Codable, Sendable {
    let server: URL
    let session: String
    let side: String
    let token: String
    var key: String { SHA256.hash(data: Data("\(server.absoluteString)/\(session)/\(side)".utf8)).map { String(format: "%02x", $0) }.joined() }
    var endpoint: URL { server.appending(path: "api/bash/video/camera/\(session)/\(side)") }

    init(link: String) throws {
        guard let components = URLComponents(string: link.trimmingCharacters(in: .whitespacesAndNewlines)), components.scheme == "bashcapture", components.host == "pair" else { throw CaptureError.message("Paste a camera setup link from the BASH dashboard.") }
        let items = components.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard let raw = value("server"),
              let session = value("session"), UUID(uuidString: session) != nil,
              let side = value("side"), ["left", "right"].contains(side),
              let token = value("token"), token.count == 43 else { throw CaptureError.message("Invalid camera setup link.") }
        let server = try captureServerURL(raw)
        self.server = server; self.session = session; self.side = side; self.token = token
    }
}

enum CaptureError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let value) = self { return value }; return nil }
}

enum CameraKeychain {
    static func save(_ pairing: Pairing) throws {
        let data = try JSONEncoder().encode(pairing)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "fan.bash.capture", kSecAttrAccount as String: pairing.key]
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var insert = query; insert[kSecValueData as String] = data; insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { throw CaptureError.message("Could not save camera credentials.") }
        } else if status != errSecSuccess { throw CaptureError.message("Could not update camera credentials.") }
    }
    static func load(_ key: String) -> Pairing? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "fan.bash.capture", kSecAttrAccount as String: key, kSecReturnData as String: true]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(Pairing.self, from: data)
    }
}

struct CaptureGame: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let date: String
    let time: String
    let status: String
    let location: String?
    let homeTeam: String
    let awayTeam: String
    var matchup: String { "\(awayTeam) at \(homeTeam)" }
    var dateLabel: String {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "America/Los_Angeles"); formatter.dateFormat = "yyyy-MM-dd"
        guard let value = formatter.date(from: date) else { return date }
        formatter.setLocalizedDateFormatFromTemplate("EEE MMM d")
        return formatter.string(from: value)
    }
}
struct CameraConfiguration: Decodable {
    let title: String?
    let game: CaptureGame?
    let ended: Bool
    let serverTime: Double
    let rtmpsUrl: String?
    let streamKey: String?
}
struct UploadTicket: Decodable { let url: String?; let alreadyUploaded: Bool }
struct UploadConfirmation: Decodable { let verified: Bool }
struct HeartbeatResponse: Decodable { let ended: Bool; let serverTime: Double }

@MainActor
enum CaptureAPI {
    static func call<T: Decodable>(_ pairing: Pairing, body: [String: Any]? = nil) async throws -> T {
        var request = URLRequest(url: pairing.endpoint)
        request.timeoutInterval = 20
        request.setValue("Bearer \(pairing.token)", forHTTPHeaderField: "Authorization")
        if let body { request.httpMethod = "POST"; request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: String])?["error"] ?? "Could not reach BASH. Recording remains on this phone."
            throw CaptureError.message(message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

struct ClockReply: Decodable { let receivedAt: Double; let sentAt: Double }
struct CaptureClockAnchor: Codable, Sendable {
    let serverMilliseconds: Double
    let uptimeSeconds: Double
    let estimatedNetworkErrorMs: Double
    var serverDate: Date { Date(timeIntervalSince1970: (serverMilliseconds + (ProcessInfo.processInfo.systemUptime - uptimeSeconds) * 1000) / 1000) }
}
extension CaptureAPI {
    static func synchronize(_ pairing: Pairing, samples: Int = 5) async throws -> CaptureClockAnchor {
        var best: CaptureClockAnchor?
        for _ in 0..<samples {
            let sent = ProcessInfo.processInfo.systemUptime
            let reply: ClockReply = try await call(pairing, body: ["action": "clock"])
            let received = ProcessInfo.processInfo.systemUptime
            guard reply.sentAt >= reply.receivedAt else { continue }
            let networkDelay = max(0, (received - sent) * 1000 - (reply.sentAt - reply.receivedAt))
            let sample = CaptureClockAnchor(serverMilliseconds: (reply.receivedAt + reply.sentAt) / 2,
                uptimeSeconds: (sent + received) / 2, estimatedNetworkErrorMs: networkDelay / 2)
            if best == nil || sample.estimatedNetworkErrorMs < best!.estimatedNetworkErrorMs { best = sample }
        }
        guard let best else { throw CaptureError.message("Could not check the camera clock. Try connecting again.") }
        return best
    }
}
