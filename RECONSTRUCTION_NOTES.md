# Recording quality diagnosis — September 19, 2026

The front-view image loss was substantially caused by the renderer. Wide-angle distortion has a deeper cause: this prototype estimates a visible depth surface from one camera, rather than reconstructing a complete moving body or room from multiple views.

## Evidence from the screenshots

- [Original front splats](artifacts/angle-01.jpg): lost hair, face, flag and equipment detail even near the capture viewpoint.
- [Original orbit view](artifacts/angle-02.jpg): stretched sheets, gaps and disconnected surfaces after leaving the source view.
- [Original recorded video](artifacts/angle-03-original-video.jpg): substantially sharper source image. The frame crops most of the body; it contains no observation of the back or legs.
- [Controlled before/after comparison](artifacts/fidelity-comparison.jpg): identical recorded video frame and preview depth map for both renderers, plus the updated renderer at 45 degrees. This deliberately isolates renderer changes from depth-model changes.

The initial renderer represented a 1280×720 recording with 36,864 single-color Gaussian samples. It discarded color detail within each footprint. It also used sparse depth updates, a linear conversion of inverse depth to distance, and permissive projected footprint sizes. These defects amplified blur, moving-frame mismatches and stretching. Fixing them does not provide observations of occluded surfaces.

## Changes installed

- 82,944 Gaussian samples, with the original video sampled across each Gaussian footprint.
- Reciprocal conversion from relative inverse depth to relative distance; bounded slopes and screen footprints, near-plane rejection and depth-edge rejection.
- A foreground-informed orbit pivot and a warning when the view leaves the useful source coverage.
- Depth playback aligned to decoded video timestamps. Cached depth loads before triggering unnecessary new inference on a seek.
- Higher-detail offline inference (518 model input instead of 294), with relative scale alignment on visually stationary pixels.
- Every-video-frame, 6 FPS high-detail, and 2 FPS preview preparation profiles. Cancel preserves completed work and rerunning resumes missing timestamps.
- Independent `depth-hq` storage. Original video and preview maps remain intact.

## Measurements and limits

At recording time 19.53 seconds, using identical preview depth at 19.520 seconds and a fixed 640×360 comparison buffer:

| Metric | Previous renderer | Updated renderer |
|---|---:|---:|
| Mean absolute RGB error, 0–255 scale | 6.9033 | 1.4308 |
| PSNR | 24.74 dB | 36.36 dB |

Mean absolute pixel error fell **79.27% on this one frame**. This measures source-view image fidelity, not anatomical accuracy, complete geometry, or novel-view correctness. The comparison intentionally shows unresolved gaps at 45 degrees. See `artifacts/fidelity-metrics.json` for exact values.

All **294 actual video frames** of the approximately 19.6-second, 1280×720, nominal 15 FPS recording were prepared at 640×360 depth resolution. Every FFprobe frame timestamp has a matching HQ map, from 0 through 19.520 seconds. The prepared maps occupy 135,477,552 bytes (about 129 MiB). One additional on-demand HQ map was generated during initial playback verification; the UI therefore reports 295 cached HQ maps. A subsequent fix makes playback wait for existing cached maps instead of recomputing them during seeks.

The updated browser showed approximately 103–105 render FPS during replay on this computer. This is the display/render rate; the source video still contains about 15 captured frames per second. Performance is specific to this clip and machine. Offline processing and playback are separate costs.

SHA-256 checks verified that both original video files and all 46 original preview depth files were unchanged when the HQ cache was installed. The production recording is still in its Desktop folder. No recording frames were sent to a remote inference service. API tests and the production build pass.

## Would a second or third camera help?

Yes, provided the footage is synchronized, the cameras are calibrated, and reconstruction combines the views in one coordinate system. Merely connecting another camera to the current single-camera selector will not fuse its footage.

| Setup | Practical expectation |
|---|---|
| One fixed RGB camera | Sharper front view and modest parallax; occluded sides/back remain unknown. |
| Two overlapping cameras | Stereo constraints and better geometry where both see the subject; wider useful viewpoints, but substantial unseen areas remain. |
| Three cameras distributed around the subject | A useful first experiment for broader body coverage; still incomplete at self-occlusions, between sparse views, and outside the cameras' full-body framing. |
| Additional well-placed views | Better coverage and redundancy; camera count alone does not guarantee a clean reconstruction. |

For an initial three-camera experiment, keep cameras fixed around the performance area, with overlapping coverage and the entire head-to-feet movement range visible. The existing camera could stay where it is if it sees that full region. Views of only the same front side will not measure the back. Framing, synchronization, lighting, exposure consistency and calibration matter as much as the count. Cameras on one USB hub also need a bandwidth check before choosing resolution and FPS.

Moving one camera to a different position later does not give the simultaneous views needed to reconstruct a person in motion. It can help scan a static room separately. Longer computation improves inference and optimization; it cannot turn an unobserved back into measured evidence. A generative model can guess missing surfaces, which is a different fidelity tradeoff.

## Architecture needed for moving full-body walk-around replay

1. Simultaneous multi-camera capture with measured timing offsets and drift checks.
2. Lens and camera-position calibration; a shared coordinate system with a known scale reference.
3. A static background reconstruction, separated from the moving person.
4. Person segmentation and multi-view geometry with visibility/occlusion handling for each synchronized instant.
5. Offline optimization of persistent dynamic Gaussians or another dynamic scene representation, with temporal consistency and multi-view appearance.
6. A renderer that loads that completed representation for pause, scrub, orbit and movement through space.

This is a separate reconstruction pipeline, beyond the improvements installed today. Begin with a short synchronized clip to measure quality and processing cost before committing to long recordings or additional hardware. Slow reconstruction can still produce fast interactive playback once processing finishes.

## Primary references

- [Dynamic 3D Gaussians](https://dynamic3dgaussians.github.io/) optimizes moving/rotating Gaussians with temporal constraints for dynamic novel-view synthesis. Its results establish the method category, not a promise that three webcams reproduce the published quality.
- [4K4D](https://zju3dv.github.io/4k4d/) learns a dynamic representation from multi-view RGB videos and demonstrates fast rendering after optimization. Its showcased capture datasets use many views; reported GPU speeds are not estimates for this computer.
- [OpenCV calibration](https://docs.opencv.org/4.13.0/d9/d0c/group__calib3d.html) documents camera calibration and multi-view geometry tools needed for a shared reconstruction.
- [World Labs Atlas](https://www.worldlabs.ai/blog/atlas) demonstrates reframing from three to five ordinary camera views and can generate unseen regions. It remains described as early access with selected partners. This app does not have an Atlas integration or its generative reconstruction model.
