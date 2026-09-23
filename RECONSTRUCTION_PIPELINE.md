# Combined Gaussian reconstruction

The multi-camera app now has an actual offline reconstruction path. From Saved takes,
choose **Reconstruct combined 3D**, select two angles and a quality profile, then
**Build combined 3D**. Saving a new multi-camera take opens these controls automatically.
Recording alone does not start a GPU build. Originals remain untouched.

Build defaults to **Whole take · playable 3D replay**. A **Single still frame**
cannot play as an animation; the viewer explains this and offers full-replay setup.
Use **Play 3D replay**, Pause, Restart and the timeline to watch or seek reconstructed
samples while roaming. These controls stay inside Expand viewer. Playback stops at
the last sample; Play starts again from the beginning. A bounded four-frame cache
prefetches the next sample. **Play original videos** opens both source recordings
and starts their normal video playback. Switching to 3D playback pauses those videos.
Source-video frame rate and reconstruction sample rate are separate: Quick is 1,
Detailed 2, and Maximum 4 reconstructed samples per second, not smooth 30 FPS 4D.

## Implemented

- Local FFmpeg decoding at a shared requested time, with user-adjustable camera delay.
- Joint camera/geometry inference using VGGT, or stricter feature matching + stereo.
- A shared coordinate frame for both views; the reference rig pose stays fixed across time.
- Cross-view depth filtering and voxel merging for inferred geometry.
- Actual CUDA `gsplat` training of positions, scales, orientations, opacity and color
  against both source views. Full-image loss includes missing pixels.
- Standard 32-byte `.splat` exports, a manifest with measurements, free flight and orbit/pan/zoom,
  source-camera view buttons, and playback/scrubbing of reconstructed samples.
- Persistent jobs in `.reconstructions/`, progress, cancellation, and clear failures.
  Failed or incomplete jobs do not expose a completed-scene download. Previous builds stay available.

| Profile | Training width | Gaussians capped at | Steps per sample | Replay samples/s |
| --- | ---: | ---: | ---: | ---: |
| Quick | 640 | 20,000 | 100 | 1 |
| Detailed | 960 | 60,000 | 400 | 2 |
| Maximum | 1280 | 120,000 | 1,000 | 4 |

These settings increase actual processing, not merely viewer point sizes. They are
not promises of monotonic image quality. Geometry inference currently uses a 518px-wide
model input; higher profiles train appearance against higher-resolution source frames.
Whole-take mode is currently capped at 120 seconds and one active GPU job.

## Surface guidance and roaming

### Inspect geometry before Gaussian training

New builds save **exact untrained seed points** before `train()` and, for the
multi-view method, an inspectable depth-surface mesh at every replay sample. In
the viewer's **Show** selector, choose **Before Gaussians · solid mesh**,
**wireframe**, or **seed points**. Switching representation keeps the current
time and roaming camera. **Frame whole model** moves outside to show its bounds;
Camera 1/2 view returns to the source viewpoints. Meshes and points use the same
replay timeline as the trained Gaussians. Older builds have no saved pre-training
geometry; their geometry options are disabled until a new build is made.

This is a newly explicit inspection stage. The previous pipeline did not create
a Blender model before splatting: it inferred depth, sampled points, and estimated
local tangent directions. The inspection mesh is constructed from neighboring
depth-grid pixels (up to 320 samples across each view); triangles are rejected at
invalid pixels, >4% relative depth jumps, long edges, and degenerate areas. Camera
layers are kept separately named and can overlap or disagree. This mesh is not
watertight and is not a collision/free-space certificate. Its topology is not
optimized by Gaussian training; the trainer uses the exact seed points and local
surface constraints. Editing a Blender export does not modify the current trainer.

Each sample exports `mesh-NNNNN.glb` and `seeds-NNNNN.ply`. These use right-handed
Y-up coordinates (OpenCV x, -y, -z), relative camera baseline=1, **not surveyed
meters**. GLB contains indexed triangles, normals and linear vertex colors. PLY
contains the exact initial positions and byte-encoded source colors, no faces.
Strict stereo currently exports seed points only. Download links follow the
current timeline sample.

When Blender is installed, the completed build also contains `pretraining.blend`
for its **first time sample**, with named depth meshes, two source cameras, and a
hidden object containing the untrained seed positions. The native document uses
Blender Z-up, includes a READ ME text block, and preserves relative scale. The
download label identifies its fixed timestamp; it is not an animated .blend.
The GLB/PLY sequence remains available for every sample. A native Blender render
and geometry counts are saved as `geometry-blender-preview.png` and
`blender-geometry.json`. If Blender is absent, the GLB can be imported separately.

### Training constraints and flight controls

**Surface-guided Gaussians** is an optional experimental training constraint, enabled
in the build controls. Local 16-neighbor PCA estimates tangent planes from the same
seed geometry. Neighborhoods with insufficient planarity or large gaps are not constrained.
Supported Gaussians keep a fixed tangent orientation, normal thickness at most 12% of
the smaller tangent radius, and normal center drift at most 15% of their seed radius.
Tangent radius is bounded at twice its initial radius. The manifest reports how many
Gaussians were constrained and the actual maximum thickness/drift. Previous builds
remain available; changing the checkbox affects new builds only.

