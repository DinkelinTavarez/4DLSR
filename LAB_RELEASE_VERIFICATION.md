# Lab release verification — September 22, 2026

## Implemented

- White/light-blue lab with six workspaces, responsive navigation and reduced-motion support.
- Experiments with groups, related experiments, status, revision history and typed notes.
- Required per-session experiment/change/procedure context, enforced by the server;
  immutable capture-time metadata, independent originals, multiple render versions.
- Markdown/JSON reports, in-notebook build comparisons, legacy-session labeling.
- Automatic camera discovery, assignment and connection; native catalog identity
  instead of model-name matching, so identical camera labels are not inherently ambiguous.
- Shared capture-service device IDs, reconnect handling, owned-connection cleanup on reload.
- N-view geometry inference, visibility voting, training, scoring, geometry export
  and source-camera navigation; no longer restricted to a selected pair.
- Per-view optimization budgets preserved as cameras are added; 240,000 total cap.
- Memory-only periodic live 3D drafts with source age and processing delay shown.
  Untrained inferred geometry is explicitly distinguished from optimized replay.
- GPU exclusion between live drafts, offline builds and source evaluation.

## Passed checks

| Check | Evidence |
|---|---|
| App production build | Vite completed |
| API/quality/archive/navigation/Scape suite | 11 tests passed |
| Python geometry/metrics/export/timing suite | 9 tests passed |
| Browser recording and notebook flow | Six simulated cameras, then two; independent byte-identical archives; required session context; notebook persistence; four-view selection budget; no page errors |
| Four-view GPU reconstruction | Four distinct rendered perspectives; two time samples; four trained/evaluated cameras at each time; eight comparisons; four Blender surface objects; approximately 30 seconds total |
| Live worker | Four synthetic views; first inference 10.008 seconds, next 1.163 seconds; no files in recording store; stop/expiry and GPU exclusion passed |
| Live browser flow | Four fixture canvas streams through actual browser JPEG capture and GPU inference; 40,000 untrained splats shown; Stop worked; no recording; no page errors |
| Saved real recording replay | 76 samples; play/pause, seek, restart/end, free flight during playback, originals playback and seeking passed |
| Model inspection | Native Blender file, solid/wireframe/seeds, mesh replay and mode/time preservation passed |
| Scape | Static fitted layout, explicit assumptions, cutaway/ceiling, free flight, rapid mode changes, legacy fallback passed |
| Library | Original downloads, build selection, comparison images, scores and reload persistence passed |

Synthetic integration fixtures demonstrate software participation and data flow,
not photorealistic reconstruction or synchronized physical-camera capture.
Warm live inference timing excludes the one-second refresh gap and browser overhead.

## Physical camera blocker

At verification time, Windows' present-device inventory showed no camera/image
devices; DirectShow reported no video devices; the local browser capture catalog
also returned zero. One C920 briefly appeared in the browser catalog later, then
both Windows and the capture catalog again reported zero on the final check.
Thus **four physical live previews were not verified**.
Auto-connect is enabled and retries when cameras become visible. The operator must
check actual imagery, placement and advancing FPS after cameras are reconnected.

No real recording was started during this shipment. Existing sessions were preserved.
The planned “Four-camera coverage baseline” experiment is ready, with no invented
observations about physical four-camera reconstruction quality.

## Remaining research limitations

No claim of a measured four-camera quality improvement in this room; no held-out
reference validation, measured lens/rig calibration, hardware exposure sync,
persistent 4D deformation model, or trained photorealistic live reconstruction.
World Labs' private model has not been recreated or integrated. No footage uploaded.

See [LAB_PROTOCOL.md](LAB_PROTOCOL.md) and [WORLD_MODEL_REVIEW.md](WORLD_MODEL_REVIEW.md).

## Rig positioning addition — 2026-09-22

- Added a pre-recording Rig setup view with joint camera poses, colored viewing
  frustums, corresponding snapshot image planes and inferred scene points.
- Optional measured lens-center baseline rescales the layout. An explicit level
  reference camera plus measured height enables a manual floor reference. No
  floor height, measured pose accuracy or gravity is invented without inputs.
- Export contains source settings, calibration, measurements, support statistics
  and limitations. It excludes images and flags simulated input. Export is blocked
  for stale layouts. Reconstruction still independently estimates its geometry.
- Three geometry tests cover rotated extrinsic inversion, exact frustum projection,
  measured scaling and conditional heights, including nonconsecutive camera slots.
- Browser integration used four generated perspective views with the real GPU
  worker: pose display, scale/floor export, fresh re-estimation, connection-change
  invalidation, missing-camera rejection, GPU release and no recording files passed.
- Existing 11 checks and the six-stream simulated recording/experiment workflow
  passed. No physical recording was made. Synthetic tests do not establish physical
  rig accuracy. The four-view screenshot is a generated scene fixture.

Artifacts: `artifacts/rig-setup-four-view.png`, `artifacts/rig-setup-empty-mobile.png`.
Run `node tests/rig-setup-e2e.mjs` for the GPU/browser workflow.
