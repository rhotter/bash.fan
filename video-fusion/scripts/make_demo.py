"""Create original synthetic overlapping inputs, with a known 250 ms timing offset.

This verifies plumbing and timing, NOT real-camera parallax or lens distortion.
Run: python scripts/make_demo.py --output output/demo
"""
import argparse
from collections import deque
import json
from pathlib import Path

import cv2
import numpy as np

from bash_fusion.media import Writer


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(44)
    width, height, crop, shift, fps, seconds = 1280, 640, 880, 400, 60, 6
    base = np.full((height, width, 3), (220, 232, 229), np.uint8)
    # Unique, static texture gives SIFT reproducible calibration landmarks.
    for _ in range(1800):
        x, y = rng.integers([0, 0], [width, height])
        cv2.circle(base, (int(x), int(y)), int(rng.integers(1, 4)), (185, 198, 193), -1)
    cv2.rectangle(base, (40, 100), (1240, 590), (50, 55, 65), 8)
    cv2.line(base, (640, 104), (640, 586), (85, 70, 210), 5)
    cv2.circle(base, (640, 345), 90, (85, 70, 210), 4)
    for x in [400, 880]:
        cv2.line(base, (x, 104), (x, 586), (200, 100, 40), 5)
    for x in [240, 1040]:
        for y in [220, 470]:
            cv2.circle(base, (x, y), 58, (85, 70, 210), 3)
    cv2.putText(base, 'BASH / SYNTHETIC FUSION TEST', (55, 45), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (40, 45, 55), 2)
    cv2.putText(base, 'Two overlapping inputs - right timeline delayed 250 ms', (55, 78), cv2.FONT_HERSHEY_SIMPLEX, .65, (60, 65, 75), 1)
    audio = rng.normal(0, .035, 48000*(seconds+4)).astype(np.float32)
    for side, offset in [('left', 0.), ('right', .25)]:
        w = Writer(args.output/f'{side}.mp4', (crop, height), fps, True)
        try:
            for i in range(seconds*fps):
                t = i/fps-offset
                frame = base.copy()
                x = int(640+340*np.sin(t*1.2))
                y = int(345+90*np.sin(t*2.2))
                cv2.circle(frame, (x, y), 18, (45, 60, 215), -1)
                cv2.circle(frame, (1280-x, 690-y), 18, (190, 100, 25), -1)
                cv2.circle(frame, (x+33, y+20), 5, (15, 15, 15), -1)
                image = frame[:, :crop] if side == 'left' else frame[:, shift:]
                if side == 'right':
                    image = (image*.88).astype(np.uint8)
                w.write_video(image, i)
                first = round((t+2)*48000)
                samples = np.tile(audio[first:first+800], (2, 1))
                w.write_audio_until(deque([(i/fps, samples)]), 0., (i+1)/fps)
        finally:
            w.close()
    (args.output/'truth.json').write_text(json.dumps({'synthetic': True, 'offset': .25, 'rate': 1.,
        'right_to_left': [[1,0,shift],[0,1,0],[0,0,1]], 'fps': fps}, indent=2)+'\n')
    print(f'Synthetic pair written to {args.output}')


if __name__ == '__main__':
    main()
