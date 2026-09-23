# Phone preview on Vercel

Vercel builds the same Session / Experiments / Library interface with
`npm run build:hosted`. The root URL opens the session workspace. The desktop
build remains `npm run build` followed by `npm start`; its files and running
camera service are separate from the hosted output.

The hosted version supports the responsive interface, browser-local experiment
notes and reports, and previewing the current device's camera with permission.
It does not connect to the Windows capture service, upload camera images,
record videos, run CUDA reconstruction, or sync the desktop experiment library.
These unavailable controls are explicitly labeled. Browser notes persist only
on that device and origin, and can be exported as JSON or Markdown.

USB camera access, FFmpeg, durable recording storage, and Python GPU workers
remain on the desktop. Remote operation needs an authenticated connection to
that engine; a static Vercel deployment cannot provide it on its own.

Model weights, virtual environments, recordings, build artifacts, and local
configuration are excluded from source control and deployment. The hosted
build does not copy the multi-gigabyte local `public/` model assets.

Verification: `node --test tests/hosted-workspace.test.mjs` and
`npm run build:hosted`, followed by mobile-width browser checks.
