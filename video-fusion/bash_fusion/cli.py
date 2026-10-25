import argparse
import json
import math
import os
from pathlib import Path
import sys

import cv2
import numpy as np

from .geometry import CalibrationError, Stitcher, corners, estimate, project, save
from .media import render, snapshot
from .sync import Sync, audio_offset, fit_drift, read_audio


def calibrate(args):
    if not math.isfinite(args.at) or args.at < 0 or not math.isfinite(args.max_motion) or args.max_motion <= 0:
        raise ValueError("Calibration time must be nonnegative and motion tolerance positive")
    sync = Sync(args.offset, 1 + args.drift_ppm / 1_000_000)
    times = [args.at + d for d in [0., .5, 1.]]
    pairs, matrices, quality = [], [], []
    for t in times:
        a, b = snapshot(args.left, t), snapshot(args.right, sync.right_time(t))
        h, q = estimate(a, b, args.roi_left, args.roi_right)
        pairs.append((a, b)); matrices.append(h); quality.append(q)
    # Fixed rigs must agree across multiple frames. Refuse handheld movement.
    projected = np.array([project(corners(pairs[0][1].shape[1::-1]), h) for h in matrices])
    instability = float(np.max(np.linalg.norm(projected - np.median(projected, axis=0), axis=2)))
    if instability > args.max_motion:
        raise CalibrationError(f"Rig moved or calibration is unstable ({instability:.1f}px); use fixed cameras")
    best = int(np.argmin([q['median_error_px'] for q in quality]))
    a, b = pairs[best]
    c = {"version": 1, "model": "planar-homography", "left_size": list(a.shape[1::-1]), "right_size": list(b.shape[1::-1]),
         "right_to_left": matrices[best].tolist(), "quality": quality, "corner_motion_px": instability,
         "sync": sync.to_dict(), "calibration_left_seconds": times[best], "feather_px": 8}
    stitcher = Stitcher(c, args.width)
    c['right_gain'] = stitcher.exposure(a, b)
    preview = str(Path(args.output).with_suffix('.jpg'))
    if Path(args.output).exists() or Path(preview).exists():
        raise ValueError("Calibration output already exists")
    save(args.output, c)
    if not cv2.imwrite(preview, Stitcher(c, args.width).frame(a, b)):
        raise ValueError("Could not save calibration preview")
    print(json.dumps({"calibration": args.output, "preview": preview, "quality": quality, "corner_motion_px": instability}))


def stitch_image(args):
    """A geometry preview only; one image pair cannot establish a stable video rig."""
    if Path(args.output).exists():
        raise ValueError("Image output already exists")
    a, b = cv2.imread(args.left), cv2.imread(args.right)
    if a is None or b is None:
        raise ValueError("Could not read both images")
    h, quality = estimate(a, b)
    calibration = {"version": 1, "left_size": list(a.shape[1::-1]), "right_size": list(b.shape[1::-1]),
                   "right_to_left": h.tolist()}
    calibration['right_gain'] = Stitcher(calibration, args.width).exposure(a, b)
    stitcher = Stitcher(calibration, args.width)
    if not cv2.imwrite(args.output, stitcher.frame(a, b)):
        raise ValueError("Could not write stitched image")
    print(json.dumps({"quality": quality, "size": stitcher.size, "preview_only": True}))


def synchronize(args):
    observations, evidence = [], []
    for t in args.at:
        result = audio_offset(read_audio(args.left, t, args.window), read_audio(args.right, t, args.window), max_offset=args.max_offset)
        observations.append([t + args.window/2, result['offset']])
        evidence.append({"left_window_start": t, **result})
    if len(observations) == 1:
        sync, inliers = Sync(observations[0][1]), 1
    else:
        sync, inliers = fit_drift(observations)
    result = {"sync": sync.to_dict(), "inliers": inliers, "observations": evidence,
              "warning": "One window estimates offset only; use three or more separated windows to estimate drift." if inliers == 1 else None}
    if args.output:
        if Path(args.output).exists():
            raise ValueError("Sync output already exists")
        save(args.output, result)
    print(json.dumps(result, indent=2))


