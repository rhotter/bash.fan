import SwiftUI
import HaishinKit

@main
struct BASHCaptureApp: App {
    @StateObject private var camera = CaptureController()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            CaptureView(camera: camera, library: camera.library)
                .tint(Color(red: 0.88, green: 0.48, blue: 0.16))
                .preferredColorScheme(.light)
                .onOpenURL { url in Task { await camera.pair(url.absoluteString) } }
                .onChange(of: phase) { _, next in
                    if next == .background { Task { await camera.stop() } }
                }
        }
    }
}

struct CapturePreview: UIViewRepresentable {
    let mixer: MediaMixer
    func makeUIView(context: Context) -> MTHKView {
        let view = MTHKView(frame: .zero)
        view.videoGravity = .resizeAspect
        Task { await mixer.addOutput(view) }
        return view
    }
    func updateUIView(_ view: MTHKView, context: Context) {}
}

struct CaptureView: View {
    @ObservedObject var camera: CaptureController
    @ObservedObject var library: RecordingLibrary
    @State private var setupLink = ""
    @State private var showPairing = false
    @State private var showLibrary = false
    @State private var confirmCleanup = false

    var body: some View {
        HStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
                Color.black
                CapturePreview(mixer: camera.mixer)
                if !camera.ready {
                    VStack(spacing: 12) { Image(systemName: "video").font(.largeTitle); Text("Camera preview").font(.headline); Text("Use a physical iPhone to capture 4K.").font(.caption) }.foregroundStyle(.white.opacity(0.7)).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                HStack(spacing: 8) {
                    Label(camera.recording ? "REC" : "STANDBY", systemImage: "circle.fill").foregroundStyle(camera.recording ? .red : .white)
                    Text("4K · \(camera.framesPerSecond) FPS").foregroundStyle(.white)
                    if camera.streaming { Text("LIVE").foregroundStyle(.green) }
                }.font(.system(size: 11, weight: .bold, design: .monospaced)).padding(10).background(.black.opacity(0.6), in: Capsule()).padding(16)
                // Center overlap guides are framing aids, not a calibration result.
                Rectangle().stroke(.white.opacity(0.25), style: StrokeStyle(lineWidth: 1, dash: [5, 5])).padding(.horizontal, 45).padding(.vertical, 35).allowsHitTesting(false)
            }
            VStack(alignment: .leading, spacing: 14) {
                HStack { Text("BASH").font(.system(size: 17, weight: .bold)); Text("CAPTURE").font(.system(size: 10, weight: .bold)).tracking(2).foregroundStyle(.secondary) }
                Text(camera.pairing.map { "\($0.side.capitalized) camera" } ?? "Set up your camera").font(.title3.bold())
                Text(camera.status).font(.caption).foregroundStyle(.secondary)
                if let error = camera.error ?? library.error { Text(error).font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
                HStack {
                    Text("Frame rate").font(.caption)
                    Picker("Frame rate", selection: $camera.framesPerSecond) { Text("30").tag(30); Text("60").tag(60) }.pickerStyle(.segmented).disabled(camera.recording)
                }
                Toggle("Livestream at 1080p", isOn: $camera.liveEnabled).font(.caption).disabled(camera.recording)
                Button { Task { if camera.recording { await camera.stop() } else { await camera.start() } } } label: {
                    Label(camera.recording ? "Stop recording" : "Start recording", systemImage: camera.recording ? "stop.fill" : "record.circle").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 9)
                }.buttonStyle(.borderedProminent).disabled(camera.busy || !camera.ready || camera.pairing == nil)
                HStack {
                    Button("Pair phone", systemImage: "link") { showPairing = true }.disabled(camera.recording || camera.busy)
                    Spacer()
                    Button("Library", systemImage: "film.stack") { showLibrary = true }
                }.font(.caption)
                Spacer(minLength: 0)
                Label("\(library.pending) segments waiting to upload", systemImage: "icloud.and.arrow.up").font(.caption).foregroundStyle(.secondary)
                Text("Keep the app open while recording. Originals stay on this phone until you remove verified uploads.").font(.system(size: 10)).foregroundStyle(.secondary)
            }.padding(16).frame(width: 300)
        }.background(Color(white: 0.985)).ignoresSafeArea(edges: .vertical)
        .task { await camera.prepare(); await library.recoverInterrupted() }
        .sheet(isPresented: $showPairing) {
            NavigationStack { Form {
                Section("Pair with your dashboard") {
                    Text("Create a session at /video. Copy its private camera setup link and paste it here.")
                    TextField("bashcapture://pair?…", text: $setupLink, axis: .vertical).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Connect camera") { Task { await camera.pair(setupLink); if camera.error == nil { setupLink = ""; showPairing = false } } }.disabled(camera.busy || setupLink.isEmpty)
                    if let error = camera.error { Text(error).foregroundStyle(.red) }
                }
            }.navigationTitle("Pair camera").toolbar { Button("Done") { showPairing = false } } }
        }
        .sheet(isPresented: $showLibrary) {
            NavigationStack { List {
                Section {
                    Button(library.uploading ? "Uploading…" : "Upload pending recordings", systemImage: "icloud.and.arrow.up") { Task { await library.uploadPending() } }.disabled(library.uploading || camera.recording)
                    Text("Upload after the game to give recording and livestreaming the available bandwidth. Keep the app open during uploads.").font(.caption).foregroundStyle(.secondary)
                    if let error = library.error { Text(error).font(.caption).foregroundStyle(.red) }
                }
                ForEach(library.recordings.reversed()) { item in
                    HStack { VStack(alignment: .leading) { Text(item.startedAt, style: .time); Text(item.duration.map { "\(Int($0)) seconds" } ?? "Needs recovery").font(.caption).foregroundStyle(.secondary) }; Spacer(); Text(item.uploaded ? "Verified in R2" : "On this phone").font(.caption) }
                }
                Section { Button("Remove verified local copies", role: .destructive) { confirmCleanup = true }.disabled(camera.recording || library.uploading || !library.recordings.contains(where: { $0.uploaded })) }
            }.navigationTitle("Recordings").toolbar { Button("Done") { showLibrary = false } }
                .confirmationDialog("Remove local copies already verified in R2?", isPresented: $confirmCleanup, titleVisibility: .visible) { Button("Remove local copies", role: .destructive) { do { try library.removeVerified() } catch { library.error = error.localizedDescription } } }
            }
        }
    }
}
