"""Explicit per-session point selection; zero preserves all valid geometry."""
import numpy as np


def apply_splat_budget(points, colors, radii, maximum=0):
    if maximum is None:
        maximum = 0
    if isinstance(maximum, bool) or not isinstance(maximum, int) or maximum < 0:
        raise ValueError('Splat budget must be a nonnegative whole number')
    if len(points) != len(colors) or len(points) != len(radii):
        raise ValueError('Geometry attributes have different lengths')
    if not maximum or len(points) <= maximum:
        return points, colors, radii
    # Evenly sample the complete ordered cloud rather than taking its first
    # camera/layer. Keep positions and appearance attributes aligned.
    indices = (np.arange(maximum, dtype=np.int64) * len(points)) // maximum
    return points[indices], colors[indices], radii[indices]
