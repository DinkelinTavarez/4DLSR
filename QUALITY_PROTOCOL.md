# Spatial Replay quality protocol — version 1

The product target is an indistinguishable, freely navigable replay. A finite benchmark cannot prove 100% reality from all viewpoints. We track explicit acceptance gates and raw evidence, with no weighted realism score. An unmeasured gate never passes. The thresholds below are project R&D targets, not validated perceptual guarantees.

## What works now

The rig captures independent videos and browser timing observations. Single-view reconstruction predicts relative depth per frame and projects textured splats. It does not calibrate lens distortion, recover camera poses, triangulate correspondences, fuse observations into a shared scene, or reconstruct unseen surfaces. Therefore the current engine fails the combined-3D milestone regardless of camera count or Gaussian density. Two disconnected monocular depth surfaces cannot establish that the multi-view reconstruction theory works.

## Eight acceptance gates

| Gate | Required evidence | Current measurement |
|---|---|---|
| Playable original videos | Every camera saved with readable frame timestamps spanning positive duration | FFprobe on saved WebM files |
| Timing and continuity | Strictly increasing timestamps; ≥10 sec; ≥98% of requested FPS on every camera; maximum encoded gap ≤2 requested frame periods (1.1 ms tolerance for container quantization); ≥98% browser observations and ≥95% observed time span | Frame timestamps plus saved browser observations; recovered timing fails |
| Exposure alignment | Residual inter-camera exposure offset and drift ≤5 ms for the moving-scene experiment | Unverified. Start-button and cue-button times do not measure this |
| Calibration | Lens intrinsics/distortion and camera poses; ≤0.5 px reprojection RMS on independent target captures | Missing pipeline: fail |
| Shared geometry | Calibrated multi-view scene with surveyed dimension error and coverage measured throughout a declared viewing volume | Missing pipeline: fail; physical scale/coverage tolerances must be preregistered for that experiment |
| Held-out images | Independent viewpoint/time references; initial PSNR ≥40 dB, SSIM ≥0.99, LPIPS ≤0.02 at target display resolution | Unverified; never substitute the source image |
| Motion stability | Held-out moving video including turns, crossed limbs, occlusion/disocclusion, depth edges and difficult materials | Unverified; publish worst-view/time errors, holes and flicker; preregister temporal tolerances |
| Blind realism | Preregistered blinded real-vs-rendered evaluation, viewing conditions, sample sizes and confidence intervals | Unverified |

Capture observations measure browser delivery, not sensor exposure. A low observation count may mean an overloaded/background browser, rather than lost sensor frames; it still fails timing evidence. Encoded timestamps check cadence, not whether a camera duplicated an image. Resolution alone is not image quality. Simulated streams verify software behavior only.

## Two-camera baseline procedure

1. Fix both cameras at different positions with overlapping views of the same full-body movement area. Do not move them during the take. Keep focus/exposure stable if the device supports it. Start at 720p/30 to establish reliability, then repeat at 1080p/30.
2. Record 10–20 seconds. Show a common visible cue at both ends. Stand still, walk slowly, turn, and stop. Marking the cue records a note; it does not calculate alignment.
3. Stop and save. Review both files, then Assess take. Retain the original video and downloaded assessment JSON. Repeat the same movement/placement when comparing settings.
4. Prepare depth for each angle in the single-camera viewer. Run its source-view diagnostic. It samples up to eight prepared frames at 640×360; preserve worst-sample results. This is a renderer regression check, not proof of complete geometry or 4K quality.
5. The next implementation milestone is calibrated static multi-view reconstruction. Validate geometry before adding motion. With only two cameras, using both as inputs leaves no third simultaneous camera for held-out dynamic validation. For static scenes, acquire additional fixed validation positions separately; moving scenes need an independent synchronized view.

Additional cameras must see useful overlapping surfaces. Opposite-facing cameras with no common features cannot simply be stitched. More cameras, higher splat counts, or generative fill do not turn unobserved surfaces into measured ground truth.

## September 22, 2026 baseline

- Automated API and metric tests pass. An isolated six-stream browser test passed capture, saved playback/seeking, assessment, layout persistence, removing a live slot and reducing to a two-stream take. Synthetic capture received 1/8 gates, with **SOFTWARE TEST ONLY** verdict. No physical reconstruction claim follows from that result.
- Actual browser device enumeration exposed one C920; an attempted camera open returned `Could not start video source`. The user-facing in-app rig also exposed one device. A two-physical-camera take is **not verified**.
- Existing take `b9ac9e57-6694-4c0b-b39e-e1a6462bc211`: eight HQ-depth source-view samples at 640×360 / 82,944 splats. Worst PSNR **33.5233 dB**, worst block SSIM **0.978808**, worst MAE **1.17187/255**. The provisional source-fidelity gate **fails**. Geometry remains unverified. Sample times: 0, 2.8, 5.6, 8.4, 11.12, 13.92, 16.72, 19.52 seconds. This benchmark reuses source RGB and must never be represented as held-out novel-view quality.
