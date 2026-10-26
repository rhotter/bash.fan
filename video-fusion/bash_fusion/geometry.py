"""Fixed calibration: a planar homography baseline, NOT a parallax-free 3D stitcher."""
import json
from pathlib import Path

import cv2
import numpy as np


class CalibrationError(ValueError):
    pass


def corners(size):
    w, h = size
    return np.float32([[0, 0], [w, 0], [w, h], [0, h]])


def project(points, matrix):
    return cv2.perspectiveTransform(np.float32(points).reshape(-1, 1, 2), np.asarray(matrix, np.float64)).reshape(-1, 2)


def validate_homography(matrix, left_size, right_size):
    h = np.asarray(matrix, np.float64)
    if h.shape != (3, 3) or not np.isfinite(h).all() or abs(np.linalg.det(h)) < 1e-8:
        raise CalibrationError("Degenerate or non-finite calibration")
    # A horizon inside the source would create an unbounded panorama.
    c = corners(right_size)
    divisor = np.c_[c, np.ones(4)] @ h[2]
    if np.min(np.abs(divisor)) < 1e-6 or np.any(np.sign(divisor) != np.sign(divisor[0])):
        raise CalibrationError("Perspective horizon crosses the camera image")
    warped = project(c, h)
    if not cv2.isContourConvex(warped):
        raise CalibrationError("Folded camera projection")
    area = cv2.contourArea(warped)
    if not .2 <= area / np.prod(right_size) <= 5:
        raise CalibrationError("Excessive perspective distortion")
    points = np.vstack([corners(left_size), warped])
    lo, hi = np.floor(points.min(axis=0)), np.ceil(points.max(axis=0))
    size = hi - lo
    if np.any(size > 4 * np.maximum(left_size, right_size)) or np.prod(size) > 32_000_000:
        raise CalibrationError("Unreasonably large panorama")
    overlap, _ = cv2.intersectConvexConvex(corners(left_size), warped.astype(np.float32))
    if overlap < .05 * min(np.prod(left_size), area):
        raise CalibrationError("Cameras do not have enough overlap")
    return lo, size.astype(int)


def estimate(left, right, roi_left=None, roi_right=None):
    """Fit right -> left with SIFT/RANSAC and spatial-support checks."""
    detector = cv2.SIFT_create(nfeatures=6000)
    def features(frame, roi):
        mask = None
        if roi:
            mask = np.zeros(frame.shape[:2], np.uint8)
            x, y, w, h = roi
            if min(x, y) < 0 or min(w, h) <= 0 or x+w > frame.shape[1] or y+h > frame.shape[0]:
                raise CalibrationError("Calibration region is outside the image")
            mask[y:y+h, x:x+w] = 255
        return detector.detectAndCompute(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), mask)
    kl, dl = features(left, roi_left)
    kr, dr = features(right, roi_right)
    if dl is None or dr is None or min(len(dl), len(dr)) < 12:
        raise CalibrationError("Too few features; use an unobstructed calibration view")
    pairs = cv2.BFMatcher().knnMatch(dr, dl, k=2)
    matches = [p[0] for p in pairs if len(p) == 2 and p[0].distance < .7 * p[1].distance]
    if len(matches) < 15:
        raise CalibrationError("Not enough reliable overlapping features")
    src = np.float32([kr[m.queryIdx].pt for m in matches])
    dst = np.float32([kl[m.trainIdx].pt for m in matches])
    h, mask = cv2.findHomography(src, dst, cv2.RANSAC, 3.0, maxIters=5000, confidence=.999)
    if h is None:
        raise CalibrationError("Could not estimate geometry")
    good = mask.ravel().astype(bool)
    if good.sum() < 12 or good.mean() < .35:
        raise CalibrationError("Poor geometric agreement; cameras may not overlap")
    errors = np.linalg.norm(project(src[good], h) - dst[good], axis=1)
    for points, frame in [(src[good], right), (dst[good], left)]:
        if cv2.contourArea(cv2.convexHull(points)) < .015 * frame.shape[0] * frame.shape[1]:
            raise CalibrationError("Matches are concentrated in too small an area")
    if np.percentile(errors, 95) > 4:
        raise CalibrationError("High alignment residual")
    validate_homography(h, left.shape[1::-1], right.shape[1::-1])
    return h, {"matches": len(matches), "inliers": int(good.sum()),
               "median_error_px": float(np.median(errors)), "p95_error_px": float(np.percentile(errors, 95))}


