# Deer demo: evidence and an experiment for Spatial Replay

Reviewed 2026-09-23. This is a research proposal, not a claim that the proposed reconstruction has been implemented or matched the demo.

## What was actually inspected

Bilawal Sidhu's [September 22 X post](https://x.com/bilawalsidhu/status/2102391212544291072), including the browser video at approximately 0, 5, 10 and 17 seconds. The clip shows a source image plane and camera frustum, a partially reconstructed wooded clearing, and successive deer shapes retained along their path. The virtual viewpoint changes around the accumulated reconstruction. Dark empty regions and incomplete background geometry remain visible.

The creator describes geolocated video converted into Gaussians for each frame, placed at the corresponding position and time. That supports a spatial sequence of reconstructions with a history visualization. The repeated deer positions are intentionally retained history; they are not proof of a temporally consistent, fully reconstructed animal.

The inspected post does not disclose the model, processing speed, GPU, optimization budget, positional error, or reconstruction of hidden surfaces. Smooth playback is not evidence of live reconstruction. The exact deer pipeline could not be established from the public sources inspected. No model should be attributed to this clip without additional evidence.

His separate [IronSight write-up](https://www.spatialintelligence.ai/p/ironsight-turning-2d-videos-into) describes synchronization, masked camera solving, Gaussian training and held-out evidence. It explicitly describes an offline pipeline and a moving-object failure. That is useful background on his engineering practice, but it does not identify the deer method.

## A plausible implementation of the visible effect

1. Estimate each source camera pose and scene depth, or predict Gaussians directly. For a fixed webcam rig, calibrate lens parameters and camera-to-world transforms once, then hold them fixed.
2. Express every frame's reconstruction in the same coordinate system. Geographic coordinates are optional for our room; consistent local position, orientation and scale are essential.
3. Associate each reconstructed frame with its capture time. A timeline can display one time, play a sequence, or retain a selected range as a motion trail.
4. Render from a freely controlled virtual camera, independently of the source cameras and timeline.

This is an implementation inference. A full dynamic model with persistent point identities is a further capability, not implied by a trail display.

## Where the current prototype falls short

The single-camera viewer projects image color using estimated depth. The live multiview worker uses inferred geometry and untrained isotropic splats with a 40,000-point cap. It does not optimize live appearance. The saved multiview pipeline trains individual time samples, with temporal regularization disabled and no persistent motion tracks. Adding cameras cannot by itself remove these limitations.

Four cameras can improve observed coverage when they have useful overlap, correct calibration and matched times. Independently inferred splats must not simply be overlaid: inconsistent depth, scale and time can make extra views produce double surfaces and more blur.

## Proposed architecture

Maintain one persistent environment model plus time-varying subject reconstructions:

- **Environment:** accumulate reliable observations of walls, floor and furniture across time; exclude moving subjects from static fusion. Maintain confidence and source provenance.
- **Motion:** segment moving regions, align corresponding observations in time, and refine them jointly across available camera views. Add temporal constraints to suppress jumping geometry. Avoid averaging multiple poses into the room.
- **Rendering:** retain source image detail and native Gaussian orientation, scale and opacity. Cull unsupported points and use visibility-aware contributions from each camera. Allocate detail according to image error and coverage, not only a global point-count increase.
- **Time:** store source timestamps, reconstruction versions and data age. Provide Live, Replay and Motion trail as display choices over the same spatial coordinate system. A trail is an inspection mode, not the default live scene.
- **Latency:** show the newest completed reconstruction with its age. A responsive viewer can run faster than reconstruction updates. Interpolated motion must not be presented as newly observed geometry.

Unknown surfaces stay unknown in measurement mode. Generative completion can be a separate visualization with explicit provenance; a plausible hidden surface is not a verified reconstruction.

## First comparison to run

[Apple's SHARP](https://github.com/apple-aiml-research/ml-sharp) is a candidate for direct single-image Gaussian prediction. Its documented target is high-quality nearby novel views, with reported subsecond prediction on a GPU. It does not by itself provide calibrated multiview fusion, stable video, unrestricted room roaming or continuous live reconstruction. There is no evidence here that Sidhu used SHARP.

Use the same short, locally captured scene for three baselines: existing depth projection, existing multiview reconstruction, and SHARP-generated single-frame Gaussians. Measure GPU inference, transfer, rendering and end-to-end delay separately on this PC. Keep the model resident for throughput measurements and also report cold start.

First establish static room quality. Then add a slow moving person. For four-camera evaluation, reconstruct from three cameras and reserve the fourth as an unseen evaluation view, rotating which camera is held out. Calibrate the held-out camera separately without using its evaluation image for appearance training. Compare images at matched exposure times, report synchronization uncertainty, and separate background and moving-subject scores.

Report source-view fidelity, held-out PSNR/SSIM/LPIPS, subject silhouette overlap, valid coverage and holes, static landmark drift, temporal flicker, latency, update rate and VRAM. Include visual wipes and orbit views. Do not turn these measurements into a claim of "100% realism." A near-source image match alone does not establish free-roaming quality.

The next meaningful milestone is a repeatable comparison showing sharper geometry and appearance from a held-out viewpoint, with a stable room and a separately moving subject. Matching the deer trail visualization is achievable as a display feature; matching its visual quality and extending it to live multiview capture must be demonstrated by that experiment.
