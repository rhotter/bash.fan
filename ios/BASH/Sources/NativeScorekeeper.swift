import SwiftUI

// Preserve every server-owned/legacy state field when editing a native control.
indirect enum ScoringJSON: Codable, Equatable, Sendable {
    case object([String: ScoringJSON]), array([ScoringJSON]), string(String), number(Double), bool(Bool), null
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([String: ScoringJSON].self) { self = .object(v) }
        else { self = .array(try c.decode([ScoringJSON].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    var object: [String: ScoringJSON] { if case .object(let v) = self { v } else { [:] } }
    var array: [ScoringJSON] { if case .array(let v) = self { v } else { [] } }
    var text: String { if case .string(let v) = self { v } else { "" } }
    var number: Double { if case .number(let v) = self { v } else { 0 } }
    var flag: Bool { if case .bool(let v) = self { v } else { false } }
    static func int(_ v: Int) -> Self { .number(Double(v)) }
}
typealias ScoringState = [String: ScoringJSON]
struct ScoringPlayer: Codable, Identifiable { let id: Int; let name: String }
struct ScoringPayload: Codable {
    var status: String
    let isPlayoff: Bool
    let periodLength: Int
    var homeRoster: [ScoringPlayer]
    var awayRoster: [ScoringPlayer]
    var subPlayerIds: [Int]
    var state: ScoringState?
}
private struct ScoringDraft: Codable { let state: ScoringState; let expected: ScoringState }

@MainActor final class NativeScorekeeper: ObservableObject {
    let game: Game
    let server: URL
    let session: URLSession
    @Published var payload: ScoringPayload?
    @Published var state: ScoringState = [:]
    @Published var busy = false
    @Published var dirty = false
    @Published var conflict = false
    @Published var error: String?
    @Published var editingFinal = false
    private(set) var expected: ScoringState = [:]
    private(set) var preview = false
    var period: Int { Int(state["period"]?.number ?? 0) }
    var periodLength: Int { period == 4 && payload?.isPlayoff != true ? 300 : payload?.periodLength ?? 1200 }
    var running: Bool { state["clockRunning"]?.flag == true }
    var final: Bool { payload?.status == "final" }
    var editable: Bool { payload != nil && !busy && !conflict && (!final || editingFinal) }
    var draftURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "ScorekeeperDrafts").appending(path: "\(server.host ?? "server")-\(game.id).json")
    }
    init(game: Game, server: URL, cookies: [HTTPCookie], session: URLSession? = nil) {
        self.game = game; self.server = server
        if let session { self.session = session }
        else {
            let config = URLSessionConfiguration.ephemeral
            // Ephemeral cookie storage is discarded with this scorekeeper session.
            cookies.forEach { config.httpCookieStorage?.setCookie($0) }
            config.requestCachePolicy = .reloadIgnoringLocalCacheData
            self.session = URLSession(configuration: config)
        }
    }
    func clock(at date: Date = .now) -> Int {
        let seconds = state["clockSeconds"]?.number ?? 0
        let start = state["clockStartedAt"]?.number ?? 0
        return max(0, Int(ceil(seconds - (running && start > 0 ? (date.timeIntervalSince1970 * 1000 - start) / 1000 : 0))))
    }
    static func time(_ seconds: Int) -> String { String(format: "%d:%02d", max(0, seconds) / 60, max(0, seconds) % 60) }
    func roster(_ home: Bool) -> [ScoringPlayer] { (home ? payload?.homeRoster : payload?.awayRoster) ?? [] }
    func team(_ home: Bool) -> String { home ? game.homeTeam : game.awayTeam }
    func slug(_ home: Bool) -> String { (home ? game.homeSlug : game.awaySlug) ?? "" }
    func name(_ id: Int) -> String { (roster(false) + roster(true)).first { $0.id == id }?.name ?? "Player #\(id)" }
    func list(_ key: String) -> [ScoringState] { state[key]?.array.map(\.object) ?? [] }
    func ids(_ key: String) -> [Int] { state[key]?.array.map { Int($0.number) } ?? [] }
    func score(_ home: Bool) -> Int {
        let goals = list("goals").filter { $0["team"]?.text == slug(home) && ($0["period"]?.number ?? 0) <= 4 }.count
        let shootout = state["shootout"]?.object ?? [:]
        let own = shootout[home ? "homeAttempts" : "awayAttempts"]?.array.filter { $0.object["scored"]?.flag == true }.count ?? 0
        let other = shootout[home ? "awayAttempts" : "homeAttempts"]?.array.filter { $0.object["scored"]?.flag == true }.count ?? 0
        return goals + (own > other ? 1 : 0)
    }
    func request(_ suffix: String, method: String = "GET", body: ScoringState? = nil, headers: [String: String] = [:]) async throws -> ScoringState {
        guard !preview else { throw URLError(.notConnectedToInternet) }
        var request = URLRequest(url: server.appending(path: "api/bash/scorekeeper/\(game.id)/\(suffix)"))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        if let body { request.httpBody = try JSONEncoder().encode(body) }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        let json = (try? JSONDecoder().decode(ScoringState.self, from: data)) ?? [:]
        guard (200..<300).contains(response.statusCode) else {
            if response.statusCode == 409 { conflict = true }
            throw NSError(domain: "Scorekeeper", code: response.statusCode, userInfo: [NSLocalizedDescriptionKey: json["error"]?.text ?? "Could not load scorekeeper (\(response.statusCode))."])
        }
        if method != "GET", json["ok"]?.flag != true {
            throw NSError(domain: "Scorekeeper", code: 0, userInfo: [NSLocalizedDescriptionKey: "The server did not confirm this change. Reload to check its status."])
        }
        return json
    }
    func load(discardDraft: Bool = false) async {
        guard !busy, !preview else { return }
        busy = true; defer { busy = false }
        do {
            let json = try await request("native")
            let data = try JSONEncoder().encode(json)
            var payload = try JSONDecoder().decode(ScoringPayload.self, from: data)
            if payload.state == nil && payload.status != "final" {
                let started = try await request("start", method: "POST")
                payload.state = started["state"]?.object
            }
            guard let remote = payload.state else { throw NSError(domain: "Scorekeeper", code: 0, userInfo: [NSLocalizedDescriptionKey: "This game has no recorded scoring state."]) }
            self.payload = payload; state = remote; expected = remote; conflict = false; dirty = false; error = nil
            if discardDraft { try? FileManager.default.removeItem(at: draftURL) }
            else if let data = try? Data(contentsOf: draftURL), let draft = try? JSONDecoder().decode(ScoringDraft.self, from: data) {
                if Self.comparable(draft.state) == Self.comparable(remote) { try? FileManager.default.removeItem(at: draftURL) }
                else {
                    state = draft.state; expected = draft.expected; dirty = true
                    conflict = Self.comparable(remote) != Self.comparable(expected) || payload.status == "final"
                    if conflict { error = "The server has newer changes. Your local draft is retained. Reload the server version before scoring." }
                }
            }
        } catch { self.error = error.localizedDescription }
    }
    static func comparable(_ state: ScoringState) -> ScoringState { state.filter { $0.key != "timing" } }
    func change(_ kind: String = "clock", _ edit: (inout ScoringState) -> Void) {
        guard editable else { return }
        let before = state
        let captureClock = clock()
        var next = state
        edit(&next)
        guard next != before else { return }
        state = next
        let now = Date.now.timeIntervalSince1970 * 1000
        state["updatedAt"] = .number(max(now.rounded(), (before["updatedAt"]?.number ?? 0) + 1))
        var timing = state["timing"]?.object ?? [:]
        var entries = timing["entries"]?.array ?? []
        let changedKeys = Set(before.keys).union(state.keys).filter { before[$0] != state[$0] }
        let changedBefore = before.filter { changedKeys.contains($0.key) }
        let changedAfter = state.filter { changedKeys.contains($0.key) }
        if kind != "clock" || !changedKeys.isDisjoint(with: ["period", "clockSeconds", "clockRunning", "clockStartedAt"]) {
        entries.append(.object(["id": .string(UUID().uuidString), "kind": .string(kind), "action": .string("change"), "capturedAt": .number(now.rounded()), "recordedAt": .number(now.rounded()), "source": .string("device"), "period": .int(Int(before["period"]?.number ?? 0)), "clockSeconds": .int(captureClock), "details": .object(["client": .string("ios"), "before": .object(changedBefore), "after": .object(changedAfter)])]))
        }
        timing["version"] = .int(1); timing["entries"] = .array(entries)
        if running && period > 0 {
            timing["hasPlayStarted"] = .bool(true)
            if timing["firstPlayStartedAt"] == nil { timing["firstPlayStartedAt"] = .number(now.rounded()) }
        }
        state["timing"] = .object(timing); dirty = true; persist()
    }
    func persist() {
        guard !preview else { return }
        do {
            try FileManager.default.createDirectory(at: draftURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(ScoringDraft(state: state, expected: expected)).write(to: draftURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch { self.error = "Couldn't save the draft on this phone. Keep this screen open and save to the server." }
    }
    func save() async -> Bool {
        guard !busy, !conflict, !final else { return false }
        guard dirty else { return true }
        if preview { expected = state; dirty = false; return true }
        busy = true; defer { busy = false }
        do {
            let mutationID = UUID().uuidString
            let reply = try await request("state", method: "PUT", body: [
                "state": .object(state), "expectedState": .object(expected),
                "expectedRevision": expected["revision"] ?? .int(0), "mutationId": .string(mutationID)
            ])
            if let revision = reply["revision"] {
                state["revision"] = revision
                state["lastMutationId"] = .string(mutationID)
            }
            if var timing = state["timing"]?.object { timing["entries"] = .array([]); state["timing"] = .object(timing) }
            expected = state; dirty = false; error = nil
            try? FileManager.default.removeItem(at: draftURL)
            return true
        } catch { self.error = "Not saved: \(error.localizedDescription)"; return false }
    }
    func finalize() async {
        guard !busy, !conflict else { return }
        let stars = ids("threeStars").filter { $0 > 0 }
        if !stars.isEmpty && (stars.count != 3 || Set(stars).count != 3) {
            error = "Select three different stars, or clear all three selections."; return
        }
        if !final { guard await save() else { return } }
        busy = true; defer { busy = false }
        do {
            if !preview {
                if final {
                    _ = try await request("finalize", method: "POST", body: ["state": .object(state), "expectedState": .object(expected)])
                } else {
                    _ = try await request("finalize", method: "POST", headers: ["x-state-updated-at": String(Int(state["updatedAt"]?.number ?? 0)), "x-state-revision": String(Int(state["revision"]?.number ?? 0))])
                }
            }
            payload?.status = "final"; dirty = false; editingFinal = false; error = nil; expected = state
            if !preview { try? FileManager.default.removeItem(at: draftURL) }
        } catch {
            self.error = error.localizedDescription
            let code = (error as NSError).code
            if code != 400 && code != 422 { conflict = true }
        }
    }
    func pause() {
        let seconds = clock()
        change { $0["clockSeconds"] = .int(seconds); $0["clockRunning"] = .bool(false); $0["clockStartedAt"] = .null }
    }
    func toggleClock() {
        if running { pause() }
        else { change { $0["clockRunning"] = .bool(true); $0["clockStartedAt"] = .number((Date.now.timeIntervalSince1970 * 1000).rounded()) } }
    }
    func setPeriod(_ value: Int) {
        change {
            $0["period"] = .int(value); $0["clockSeconds"] = .int(value == 4 && payload?.isPlayoff != true ? 300 : payload?.periodLength ?? 1200)
            $0["clockRunning"] = .bool(false); $0["clockStartedAt"] = .null
            for key in ["homeShots", "awayShots"] {
                var shots = $0[key]?.array ?? []
                while shots.count < min(4, value) { shots.append(.int(0)) }; $0[key] = .array(shots)
            }
            $0["goaliePulls"] = .array(($0["goaliePulls"]?.array ?? []).map { item in
                var pull = item.object
                if pull["returnedAt"] == .null { pull["returnedAt"] = .string("0:00") }
                return .object(pull)
            })
        }
    }
    func shot(_ home: Bool, delta: Int) {
        let key = home ? "homeShots" : "awayShots"
        change("shots") { state in
            var shots = state[key]?.array ?? []; let index = max(0, min(3, period - 1))
            while shots.count <= index { shots.append(.int(0)) }
            shots[index] = .int(max(0, Int(shots[index].number) + delta)); state[key] = .array(shots)
        }
    }
    func remove(_ collection: String, id: String) {
        let kind = collection == "goals" ? "goal" : collection == "penalties" ? "penalty" : "timeout"
        change(kind) { state in
            state[collection] = .array((state[collection]?.array ?? []).filter { $0.object["id"]?.text != id })
            if collection == "goals" {
                state["penalties"] = .array((state["penalties"]?.array ?? []).map { item in
                    var p = item.object
                    if p["endedByGoalId"]?.text == id { p.removeValue(forKey: "endedByGoalId") }
                    return .object(p)
                })
            }
            Self.recomputePenaltyReleases(&state, regulation: payload?.periodLength ?? 1200, overtime: payload?.isPlayoff == true ? payload?.periodLength ?? 1200 : 300)
        }
    }
    func putEvent(_ event: ScoringState, collection: String) {
        change(collection == "goals" ? "goal" : "penalty") { state in
            var events = state[collection]?.array ?? []
            if let i = events.firstIndex(where: { $0.object["id"] == event["id"] }) { events[i] = .object(event) }
            else { events.append(.object(event)) }
            state[collection] = .array(events)
            let attendanceKey = event["team"]?.text == slug(true) ? "homeAttendance" : "awayAttendance"
            var attendance = state[attendanceKey]?.array ?? []
            for key in ["scorerId", "assist1Id", "assist2Id", "playerId"] {
                if let id = event[key], id.number > 0, !attendance.contains(id) { attendance.append(id) }
            }
            state[attendanceKey] = .array(attendance)
            Self.recomputePenaltyReleases(&state, regulation: payload?.periodLength ?? 1200, overtime: payload?.isPlayoff == true ? payload?.periodLength ?? 1200 : 300)
        }
    }
    static func recomputePenaltyReleases(_ state: inout ScoringState, regulation: Int, overtime: Int) {
        func elapsed(_ event: ScoringState) -> Int {
            let p = Int(event["period"]?.number ?? 1)
            let length = p <= 3 ? regulation : overtime
            return min(3, p - 1) * regulation + max(0, p - 4) * overtime + length - GameLive.clockSeconds(event["clock"]?.text ?? "0:00")
        }
        var penalties = (state["penalties"]?.array ?? []).map { value -> ScoringState in
            var p = value.object; p.removeValue(forKey: "endedByGoalId"); p.removeValue(forKey: "adjustedEndElapsed"); return p
        }
        let goals = (state["goals"]?.array ?? []).map(\.object).sorted { elapsed($0) < elapsed($1) }
        for goal in goals where goal["flags"]?.array.contains(.string("PPG")) == true {
            let now = elapsed(goal)
            let candidates = penalties.indices.filter { i in
                let p = penalties[i]; let duration = Int(p["minutes"]?.number ?? 0)
                let start = elapsed(p), end = p["adjustedEndElapsed"].map { Int($0.number) } ?? start + duration * 60
                return p["team"] != goal["team"] && p["endedByGoalId"] == nil && [2, 4].contains(duration) && start <= now && end > now
            }.sorted {
                let a = penalties[$0], b = penalties[$1]
                return (a["adjustedEndElapsed"].map { Int($0.number) } ?? elapsed(a) + Int(a["minutes"]?.number ?? 0) * 60) < (b["adjustedEndElapsed"].map { Int($0.number) } ?? elapsed(b) + Int(b["minutes"]?.number ?? 0) * 60)
            }
            if let i = candidates.first {
                if penalties[i]["minutes"]?.number == 4 && penalties[i]["adjustedEndElapsed"] == nil && now < elapsed(penalties[i]) + 120 {
                    penalties[i]["adjustedEndElapsed"] = .int(now + 120)
                } else { penalties[i]["endedByGoalId"] = goal["id"] }
            }
        }
        state["penalties"] = .array(penalties.map(ScoringJSON.object))
    }
}

struct ScorekeeperScreen: View {
    @StateObject private var model: NativeScorekeeper
    @State private var tab = "Game"
    @State private var home = false
    @State private var sheet: String?
    @State private var event: ScoringState?
    @State private var confirmClose = false
    @State private var confirmFinalize = false
    @State private var confirmReload = false
    @State private var confirmPeriod = false
    @Environment(\.dismiss) private var dismiss
    init(game: Game, server: URL, cookies: [HTTPCookie]) {
        _model = StateObject(wrappedValue: NativeScorekeeper(game: game, server: server, cookies: cookies))
    }
    init(model: NativeScorekeeper) { _model = StateObject(wrappedValue: model) }
    var body: some View {
        NavigationStack {
            Group {
                if model.payload == nil {
                    if let error = model.error {
                        ContentUnavailableView { Label("Scorekeeper unavailable", systemImage: "wifi.exclamationmark") } description: { Text(error) } actions: { Button("Retry") { Task { await model.load() } } }
                    } else { ProgressView("Loading scorekeeper…") }
                } else {
                    VStack(spacing: 0) {
                        scoreHeader
                        Picker("Scorekeeper section", selection: $tab) {
                            Text("Game").tag("Game"); Text("Roster").tag("Roster"); Text("Details").tag("Details")
                        }.pickerStyle(.segmented).padding(.horizontal, 16).padding(.bottom, 12)
                        List {
                            if let error = model.error {
                                Section {
                                    Text(error).font(.footnote).foregroundStyle(.red)
                                    if model.conflict { Button("Reload server version", role: .destructive) { confirmReload = true } }
                                    else if model.dirty { Button("Retry save") { Task { _ = await model.save() } } }
                                }
                            }
                            if model.final && !model.editingFinal {
                                Section {
                                    Label("Final result", systemImage: "checkmark.circle")
                                    Button("Edit final result") { model.editingFinal = true }
                                }
                            }
                            Group {
                                if tab == "Game" { gameControls }
                                else if tab == "Roster" { rosterControls }
                                else { detailControls }
                            }.disabled(!model.editable)
                        }.listStyle(.insetGrouped).contentMargins(.top, 8)
                    }
                }
            }
            .navigationTitle(model.preview ? "Demo scorekeeper" : "Scorekeeper").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { if model.dirty { confirmClose = true } else { dismiss() } }.disabled(model.busy) }
                ToolbarItem(placement: .primaryAction) {
                    if model.busy { ProgressView() }
                    else if model.final && model.editingFinal { Button("Review") { confirmFinalize = true }.disabled(model.conflict) }
                    else { Button("Save") { Task { _ = await model.save() } }.fontWeight(.semibold).disabled(!model.dirty || model.conflict) }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if model.payload != nil {
                    Label(model.preview ? "Demo · changes stay in memory" : model.busy ? "Saving…" : model.conflict ? "Needs review" : model.dirty ? "Unsaved changes · saved on this phone" : "Saved", systemImage: model.dirty ? "icloud.and.arrow.up" : "checkmark.circle")
                        .font(.caption).foregroundStyle(model.dirty ? Color.orange : Color.secondary)
                        .frame(maxWidth: .infinity).padding(10).background(.bar)
                }
            }
        }
        .tint(LeagueStyle.orange)
        .interactiveDismissDisabled(model.dirty || model.busy)
        .task { await model.load() }
        .sheet(isPresented: Binding(get: { sheet != nil }, set: { if !$0 { sheet = nil } })) {
            if let sheet {
                if sheet == "goal" || sheet == "penalty" {
                    ScoringEventEditor(model: model, home: home, scoring: sheet == "goal", original: event)
                } else if sheet == "clock" { ScoringClockEditor(model: model) }
                else if sheet == "player" { ScoringAddPlayer(model: model, home: home) }
                else if sheet == "shootout" { ScoringShootout(model: model, home: home) }
            }
        }
        .confirmationDialog("Leave scorekeeper?", isPresented: $confirmClose, titleVisibility: .visible) {
            if !model.final && !model.conflict { Button("Save and close") { Task { if await model.save() { dismiss() } } } }
            Button("Keep draft and close") { dismiss() }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Unsaved changes stay on this phone until you save them to the server.") }
        .confirmationDialog(model.final ? "Save corrected final result?" : "Finalize this game?", isPresented: $confirmFinalize, titleVisibility: .visible) {
            Button(model.final ? "Save corrected result" : "Finalize game") { model.pause(); Task { await model.finalize() } }
        } message: { Text("This publishes the score and rebuilds player and goalie stats. Check attendance, goalies, shots, and events first.") }
        .confirmationDialog("Discard local draft and reload?", isPresented: $confirmReload, titleVisibility: .visible) {
            Button("Reload server version", role: .destructive) { Task { await model.load(discardDraft: true) } }
        }
        .confirmationDialog("Move to the next period?", isPresented: $confirmPeriod, titleVisibility: .visible) {
            Button("Start \(model.period == 3 ? "overtime" : "next period")") { model.setPeriod(model.period + 1) }
        } message: { Text("The clock will reset and remain paused.") }
    }
    private var scoreHeader: some View {
        VStack(spacing: 8) {
            HStack {
                teamScore(false)
                VStack(spacing: 4) {
                    Text(model.period == 0 ? "Pre-game" : model.period == 4 ? "Overtime" : model.period == 5 ? "Shootout" : "Period \(model.period)")
                        .font(.caption).foregroundStyle(.secondary)
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text(NativeScorekeeper.time(model.clock(at: context.date))).font(.system(.largeTitle, design: .rounded, weight: .bold)).monospacedDigit()
                    }
                }.frame(maxWidth: .infinity)
                teamScore(true)
            }
            if model.editable && model.period > 0 && model.period < 5 {
                HStack(spacing: 12) {
                    Button { model.toggleClock() } label: { Label(model.running ? "Pause" : "Start clock", systemImage: model.running ? "pause.fill" : "play.fill").frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent)
                    Button("Edit clock") { sheet = "clock" }.buttonStyle(.bordered)
                }.controlSize(.large)
            }
        }.padding(16)
    }
    private func teamScore(_ home: Bool) -> some View {
        VStack(spacing: 4) {
            TeamLogo(slug: model.slug(home), size: 42)
            Text(model.team(home)).font(.caption.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
            Text("\(model.score(home))").font(.title.bold()).monospacedDigit()
        }.frame(maxWidth: .infinity)
    }
    private var teamPicker: some View {
        Picker("Team", selection: $home) { Text(model.team(false)).tag(false); Text(model.team(true)).tag(true) }.pickerStyle(.segmented)
    }
    @ViewBuilder private var gameControls: some View {
        if model.period == 0 { Section { Button("Begin first period") { model.setPeriod(1) }.fontWeight(.semibold) } }
        Section {
            teamPicker
            HStack(spacing: 12) {
                Button { event = nil; model.pause(); sheet = "goal" } label: { Label("Goal", systemImage: "plus.circle.fill").frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent).accessibilityIdentifier("recordGoal")
                Button { event = nil; model.pause(); sheet = "penalty" } label: { Label("Penalty", systemImage: "flag").frame(maxWidth: .infinity) }.buttonStyle(.bordered)
            }.controlSize(.large).disabled(model.period == 0 || model.period == 5)
            let key = home ? "homeShots" : "awayShots"
            let shots = model.ids(key)
            let index = max(0, min(3, model.period - 1))
            Stepper("Shots · \(index == 3 ? "OT" : "P\(index + 1)"): \(shots.indices.contains(index) ? shots[index] : 0)", onIncrement: { model.shot(home, delta: 1) }, onDecrement: { model.shot(home, delta: -1) })
                .disabled(model.period == 0 || model.period == 5)
            HStack {
                Button("Timeout") { useTimeout() }.disabled(model.period == 0 || model.period == 5)
                Spacer()
                Button(pulled ? "Return goalie" : "Pull goalie") { togglePull() }.disabled(model.period == 0 || model.period == 5)
            }.buttonStyle(.bordered)
        }
        recordedPlays
        if !model.list("timeouts").isEmpty {
            Section("Timeouts") {
                ForEach(model.list("timeouts"), id: \.idString) { timeout in
                    Text("\(timeout["team"]?.text == model.slug(true) ? model.team(true) : model.team(false)) · P\(Int(timeout["period"]?.number ?? 1)) · \(timeout["clock"]?.text ?? "")")
                        .font(.subheadline)
                        .swipeActions { Button("Delete", role: .destructive) { removeTimeout(timeout) } }
                }
            }
        }
        Section {
            if model.period > 0 && model.period < 4 { Button("Next period") { confirmPeriod = true } }
            if model.period >= 4 && model.payload?.isPlayoff != true { Button("Shootout") { model.pause(); sheet = "shootout" } }
            Button(model.final ? "Save corrected final result" : "Finalize game") { confirmFinalize = true }.fontWeight(.semibold).disabled(model.period == 0)
        }
    }
    private var plays: [ScoringPlay] {
        let items = model.list("goals").map { ScoringPlay(collection: "goals", value: $0) } + model.list("penalties").map { ScoringPlay(collection: "penalties", value: $0) }
        return items.sorted {
            let p0 = $0.value["period"]?.number ?? 0, p1 = $1.value["period"]?.number ?? 0
            if p0 != p1 { return p0 > p1 }
            return GameLive.clockSeconds($0.value["clock"]?.text ?? "") < GameLive.clockSeconds($1.value["clock"]?.text ?? "")
        }
    }
    private var recordedPlays: some View {
        Section("Recorded plays") {
            if plays.isEmpty { Text("No plays recorded").foregroundStyle(.secondary) }
            ForEach(plays) { item in
                let collection = item.collection
                let play = item.value
                Button {
                    home = play["team"]?.text == model.slug(true); event = play; sheet = collection == "goals" ? "goal" : "penalty"
                } label: {
                    HStack {
                        TeamLogo(slug: play["team"]?.text, size: 30)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(model.name(Int(play[collection == "goals" ? "scorerId" : "playerId"]?.number ?? 0))).fontWeight(.medium)
                            Text(collection == "goals" ? "Goal" : "\(play["infraction"]?.text ?? "Penalty") · \(Int(play["minutes"]?.number ?? 0)) min").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text("P\(Int(play["period"]?.number ?? 1)) · \(play["clock"]?.text ?? "")").font(.caption).monospacedDigit().foregroundStyle(.secondary)
                    }.foregroundStyle(.primary)
                }.swipeActions { Button("Delete", role: .destructive) { model.remove(collection, id: play.idString) } }
            }
        }
    }
    @ViewBuilder private var rosterControls: some View {
        Section { teamPicker }
        Section("Goalie") {
            Picker("In net", selection: Binding(get: { Int(model.state[home ? "homeGoalieId" : "awayGoalieId"]?.number ?? 0) }, set: { setGoalie($0) })) {
                Text("Select goalie").tag(0)
                ForEach(model.roster(home)) { Text($0.name).tag($0.id) }
            }
        }
        Section {
            Button("Mark all present") { model.change { $0[home ? "homeAttendance" : "awayAttendance"] = .array(model.roster(home).map { .int($0.id) }) } }
            ForEach(model.roster(home)) { player in
                Toggle(isOn: Binding(get: { model.ids(home ? "homeAttendance" : "awayAttendance").contains(player.id) }, set: { present in
                    model.change { state in
                        let key = home ? "homeAttendance" : "awayAttendance"
                        var ids = state[key]?.array ?? []; ids.removeAll { Int($0.number) == player.id }
                        if present { ids.append(.int(player.id)) }; state[key] = .array(ids)
                    }
                })) {
                    HStack { Text(player.name); if model.payload?.subPlayerIds.contains(player.id) == true { Text("Sub").font(.caption).foregroundStyle(.secondary) } }
                }.tint(LeagueStyle.orange)
            }
            Button("Add substitute") { sheet = "player" }.disabled(model.dirty || model.final)
        } header: { Text("Attendance") } footer: { if model.dirty { Text("Save your changes before adding a substitute.") } }
    }
    @ViewBuilder private var detailControls: some View {
        Section("Officials") {
            officialField("Referee 1", key: "ref1"); officialField("Referee 2", key: "ref2"); officialField("Scorekeeper", key: "scorekeeper")
        }
        Section("Three stars") {
            ForEach(0..<3) { index in
                Picker("\(index + 1)\(index == 0 ? "st" : index == 1 ? "nd" : "rd") star", selection: Binding(get: {
                    let values = model.ids("threeStars"); return values.indices.contains(index) ? values[index] : 0
                }, set: { id in
                    model.change { state in
                        var stars = state["threeStars"]?.array ?? []; while stars.count < 3 { stars.append(.int(0)) }
                        stars[index] = .int(id); state["threeStars"] = stars.allSatisfy { $0.number == 0 } ? .null : .array(stars)
                    }
                })) {
                    Text("Not selected").tag(0)
                    ForEach(model.roster(false) + model.roster(true)) { player in
                        HStack(spacing: 10) {
                            TeamLogo(slug: model.slug(model.roster(true).contains { $0.id == player.id }), size: 30)
                            Text(player.name)
                        }.tag(player.id)
                    }
                }.pickerStyle(.navigationLink)
            }
        }
        Section("Notes") {
            TextField("Game notes", text: Binding(get: { model.state["notes"]?.text ?? "" }, set: { value in model.change { $0["notes"] = .string(value) } }), axis: .vertical).lineLimit(3...8)
        }
        goalieAllocation
    }
    private var goalieIDs: [Int] {
        let starters = [Int(model.state["homeGoalieId"]?.number ?? 0), Int(model.state["awayGoalieId"]?.number ?? 0)]
        let substitutes = model.list("goalieChanges").flatMap { [Int($0["outGoalieId"]?.number ?? 0), Int($0["inGoalieId"]?.number ?? 0)] }
        return Set(starters + substitutes).filter { $0 > 0 }.sorted()
    }
    private var goalieAllocation: some View {
        Section("Shots faced by goalie") {
            Text("For games with goalie changes, enter each goalie’s total shots against before finalizing.").font(.footnote).foregroundStyle(.secondary)
            ForEach(goalieIDs, id: \.self) { id in
                HStack {
                    Text(model.name(id))
                    Spacer()
                    TextField("Auto", text: Binding(get: {
                        model.state["goalieShotsAgainst"]?.object[String(id)].map { String(Int($0.number)) } ?? ""
                    }, set: { value in
                        model.change("shots") { state in
                            var values = state["goalieShotsAgainst"]?.object ?? [:]
                            if let n = Int(value), n >= 0 { values[String(id)] = .int(n) } else if value.isEmpty { values.removeValue(forKey: String(id)) }
                            state["goalieShotsAgainst"] = .object(values)
                        }
                    })).keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 60)
                }
            }
        }
    }
    private func officialField(_ title: String, key: String) -> some View {
        TextField(title, text: Binding(get: { model.state["officials"]?.object[key]?.text ?? "" }, set: { value in
            model.change { state in var officials = state["officials"]?.object ?? [:]; officials[key] = .string(value); state["officials"] = .object(officials) }
        }))
    }
    private var pulled: Bool { model.list("goaliePulls").contains { $0["team"]?.text == model.slug(home) && $0["returnedAt"] == .null } }
    private func togglePull() {
        let clock = NativeScorekeeper.time(model.clock())
        model.change("goaliePull") { state in
            var pulls = state["goaliePulls"]?.array ?? []
            if let i = pulls.lastIndex(where: { $0.object["team"]?.text == model.slug(home) && $0.object["returnedAt"] == .null }) {
                var item = pulls[i].object; item["returnedAt"] = .string(clock); pulls[i] = .object(item)
            } else {
                pulls.append(.object(["id": .string(UUID().uuidString), "team": .string(model.slug(home)), "period": .int(model.period), "pulledAt": .string(clock), "returnedAt": .null]))
            }
            state["goaliePulls"] = .array(pulls)
        }
    }
    private func setGoalie(_ id: Int) {
        let key = home ? "homeGoalieId" : "awayGoalieId"
        let old = Int(model.state[key]?.number ?? 0)
        let clock = NativeScorekeeper.time(model.clock())
        model.change("goalieChange") { state in
            if model.period > 0 && old > 0 && id > 0 && old != id {
                var changes = state["goalieChanges"]?.array ?? []
                changes.append(.object(["id": .string(UUID().uuidString), "team": .string(model.slug(home)), "period": .int(model.period), "clock": .string(clock), "outGoalieId": .int(old), "inGoalieId": .int(id), "shotSnapshot": .object(["period": .int(model.period), "clock": .string(clock), "opponentShots": state[home ? "awayShots" : "homeShots"] ?? .array([])])]))
                state["goalieChanges"] = .array(changes)
            }
            state[key] = id == 0 ? .null : .int(id)
            if id > 0 {
                let attendance = home ? "homeAttendance" : "awayAttendance"
                var ids = state[attendance]?.array ?? []; if !ids.contains(.int(id)) { ids.append(.int(id)) }; state[attendance] = .array(ids)
            }
        }
    }
    private func useTimeout() {
        model.pause()
        model.change("timeout") { state in
            var values = state["timeouts"]?.array ?? []
            values.append(.object(["id": .string(UUID().uuidString), "team": .string(model.slug(home)), "period": .int(model.period), "clock": .string(NativeScorekeeper.time(model.clock()))]))
            state["timeouts"] = .array(values)
            let key = home ? "homeTimeoutsUsed" : "awayTimeoutsUsed"; state[key] = .int(Int(state[key]?.number ?? 0) + 1)
        }
    }
    private func removeTimeout(_ timeout: ScoringState) {
        model.change("timeout") { state in
            state["timeouts"] = .array((state["timeouts"]?.array ?? []).filter { $0.object["id"] != timeout["id"] })
            let key = timeout["team"]?.text == model.slug(true) ? "homeTimeoutsUsed" : "awayTimeoutsUsed"
            state[key] = .int(max(0, Int(state[key]?.number ?? 0) - 1))
        }
    }
}
private struct ScoringPlay: Identifiable {
    let collection: String
    let value: ScoringState
    var id: String { collection + value.idString }
}
private extension Dictionary where Key == String, Value == ScoringJSON {
    var idString: String { self["id"]?.text ?? "" }
}

private struct ScoringEventEditor: View {
    @ObservedObject var model: NativeScorekeeper
    let home: Bool
    let scoring: Bool
    let original: ScoringState?
    @Environment(\.dismiss) private var dismiss
    @State private var player = 0
    @State private var assist1 = 0
    @State private var assist2 = 0
    @State private var period = 1
    @State private var minutes = 0
    @State private var seconds = 0
    @State private var infraction = "Tripping"
    @State private var penaltyMinutes = 2
    @State private var ppg = false
    @State private var shg = false
    @State private var eng = false
    private var valid: Bool {
        player > 0 && (assist1 == 0 || assist1 != player) && (assist2 == 0 || assist2 != player && assist2 != assist1)
        && (scoring || !infraction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        && minutes * 60 + seconds <= (period >= 4 && model.payload?.isPlayoff != true ? 300 : model.payload?.periodLength ?? 1200)
    }
    var body: some View {
        NavigationStack {
            Form {
                Section(model.team(home)) {
                    playerPicker(scoring ? "Scorer" : "Player", selection: $player)
                    if scoring {
                        playerPicker("First assist", selection: $assist1)
                        playerPicker("Second assist", selection: $assist2)
                    } else {
                        TextField("Infraction", text: $infraction)
                        Picker("Minutes", selection: $penaltyMinutes) { ForEach([2, 4, 5, 10], id: \.self) { Text("\($0) min").tag($0) } }
                    }
                }
                Section("Time remaining") {
                    Picker("Period", selection: $period) {
                        ForEach(1...max(4, model.period), id: \.self) { Text($0 <= 3 ? "Period \($0)" : "Overtime \($0 - 3)").tag($0) }
                    }
                    HStack {
                        Picker("Minutes", selection: $minutes) { ForEach(0...30, id: \.self) { Text(String($0)).tag($0) } }
                        Picker("Seconds", selection: $seconds) { ForEach(0..<60, id: \.self) { Text(String(format: "%02d", $0)).tag($0) } }
                    }
                }
                if scoring {
                    Section("Goal type") {
                        Toggle("Power play", isOn: $ppg).onChange(of: ppg) { _, on in if on { shg = false } }
                        Toggle("Short-handed", isOn: $shg).onChange(of: shg) { _, on in if on { ppg = false } }
                        Toggle("Empty net", isOn: $eng)
                    }
                }
            }
            .navigationTitle(original == nil ? (scoring ? "Record goal" : "Record penalty") : "Edit play").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(original == nil ? "Add" : "Save") { submit() }.disabled(!valid).accessibilityIdentifier("saveScoringEvent") }
            }
        }.tint(LeagueStyle.orange)
        .onAppear {
            let clock = original?["clock"]?.text.split(separator: ":").compactMap { Int($0) }
            let value = clock?.count == 2 ? clock![0] * 60 + clock![1] : model.clock()
            minutes = value / 60; seconds = value % 60; period = Int(original?["period"]?.number ?? Double(max(1, model.period)))
            player = Int(original?[scoring ? "scorerId" : "playerId"]?.number ?? 0)
            assist1 = Int(original?["assist1Id"]?.number ?? 0); assist2 = Int(original?["assist2Id"]?.number ?? 0)
            infraction = original?["infraction"]?.text ?? "Tripping"; penaltyMinutes = Int(original?["minutes"]?.number ?? 2)
            let flags = original?["flags"]?.array.map(\.text) ?? []
            ppg = flags.contains("PPG"); shg = flags.contains("SHG"); eng = flags.contains("ENG")
        }
    }
    private func playerPicker(_ title: String, selection: Binding<Int>) -> some View {
        Picker(title, selection: selection) {
            Text(title.contains("assist") ? "None" : "Select player").tag(0)
            ForEach(model.roster(home)) { player in
                HStack(spacing: 10) {
                    TeamLogo(slug: model.slug(home), size: 30)
                    Text(player.name)
                }.tag(player.id)
            }
        }.pickerStyle(.navigationLink)
    }
    private func submit() {
        var value = original ?? [:]
        value["id"] = original?["id"] ?? .string(UUID().uuidString)
        value["team"] = .string(model.slug(home)); value["period"] = .int(period)
        value["clock"] = .string(NativeScorekeeper.time(minutes * 60 + seconds))
        if scoring {
            value["scorerId"] = .int(player); value["assist1Id"] = assist1 == 0 ? .null : .int(assist1); value["assist2Id"] = assist2 == 0 ? .null : .int(assist2)
            value["flags"] = .array([(ppg, "PPG"), (shg, "SHG"), (eng, "ENG")].filter(\.0).map { .string($0.1) })
        } else { value["playerId"] = .int(player); value["infraction"] = .string(infraction); value["minutes"] = .int(penaltyMinutes) }
        model.putEvent(value, collection: scoring ? "goals" : "penalties")
        dismiss()
    }
}

private struct ScoringClockEditor: View {
    @ObservedObject var model: NativeScorekeeper
    @Environment(\.dismiss) private var dismiss
    @State private var period = 1
    @State private var minutes = 20
    @State private var seconds = 0
    var body: some View {
        NavigationStack {
            Form {
                Picker("Period", selection: $period) { ForEach(1...max(4, model.period), id: \.self) { Text($0 < 4 ? "Period \($0)" : "Overtime \($0 - 3)").tag($0) } }
                Picker("Minutes remaining", selection: $minutes) { ForEach(0...30, id: \.self) { Text(String($0)).tag($0) } }
                Picker("Seconds remaining", selection: $seconds) { ForEach(0..<60, id: \.self) { Text(String(format: "%02d", $0)).tag($0) } }
            }.navigationTitle("Game clock").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Set clock") {
                            model.change { $0["period"] = .int(period); $0["clockSeconds"] = .int(minutes * 60 + seconds); $0["clockRunning"] = .bool(false); $0["clockStartedAt"] = .null }
                            dismiss()
                        }.disabled(minutes * 60 + seconds > (period >= 4 && model.payload?.isPlayoff != true ? 300 : model.payload?.periodLength ?? 1200))
                    }
                }
        }.onAppear { period = max(1, model.period); minutes = model.clock() / 60; seconds = model.clock() % 60 }
    }
}

