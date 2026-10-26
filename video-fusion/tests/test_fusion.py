import json
from pathlib import Path
import subprocess

import av
import cv2
import numpy as np
import pytest

from bash_fusion.geometry import CalibrationError, Stitcher, estimate, project, validate_homography
from bash_fusion.media import Reader, TimelineError, Writer, render
from bash_fusion.sync import Sync, audio_offset, fit_drift


def scene():
    rng = np.random.default_rng(42)
    image = rng.integers(30, 160, (240, 500, 3), dtype=np.uint8)
    image = cv2.GaussianBlur(image, (5, 5), 0)
    for i in range(70):
        x, y = rng.integers([5, 5], [495, 235])
        cv2.circle(image, (int(x), int(y)), int(rng.integers(2, 9)), tuple(int(x) for x in rng.integers(0, 255, 3)), -1)
    cv2.line(image, (250, 0), (250, 240), (240, 240, 240), 3)
    return image


def calibration():
    return {"version": 1, "left_size": [320, 240], "right_size": [320, 240],
            "right_to_left": [[1, 0, 180], [0, 1, 0], [0, 0, 1]], "sync": Sync().to_dict()}


def video(path, right=False, offset=0., fps=30, seconds=2, gap=False, audio=False):
    base = scene()
    w = Writer(path, (320, 240), fps, audio)
    from collections import deque
    try:
        for i in range(int(fps * seconds)):
            t = i / fps - offset
            image = base.copy()
            cv2.circle(image, (int(240 + 60*np.sin(3*t)), 120), 8, (0, 0, 255), -1)
            crop = image[:, 180:] if right else image[:, :320]
            w.write_video(crop, i + (fps if gap and i >= fps else 0))
            if audio:
                n = np.arange(round(i*48000/fps), round((i+1)*48000/fps))
                samples = np.tile((.1*np.sin(2*np.pi*440*n/48000)).astype(np.float32), (2, 1))
                w.write_audio_until(deque([(i/fps, samples)]), 0., (i+1)/fps)
    finally:
        w.close()


@pytest.mark.parametrize('delay', [-.32, .27])
def test_audio_offset_sign(delay):
    rng = np.random.default_rng(7)
    whole = rng.normal(size=8000*9)
    origin = 8000
    left = whole[origin:origin+8000*6]
    right_origin = origin - round(delay*8000)
    right = whole[right_origin:right_origin+8000*6]
    assert audio_offset(left, right, max_offset=1)['offset'] == pytest.approx(delay, abs=1/8000)


def test_ambiguous_audio_rejected():
    with pytest.raises(ValueError):
        audio_offset(np.zeros(16000), np.zeros(16000))
    tone = np.sin(2*np.pi*440*np.arange(8000*5)/8000)
    with pytest.raises(ValueError, match='Ambiguous'):
        audio_offset(tone, tone, max_offset=1)


def test_drift_with_outlier():
    points = [(t, .3 + .00012*t) for t in [0, 600, 1200, 1800, 2400]] + [(3000, 4)]
    sync, inliers = fit_drift(points)
    assert sync.offset == pytest.approx(.3)
    assert sync.rate == pytest.approx(1.00012)
    assert inliers == 5
    assert sync.right_time(1000) == pytest.approx(1000.42)


def test_geometry_recovers_known_overlap():
    im = scene()
    h, q = estimate(im[:, :320], im[:, 180:])
    assert q['inliers'] > 20
    np.testing.assert_allclose(project([[50, 80], [100, 160]], h), [[230, 80], [280, 160]], atol=.4)


def test_blank_and_invalid_geometry_rejected():
    im = np.zeros((240, 320, 3), np.uint8)
    with pytest.raises(CalibrationError):
        estimate(im, im)
    for h in [[[1, 0, 100000], [0, 1, 0], [0, 0, 1]], [[1, 0, 0], [0, 1, 0], [.01, 0, -1]], np.zeros((3, 3))]:
        with pytest.raises(CalibrationError):
            validate_homography(h, (320, 240), (320, 240))


