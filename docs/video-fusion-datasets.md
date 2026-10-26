# Panorama test data

Reviewed October 24, 2026. The worker only combines overlapping views into one wide view. No sports-specific model or labeled sports dataset is required. Generic synchronized camera pairs are appropriate.

## Primary candidate: StabStitch-D

[Official project and dataset links](https://github.com/nie-lang/StabStitch), [authors' dataset folder](https://drive.google.com/drive/folders/16EDGrKOLLwcMseOjpI7bCrv_aP1MYVcz).

A dedicated video-stitching dataset with handheld overlapping views. This is more directly useful than arbitrary multi-camera videos: two cameras merely seeing the same event is not enough for a panorama. The authors also publish a learned stitching implementation and document generalization failures; this prototype uses classical fixed calibration instead of adopting those weights.

Downloaded 90 frames per camera from each of test pairs `00000100` and `00000107`. The first was too dark/feature-poor for this baseline. The second produced a plausible still panorama: 291 inliers, 0.36 px median residual, and 1.11 px p95 residual. Its relative camera movement (8.5 px over the sampled second) exceeded the default fixed-rig limit (8 px), so the video calibration was rejected rather than presented as a stable video stitch.

The public archive is 6,206,706,274 bytes. Its test pairs contain ordered JPEG frames in `testing/<pair>/video1` and `video2`. The repository's bounded range downloader fetches selected frames and checks ZIP CRCs, then records SHA-256 hashes. Dataset media stays in ignored local directories. The software repository's license is not treated as proof of a license for redistributing the dataset.

## Other candidates

| Dataset | What it can test | Limits / access |
| --- | --- | --- |
| [EPFL-RLC](https://www.epfl.ch/labs/cvlab/data/data-rlc/) | Three static overlapping cameras, calibration, synchronized sequences | Published video is reduced to 480×270. Cameras are distributed around a scene, so parallax may be much larger than adjacent phones. Identified; not downloaded. |
| [MUVS](https://zenodo.org/records/20708683) | Real simultaneous handheld-phone recordings | Two short hockey camera samples were downloaded and inspected. One mostly faces the crowd, and the inspected sources have no audio. The worker correctly rejected the pair for insufficient reliable overlap and rejected audio sync. Not a successful stitch demonstration. |
| [ISSIA soccer](https://pspagnolo.jimdofree.com/download/) | Six synchronized fixed Full-HD views at 25 fps, with calibration data | Explicitly limited to non-commercial research. Not selected for deployment or redistribution. |

MUVS's Zenodo metadata reports CC BY 4.0, but its downloadable README leaves the license as a TODO. Treat that inconsistency as unresolved for redistribution. Earlier exploration downloaded only short local samples from `blackhawks_vs_hurricanes_20240414`, period P2, cameras CAM2/CAM3, scaled to 960×540. Their annotation offsets are not proof of frame-accurate alignment.

## Reproducible validation

`video-fusion/scripts/make_demo.py` generates our own synthetic pair with known spatial translation, a 250 ms temporal offset, moving objects, and different exposure. The CLI detected the offset, calibrated the overlap, and generated 300 frames of H.264/AAC output at 60 fps. A local RTMP receiver decoded all 300 frames and the audio track. No dataset footage was published to Cloudflare.

The synthetic experiment validates geometry on a known planar scene and the encoding/streaming path. It does not validate real lenses, parallax, long-run synchronization, or sustained full-resolution live throughput. The actual fixed iPhone mount still needs a calibration and motion test, regardless of which generic dataset is used.

To repeat the motion check, wrap pair 107's JPEG sequences with FFmpeg
(`-framerate 30 -i video1/%04d.jpg`, similarly for video2) and run
`bash-fusion calibrate --left left.mp4 --right right.mp4 --output rig.json`.
Here 30 fps is an explicit test wrapper assumption, not a measured camera
rate. Three calibration snapshots use image indices 1, 16 and 31. The
single-frame preview command is in the worker README.
