"""Right media time = offset + rate * left media time (seconds).

A positive offset means the matching event occurs later in the right FILE.
This differs from the website's wall-clock offset convention.
"""
from dataclasses import asdict, dataclass
import math
import subprocess

import numpy as np
from scipy import signal


@dataclass(frozen=True)
class Sync:
    offset: float = 0.0
    rate: float = 1.0

    def __post_init__(self):
        if not math.isfinite(self.offset) or not math.isfinite(self.rate) or not 0.99 <= self.rate <= 1.01:
            raise ValueError("Invalid sync: rate must be within 1% of real time")

    def right_time(self, left_time):
        return self.offset + self.rate * left_time

    def to_dict(self):
        return asdict(self)


def read_audio(path, start=0.0, duration=30.0, sample_rate=8000):
    if not math.isfinite(start) or start < 0 or not math.isfinite(duration) or not 1 <= duration <= 120:
        raise ValueError("Audio windows must start at a nonnegative time and last 1–120 seconds")
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-ss", str(start), "-i", str(path),
           "-t", str(duration), "-vn", "-ac", "1", "-ar", str(sample_rate), "-f", "f32le", "pipe:1"]
    try:
        p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90)
    except subprocess.TimeoutExpired:
        # TimeoutExpired includes the command, which may contain private source URLs.
        raise ValueError("Audio extraction timed out") from None
    if p.returncode or not p.stdout:
        raise ValueError("No usable audio; supply a measured offset or aligned timestamps")
    return np.frombuffer(p.stdout, dtype="<f4").copy()


def audio_offset(left, right, sample_rate=8000, max_offset=5.0):
    """Normalized correlation with a bounded lag; reject silence and ambiguous peaks."""
    if not math.isfinite(max_offset) or max_offset <= 0:
        raise ValueError("Maximum offset must be positive")
    left, right = np.array(left, np.float64, copy=True), np.array(right, np.float64, copy=True)
    if not np.isfinite(left).all() or not np.isfinite(right).all():
        raise ValueError("Audio samples must be finite")
    if min(len(left), len(right)) < sample_rate:
        raise ValueError("At least one second of audio is required")
    left -= left.mean()
    right -= right.mean()
    # Whiten low-frequency arena noise without inventing timing evidence.
    sos = signal.butter(3, [150, min(3000, sample_rate * .45)], btype="bandpass", fs=sample_rate, output="sos")
    left, right = signal.sosfilt(sos, left), signal.sosfilt(sos, right)
    if min(np.std(left), np.std(right)) < 1e-5:
        raise ValueError("Audio is silent or too weak to synchronize")
    corr = signal.correlate(right, left, mode="full", method="fft")
    lags = signal.correlation_lags(len(right), len(left))
    n = len(left)
    valid = np.abs(lags) <= int(max_offset * sample_rate)
    lags, corr = lags[valid], corr[valid]
    # Compare only the overlapping samples at each lag.
    r0, l0 = np.maximum(lags, 0), np.maximum(-lags, 0)
    count = np.minimum(len(right) - r0, n - l0)
    le = np.r_[0.0, np.cumsum(left * left)]
    re = np.r_[0.0, np.cumsum(right * right)]
    energy = np.sqrt((le[l0 + count] - le[l0]) * (re[r0 + count] - re[r0]))
    scores = np.where(count >= sample_rate, np.abs(corr) / np.maximum(energy, 1e-12), 0)
    peak = int(np.argmax(scores))
    rivals = scores[np.abs(lags - lags[peak]) > int(.05 * sample_rate)]
    second = float(rivals.max()) if len(rivals) else 0
    confidence = float(scores[peak])
    ratio = confidence / max(second, 1e-8)
    if confidence < .25 or ratio < 1.25 or abs(lags[peak]) >= max_offset * sample_rate - 2:
        raise ValueError(f"Ambiguous audio alignment (correlation={confidence:.3f}, peak ratio={ratio:.2f})")
    return {"offset": float(lags[peak] / sample_rate), "correlation": confidence, "peak_ratio": ratio}


def fit_drift(observations, max_residual=.025):
    """Robust linear fit to (left window time, measured right-minus-left lag)."""
    a = np.asarray(observations, dtype=float)
    if a.ndim != 2 or a.shape[1] != 2 or len(a) < 3 or not np.isfinite(a).all() or np.ptp(a[:, 0]) < 10:
        raise ValueError("Need three separated, finite sync observations spanning at least ten seconds")
    slope, intercept, _, _ = signal_theil(a[:, 0], a[:, 1])
    residual = np.abs(a[:, 1] - intercept - slope * a[:, 0])
    good = residual <= max_residual
    if good.sum() < 3 or good.mean() < .6:
        raise ValueError("Inconsistent audio offsets; do not apply one drift fit across a discontinuity")
    slope, intercept = np.polyfit(a[good, 0], a[good, 1], 1)
    if np.max(np.abs(a[good, 1] - intercept - slope * a[good, 0])) > max_residual:
        raise ValueError("Sync residual exceeds tolerance")
    return Sync(float(intercept), float(1 + slope)), int(good.sum())


def signal_theil(x, y):
    from scipy.stats import theilslopes
    return theilslopes(y, x)
