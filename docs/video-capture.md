# BASH recording development

Recording is integrated into the iPhone application in `ios/BASH`, with capture code in `ios/BASH/Sources/Capture`. The standalone BASH Capture application has been removed. Recording setup and camera management exist only in the iPhone app. Each existing score page, `/game/[id]`, provides viewing: livestreams, uploaded recordings and event replays. Operators connect through the app using the existing league PIN. There is no standalone video page. This is a development implementation: R2 upload and retrieval and Stream ingest have been verified with synthetic footage. Short synthetic live playback now works in Chrome. Game-length playback and physical camera performance still require validation before a game.

## Run the dashboard

1. Use a separate Neon dev endpoint in `DATABASE_URL_DEV` in `.env.local`.
2. Run `pnpm exec tsx scripts/setup-video-dev.ts`. This additive, repeatable migration refuses a dev endpoint matching `DATABASE_URL_PROD`; it never falls back to `DATABASE_URL`.
3. Run `VIDEO_ENABLED=1 DB_TARGET=dev pnpm dev --hostname 0.0.0.0 --port 3002`.
4. Build the iPhone app for this service, enter the league PIN, and choose a camera side. Leave both phones recording through the games; the backend matches footage using scorekeeper timing. Open a game’s score page to watch.

The dashboard uses the public BASH header/footer, max-w-6xl page width, compact typography, neutral selection pills, and shared theme tokens. The website has no recording setup, camera pairing, live provisioning or session-ending controls, including for administrators. Covered goals and penalties have play buttons beside their event rows. No simulated recording or stream status is displayed. The feature is disabled unless `VIDEO_ENABLED=1`.

## Cloudflare setup

Use a private development R2 bucket and separate Stream inputs. See `.env.video.example` for variable names. R2 credentials need object read/write access only to that bucket. The Stream token needs Stream edit permission for the selected account. Keep both server-side; never use `NEXT_PUBLIC_*` for these credentials.

For browser playback, configure the R2 bucket CORS policy with the exact development/preview origins, allowed methods `GET` and `HEAD`, allowed header `Range`, and exposed headers `Content-Length`, `Content-Range`, `Accept-Ranges`, `ETag`. Native phone uploads do not use browser CORS. No public bucket is required.

Selecting a game and side with **Livestream** enabled in the app provisions its signed-playback Cloudflare Stream input. Native capture publishes RTMPS to that input. The player uses signed HLS on Cloudflare's account-specific playback domain, with hls.js where MediaSource is supported and native HLS as a fallback. Viewer tokens last three hours to cover a two-hour game plus setup; R2 read/write URLs last one hour. No account credential is delivered to the phone or browser. Pairing tokens are random, hashed in Postgres, scoped to one session and side, and expire after seven days. Camera replacement is an explicit confirmation in the app. It invalidates the previous credential; stop the old phone first. Previously saved files remain on that phone.

Stream's `automatic` recording mode creates its own viewing copies in addition to R2 originals. This implementation does **not** automatically delete Stream recordings or R2 media. Until an archive-completeness/retention job is added, review Stream storage manually; do not assume temporary recordings expire automatically.

## Build the iPhone app

Requires Xcode 26 with Swift 6, an iOS 17+ device, and XcodeGen. The HaishinKit dependency is pinned to 2.2.5.

```sh
cd ios/BASH
xcodegen generate
xcodebuild -project BASH.xcodeproj -scheme BASH \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/bash-capture-build BASH_SERVER_URL=http://localhost:3002 \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES build
```

Open the project in Xcode, select your Apple signing team and a physical iPhone, then run. Simulator builds check compilation and UI only; they cannot verify camera capture, encoding, heat, audio, or a two-hour session.

Keep ad-hoc signing enabled for simulator runs: unsigned builds compile but cannot save the camera pairing in Keychain.

The service address is built into the app through `BASH_SERVER_URL`, currently pointing to the video preview backend configured in `ios/BASH/project.yml`. There is no server-address field or settings screen. Override the build setting for development as above; physical phones need an accessible HTTPS dev service or trusted LAN address, since localhost points to the phone itself. The video backend must be deployed before a default production build can connect. Pairing credentials are stored in Keychain, never in the recording manifest. Camera setup cannot replace the active session while recording.

