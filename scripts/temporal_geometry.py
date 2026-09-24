"""Conservative fixed-rig depth anchors; moving surfaces are never frozen."""
import cv2
import numpy as np


def stationary_mask(image, reference, reference_depth, depth, confidence, stable_reference=None):
    appearance = np.max(np.abs(image.astype(np.float32)-reference.astype(np.float32)), axis=2) < 12
    valid = np.isfinite(depth) & np.isfinite(reference_depth) & (depth > 0) & (reference_depth > 0)
    agrees = np.abs(depth-reference_depth) <= .04*np.maximum(reference_depth, 1e-6)
    reliable = np.isfinite(confidence) & (confidence >= np.nanpercentile(confidence, 30))
    mask = appearance & valid & agrees & reliable
    if stable_reference is not None:
        mask &= stable_reference
    # Keep a margin around moving silhouettes and depth discontinuities.
    return cv2.erode(mask.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)


def depth_interior(depth, relative_jump=.04):
    valid = np.isfinite(depth) & (depth > 0)
    safe = np.where(valid, depth, 0).astype(np.float32)
    lo = cv2.erode(safe, np.ones((3, 3), np.uint8))
    hi = cv2.dilate(safe, np.ones((3, 3), np.uint8))
    return valid & (lo > 0) & ((hi-lo) <= relative_jump*np.maximum(safe, 1e-6))


def confirmed_surface(supported, contradicted):
    # A single reliable observation of free space vetoes the point. Hidden
    # and out-of-frame observations do not count as evidence of a surface.
    return (supported > 0) & (contradicted == 0)
