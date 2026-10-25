import Foundation
import Security
import CryptoKit

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
        guard let raw = value("server"), let server = URL(string: raw), let host = server.host,
              server.user == nil, server.password == nil, server.query == nil, server.fragment == nil,
              let session = value("session"), UUID(uuidString: session) != nil,
              let side = value("side"), ["left", "right"].contains(side),
              let token = value("token"), token.count == 43 else { throw CaptureError.message("Invalid camera setup link.") }
        let local = host == "localhost" || host.hasSuffix(".local") || host.hasPrefix("192.168.") || host.hasPrefix("10.") || host == "127.0.0.1"
        guard server.scheme == "https" || (server.scheme == "http" && local) else { throw CaptureError.message("Use HTTPS, or a local development address.") }
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

struct CameraConfiguration: Decodable {
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