The app uses native SwiftUI navigation, lists, forms, sheets, system typography and a full-screen camera. On iOS 26 its camera controls use Liquid Glass; earlier supported versions use system material. It follows the device's appearance outside the dark viewfinder. The web score pages keep the public BASH design.

Open Record game from the three-dot menu on Scores or game details, enter the league operator PIN, choose Left or Right, and open the camera. Recording is independent of the selected game; the backend matches footage using scorekeeper timing. Upload progress is available in the Uploads sheet.

The app joins `POST /api/bash/video/capture` with only its camera side. Both phones atomically join the same daily session using the Los Angeles calendar date and a unique `capture_day` index. Reopening with the same camera credential is idempotent; taking another phone’s side requires confirmation. The current implementation is for one fixed rink rig, with no simultaneous-rink disambiguation. Apply the updated video schema before deploying this version.

The server keeps the daily recording independent of game IDs. Public game pages derive game intervals from the first observed scorekeeper clock start and original device timing entries. Completed games end at their last original observation. Live intervals extend through the running clock or a 15-minute activity grace, capped at four hours from start. Schedule dates bound the search but do not establish a match. Both metadata and signed playback enforce the same coverage check. Whole clips must fit within one game interval and cannot overlap a competing game; boundary clips, gaps, missing timing and ambiguous activity remain stored but unassigned. No timestamps are fabricated for legacy games. A later scorekeeper upload can reveal previously unassigned footage without re-uploading video.

The PIN is not saved; the operator cookie lives in an ephemeral URL session. Joining automatically prepares live output. Stop recording separately on each phone. Persisted camera credentials stay in Keychain, and old pending uploads retain their original destination.

## Capture, uploads, and failure behavior

- Landscape with volume buttons facing up. The viewfinder gives explicit rotation feedback (including a 180° prompt for reversed landscape) and blocks starting until correctly oriented. Moving the phone during recording shows a warning while recording and Stop remain available.
- Rear 0.5× ultra-wide camera; 4K HEVC at a fixed 60 fps, targeting 40 Mbps plus AAC audio. Preview, local recording and livestream share this physical lens. Phones without an ultra-wide camera or a 3840×2160 format supporting 60 fps on that lens cannot record; there is no silent lens, resolution or frame-rate fallback. Test visual quality, framing and actual dimensions on the selected phones.
- Independent 1080p H.264 live output, approximately 9 Mbps and 60 fps. A live connection failure does not stop a running local recording. Publishing reconnects automatically.
- Local MP4 segments of approximately 60 seconds, with ten-second movie fragments for recovery. Segment rotation currently stops/starts the writer and may introduce a small gap; this is **not** a proven gapless recorder.
- A manifest is saved before recording starts. Finalized segment duration is read from the actual media. Startup attempts to recover interrupted files without deleting them. Files are accessible in the Files app and Finder file sharing.
- Finalized clips upload automatically to R2 while recording and after stopping. File uploads use an OS-managed background URLSession, with up to two connections per host. Queued transfers can continue while locked or suspended, and reconnect after system relaunch. A short background handoff finalizes and queues the last clip. iOS controls scheduling; force-quitting cancels transfers until the user reopens BASH. Failed/expired transfers retry with fresh signed URLs on launch/foreground and every 30 seconds while active. Upload URLs last 24 hours; there is no multipart resume within a segment. Successful transfers are persisted before server verification, which can retry on reopening without resending the video. Lock-screen completion and system relaunch still require physical-iPhone validation.
- The server checks the object's byte length and content type before marking it verified. This is an upload-completeness check, not full media integrity or a checksum comparison. A verified retry does not overwrite the existing object.
- Local clips are removed automatically only after the server confirms the upload and the app persists that verification. Small upload receipts remain for safe cleanup retries on launch and while active. Failed uploads and unverified/recovery files remain on the phone. There is no manual cleanup button.
- Keep the app foreground while recording. The app prevents auto-lock and stops/finalizes when backgrounded or interrupted. It checks storage and critical thermal state between segments. These controls do not substitute for a full-duration hardware test.
- The backend retains session-ending support; an ended session stops connected phones at their next check-in. There is no shared-session end control in the simplified app. Pending uploads remain allowed after session end.

