# Live Spatial Replay — experiment protocol

Working technology name: **Live Spatial Replay**. Descriptive category: **4D spatial streaming**.
These are working names, not claims of trademark availability or completed photorealism.

## A repeatable experiment

1. Choose **New session**, link an experiment (or create one inline), and add one
   **Session context** describing what is changing and what will happen. Detailed
   procedure and conditions are optional. One experiment can have many sessions.
2. Choose **Continue to cameras**. Connect cameras and check advancing previews.
   Expand individual camera settings only when needed. Start the optional **Live
   3D draft** to inspect approximate geometry alongside the live video.
3. Under **Processing settings**, choose Quick, Detailed or Maximum. The default
   splat budget is **All available**, with no fixed point cap. An explicit maximum
   deterministically samples the available points across the complete cloud before
   optimization. It cannot create geometry beyond the inferred observations.
4. Start recording. Capture 10–20 seconds initially. Show a cue visible in every camera, stand still,
   walk slowly across overlapping views, turn, stop, and repeat the cue. The cue is
   evidence for alignment; a button press does not synchronize exposure.
5. Choose **End & process**. Every original angle is saved first; the live draft
   stops to release the GPU, then the whole replay is built automatically with
   the selected quality and splat budget. A failure leaves the recordings intact
   and offers the processing controls for another attempt. Combined 3D requires
   at least two cameras; a single-camera recording still saves its original video.
6. Scrub the replay timeline in seconds or scroll over it to step through samples.
   Fly or orbit independently of time. **Visible splats** adjusts display density
   without modifying the saved files. Model tools, scores, timing corrections and
   previous build versions are available in expandable sections. Existing sessions
   reopen from **Library**. New session clears capture context for the next take.
7. In the experiment notebook, compare render versions, write observations,
   decisions and next steps. Download the Markdown report or JSON evidence bundle.
   Mark Reviewed only when the outcome and next step are documented; reopen to
   capture more sessions. Metadata revisions are retained. Session context is an
   immutable snapshot of the hypothesis and criteria at capture time.

## Learning policy

Each processed session optimizes its own Gaussian scene against its source views.
The geometry model is not automatically retrained from experiments, inferred
meshes or source-fit scores. Those estimates are not independent ground truth.
The notebook, original recordings, timing evidence, configuration and versioned
builds remain the evidence for future calibrated evaluations and, if justified,
supervised geometry-model fine-tuning. No cross-experiment model improvement is
claimed by the session workflow.

## First four-camera experiment

Question: Do additional overlapping views reduce missing surfaces and body
distortion relative to a two-camera build of the same take?

- Keep all four cameras fixed. Avoid facing only blank walls or giving each camera
  an isolated, non-overlapping corner. Different views need shared visible detail.
- Record one short repeatable motion. Build the same still timestamp first with
  two training cameras, then all four. Keep geometry method and quality level fixed.
- Record time cost, worst source-image metrics, holes, thick surfaces, duplicate
  limbs, and distortion while roaming. More views can reveal calibration failures.
- For a genuine novel-view test, a subsequent protocol must withhold a reference
  camera from geometry and appearance fitting and establish its pose independently.
  Selecting fewer training views currently does **not** automatically evaluate a
  held-out camera. It must not be reported as held-out validation.
- Do not compare only the best-looking frame. The existing source score uses the
  weakest camera/time sample. Missing geometry is penalized.

## Current quality budgets

Capture modes are independent per camera. Enter a native width, height and
positive FPS (including fractional rates such as 29.97), then Apply. Presets are
shortcuts, not a list of the only supported formats. Explicit Camera default
mode lets the device/browser choose and displays its resulting settings; it does
not claim to choose maximum quality. Custom mode requests exact dimensions and
FPS without image resizing and reports rejection instead of substituting a mode.
Reported capability ranges are hints, not a list of supported combinations.

Mixed capture resolutions, aspect ratios and frame rates remain separate in the
recording library. Reconstruction decodes each source at a common time, resizes
working copies to the selected profile width and center-crops to a common height.
The original recordings retain their dimensions and cadence; the working crop
does not retain the full field of view of every differently shaped source. Camera
geometry is inferred again if live working-image dimensions/aspects change.
Driver, browser, codec, USB and GPU support still determine which physical modes
can actually run. Proprietary depth/industrial camera SDKs need separate adapters.

| Level | Training raster width | Samples/s in saved replay | Steps/sample, 2 / 4 views | Gaussian count policy |
|---|---:|---:|---:|---:|
| Quick | 640 | 1 | 100 / 200 | All valid geometry; no count cap |
| Detailed | 960 | 2 | 400 / 800 | All valid geometry; no count cap |
| Maximum | 1280 | 4 | 1,000 / 2,000 | All valid geometry; no count cap |

Training uses every selected source. Larger rigs retain the per-view optimization
budget. Live drafts and saved builds have no fixed Gaussian count cap. Confidence,
cross-view consistency and spatial deduplication still determine usable geometry.
Larger scenes require more GPU/RAM and time; allocation failures are reported
instead of silently reducing the point count. Existing exports retain their original
counts and must be rebuilt to benefit. The inferred-depth network uses a
518-pixel width. More training does not create captured 4K detail or verify hidden
surfaces. Capture quality, inference resolution and viewer resolution are distinct.
Different input aspect ratios are center-cropped to the shared raster height,
without stretching; original recordings remain untouched.

## Live versus replay

- Live video: camera previews, local to this PC; recording is explicit.
- **Live 3D draft**: memory-only JPEG snapshots, joint inferred depth and untrained
  colored splats. Processing repeats after each result and a one-second gap.
  Snapshot age and processing time are displayed. Initial model loading is slower.
  It is an experimental geometry preview, not trained photorealistic live 4D.
  Keep the rig fixed; stop/restart after moving cameras. Stopping freezes the last
  draft for inspection and releases the GPU. No video or draft history is archived.
- Saved replay: independently optimized Gaussian time samples, with original
  video playback at the recorded frame rate. No persistent deforming 4D model or
  validated temporal correspondence yet.
- One GPU task at a time: stop the live draft before starting a build or evaluation.
  Live drafts accept 2–8 cameras; offline multi-view accepts 2–16. Strict stereo
  requires exactly two. Larger rigs can exceed the available 12 GB GPU memory;
  failure is explicit and preserves the original recordings.

## Evidence and storage

Before capturing a changed camera arrangement, use **Rig setup** to inspect
inferred positions, source-image planes and scene points. Optional baseline and
level-camera measurements establish approximate scale and heights. These are
setup diagnostics, not fixed calibration constraints used by recorded builds.
See [RIG_SETUP.md](RIG_SETUP.md) for the workflow and independent accuracy checks.

`Desktop/Spatial Replay Recordings/Lab/experiments/<experiment-id>/` contains the
notebook and revision history. Reports are refreshed when opened/downloaded.
`Desktop/Spatial Replay Recordings/Experiments/<session-id>/` independently copies
original videos, timing, capture context and each completed render version.
Older sessions remain in the library without invented historical context.

The original source-fit score compares exported Gaussian bytes with source frames
using PSNR, SSIM, opacity coverage, bad pixels and edges. The worst component/time/view
sets the score. It is **not a percentage of realism**. Novel-view accuracy, measured
scale, exposure synchronization and continuous motion fidelity remain unverified.

## Next research gates

Measured lens/rig calibration → exposure alignment → independent-view validation
→ static/dynamic separation → temporal correspondence → sustained latency budget.
An AI observer can consume the evidence bundle later. No automatic AI video review
or cloud upload has been added or implied.