This is a local plane prior, not SuGaR, a complete edge/object mesh, or measured
free-space carving. Thin Gaussians at an incorrect depth are still incorrect. This
does not supply a watertight collision map or prove that empty room space is clear.
Image edges alone cannot recover the distance to a surface. Novel-view reference
images and independently calibrated camera geometry are still needed for validation.

The viewer defaults to **Fly freely**. Click the scene first: W/A/S/D or arrow keys
move, E/Space rises, Q/Ctrl descends. Shift multiplies speed by four; Alt slows it to
one quarter. The speed slider ranges from 0.25× to 8×. X stops immediately; release
keys for smooth deceleration. Drag to look, or choose Capture mouse and use Esc to
release it. Focus loss stops motion and keyboard shortcuts do not consume form input.
Camera 1/2 view buttons return to the calibrated poses. Orbit remains available.
There are no collision barriers. Expand viewer fills the browser viewport; Esc closes
it. Mouse capture depends on browser support; the embedded app uses drag-look fallback.

Splat depth sorting uses a linear-time worker with transferable buffers, only when
orientation or the time sample changes. Translation does not require another sort.
Playback preserves the roaming pose and keeps the speed scale fixed across samples.

## Scene explorer modes

- **Full GSP:** trained Gaussian appearance and sampled replay.
- **3D Model:** saved pre-training solid mesh, wireframe, or exact seed points.
  The mesh/PLY downloads follow the selected time; Blender remains the first sample.
- **Scape:** a static layout of flat quadrilaterals in the same coordinate system.
  A browser worker samples at most 7,000 points from the first frame's saved seed
  PLY, performs deterministic RANSAC and covariance plane fitting, then proposes
  a rectangular room completion from trimmed bounds. No retraining is required.

Scape colors fitted plane positions teal and unobserved boundaries amber with
dashed outlines. Even fitted planes have inferred extents and role labels. Camera
uprightness, gravity, one rectangular room, floor/wall identity and unseen space
are assumptions, not verified measurements. Separate switches hide assumed
boundaries and the ceiling, and control exterior-wall cutaway rendering. The grid
is illustrative; its divisions are not meters. A JSON download includes corners,
normals, fitting support, residuals, assumptions and the reference time/job ID.

Scape is fixed to the first reconstructed time sample; it does not animate people
or segment furniture. Its replay controls are disabled, while switching back
restores playback at the retained time. All mode switches preserve the viewer
pose. Frame whole model deliberately changes the viewpoint. Scape is for visual
layout inspection and does not modify Gaussian optimization or impose collisions.
Old builds without saved geometry disable unsupported modes rather than invent
replacement scan data. Failed fitting is reported without leaving old geometry
visibly mislabeled as the new mode.

## What this does not establish

This is an experimental shared Gaussian scene and sampled 3D replay, not a finished
photorealistic 4D engine. There is no persistent dynamic Gaussian identity or temporal
optimization. Independently reconstructed samples can flicker or pop. The two-view
implementation selects a pair from larger rigs; it does not yet fuse every camera.

VGGT infers poses, intrinsics and depth from both images. Those are learned estimates,
not measured calibration. The stereo alternative assumes a specified horizontal FOV,
zero distortion and a relative baseline of one. Neither output has surveyed metric scale.
Camera movement, autofocus changes, mirrors, blank walls and occlusion can invalidate
the estimates. Reference depth is stabilized using unchanged pixels but has no ground truth.

Source capture uses browser/receiver timestamps. A user-set delay does not measure
exposure synchronization or drift. Fast motion can therefore produce mismatched geometry.
Measured quality includes full-image PSNR and rendered opacity coverage from both
**training** cameras. Coverage is not a correctness score, and training-view fit does not
validate unseen viewpoints. `metricsPass` remains false and `realismScore` remains null.

## Setup and validation

Windows / NVIDIA CUDA, Chrome capture, Node and FFmpeg. Run
`powershell -ExecutionPolicy Bypass -File scripts/setup-reconstruction.ps1` in a normal
user shell (not an administrator shell). The model and Python environments are project-local.
The setup requires Git on PATH and several GB of disk/download space.

Validation commands:

```
npm test
npm run test:rig
.reconstruction-env/Scripts/python.exe tests/test_reconstruction.py
node tests/navigation-e2e.mjs <completed-reconstruction-id>
node tests/replay-e2e.mjs <completed-sequence-id>
node tests/geometry-e2e.mjs <completed-sequence-with-geometry-id>
node tests/scape-e2e.mjs <completed-sequence-with-geometry-id>
npm run build
```

When starting the service from a sandbox, the configured Desktop recordings folder
requires permission to write there. Do not restart it in a restricted process and call
recording fixed without verifying a save.

## Sources and model terms

- [VGGT source and model terms](https://github.com/facebookresearch/vggt). Installed source
  revision: `a288dd0f14786c93483e45524328726ab7b1b4ce`. The downloaded **VGGT-1B** checkpoint is
  non-commercial. The separately gated commercial checkpoint has separate access/terms;
  it is not installed. This environment is an R&D prototype.
- [gsplat](https://github.com/nerfstudio-project/gsplat), official Windows
  `1.5.3+pt24cu124` wheel with PyTorch `2.4.1+cu124` and Python 3.10.
- [Kornia LoFTR](https://kornia.readthedocs.io/en/latest/models/loftr.html), MegaDepth matcher.
- [OpenCV calibration and geometry](https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html).

No source footage is uploaded to these services. Only packages and model weights are downloaded.