## Replays and synchronization

Before capture, the phone samples the authenticated clock endpoint five times. The server reports request-received and response-sent timestamps, allowing the client to subtract server processing time and select the sample with the lowest estimated network delay. That estimate anchors the phone's monotonic uptime to server time, so a phone wall-clock adjustment does not move an ongoing recording's timestamps. The anchor and estimated network uncertainty are saved in the local recording manifest; the API still receives the derived segment start time.

These remain recording-request timestamps, not measured first-frame timestamps. The clock estimate is not frame-accurate synchronization or an accuracy guarantee: first-frame latency, long-term clock drift, network asymmetry and scorekeeper reaction delay remain. Playback applies stored camera offsets (positive means camera timestamps are ahead of event timestamps); an in-app offset editor is not implemented yet. See [the fusion plan](video-fusion.md) for audio alignment, calibration and live processing.

Manual highlight markers are stored in `video_markers`. For linked games, the backend reads original `add` observations from `game_timing_events` (when migrated), falling back to legacy `game_live.state.timing` entries, for goals and penalties still present in the game. Later scoring edits don't silently replace the original observation. It never exposes the entire private timing history publicly.

Selecting a covered event replay seeks into the corresponding uploaded segment with up to ten seconds of lead-in. Events without timestamped footage have no play button. Lead-in is currently bounded to that segment; continuous multi-segment playback and frame-accurate camera switching are future work. HEVC browser support varies; Safari is recommended for the dev replay view. A broadly compatible H.264/HLS viewing derivative remains to be added.

## Camera fusion and Android

Original files and timestamps are preserved separately per camera so a processor can later calibrate, synchronize, stitch and crop them. The game page displays left/right players side by side at desktop and phone widths, with native playback controls and explicit fullscreen buttons. There are no recording or timing settings on the website. Event replay buttons open each available camera at the same event-relative starting time, accounting for its timestamp offset and shared available lead-in. Subsequent playback controls and live HLS buffers are independent; this is not frame-locked playback or a stitched panorama. Missing footage remains an unavailable camera tile. Fusion needs calibration footage from the actual mount; do not treat framing guides as calibration. No processing worker or fused livestream has been deployed.

The API uses ordinary HTTPS bearer authentication and JSON, independent of Swift. An Android recorder can implement the same pairing, heartbeat, upload and completion contract. Android is not implemented in this change.

## Validation

On October 24, 2026, the local dev API uploaded a 12-second synthetic H.264/AAC clip to the private `bash-video-dev` R2 bucket. Completion verification, a repeated upload request, SHA-256 comparison of the downloaded file, HTTP 206 range playback, and CORS for `http://localhost:3002` passed. An unsigned object request was rejected. The sample is explicitly labeled **Synthetic video · R2 integration test** in the dev dashboard. This does not validate iPhone HEVC recording or a real game.

Cloudflare Stream is activated with 1,000 stored video minutes at $5/month, plus delivery usage. Separate left/right inputs were created for the synthetic test session. A 500 kbps H.264/AAC RTMPS test completed all 45 seconds on the right input, and the provider reported connection followed by client disconnect. An initial embedded-player approach buffered or remained blank in Chrome. The dashboard now uses direct HLS playback; a subsequent 640×360 synthetic live test in Chrome rendered frames with advancing playback time, readyState 4, and no media error. Dev database requests have also intermittently timed out. Short synthetic playback does not establish reliable game-length playback; validate the intended 1080p bitrate and full duration before a game.

The initial development R2 and Stream credentials expire November 23, 2026. Renew the scoped credentials before testing after that date. Credentials belong only in the ignored server environment, not in this document or the iPhone application.

