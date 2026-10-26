import Foundation

/// Bounded cache shared by preloading and navigation. One request per URL at a time.
actor DetailResponseCache {
    static let shared = DetailResponseCache()
    private struct Entry { let date: Date; let data: Data }
    private var entries: [String: Entry] = [:]
    private var pending: [String: Task<Data, Error>] = [:]

    func load(key: String, maxAge: TimeInterval, loader: @escaping @Sendable () async throws -> Data) async throws -> Data {
        if let entry = entries[key], Date().timeIntervalSince(entry.date) < maxAge { return entry.data }
        if let task = pending[key] { return try await task.value }
        let task = Task { try await loader() }
        pending[key] = task
        do {
            let data = try await task.value
            if entries.count >= 80, let oldest = entries.min(by: { $0.value.date < $1.value.date })?.key { entries.removeValue(forKey: oldest) }
            entries[key] = Entry(date: Date(), data: data)
            pending[key] = nil
            return data
        } catch {
            pending[key] = nil
            throw error
        }
    }
}
