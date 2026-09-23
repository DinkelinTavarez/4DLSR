# Spatial Replay

A local Windows webcam recorder with continuous disk storage, rewind while recording, and navigable temporal Gaussian splats. The browser handles capture, inference and rendering; a loopback-only Node service saves video and builds seekable playback with FFmpeg.

## Run

Double-click **Open Spatial Replay.cmd**, or the **Spatial Replay** shortcut on the Desktop. It opens <http://127.0.0.1:8794> in your browser. Use Chrome or Edge with hardware acceleration enabled.

1. **Connect camera** and allow browser camera access. The microphone is never requested.
2. Click **Start recording**. The depth engine initializes locally. Video is appended to disk about once a second.
3. Click **rewind 10 seconds** or scrub the timeline. Capture keeps running. **Update replay** includes newer footage; **Live** returns to the camera.
4. Click **4D space**. Drag to orbit, right-drag to pan, scroll to zoom, and use **W/A/S/D** to move, **Q/E** for height. **Reset view** returns to the source camera. Space pauses/plays.
5. **Stop & save** finalizes a normal, seekable WebM file. Open past sessions from **Recordings**. Choose **Every video frame · best quality**, **High detail · 6 depth frames/sec**, or **Quick preview · 2 depth frames/sec**, then **Prepare full recording in 4D**. Best quality follows the recording's actual frame timestamps and uses a larger depth-model input. Keep the tab open until preparation finishes. Cancel keeps completed frames; running the same profile again skips those frames.

Keep the app tab open during recording. Closing it stops camera capture. The local server alone does not record, and no auto-start or background surveillance service is installed. Disconnect releases the camera.

## Optional multi-camera capture

Open **Multi-camera lab** in the header or `/rig.html`. Start with two slots; **+ Add camera** and each slot's **Remove** control change the layout. There is no fixed four-camera limit in the UI or API. Find cameras adds slots for detected devices; selections persist locally. Removing a slot releases its preview and preserves saved takes. Layout changes are locked while recording/saving. USB bandwidth, power and encoding capacity set the practical limit; more views help only with useful overlap, calibration and synchronization.

Assign distinct devices, connect, check observed FPS, then record all connected views. Preview alone never starts recording. A failed camera connection preserves other working previews. Start at 720p/30 for two C920s; raise resolution after checking saved cadence. Microphones remain off. Each view retains a separate original video; `.rigs/<group UUID>.json` links camera sessions and stores capture settings, software start times and cue markers. Per-session `timing/*.json` files contain browser frame observations. These timestamps are not hardware exposure synchronization. Review offers approximate alignment; calibration, combined 4D reconstruction, body tracking and generative completion are not implemented here.

After **Review angles**, choose **Assess take**. The server inspects actual encoded frame timestamps with FFprobe and reads saved timing evidence. Eight gates cover playable files, cadence, exposure alignment, calibration, fused geometry, held-out images, temporal stability and blind realism evaluation. Missing evidence never passes; no realism percentage is invented. Download the JSON report to retain a baseline. See `QUALITY_PROTOCOL.md`. Existing four-camera takes remain readable.

**Gaussian density** in the existing single-camera viewer selects 82,944, 230,400 (default), 518,400 or 921,600 samples. More samples can refine observed detail, at additional CPU/GPU cost. They cannot restore unobserved surfaces or increase the underlying depth model's accuracy. See `CAMERA_EXPERIMENT.md` for the small-budget purchase plan and actual verification scope.

## Recording files

The launch script uses Windows' actual Desktop location, including redirected/OneDrive Desktops:

```
Desktop/Spatial Replay Recordings/<session UUID>/
  capture.webm       Original continuous MediaRecorder stream
  recording.webm     Indexed, seekable copy produced at Stop & save
  session.json       Timing, image dimensions and save state
  depth/*.bin        Timestamped preview inverse-depth maps
  depth-hq/*.bin     Separate, higher-detail inverse-depth maps
  replay-*.webm      At most two recent seekable live snapshots
```

The raw stream is intentionally kept even after finalization. Consequently video storage is roughly 2–4 times the raw recording size while snapshots are present, plus depth. Preview depth uses about 330 KB/s at 384×216 and two samples/second. HQ maps use 460,808 bytes per 640×360 frame: about 6.9 MB/s at 15 FPS, or 135 MB for the tested 294-frame clip. There is no automatic deletion or retention policy. Rewinding a long recording copies and indexes the recorded prefix, so the first rewind is not instantaneous for large files. Disk/network save failures are surfaced; capture uploads retry, while failed offline preparation can be resumed. The tab warns before closing an active recording. A server restart marks unfinished sessions as interrupted. **Recover & open** reconstructs a seekable file from the surviving bytes; the last incomplete frame may be lost.

## What the spatial mode actually does