def main():
    parser = argparse.ArgumentParser(description="BASH fixed-rig fusion prototype")
    sub = parser.add_subparsers(dest="command", required=True)
    cal = sub.add_parser("calibrate", help="Calibrate a fixed overlapping camera pair from three frames")
    sy = sub.add_parser("sync", help="Measure audio offset and optional clock drift")
    run = sub.add_parser("render", help="Fuse timestamped files or live URLs to MP4/RTMPS/SRT")
    still = sub.add_parser("stitch-image", help="Preview geometry from one image pair; does not establish video calibration")
    for p in [cal, sy, run, still]:
        p.add_argument('--left', required=True)
        p.add_argument('--right', required=True)
    still.add_argument('--output', required=True)
    still.add_argument('--width', type=int, default=1920)
    cal.add_argument('--at', type=float, default=0.)
    cal.add_argument('--offset', type=float, default=0., help="right media seconds minus left media seconds")
    cal.add_argument('--drift-ppm', type=float, default=0.)
    cal.add_argument('--max-motion', type=float, default=8.)
    cal.add_argument('--roi-left', nargs=4, type=int, metavar=('X','Y','W','H'))
    cal.add_argument('--roi-right', nargs=4, type=int, metavar=('X','Y','W','H'))
    cal.add_argument('--output', required=True)
    cal.add_argument('--width', type=int, default=1920)
    sy.add_argument('--at', nargs='+', type=float, default=[0.])
    sy.add_argument('--window', type=float, default=20.)
    sy.add_argument('--max-offset', type=float, default=5.)
    sy.add_argument('--output')
    run.add_argument('--calibration', required=True)
    run.add_argument('--sync', help="Sync JSON from the sync command; overrides calibration timing")
    dest = run.add_mutually_exclusive_group(required=True)
    dest.add_argument('--output', help="Local .mp4 path")
    dest.add_argument('--publish-env', help="Environment variable containing the full private RTMPS/SRT URL")
    run.add_argument('--start', type=float, default=0.)
    run.add_argument('--duration', type=float)
    run.add_argument('--fps', type=int, default=60)
    run.add_argument('--width', type=int, default=1920)
    run.add_argument('--realtime', action='store_true')
    run.add_argument('--no-audio', action='store_true')
    run.add_argument('--report')
    args = parser.parse_args()
    try:
        if args.command == 'calibrate':
            calibrate(args)
        elif args.command == 'sync':
            synchronize(args)
        elif args.command == 'stitch-image':
            stitch_image(args)
        else:
            calibration = json.loads(Path(args.calibration).read_text())
            sync = json.loads(Path(args.sync).read_text())['sync'] if args.sync else calibration['sync']
            output = os.environ.get(args.publish_env) if args.publish_env else args.output
            if not output:
                raise ValueError("Publishing URL environment variable is missing")
            if args.publish_env and not output.startswith(('rtmps://', 'rtmp://', 'srt://', 'udp://')):
                raise ValueError("Unsupported publishing protocol")
            if args.width < 64 or args.width > 7680:
                raise ValueError("Output width must be between 64 and 7680")
            report = render(args.left, args.right, output, Stitcher(calibration, args.width), Sync(**sync),
                            args.fps, args.start, args.duration, args.realtime, not args.no_audio)
            # Do not echo source URLs or publishing credentials into logs.
            if args.report:
                save(args.report, report)
            print(json.dumps(report, indent=2))
    except (ValueError, RuntimeError, OSError, EOFError) as e:
        # Media errors may contain private stream URLs. Print detailed errors only for our validations.
        from .media import TimelineError
        message = str(e) if type(e) in (ValueError, CalibrationError, TimelineError) else 'Media input/output failed; check source availability and credentials.'
        print('Fusion stopped: ' + message, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
