import Foundation
import UIKit
import Network

/// Bounded operational telemetry only: never request URLs, tokens, or error descriptions.
@MainActor
final class CaptureDiagnostics {
    static let shared = CaptureDiagnostics()
    private let monitor = NWPathMonitor()
    private var network: [String: Any] = ["status": "unknown", "interface": "unknown", "expensive": false, "constrained": false]
    private(set) var events: [[String: Any]] = []
    private var previousTasks: [Int: (bytes: Int64, time: TimeInterval, progress: TimeInterval)] = [:]
    private var lastVideoProgress: TimeInterval?
    private var lastByteProgress: TimeInterval?
    private var previousBytes = 0
    private var fps = 0
    private var streamBytes = 0
    private var streamRate = 0
    private var streamSampleAt: TimeInterval?

    init() {
        monitor.pathUpdateHandler = { path in
            let status = path.status == .satisfied ? "satisfied" : path.status == .requiresConnection ? "requiresConnection" : "unsatisfied"
            let interface = path.usesInterfaceType(.wifi) ? "wifi" : path.usesInterfaceType(.cellular) ? "cellular" : path.usesInterfaceType(.wiredEthernet) ? "wired" : "other"
            let expensive = path.isExpensive, constrained = path.isConstrained
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.network = ["status": status, "interface": interface, "expensive": expensive, "constrained": constrained]
                self.event("network", detail: "\(status).\(interface)")
            }
        }
        monitor.start(queue: DispatchQueue(label: "fan.bash.capture-diagnostics"))
    }
    deinit { monitor.cancel() }

    func event(_ name: String, detail: String? = nil, code: Int? = nil) {
        var entry: [String: Any] = ["at": Date().timeIntervalSince1970 * 1000, "name": String(name.prefix(48))]
        if let detail { entry["detail"] = String(detail.filter { $0.isASCII && ($0.isLetter || $0.isNumber || "._-".contains($0)) }.prefix(96)) }
        if let code { entry["code"] = code }
        events.append(entry)
        if events.count > 24 { events.removeFirst(events.count - 24) }
    }
    func failure(_ name: String, _ error: Error) {
        if let response = error as? CaptureAPIError {
            event(name, detail: "HTTP", code: response.statusCode)
            return
        }
        let failure = error as NSError
        let domain = [NSURLErrorDomain, NSCocoaErrorDomain, NSPOSIXErrorDomain, NSOSStatusErrorDomain].contains(failure.domain) ? failure.domain : "other"
        event(name, detail: domain, code: failure.code)
    }
    func resetStream() {
        previousBytes = 0; streamBytes = 0; streamRate = 0; fps = 0
        lastVideoProgress = nil; lastByteProgress = nil; streamSampleAt = nil
    }
    func sampleStream(fps: Int, bytes: Int, rate: Int) {
        let now = ProcessInfo.processInfo.systemUptime
        self.fps = fps; streamBytes = max(0, bytes); streamRate = max(0, rate); streamSampleAt = now
        if fps > 0 { lastVideoProgress = now }
        if bytes > previousBytes { lastByteProgress = now }
        previousBytes = bytes
    }
    func snapshot(tasks: [URLSessionTask], pending: Int, quality: String, connected: Bool) -> [String: Any] {
        let now = ProcessInfo.processInfo.systemUptime
        func age(_ value: TimeInterval?) -> Any { value.map { max(0, now - $0) } as Any? ?? NSNull() }
        var taskRows: [[String: Any]] = []
        var current: [Int: (bytes: Int64, time: TimeInterval, progress: TimeInterval)] = [:]
        for task in tasks.sorted(by: { $0.taskIdentifier < $1.taskIdentifier }) {
            let old = previousTasks[task.taskIdentifier]
            let progress = old == nil || task.countOfBytesSent > old!.bytes ? now : old!.progress
            let rate = old.map { Double(max(0, task.countOfBytesSent - $0.bytes)) / max(0.001, now - $0.time) } ?? 0
            current[task.taskIdentifier] = (task.countOfBytesSent, now, progress)
            if taskRows.count < 6 {
                taskRows.append(["task": task.taskIdentifier, "state": task.state.rawValue,
                                 "sent": max(0, task.countOfBytesSent), "expected": max(0, task.countOfBytesExpectedToSend),
                                 "bytesPerSecond": rate, "secondsWithoutProgress": max(0, now - progress)])
            }
        }
        previousTasks = current
        let free = (try? URL.documentsDirectory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage) ?? 0
        return ["version": 1, "sampledAt": Date().timeIntervalSince1970 * 1000,
                "appBuild": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
                "osVersion": UIDevice.current.systemVersion, "quality": quality,
                "thermalState": ProcessInfo.processInfo.thermalState.rawValue,
                "lowPower": ProcessInfo.processInfo.isLowPowerModeEnabled, "freeBytes": max(0, free),
                "network": network,
                "stream": ["connected": connected, "encodedFPS": fps, "queuedBytes": streamBytes,
                           "queuedBytesPerSecond": streamRate, "sampleAge": age(streamSampleAt),
                           "secondsWithoutVideoProgress": age(lastVideoProgress), "secondsWithoutByteProgress": age(lastByteProgress)],
                "uploads": ["pending": pending, "taskCount": tasks.count, "tasks": taskRows], "events": events]
    }
}
