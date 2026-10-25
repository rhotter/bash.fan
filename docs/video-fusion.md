# Two-phone fusion

The mount is fixed at center rink, with overlapping views from two recent iPhones. Capture remains native on each phone; a separate processor aligns and combines the images. R2 holds the originals. Cloudflare Stream handles delivery; it does not perform this stitching. The app still publishes independent left/right feeds. The website automatically displays one available feed in a single player, with no camera controls. No fusion worker is implemented or deployed yet.

## Capture setup

Select the same website game on both phones, assign left/right, and use the same frame rate. Keep the lenses close together, include a useful overlap, and do not move the mount after calibration. We need a short recording from the actual rig to establish lens distortion, the overlap and whether the mount is stable enough. Different lens choices, zoom levels, stabilization behavior or a moved mount require recalibration. Locking focus, exposure and white balance is part of the capture work still to implement.

## Synchronization

1. **Coarse time:** the app already samples the shared server clock and anchors it to monotonic uptime. Segment start metadata gives the processor a bounded search area, but currently describes the recording request rather than the first captured frame. Before relying on precise replay timing, the recorder must persist first-frame presentation timestamps and segment discontinuities alongside the media.
2. **Audio alignment:** record a clap near the mount after both phones start. Cross-correlate their audio to find the relative offset. Repeated sound patterns or weak audio can produce a false match; retain confidence scores and a manual adjustment instead of silently accepting it.
3. **Drift:** repeat the alignment over overlapping audio windows throughout the game. Fit a robust mapping between the two media timelines and re-check around interruptions. Do not apply one opening offset to an entire two-hour game. Keep segment gaps explicit; concatenating files without their real start times would erase gaps and break the mapping.
4. **Playback timeline:** map each selected frame into the shared game timeline. Resample or select frames as needed, and use one audio source for the output to avoid echo. This aligns recorded content; it does not make the two camera sensors expose at exactly the same instant.

Hardware genlock is an optional future path for suitable devices and accessories. Apple documents external genlock in Final Cut Camera on iPhone 17 Pro or later with a compatible generator. That does not establish support in our app or on unspecified “newish” phones. The initial design therefore uses software alignment. [Apple's timecode and genlock guide](https://support.apple.com/guide/final-cut-camera/set-timecode-and-genlock-devdbb68a124/ios).

## Image fusion

Calibrate lens distortion and the relationship between the two views from the mounted cameras, then project them onto a common panorama. A plain homography is a useful prototype for distant/static features, but players and a puck at different depths can create parallax and double images at the seam. Validate the seam on moving play, compensate for exposure differences, and use a seam policy that avoids blending two displaced versions of a player. OpenCV supplies calibration and stitching primitives; it does not make an arbitrary rig seamless automatically. [OpenCV stitching overview](https://docs.opencv.org/4.10.0/d8/d19/tutorial_stitcher.html).

The first output should be a fixed wide panorama. Automatic puck tracking and a moving broadcast crop are separate later work. Preserve the original recordings so calibration and rendering can be improved without losing source footage.

## Live path

The intended path is `two phones → ingest/processing machine → one fused output → Cloudflare Stream → game page`. The processor needs timestamp-aware ingest, a rolling buffer for unequal network delays, continuous alignment, and explicit handling when one camera disconnects. A rink-side computer is a practical first test host; cloud processing is an alternative whose compute and ingest costs still need measurement. Live stitching adds latency. Keep recording the 4K originals locally during network interruptions; the first live experiment can process 1080p feeds to reduce bandwidth and heat.

The current direct-to-Stream camera feeds are useful for testing capture and delivery, but are not this fused pipeline. Before enabling it for a Saturday, validate alignment and seams using actual mounted footage, then test reconnects and full two-hour capture, processing and playback.
