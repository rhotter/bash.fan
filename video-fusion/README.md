# BASH panorama worker

Two overlapping camera feeds in, one wide video out. This is a standalone Python processor: no game selection, player detection, puck tracking, or broadcast cropping. Downstream processing can consume its single output.

The prototype implements fixed geometry calibration, timestamp-based frame selection, optional audio offset/drift estimation, exposure matching, a fixed narrow blend, and H.264/AAC encoding to MP4 or an RTMP(S)/SRT destination. It is not yet deployed or connected to the iPhone publishing configuration or game-page playback.

## Run locally

Requires Python 3.11+ and FFmpeg on PATH. The Python dependencies are locked in `uv.lock`.

```sh
cd video-fusion
uv sync --extra test --locked
uv run --locked pytest
uv run --locked python scripts/make_demo.py --output output/demo
uv run --locked bash-fusion sync \
  --left output/demo/left.mp4 --right output/demo/right.mp4 \
  --window 4 --max-offset 1 --output output/demo/sync.json
uv run --locked bash-fusion calibrate \
  --left output/demo/left.mp4 --right output/demo/right.mp4 \
  --at 1 --offset .25 --width 1280 --output output/demo/rig.json
uv run --locked bash-fusion render \
  --left output/demo/left.mp4 --right output/demo/right.mp4 \
  --calibration output/demo/rig.json --sync output/demo/sync.json \
  --output output/demo/fused.mp4 --duration 5 --width 1280 \
  --report output/demo/report.json
```

The demo is original synthetic footage with overlapping views, a 250 ms offset, moving objects, and different exposure. It tests the plumbing against known geometry and timing; it does not simulate real lens distortion or parallax. Existing calibration/video outputs are not overwritten; use a new directory to repeat the demo.

`calibrate` examines three moments across one second and rejects unstable geometry, insufficient overlap, weak matches, and excessive perspective distortion. It writes a calibration JSON and a preview JPEG. The preview must be visually checked before use. Optional `--roi-left X Y W H` / `--roi-right X Y W H` constrain calibration to stationary background features. These are operator tools, not settings in the website or app.

## Synchronization

The convention is **right media time = offset + rate × left media time**, in seconds. A positive offset means the matching event occurs later in the right file. This is not the website's wall-clock offset convention.

For example, `--offset .25` means left frame at 1.00 seconds matches right frame at 1.25 seconds. `--drift-ppm 100` adds 0.0001 to the rate. For audio alignment, a clap or a shared broadband sound near the adjacent microphones is useful. Silence, periodic tones, and ambiguous correlations are rejected.

```sh
uv run --locked bash-fusion sync --left left.mp4 --right right.mp4 \
  --at 30 600 1200 --window 20 --max-offset 5 --output sync.local.json
```

A single window estimates offset only. Three or more separated windows estimate an affine drift mapping with outlier rejection. This is an offline measurement, not a continuous live synchronization service. A fresh connection or recording can reset its timeline and requires a new timing anchor. No claim of sensor-level genlock is made.

Rendering uses presentation timestamps, not matching frame indices. It trims time before both inputs are available, selects the nearest frame on each timeline, retains only the left audio track, and stops on gaps beyond its frame tolerance, backward timestamps, or source failure. End of the shorter recording ends output. It does not fill missing coverage by holding a stale image. A 30 fps source rendered at 60 fps still has only 30 unique captured frames per second.

## Stream the combined view

`--left` and `--right` accept files or FFmpeg-supported readable URLs. Use fixed-resolution inputs matching the calibration. These are input URLs, not an RTMP ingest server. File/URL timelines must share the timing mapping supplied to this invocation; downloading a clip and reconnecting to a live endpoint does not preserve that anchor automatically.

Supply a full destination URL through a process environment variable (for Cloudflare, the prepared fused live input's RTMPS URL plus its private stream key). Keep credentials outside Git and logs.

```sh
# Inject BASH_FUSION_PUBLISH_URL via the host's secret manager.
uv run --locked bash-fusion render \
  --left left.mp4 --right right.mp4 --calibration rig.local.json \
  --sync sync.local.json --publish-env BASH_FUSION_PUBLISH_URL --fps 60
```

Network output is paced in real time and stops if processing falls more than two seconds behind. Destination protocols use the codecs supported by the bundled FFmpeg/PyAV build. RTMP was tested locally; RTMPS to Cloudflare and SRT have not been exercised end to end. Input network reads time out; run the worker under a supervisor for process-level publishing timeouts and restarts. There is no automatic reconnect, rolling jitter buffer, or continuous drift estimator yet.

The intended deployment remains:

```text
two phones → ingest → panorama worker → one output → downstream processing / Stream
```

The current phones still publish their separate feeds. This change does not silently switch the game page to an unvalidated panorama. R2 originals stay intact.

## Scope and limitations

- The geometry is a planar homography baseline. It works best with adjacent fixed cameras, substantial overlap, distant content, and already corrected lenses. It does not yet calibrate/undistort iPhone 0.5× lenses or use spherical projection. A saved calibration is tied to camera resolution, orientation, zoom, and mount position.
- Depth differences cause parallax. The narrow static blend limits the area of ghosting but cannot remove it. There is no depth-aware or motion-aware seam selection.
- Calibration feature agreement is evidence of geometric fit, not a guarantee of a seamless panorama. Check moving objects through the overlap and the outer edges of the combined view.
- Exposure compensation is measured once. Auto exposure/white balance changes during capture will need capture locks or gradual correction.
- CPU throughput depends on output size and image complexity. A 60 fps file is not proof of sustained real-time 4K60 or even 1080p60 processing.
- Two-hour live testing, reconnect handling, precise capture-to-server timestamps, deployment, and automatic game-page routing are still required before live use.

## Dataset experiments

See [dataset notes](../docs/video-fusion-datasets.md). Generic video stitching data is the primary benchmark; this processor is independent of the subject of the video.

Fetch a small part of the authors' public StabStitch-D archive without downloading all 6 GB:

```sh
uv run --locked python scripts/fetch_stabstitch_sample.py \
  --pair 00000107 --frames 90 --output data/stabstitch-107
```

The fetcher bounds downloads to 100 MB and writes hashes and source attribution in `manifest.json`. It downloads only JPEG data; it never runs downloaded scripts. Do not commit or redistribute dataset media without checking its own license. The `.gitignore` excludes `data/`, `output/`, and `*.local.json`.

StabStitch-D uses handheld cameras. A fixed-mount calibration can legitimately reject a moving pair. Its ordered JPEGs can test per-frame geometry, but contain no native audio or PTS; wrapping them at a chosen frame rate is not a synchronization benchmark.

Preview a real pair's geometry without claiming the cameras remain fixed:

```sh
uv run --locked bash-fusion stitch-image \
  --left data/stabstitch-107/video1/0001.jpg \
  --right data/stabstitch-107/video2/0001.jpg \
  --output output/stabstitch-107-preview.jpg
```

On test pair `00000107`, the first-frame preview had 291 RANSAC inliers,
0.36 px median residual and 1.11 px 95th-percentile residual. A three-frame
video calibration rejected it for 8.5 px of corner motion (8 px limit).
That is a useful distinction: a plausible still panorama does not establish
stable geometry throughout a moving-camera video.

On this development Mac, the synthetic 1280×642 render measured about 81 fps
without pacing; the local RTMP run delivered 300 frames at 60 fps and AAC
audio. This short test is not a deployment capacity estimate. The macOS
OpenCV/PyAV wheels currently print duplicate AVFoundation class warnings;
these tests use file/network decoding rather than AVFoundation capture.
