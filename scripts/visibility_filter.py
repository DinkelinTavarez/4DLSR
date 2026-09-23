import numpy as np


def cross_view_visibility(z, expected, inside, reliable, tolerance=.1):
    """Only contradictions in observed free space are rejected.

    A point behind the other camera's nearest surface is occluded, not disproven.
    Neither occlusion nor an unreliable/out-of-frame view counts as confirmation.
    """
    reliable=reliable&np.isfinite(expected)&(expected>0)
    comparable=inside&reliable&np.isfinite(z)&(z>.01)
    consistent=comparable&(np.abs(z-expected)<=tolerance*expected)
    occluded=comparable&(z>expected*(1+tolerance))
    return (~comparable)|consistent|occluded,consistent,occluded
