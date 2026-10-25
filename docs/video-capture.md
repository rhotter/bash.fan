# BASH Capture development

The iPhone application is in `ios/BASHCapture`. The supporting Next.js dashboard is `/video`, behind the existing admin login. This is a development implementation: R2 upload and retrieval and Stream ingest have been verified with synthetic footage. Short synthetic live playback now works in Chrome. Game-length playback and physical camera performance still require validation before a game.

## Run the dashboard

1. Use a separate Neon dev endpoint in `DATABASE_URL_DEV` in `.env.local`.
2. Run `pnpm exec tsx scripts/setup-video-dev.ts`. This additive, repeatable migration refuses a dev endpoint matching `DATABASE_URL_PROD`; it never falls back to `DATABASE_URL`.
3. Run `VIDEO_ENABLED=1 DB_TARGET=dev pnpm dev --hostname 0.0.0.0 --port 3002`.
4. Open `/video`, sign in with the existing admin PIN, and create a camera-test session or link a scheduled game.

The dashboard uses the public BASH header/footer, max-w-6xl page width, compact typography, neutral selection pills, and shared theme tokens. It still requires the existing admin login; the old `/admin/video` URL redirects here. Camera configuration sits in a disclosure below the replay view. A provider-configuration notice distinguishes missing credentials from a live device. No simulated recording or stream status is displayed. The feature is disabled unless `VIDEO_ENABLED=1`.

## Cloudflare setup

Use a private development R2 bucket and separate Stream inputs. See `.env.video.example` for variable names. R2 credentials need object read/write access only to that bucket. The Stream token needs Stream edit permission for the selected account. Keep both server-side; never use `NEXT_PUBLIC_*` for these credentials.

For browser playback, configure the R2 bucket CORS policy with the exact development/preview origins, allowed methods `GET` and `HEAD`, allowed header `Range`, and exposed headers `Content-Length`, `Content-Range`, `Accept-Ranges`, `ETag`. Native phone uploads do not use browser CORS. No public bucket is required.

After pairing a side in the dashboard, select **Prepare live** to provision its signed-playback Cloudflare Stream input. Native capture publishes RTMPS to that input. The player uses signed HLS on Cloudflare's account-specific playback domain, with hls.js where MediaSource is supported and native HLS as a fallback. Viewer tokens last three hours to cover a two-hour game plus setup; R2 read/write URLs last one hour. No account credential is delivered to the phone or browser. Pairing tokens are random, hashed in Postgres, scoped to one session and side, and expire after seven days. Pair again to rotate or renew a token, including to resume old uploads.

Stream's `automatic` recording mode creates its own viewing copies in addition to R2 originals. This implementation does **not** automatically delete Stream recordings or R2 media. Until an archive-completeness/retention job is added, review Stream storage manually; do not assume temporary recordings expire automatically.

## Build the iPhone app

Requires Xcode 26 with Swift 6, an iOS 17+ device, and XcodeGen. The HaishinKit dependency is pinned to 2.2.5.

```sh
cd ios/BASHCapture
xcodegen generate
xcodebuild -project BASHCapture.xcodeproj -scheme BASHCapture \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/bash-capture-build CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES build
```

Open the project in Xcode, select your Apple signing team and a physical iPhone, then run. Simulator builds check compilation and UI only; they cannot verify camera capture, encoding, heat, audio, or a two-hour session.

Keep ad-hoc signing enabled for simulator runs: unsigned builds compile but cannot save the camera pairing in Keychain.

Use an HTTPS dev URL accessible from the phone, or a trusted LAN hostname/address. A pairing link copied from `localhost` points to the phone itself. The setup link can be pasted into the app; its custom URL scheme is `bashcapture://pair`. Pairing credentials are stored in Keychain, never in the recording manifest. Opening a link while recording does not replace the active session.

## Capture, uploads, and failure behavior