This is a custom **depth-based temporal Gaussian-splat prototype**, not a trained multi-view 4DGS model and not an Atlas integration. Each sampled video frame is assigned relative inverse depth by Depth Anything V2 Small. We convert inverse depth reciprocally to relative distance, unproject the selected density of visible surface samples into 3D, and render Gaussian footprints that sample the original video texture across their area. Depth sorting, alpha compositing, depth-edge rejection and footprint limits reduce blending and stretching artifacts. HQ preparation aligns relative depth scale using visually stationary pixels; preview mode also filters stable regions. Cached depth follows decoded video-frame timestamps, with interpolation between nearby cached frames. Every-frame preparation removes the sparse geometry-update bottleneck for saved clips. Original recordings and preview caches are preserved separately from HQ maps.

This creates genuine parallax and a navigable, changing surface representation around the source view. It does **not** reconstruct an entire room, recover unseen backs of objects, infer metric distances, estimate a moving camera's pose, or keep a globally fused 3D map. A stationary webcam and modest viewpoint changes give the best results. Moving far from the source view exposes gaps, flattened regions and distorted surfaces. Fast motion may briefly misalign video color and estimated depth. The synthetic sample has known depth and is explicitly labeled; its accuracy is not a claim about webcam reconstruction.

The public [World Labs Atlas announcement](https://www.worldlabs.ai/blog/atlas) offers early access. The documented [World API](https://docs.worldlabs.ai/api) exposes Marble, which is not a drop-in live 4D recorder. This project chooses the user's custom implementation option instead of claiming access to Atlas. Jev is not needed for recording or reconstruction and is not integrated.

## Local inference and dependencies

All app, model and runtime files are served locally. No camera image or video is sent to World Labs, OpenAI, Hugging Face or another inference service. Initial installation downloads the public model and libraries; runtime inference does not need a remote API or paid key.

- [Depth Anything V2 Small ONNX](https://huggingface.co/onnx-community/depth-anything-v2-small), Apache 2.0
- Transformers.js 3.8.1 / ONNX Runtime, WebGPU with CPU/WASM fallback
- Three.js 0.180.0 for WebGL rendering and controls
- Node.js and FFmpeg available on this computer

Rebuild from this folder:

```powershell
npm install
node scripts/setup-assets.mjs
npm run build
npm start
```

The server binds only to `127.0.0.1`. Mutations require a per-process token; Host, Origin, path and payload checks restrict cross-site writes. This is a single-user local prototype, with no accounts, encryption, cloud sync or forensic certification.

## Verification

`npm test` verifies source-byte integrity, chunk ordering and retry deduplication, rejection of hostile requests, separate preview/HQ depth storage, true video-frame timestamp inspection, depth payload validation, seekable remuxing, closed-session writes and HTTP byte ranges.

`node tests/e2e.mjs` exercises an isolated simulated webcam through capture → disk → rewind during recording → depth inference → spatial controls → finalize → reload and reopen. It uses a test server at port 8795. `node tests/e2e.mjs --physical` exercises the actual camera without creating camera screenshots. Results and software screenshots are stored in `artifacts/`; test footage is kept separately from ordinary Desktop recordings.

See `artifacts/verification.md` for earlier results and `RECONSTRUCTION_NOTES.md` for the screenshot diagnosis. `/quality.html?recording=<UUID>&t=<seconds>` compares the previous and current renderers using the same video and depth. Without `t`, it samples up to eight prepared timestamps and reports the worst result. HQ depth is preferred with preview fallback. RGB MAE/PSNR and 8×8 luminance block SSIM measure source-view fidelity, not novel-view geometric accuracy. Missing depth produces an actionable message. The diagnostic uses 83k splats at 640×360; it does not validate 4K playback. `npm run test:rig` tests dynamic layouts, six-stream recording, review, assessment and reducing to two cameras in an isolated store. `node tests/rig-e2e.mjs --physical` requires at least two accessible cameras and retains test clips only in `.test-recordings/`.

## Live preview workflow (September 20 update)
The app requests camera preview on opening. Preview alone never starts MediaRecorder or saves camera frames. New recording returns to live preview; Start recording explicitly begins a new take. Stop & save returns to non-recording live preview. Open Recordings to select a saved take for playback or offline preparation; the separate camera monitor stays live. Quick uses a 294px model input and 384px output at two samples/sec; High uses a 518px model input and 640px output at six samples/sec; Best uses that higher resolution at every actual video timestamp. Preparation locks conflicting session actions and supports cancellation/resume. Keep the camera stationary while walking within its view; camera pose tracking and fused room reconstruction are not implemented.
# Combined multi-camera reconstruction

Saved takes now include **Reconstruct combined 3D**. This runs joint two-view geometry
estimation and actual CUDA Gaussian training, with one-moment builds or sampled 3D
replays. Quick / Detailed / Maximum profiles change real resolution, point budgets,
training iterations and time sampling. See [RECONSTRUCTION_PIPELINE.md](RECONSTRUCTION_PIPELINE.md)
for usage, setup, model terms, measured limits and validation. This remains experimental;
it is not a validated photorealistic 4D reconstruction system.