private struct ScoringAddPlayer: View {
    @ObservedObject var model: NativeScorekeeper
    let home: Bool
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                Section(model.team(home)) { TextField("Full name", text: $name).textContentType(.name) }
                Text("An existing player with this exact name will be used. Otherwise a new player will be created and added as a substitute.").font(.footnote).foregroundStyle(.secondary)
                if let error { Text(error).foregroundStyle(.red) }
            }.navigationTitle("Add substitute").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Add") {
                            busy = true
                            Task {
                                do {
                                    _ = try await model.request("player", method: "POST", body: ["name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)), "teamSide": .string(home ? "home" : "away"), "isSub": .bool(true)])
                                    await model.load(); dismiss()
                                } catch { self.error = error.localizedDescription }
                                busy = false
                            }
                        }.disabled(busy || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
        }.interactiveDismissDisabled(busy)
    }
}

private struct ScoringShootout: View {
    @ObservedObject var model: NativeScorekeeper
    let home: Bool
    @State private var player = 0
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                Section(model.team(home)) {
                    Picker("Shooter", selection: $player) {
                        Text("Select player").tag(0)
                        ForEach(model.roster(home)) { Text($0.name).tag($0.id) }
                    }
                    HStack { Button("Goal") { add(true) }; Spacer(); Button("No goal") { add(false) } }.disabled(player == 0)
                }
                Section("Attempts") {
                    let values = model.state["shootout"]?.object[home ? "homeAttempts" : "awayAttempts"]?.array ?? []
                    ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                        LabeledContent(model.name(Int(value.object["playerId"]?.number ?? 0)), value: value.object["scored"]?.flag == true ? "Goal" : "No goal")
                            .swipeActions { Button("Delete", role: .destructive) {
                                model.change("shootout") { state in
                                    var shootout = state["shootout"]?.object ?? [:]; var attempts = shootout[home ? "homeAttempts" : "awayAttempts"]?.array ?? []
                                    attempts.remove(at: index); shootout[home ? "homeAttempts" : "awayAttempts"] = .array(attempts); state["shootout"] = .object(shootout)
                                }
                            } }
                    }
                }
            }.navigationTitle("Shootout").toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
    private func add(_ scored: Bool) {
        model.change("shootout") { state in
            state["period"] = .int(5); state["clockRunning"] = .bool(false); state["clockStartedAt"] = .null
            var shootout = state["shootout"]?.object ?? ["homeAttempts": .array([]), "awayAttempts": .array([])]
            let key = home ? "homeAttempts" : "awayAttempts"; var attempts = shootout[key]?.array ?? []
            attempts.append(.object(["playerId": .int(player), "scored": .bool(scored)])); shootout[key] = .array(attempts); state["shootout"] = .object(shootout)
        }
        player = 0
    }
}