- Landscape rear wide camera; 4K HEVC at 30 fps by default, selectable 60 fps when supported. Targets 25 Mbps at 30 fps / 40 Mbps at 60 fps, plus AAC audio. Test visual quality and actual dimensions on the selected phones.
- Independent 1080p H.264 live output, approximately 6 Mbps and 30 fps. A live connection failure does not stop a running local recording. Publishing reconnects automatically.
- Local MP4 segments of approximately 60 seconds, with ten-second movie fragments for recovery. Segment rotation currently stops/starts the writer and may introduce a small gap; this is **not** a proven gapless recorder.
- A manifest is saved before recording starts. Finalized segment duration is read from the actual media. Startup attempts to recover interrupted files without deleting them. Files are accessible in the Files app and Finder file sharing.
- Upload from the Library after recording. Files upload directly to R2, sequentially, with per-segment retries after app restart. V1 uploads require the app to remain open; there is no OS-background upload service or multipart resume within one segment yet.
- The server checks the object's byte length and content type before marking it verified. This is an upload-completeness check, not full media integrity or a checksum comparison. A verified retry does not overwrite the existing object.
- Local files are never automatically deleted. The app offers explicit cleanup of verified copies. Unuploaded/recovery files remain on the phone.
- Keep the app foreground while recording. The app prevents auto-lock and stops/finalizes when backgrounded or interrupted. It checks storage and critical thermal state between segments. These controls do not substitute for a full-duration hardware test.
- Ending a dashboard session tells connected phones to stop on their next check-in. An offline phone cannot receive that signal; stop it locally. Pending uploads remain allowed after session end.

## Replays and synchronization

Segment metadata maps approximate recording-start wall time onto the server clock using a request round trip. This is not frame-accurate synchronization; first-frame latency, clock drift, network asymmetry and scorekeeper reaction delay remain. Camera offsets can be adjusted in seconds in the dashboard (positive means camera timestamps are ahead of event timestamps).

Manual highlight markers are stored in `video_markers`. For linked games, the dashboard reads original `add` observations from `game_timing_events` (when migrated), falling back to legacy `game_live.state.timing` entries, for goals still present in the game. Later scoring edits don't silently replace the original observation. It never exposes the entire private timing history publicly.

Selecting a marker seeks into the corresponding uploaded segment with up to ten seconds of lead-in. Missing coverage produces an explicit message rather than jumping to unrelated footage. Lead-in is currently bounded to that segment; continuous multi-segment playback and frame-accurate camera switching are future work. HEVC browser support varies; Safari is recommended for the dev replay view. A broadly compatible H.264/HLS viewing derivative remains to be added.

## Camera fusion and Android

Original files and timestamps are preserved separately per camera so a processor can later calibrate, synchronize, stitch and crop them. The current UI shows left/right views, not a stitched panorama. Fusion needs calibration footage from the actual mount; do not treat framing guides as calibration. No processing worker or fused livestream has been deployed.

The API uses ordinary HTTPS bearer authentication and JSON, independent of Swift. An Android recorder can implement the same pairing, heartbeat, upload and completion contract. Android is not implemented in this change.

## Validation

On October 24, 2026, the local dev API uploaded a 12-second synthetic H.264/AAC clip to the private `bash-video-dev` R2 bucket. Completion verification, a repeated upload request, SHA-256 comparison of the downloaded file, HTTP 206 range playback, and CORS for `http://localhost:3002` passed. An unsigned object request was rejected. The sample is explicitly labeled **Synthetic video · R2 integration test** in the dev dashboard. This does not validate iPhone HEVC recording or a real game.

Cloudflare Stream is activated with 1,000 stored video minutes at $5/month, plus delivery usage. Separate left/right inputs were created for the synthetic test session. A 500 kbps H.264/AAC RTMPS test completed all 45 seconds on the right input, and the provider reported connection followed by client disconnect. An initial embedded-player approach buffered or remained blank in Chrome. The dashboard now uses direct HLS playback; a subsequent 640×360 synthetic live test in Chrome rendered frames with advancing playback time, readyState 4, and no media error. Dev database requests have also intermittently timed out. Short synthetic playback does not establish reliable game-length playback; validate the intended 1080p bitrate and full duration before a game.

The initial development R2 and Stream credentials expire November 23, 2026. Renew the scoped credentials before testing after that date. Credentials belong only in the ignored server environment, not in this document or the iPhone application.

`pnpm exec vitest run tests/video.test.ts` covers authorization, expired credentials, upload verification, retry/id collisions, payload limits and replay gaps/offsets. Run `pnpm exec tsc --noEmit` and the simulator build above. Before field use: verify two physical cameras, actual 4K dimensions, audio/video sync, stream disconnect/reconnect, R2 byte checks, interrupted uploads, app restart recovery, clock correction and full two-hour thermal/storage behavior.

The video layout was checked in Chrome and a narrow in-app browser viewport after switching to the public site shell. The old route redirects to `/video`. An unauthenticated page request shows the login gate without recording data, and the API returns 401. TypeScript, targeted ESLint, 12 video tests, and the updated iOS simulator build passed.
