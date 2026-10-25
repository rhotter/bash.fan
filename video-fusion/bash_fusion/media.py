"""PTS-aware bounded decoding and H.264/AAC output for files or FFmpeg-supported URLs."""
from collections import deque
from fractions import Fraction
import math
from pathlib import Path
import time

import av
import numpy as np


class TimelineError(ValueError):
    pass


class Reader:
    def __init__(self, path, audio=False):
        # Timeout stops stalled network inputs rather than silently repeating old play.
        self.container = av.open(str(path), timeout=(10., 10.))
        self.video = self.container.streams.video[0]
        streams = [self.video]
        self.has_audio = audio and bool(self.container.streams.audio)
        if self.has_audio:
            streams.append(self.container.streams.audio[0])
        self.frames = self.container.decode(*streams)
        self.origin = float(self.video.start_time * self.video.time_base) if self.video.start_time is not None else None
        self.audio = deque()
        self.resampler = av.AudioResampler(format="fltp", layout="stereo", rate=48000) if self.has_audio else None
        self.before = self.after = None
        self.eof = False
        self.last_time = None
        self.rate = float(self.video.average_rate or 30)
        self.tolerance = max(.025, 1.1 / self.rate)
        self._next_video()

    def _next_video(self, discard_audio_before=None):
        self.before = self.after
        self.after = None
        for frame in self.frames:
            if frame.pts is None:
                raise TimelineError("Input frame has no presentation timestamp")
            if self.origin is None:
                if isinstance(frame, av.AudioFrame):
                    continue  # Cannot anchor leading audio without a video timestamp.
                self.origin = float(frame.pts * frame.time_base)
            t = float(frame.pts * frame.time_base) - self.origin
            if isinstance(frame, av.AudioFrame):
                frame.pts = round(t / float(frame.time_base))
                for out in self.resampler.resample(frame):
                    self.audio.append((float(out.pts * out.time_base), out.to_ndarray()))
                if discard_audio_before is not None:
                    while self.audio and self.audio[0][0] + self.audio[0][1].shape[1] / 48000 < discard_audio_before:
                        self.audio.popleft()
                if len(self.audio) > 1000:
                    raise TimelineError("Audio/video drift exceeded the bounded buffer")
                continue
            if self.last_time is not None and t <= self.last_time:
                raise TimelineError("Camera timestamps reset or ran backwards; restart and resynchronize")
            self.last_time = t
            self.after = (t, frame)
            return
        self.eof = True

    def at(self, t):
        while self.after is not None and self.after[0] < t:
            self._next_video(discard_audio_before=t - .1)
        choices = [v for v in [self.before, self.after] if v is not None]
        if not choices:
            raise EOFError
        nearest = min(choices, key=lambda v: abs(v[0] - t))
        if abs(nearest[0] - t) > self.tolerance:
            if self.eof and t > nearest[0]:
                raise EOFError
            raise TimelineError("Camera gap or excessive timestamp mismatch; refusing stale frames")
        return nearest[1].to_ndarray(format="bgr24"), nearest[0]

    def close(self):
        self.container.close()


def snapshot(path, t):
    with av.open(str(path)) as c:
        stream = c.streams.video[0]
        origin = float(stream.start_time * stream.time_base) if stream.start_time is not None else 0.
        c.seek(max(0, int((origin + t) / float(stream.time_base))), stream=stream, backward=True)
        for f in c.decode(stream):
            if float(f.pts * f.time_base) - origin >= t:
                return f.to_ndarray(format="bgr24")
    raise ValueError("Calibration time is beyond the video")