`pnpm exec vitest run tests/video.test.ts tests/game-video.test.ts tests/video-games.test.ts tests/video-auto-match.test.ts tests/video-auto-capture.test.ts` runs 43 tests covering authorization, expired credentials, upload verification, retry/id collisions, payload limits, replay gaps/offsets, game-scoped viewing, public metadata redaction, native game selection, camera claim isolation and clock responses. Run `pnpm exec tsc --noEmit` and the simulator build above. Before field use: verify two physical cameras, actual 4K dimensions, audio/video sync, stream disconnect/reconnect, R2 byte checks, interrupted uploads, app restart recovery, clock correction and full two-hour thermal/storage behavior.

The video layout was checked in Chrome and a narrow in-app browser viewport after switching to the public site shell. The standalone routes have been removed. Viewer metadata and signed playback are scoped to the game; admin APIs still require authentication. TypeScript, targeted ESLint, video tests, and the updated iOS simulator build passed.

On the `video` branch, the synthetic R2 fixture is linked only to development game `g70`. Browser verification confirmed playback within that game page (1280×720, readyState 4, advancing playback, no media error) and, at that time, inline admin camera setup. That website setup UI has since been removed; capture is app-only. Both removed standalone page URLs return 404; the admin API rejects unauthenticated requests while the game viewing endpoint serves only game-scoped viewer data.

The native schedule was also verified in the iOS 26.1 simulator against the running dev website. A live API integration check on development game `g49` joined left/right concurrently, confirmed a shared session and matching game metadata, rejected a duplicate side with 409, and checked both authenticated clock responses. The explicitly titled **Native pairing · integration test** session was then ended. No media or Cloudflare inputs were created by that check. The unique open-game index was applied to the dev database only.

The simplified game-page player was checked in the browser with the synthetic R2 clip: it loads directly without a separate watch button, renders frames, and plays through native controls. Camera/session selectors, recording titles and standalone highlight buttons have been removed. The subsequent two-camera layout restores concise left/right labels and adds fullscreen buttons. The backend prioritizes sessions with a live feed, then sessions with uploaded video, so a newer empty setup does not hide available footage.

The simplified iPhone flow was verified in the iOS 26.1 simulator: PIN sign-in to the build-configured dev service, schedule loading, Left/Right selection, and automatic upload of a 12-second synthetic clip through the camera API to R2. The server verified the upload and the app marked it saved without an upload-button action. This does not verify physical capture or sustained upload bandwidth. Native controls and restrained brand accents follow Apple’s [branding guidance](https://developer.apple.com/design/human-interface-guidelines/branding) and [Liquid Glass guidance](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass).

Automatic local cleanup was checked with synthetic simulator files: a newly verified R2 upload was removed, an upload with missing credentials was retained, and existing verified files were cleared on relaunch. The small verification receipts remained in the manifest. The upload sheet no longer includes a removal control.

Before removal of the game picker, the app refreshed its schedule on foreground and every minute while active outside recording, bypassing the local URL cache. Camera selection orders same-day games by parsed start time (including AM/PM). On October 24, the isolated video dev database was missing the current 2026–27 season; its 73-game schedule and season/team metadata were copied from production, and its current-season flag was corrected. Production and existing dev video fixtures were unchanged. This was a schedule-only refresh, not a copy of rosters or boxscores; future development data refreshes remain explicit.

Automatic day capture replaces the earlier schedule-picker flow described in historical verification notes above. Unit checks cover consecutive games, missing timing, overlaps, stale live clocks, delayed observations, authenticated pairing, credential reuse, and game-scoped playback rejection.

Automatic matching was verified against the development API and R2 with two synthetic games and three uploaded clips from one shared daily session. Each game exposed only its own clip; both the between-game clip and the other game’s clip were rejected by signed playback. The same check passed after moving observations into the append-only timing table and clearing legacy inline entries. Synthetic schedule fixtures were then removed. The updated app built and its PIN-to-side-selection UI was verified in the iOS simulator. Production schema and app deployment remain pending.

Background upload recovery checks: `scripts/test-ios-upload-recovery.sh` runs the actual manifest and file-cleanup code in a booted simulator with stubbed server verification (successful upload, failed transfer, verification interrupted by restart, and legacy manifests). It does not validate OS scheduling or real R2 transfers while locked.