extension NativeScorekeeper {
    static func sample() -> NativeScorekeeper {
        let game = Game(id: "native-preview", date: "2026-10-25", time: "12:00", homeTeam: "Landsharks", awayTeam: "Seals", homeSlug: "landsharks", awaySlug: "seals", homeScore: 0, awayScore: 0, status: "live", location: "Rink", isOvertime: false, isPlayoff: false)
        let model = NativeScorekeeper(game: game, server: URL(string: "https://preview.invalid")!, cookies: [])
        model.preview = true
        let players = [ScoringPlayer(id: 1, name: "Alex Lee"), ScoringPlayer(id: 2, name: "Jordan Kim"), ScoringPlayer(id: 3, name: "Sam Chen")]
        model.state = ["period": .int(1), "clockSeconds": .int(1042), "clockRunning": .bool(false), "clockStartedAt": .null,
                       "homeShots": .array([.int(4), .int(0), .int(0)]), "awayShots": .array([.int(3), .int(0), .int(0)]),
                       "homeTimeoutsUsed": .int(0), "awayTimeoutsUsed": .int(0), "homeAttendance": .array([.int(4), .int(5), .int(6)]), "awayAttendance": .array([.int(1), .int(2), .int(3)]),
                       "goals": .array([]), "penalties": .array([]), "timeouts": .array([]), "goaliePulls": .array([]), "goalieChanges": .array([]),
                       "shootout": .null, "threeStars": .null, "homeGoalieId": .int(6), "awayGoalieId": .int(3), "officials": .object(["ref1": .string(""), "ref2": .string(""), "scorekeeper": .string("")]), "notes": .string(""), "updatedAt": .int(1)]
        model.expected = model.state
        model.payload = ScoringPayload(status: "live", isPlayoff: false, periodLength: 1200, homeRoster: [ScoringPlayer(id: 4, name: "Taylor Morgan"), ScoringPlayer(id: 5, name: "Casey Rivera"), ScoringPlayer(id: 6, name: "Jamie Park")], awayRoster: players, subPlayerIds: [], state: model.state)
        return model
    }
}
