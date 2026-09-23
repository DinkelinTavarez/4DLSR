# Experiment library

Each **Stop & save** finalizes the original camera videos and archives a separate
experiment under `C:\Users\Dean\Desktop\Spatial Replay Recordings\Experiments\<take-id>`.
An archive error does not discard a successfully saved recording. The app reports
the error and offers **Refresh / repair archive**, which is safe to repeat.

```text
<take-id>/
  experiment.json                 library index, build versions and scores
  capture.json                    camera grouping, settings and timing
  README.txt
  originals/
    camera-01/recording.webm       original recorded angle
    camera-01/session.json
    camera-01/timing/*.json
    camera-02/...
  reconstructions/
    <build-id>/
      spec.json                   settings; portable paths to archived originals
      manifest.json               sample times and files for the 3D replay
      calibration.json
      frame-00000.splat ...        every Gaussian time sample
      mesh-00000.glb ...           every saved pre-training triangle proxy
      seeds-00000.ply ...          exact Gaussian initialization points
      pretraining.blend           first sample only, when Blender is available
      scape-layout.json           inferred static layout, when fitting succeeds
      evaluation.json             full source-view measurements
      comparison-*.jpg            original / exported splats / amplified error
```

Originals enter the folder immediately after saving. A 3D build is still an explicit
choice of render level and time range. Every **completed build automatically adds
its exports and scores** to that experiment, under a new build ID; older versions
remain available. Cancelled or failed builds are not published as completed exports.
Copies are independent files, not hard links. Editing an archive copy does not edit
the engine's original reconstruction. Comparison reports describe the engine's
exported assets at evaluation time; externally edited copies need fresh validation.

The app library supports search, source-video downloads, reopening a selected build,
and model/Gaussian/Blender/Scape/report downloads. Reloading or restarting preserves
the library. Original engine session and reconstruction folders are retained for
normal playback; archive import/relocation to another PC is not implemented yet.

## Source fidelity v1

Evaluation renders the actual `.splat` bytes, including color and rotation
quantization, at both inferred source-camera poses for **every exported time sample**.
It decodes the corresponding original recorded frames at the configured offset.
Full-image errors include uncovered pixels. No exposure correction hides mismatch.

Measurements: PSNR, local Gaussian-window SSIM, mean absolute RGB error, opacity
coverage, fraction of pixels with any RGB channel error above 0.10, and edge F1
(one-pixel tolerance). An additional temporal diagnostic compares image changes
between reconstructed samples with changes in the originals; it is not a 3D tracking
or full-frame-rate validation metric.

The engineering index is
`100 × min(clamp((PSNR − 10)/30, 0, 1), SSIM, coverage, 1 − badPixels, edgeF1)`.
The headline uses the **worst camera/time sample**, with median and lower-decile
scores included. This is a declared conservative index, not a calibrated human
perception score and not “percent real.”

Every camera/sample must satisfy PSNR ≥ 35 dB, SSIM ≥ 0.97, coverage ≥ 98%, bad
pixels ≤ 2%, and edge F1 ≥ 0.95 to pass source checks. Novel-view accuracy, true 3D
geometry, and continuous motion fidelity remain unverified. A held-out, synchronized
camera and measured geometry are needed to test those claims. Training-camera
success cannot substitute for that evidence. No overall realism grade is issued.

## Improvements available for new builds

**Improved coverage & detail** enables `visibility-ssim-v1`:

1. Occlusion-aware filtering retains a surface supported by one camera when it is
   behind a nearer surface in the other. Points contradicting reliable visible
   free space are still rejected. Reports distinguish confirmed and unconfirmed
   retained observations. Both mesh exports and Gaussian seeds use this filter.
2. Training combines full-image L1 with structural similarity loss to retain detail.
3. Position learning rate decays through training to settle geometry during refinement.

Gaussian budgets and sample rates remain tied to Quick/Detailed/Maximum. Surface
constraints remain active when selected. These improvements cannot recover measured
information from unseen space or fix inaccurate inferred calibration. The toggle
can be disabled to produce a legacy comparison under the same capture settings.

Validation: `npm test`, Python reconstruction tests, `npm run test:rig`, and
`node tests/library-e2e.mjs`. Replay and geometry tests cover viewer regressions.
