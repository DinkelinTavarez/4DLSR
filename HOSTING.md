# Phone control and Vercel deployment

Connect this repository to Vercel with Framework Preset **Other**. The checked-in
`vercel.json` sets the build command to `npm run build:hosted`, output directory
to `dist-hosted`, and the root page to `remote.html`. Vercel hosts the phone
interface; Windows retains USB capture, recordings, FFmpeg, and GPU workers.

## Current status

The repository includes private desktop pairing, periodic camera preview
snapshots, timed remote recording, processing progress, and a touch-enabled
Gaussian replay viewer. These are experimental additions. A successful Vercel
build alone does **not** connect a phone to the desktop. Internet pairing and
the complete remote capture-to-replay flow must be verified for each setup.
Camera previews are periodic snapshots, not full-frame-rate remote video.

## Desktop setup

1. Install dependencies, run `npm run build`, then `npm start`.
2. Keep `http://127.0.0.1:8794/rig.html` open with cameras connected. The header
   indicates whether phone control is ready. Keep the PC awake.
3. Create the ignored `artifacts/remote-access.json` configuration with `secret`
   (64 hexadecimal characters generated with cryptographic randomness),
   `origins` (an array containing the exact deployed HTTPS origin), `engine`
   (`http://127.0.0.1:8794`), and `port` (`8800`). Never commit this file.
4. Start `node remote-gateway.mjs`. It listens only on loopback and permits a
   limited set of authenticated experiment and replay routes.
5. For temporary development access, use an official Cloudflare Quick Tunnel
   pointing at `http://127.0.0.1:8800`. Never expose the main capture server.
   Quick Tunnel URLs are temporary and change when the tunnel restarts.
6. Open the Vercel page on the phone and enter the HTTPS tunnel origin and
   private access key. Pairing is kept in that browser tab's session storage.
   Anyone with both values can view and control this workspace: keep them private.

## Experiments and replay

Choose or create an experiment, add context, select a duration (3–110 seconds),
processing quality, and splat budget. Zero budget means all available splats.
The default capture quality gate requires the selected cameras to meet their
targets; failed targets should be investigated rather than silently downgraded.
Timed capture finishes on the PC even if the phone page closes. Closing or
reloading the desktop capture page interrupts capture and remote control.

Saved sessions and processing status appear in the phone library. Completed
reconstructions open with timeline scrubbing, playback, orbit controls and
on-screen movement buttons. Quality depends on calibration, camera coverage,
synchronization and the reconstruction pipeline; this is not a guarantee of
photorealistic or fully reconstructed scenes.

The separate `/rig.html` hosted page is a browser-local UI preview. It cannot
capture the desktop cameras without the remote controller described above.

## Files and verification

Model weights, Python environments, recordings, build output and private local
configuration are excluded from Git and deployment. Hosted builds do not copy
the local model assets. Use `npm test`, `npm run build:hosted`, and
`npm run build`, then verify pairing, real capture and replay through a browser.