def test_stitch_has_no_dark_border_and_preserves_black_pixels():
    im = scene()
    im[100:140, 220:280] = 0
    s = Stitcher(calibration(), 500)
    np.testing.assert_allclose(s.frame(im[:, :320], im[:, 180:]), im, atol=1)
    with pytest.raises(CalibrationError, match='resolution'):
        s.frame(im[:, :300], im[:, 180:])


def test_actual_render_60fps_with_audio(tmp_path):
    left, right, out = [tmp_path / name for name in ['left.mp4', 'right.mp4', 'fused.mp4']]
    video(left, fps=60, audio=True)
    video(right, right=True, fps=60)
    report = render(left, right, out, Stitcher(calibration(), 500), Sync(), fps=60, duration=1)
    assert report['frames'] == 60
    with av.open(str(out)) as c:
        assert c.streams.video[0].average_rate == 60
        assert c.streams.video[0].width == 500
        assert len(list(c.decode(video=0))) == 60
    with av.open(str(out)) as c:
        frames = list(c.decode(audio=0))
        assert frames
        assert .95 < sum(f.samples for f in frames)/48000 < 1.1
    with pytest.raises(ValueError, match='exists'):
        render(left, right, out, Stitcher(calibration(), 500), Sync(), duration=1)


def test_sync_offset_with_actual_video_pts(tmp_path):
    left, right = tmp_path/'left.mp4', tmp_path/'right.mp4'
    video(left)
    video(right, right=True, offset=.3)
    report = render(left, right, tmp_path/'out.mp4', Stitcher(calibration(), 500), Sync(.3), duration=1)
    assert report['frames'] == 60
    assert report['max_frame_skew_seconds'] < .034


def test_pts_gap_rejected(tmp_path):
    left = tmp_path/'gap.mp4'
    video(left, gap=True)
    reader = Reader(left)
    try:
        reader.at(.5)
        with pytest.raises(TimelineError, match='gap'):
            reader.at(1.5)
    finally:
        reader.close()


def test_short_input_stops_without_repeating_stale_frame(tmp_path):
    left, right = tmp_path/'left.mp4', tmp_path/'right.mp4'
    video(left, seconds=2)
    video(right, right=True, seconds=.5)
    report = render(left, right, tmp_path/'out.mp4', Stitcher(calibration(), 500), Sync(), duration=2)
    assert .45 <= report['duration'] < .55


def test_report_is_json_serializable(tmp_path):
    left, right = tmp_path/'left.mp4', tmp_path/'right.mp4'
    video(left, seconds=.5)
    video(right, right=True, seconds=.5)
    report = render(left, right, tmp_path/'out.mp4', Stitcher(calibration(), 500), Sync(), duration=.25)
    assert json.loads(json.dumps(report))['output_size'] == [500, 240]


def test_late_start_discards_old_audio(tmp_path):
    path = tmp_path/'audio.mp4'
    video(path, seconds=24, fps=30, audio=True)
    reader = Reader(path, audio=True)
    try:
        _, t = reader.at(23)
        assert t == pytest.approx(23)
        assert reader.audio
        assert len(reader.audio) < 20
    finally:
        reader.close()


def test_still_cli_creates_geometry_preview(tmp_path):
    image = scene()
    a, b, output = tmp_path/'a.png', tmp_path/'b.png', tmp_path/'wide.png'
    cv2.imwrite(str(a), image[:, :320])
    cv2.imwrite(str(b), image[:, 180:])
    import sys
    result = subprocess.run([sys.executable, '-m', 'bash_fusion.cli', 'stitch-image',
        '--left', str(a), '--right', str(b), '--output', str(output)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)['preview_only'] is True
    assert cv2.imread(str(output)).shape[1] >= 500


def test_roi_must_be_inside_frame():
    image = scene()
    with pytest.raises(CalibrationError, match='region'):
        estimate(image[:, :320], image[:, 180:], [-1, 0, 100, 100])


def test_audio_timeout_does_not_leak_source_url(monkeypatch):
    from bash_fusion.sync import read_audio
    def timeout(cmd, **kwargs):
        raise subprocess.TimeoutExpired(cmd, 90)
    monkeypatch.setattr(subprocess, 'run', timeout)
    with pytest.raises(ValueError, match='Audio extraction timed out') as result:
        read_audio('https://example.test/private-token/video.mp4')
    assert 'private-token' not in str(result.value)
