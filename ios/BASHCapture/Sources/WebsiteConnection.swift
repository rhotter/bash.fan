import Foundation

private struct GamesResponse: Decodable { let games: [CaptureGame] }
private struct ClaimResponse: Decodable { let sessionId: String; let side: String; let token: String }
private struct OKResponse: Decodable { let ok: Bool }
private struct WebsiteError: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
}

@MainActor
final class WebsiteConnection: ObservableObject {
    @Published private(set) var games: [CaptureGame] = []
    @Published private(set) var signedIn = false
    @Published private(set) var busy = false
    @Published var error: String?
    @Published var cameraConflict = false
    // Operator cookies last only for this app session. The PIN is never saved.
    private let session = URLSession(configuration: .ephemeral)
    private var authenticatedServer: URL?

    private func serverURL() throws -> URL {
        try BASHService.server()
    }
    private func call<T: Decodable>(_ server: URL, _ path: String, body: [String: Any]? = nil) async throws -> T {
        var request = URLRequest(url: server.appending(path: path), cachePolicy: .reloadIgnoringLocalCacheData); request.timeoutInterval = 20
        if let body { request.httpMethod = "POST"; request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
            if (response as? HTTPURLResponse)?.statusCode == 401 { signedIn = false }
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: String])?["error"] ?? "Could not reach the website. Try again."
            throw WebsiteError(status: (response as? HTTPURLResponse)?.statusCode ?? 0, message: message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
    func signIn(pin: String) async {
        guard !busy else { return }; busy = true; error = nil; defer { busy = false }
        do {
            let server = try serverURL()
            let _: OKResponse = try await call(server, "api/bash/admin/login", body: ["pin": pin.trimmingCharacters(in: .whitespacesAndNewlines)])
            authenticatedServer = server; signedIn = true
            // A schedule outage must not discard a successful operator login.
            await refresh()
        } catch { self.error = error.localizedDescription; signedIn = false }
    }
    func refresh() async {
        guard let server = authenticatedServer, signedIn else { return }
        do { let result: GamesResponse = try await call(server, "api/bash/video/games"); games = result.games; error = nil }
        catch { self.error = error.localizedDescription }
    }
    func choose(_ game: CaptureGame, side: String, camera: CaptureController, replace: Bool = false) async -> Bool {
        guard let server = authenticatedServer, !busy, !camera.recording else { return false }
        busy = true; error = nil; cameraConflict = false; defer { busy = false }
        do {
            let pairing: Pairing
            if !replace, let current = camera.pairing, current.server == server, current.side == side,
               camera.configuration?.game?.id == game.id, camera.configuration?.ended == false {
                pairing = current
            } else {
                let claim: ClaimResponse = try await call(server, "api/bash/video/games", body: ["gameId": game.id, "side": side, "replace": replace])
                var link = URLComponents(); link.scheme = "bashcapture"; link.host = "pair"
                link.queryItems = [URLQueryItem(name: "server", value: server.absoluteString), URLQueryItem(name: "session", value: claim.sessionId), URLQueryItem(name: "side", value: claim.side), URLQueryItem(name: "token", value: claim.token)]
                guard let url = link.url else { throw CaptureError.message("Could not connect this camera.") }
                // Preserve the claimed credential even if a subsequent network request fails.
                pairing = try Pairing(link: url.absoluteString)
                try CameraKeychain.save(pairing); camera.pairing = pairing; camera.configuration = nil
                UserDefaults.standard.set(pairing.key, forKey: "pairingKey")
            }
            camera.error = nil
            if camera.liveEnabled {
                do { let _: OKResponse = try await call(server, "api/bash/video/\(pairing.session)", body: ["action": "prepareStream", "side": side]) }
                catch { camera.error = "Live setup could not finish. Local recording is still available. Reopen this game from Games to retry live setup." }
            }
            await camera.refreshConfiguration()
            let connected = camera.configuration?.game?.id == game.id
            if !connected { error = camera.error ?? "Could not load the game. Open this camera from Games to retry." }
            return connected
        } catch {
            self.error = error.localizedDescription
            cameraConflict = (error as? WebsiteError)?.status == 409
            return false
        }
    }
    func endRecording(camera: CaptureController) async -> Bool {
        guard let server = authenticatedServer, let pairing = camera.pairing,
              pairing.server == server, signedIn, !busy, !camera.recording else { return false }
        busy = true; error = nil; defer { busy = false }
        do {
            let _: OKResponse = try await call(server, "api/bash/video/\(pairing.session)", body: ["action": "end"])
            await camera.refreshConfiguration()
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
    func signOut() {
        session.configuration.httpCookieStorage?.removeCookies(since: .distantPast)
        signedIn = false; games = []; authenticatedServer = nil
    }
}
