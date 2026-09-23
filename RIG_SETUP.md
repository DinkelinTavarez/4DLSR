# Camera positioning before capture

Open **Rig setup** in the lab. This is an estimated layout diagnostic, not a
surveyed camera calibration or a reconstruction constraint.

1. In **Live capture**, connect 2–8 different cameras. Every assigned camera must
   have an advancing preview. Unassign cameras you intentionally want to omit.
2. Fix the cameras in place. Neighboring views need common, textured objects;
   cameras looking into entirely separate rooms cannot establish reliable
   shared geometry. Hold the scene still for this setup snapshot.
3. Click **Locate cameras**. The local VGGT worker estimates camera extrinsics,
   intrinsics and depth. A fresh worker estimates poses each time. No recording
   is started, and the GPU is released after the estimate or an error.
4. Inspect camera numbers, source image planes, viewing arrows and inferred
   scene points. The colored source cards identify which view belongs to each
   pose. Inspect-camera buttons hide image planes to expose inferred geometry.
5. Optionally measure a straight-line lens-center distance between any two
   cameras. Enter meters and apply it. This sets one global scale, including
   height differences; it does not repair bad poses or lens distortion.
6. For approximate floor heights, first apply scale, then confirm that the first
   camera is horizontally aimed and has no roll. Enter its measured lens height.
   The floor grid is based on those manual inputs, not detected gravity.
7. Export a layout report for the experiment. JSON includes inferred poses,
   source settings, depth-agreement counts, measurements and limitations; it
   excludes images. Snapshot images and point geometry remain in memory.
8. After moving a camera, click **I moved a camera**, then locate again. Connection
   changes, image-size changes and lost feeds automatically mark a result stale.
   Physical movement without a connection change is **not detected**.

## What the numbers mean

- Coordinates originate at the first selected camera. “Right”, “Up” and “Forward”
  follow that camera's axes; “Up” is not floor height unless a floor reference
  has been entered. Extrinsics are world-to-camera; centers are `-Rᵀt`.
- Without a measurement, the farthest camera from the reference is one relative
  unit away. A measured baseline uniformly scales cameras and scene points.
- Depth agreement counts retained inferred points supported by another inferred
  depth map. It is **not** a pose-confidence probability, coverage, or realism
  score. Overlapping viewing cones do not establish unoccluded scene coverage.
- Browser snapshot capture time is not camera exposure synchronization. USB
  cameras may expose or buffer frames at different times.
- Recorded builds still estimate their own geometry. This report is not yet
  consumed as a fixed-pose or measured-scale constraint by reconstruction.

## Independent accuracy check

Use one baseline to set scale; measure several other camera-to-camera distances
without entering them into the estimator. Compare the exported centers against
those held-out measurements and record absolute and relative errors. Repeat the
estimate with the fixed rig to assess repeatability. Reject visibly wrong layouts;
an attractive point cloud is not evidence of accurate camera placement.

For stronger calibration, a future stage should calibrate each lens and use a
known-size checkerboard or ChArUco target across connected overlapping views,
then report reprojection error and independent physical measurement error.

## USB setup

On this check, Windows and the app catalog both reported no cameras. The operator
confirmed that the hub draws power only from the PC. Insufficient power, shared
bandwidth, cable signal quality or a hub fault are hypotheses, not a proven cause.

Later in the same check, the camera catalog fluctuated between two and three
devices. Duplicate lab tabs were consolidated. At the last UI check, two capture
connections had opened but the third failed with `NotReadableError`, including
at the 640 × 480 / 15 FPS compatibility setting. Four physical previews and their
estimated positions were not verified. The compatibility setting was left selected
for connection troubleshooting; raise it after the feeds are stable.

First test one camera directly on a PC port with no extension or hub. Add one
camera/extension at a time. A powered hub can improve the power budget; it cannot
increase its upstream bandwidth. Separate PC ports can still share a controller.
Start at the Compatibility profile when isolating connection failures, then
increase capture quality only after all previews advance reliably.

Sources: [VGGT](https://github.com/facebookresearch/vggt),
[OpenCV camera calibration](https://docs.opencv.org/4.x/dc/dbb/tutorial_py_calibration.html),
[Microsoft USB bandwidth allocation](https://learn.microsoft.com/en-us/windows-hardware/drivers/usbcon/usb-bandwidth-allocation).