class Stitcher:
    def __init__(self, calibration, output_width=1920):
        if calibration.get("version") != 1:
            raise CalibrationError("Unsupported calibration version")
        if not 64 <= output_width <= 7680:
            raise CalibrationError("Output width must be between 64 and 7680")
        self.calibration = calibration
        self.sizes = [tuple(calibration[k]) for k in ["left_size", "right_size"]]
        h = np.array(calibration["right_to_left"], np.float64)
        lo, full = validate_homography(h, *self.sizes)
        scale = min(1., output_width / full[0])
        self.size = tuple(int(v) for v in np.ceil(full * scale / 2) * 2)
        transform = np.array([[scale, 0, -lo[0]*scale], [0, scale, -lo[1]*scale], [0, 0, 1]])
        self.transforms = [transform, transform @ h]
        self.maps, self.masks = [], []
        yy, xx = np.indices(self.size[::-1], dtype=np.float32)
        dest = np.stack([xx, yy], axis=-1).reshape(-1, 2)
        for size, matrix in zip(self.sizes, self.transforms):
            uv = project(dest, np.linalg.inv(matrix)).reshape(*self.size[::-1], 2)
            self.maps.append(cv2.convertMaps(uv[..., 0], uv[..., 1], cv2.CV_16SC2))
            self.masks.append(cv2.warpPerspective(np.ones(size[::-1], np.uint8), matrix, self.size, flags=cv2.INTER_NEAREST).astype(bool))
        overlap = self.masks[0] & self.masks[1]
        if not overlap.any():
            raise CalibrationError("No overlap at output resolution")
        # Stable ownership with a narrow blend. No frame-by-frame homography wobble.
        # Prefer left image on the left of the panorama, regardless of input naming.
        centers = [project([np.array(s)/2], m)[0, 0] for s, m in zip(self.sizes, self.transforms)]
        self.left_first = centers[0] < centers[1]
        self.seam_x = float(np.median(np.where(overlap)[1]))
        feather = max(2., float(calibration.get("feather_px", 8)) * scale)
        weight = np.clip((self.seam_x + feather/2 - xx) / feather, 0, 1)
        if not self.left_first:
            weight = 1 - weight
        self.alpha = np.where(overlap, weight, self.masks[0].astype(float)).astype(np.float32)[..., None]
        self.alpha[~(self.masks[0] | self.masks[1])] = 0
        self.gain = np.asarray(calibration.get("right_gain", [1, 1, 1]), np.float32)
        if self.gain.shape != (3,) or not np.isfinite(self.gain).all() or np.any((self.gain < .5) | (self.gain > 2)):
            raise CalibrationError("Invalid exposure compensation")

    def warp(self, image, side):
        if image.shape[1::-1] != self.sizes[side]:
            raise CalibrationError("Input resolution changed; recalibration is required")
        return cv2.remap(image, *self.maps[side], cv2.INTER_LINEAR)

    def frame(self, left, right):
        a, b = self.warp(left, 0), self.warp(right, 1)
        b = np.clip(b.astype(np.float32) * self.gain, 0, 255)
        return np.clip(a * self.alpha + b * (1 - self.alpha), 0, 255).astype(np.uint8)

    def exposure(self, left, right):
        a, b = self.warp(left, 0), self.warp(right, 1)
        valid = self.masks[0] & self.masks[1] & (a.min(2) > 15) & (b.min(2) > 15) & (a.max(2) < 240) & (b.max(2) < 240)
        if valid.sum() < 100:
            return [1., 1., 1.]
        return np.clip(np.median(a[valid].astype(float) / b[valid], axis=0), .7, 1.4).tolist()


def save(path, calibration):
    Path(path).write_text(json.dumps(calibration, indent=2) + "\n")