class Writer:
    def __init__(self, path, size, fps, audio, bitrate=9_000_000):
        self.fps = fps
        self.network = str(path).startswith(("rtmp://", "rtmps://", "srt://", "udp://"))
        fmt = "flv" if str(path).startswith(("rtmp://", "rtmps://")) else "mpegts" if self.network else "mp4"
        if not self.network and Path(path).exists():
            raise ValueError("Output already exists; choose a new filename")
        self.container = av.open(str(path), "w", format=fmt, options={"rw_timeout": "10000000"} if self.network else {"movflags": "+faststart"})
        self.video = self.container.add_stream("libx264", rate=fps)
        self.video.width, self.video.height = size
        self.video.pix_fmt = "yuv420p"
        self.video.bit_rate = bitrate
        self.video.options = {"preset": "veryfast", "tune": "zerolatency", "bf": "0", "g": str(2 * fps)}
        self.video.time_base = Fraction(1, fps)
        self.audio = self.container.add_stream("aac", rate=48000) if audio else None
        if self.audio:
            self.audio.layout = "stereo"
            self.audio.bit_rate = 128000
        self.audio_written = 0

    def write_video(self, image, index):
        f = av.VideoFrame.from_ndarray(image, format="bgr24")
        f.pts, f.time_base = index, Fraction(1, self.fps)
        for packet in self.video.encode(f):
            self.container.mux(packet)

    def write_audio_until(self, pending, start, end):
        if not self.audio:
            return
        end_sample = max(0, round((end - start) * 48000))
        while pending:
            t, samples = pending[0]
            first = round((t - start) * 48000)
            lo = max(0, self.audio_written - first, -first)
            hi = min(samples.shape[1], end_sample - first)
            if hi <= lo:
                if first + samples.shape[1] <= self.audio_written:
                    pending.popleft()
                    continue
                break
            pts = first + lo
            if pts > self.audio_written + 2400:
                raise TimelineError("Gap in the master audio track")
            out = av.AudioFrame.from_ndarray(np.ascontiguousarray(samples[:, lo:hi]), format="fltp", layout="stereo")
            out.sample_rate = 48000
            out.pts, out.time_base = pts, Fraction(1, 48000)
            for packet in self.audio.encode(out):
                self.container.mux(packet)
            self.audio_written = first + hi
            if hi == samples.shape[1]:
                pending.popleft()
            else:
                break

    def close(self):
        try:
            for stream in [self.video, self.audio]:
                if stream:
                    for packet in stream.encode(None):
                        self.container.mux(packet)
        finally:
            self.container.close()


def render(left_path, right_path, output, stitcher, sync, fps=60, start=0., duration=None, realtime=False, audio=True):
    if fps not in [24, 25, 30, 50, 60] or not math.isfinite(start) or start < 0:
        raise ValueError("Invalid output frame rate or start time")
    if duration is not None and (not math.isfinite(duration) or duration <= 0):
        raise ValueError("Duration must be positive")
    start = max(start, -sync.offset / sync.rate)
    left = right = writer = None
    count = 0
    begin = time.monotonic()
    errors = []
    try:
        left, right = Reader(left_path, audio=audio), Reader(right_path)
        # Skip the time before either camera starts without fabricating coverage.
        start = max(start, left.after[0], (right.after[0] - sync.offset) / sync.rate)
        writer = Writer(output, stitcher.size, fps, left.has_audio)
        realtime = realtime or writer.network
        begin = time.monotonic()
        max_error = 0.
        while duration is None or count < math.floor(duration * fps):
            t = start + count / fps
            try:
                a, ta = left.at(t)
                b, tb = right.at(sync.right_time(t))
            except EOFError:
                break
            mismatch = abs(ta - (tb - sync.offset) / sync.rate)
            if mismatch > max(left.tolerance, right.tolerance / sync.rate):
                raise TimelineError("The two selected frames exceed synchronization tolerance")
            max_error = max(max_error, mismatch)
            frame = stitcher.frame(a, b)
            if realtime:
                delay = count / fps - (time.monotonic() - begin)
                if writer.network and delay < -2:
                    raise TimelineError("Processor is over two seconds behind real time; reduce resolution or use faster hardware")
                if delay > 0:
                    time.sleep(delay)
            writer.write_video(frame, count)
            writer.write_audio_until(left.audio, start, t + 1 / fps)
            count += 1
        if count == 0:
            raise TimelineError("No overlapping footage")
        return {"frames": count, "fps": fps, "duration": count/fps, "start_left_seconds": start,
                "max_frame_skew_seconds": max_error, "processing_fps": count / max(.001, time.monotonic()-begin),
                "audio": left.has_audio, "output_size": stitcher.size,
                "source_fps": [left.rate, right.rate], "sync": sync.to_dict()}
    finally:
        for resource in [writer, left, right]:
            if resource:
                try:
                    resource.close()
                except Exception as e:
                    errors.append(e)
        if errors:
            raise RuntimeError("Could not finalize the fusion output") from errors[0]
