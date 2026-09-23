# Small-budget four-angle experiment

Updated September 19, 2026. This is a purchase plan; Dean currently has one C920, not four cameras.

## Is it worth testing?

Yes, as a bounded experiment in simultaneous multi-view capture and reconstruction. It is not a purchase that guarantees a clean, generatively completed, moving 360-degree body. Four ordinary webcams do not provide hardware shutter synchronization or eliminate occlusion. Extra Gaussian samples improve the representation of observed surfaces; they do not create reliable missing observations.

Start with short takes and slow movement. Test capture bandwidth, visible timing cues and calibration before investing in longer sessions or advanced reconstruction. A separate static room scan can provide the background. A future body reconstruction pipeline must calibrate the cameras, align time, segment the person, fuse multi-view geometry, track motion and optimize a temporally consistent representation. Generative completion would have to be evaluated separately; invented unseen surfaces cannot be treated as measured geometry.

## Suggested purchase

**Three Logitech C920s cameras**, retaining the existing C920 as camera four. The official US store currently lists $59.99 each, or **$179.97 before tax** for three. They provide 1080p at 30 FPS, a 78-degree diagonal field of view, USB-A connection and tripod mounting. They are close to the camera already tested, keeping acquisition simple and the initial spend small. This is a practical compatibility/value choice, not a claim that the C920s has the best sensor in every price category.

- [Logitech C920s — US product and current price](https://www.logitech.com/en-us/shop/p/c920s-pro-hd-webcam)
- [Official setup guide — USB-A, 1/4-inch tripod mount and 1.5 m attached cable](https://www.logitech.com/assets/65985/c920s-web-qsg.pdf)

Allow approximately **$70–$150 extra** for stable mounts and necessary cables, depending on room layout. This is a planning allowance, not a retailer quote. Approximate initial total: **$250–$330 before tax**. Reuse stands and clamps where practical. All four cameras, including the existing one, must be positioned for full-body coverage.

Use only the extension length needed. A 3 m USB-A extension plus the camera's 1.5 m lead gives about 4.5 m of reach; test it at the intended capture mode before relying on it. Longer runs need appropriate active USB extensions, with added cost and compatibility testing. [Example 3 m extension: StarTech USBEXTAA10BK](https://www.startech.com/en-us/cables/usbextaa10bk).

Connect directly to separate PC ports first. A powered hub adds ports and power, but does not create independent host-controller bandwidth. **Do not buy a USB expansion card yet.** Start with all cameras at 720p30, then test 1080p30 while checking measured FPS and dropped/stalled views.

If the test establishes a controller bottleneck, the [StarTech PEXUSB3S44V](https://www.startech.com/en-us/cards-adapters/pexusb3s44v) provides four dedicated USB channels. It is an optional upgrade, not included in the budget. Physical slot clearance and power connectors have not been inspected. The [motherboard specifications](https://rog.asus.com/us/motherboards/rog-strix/rog-strix-b760-a-gaming-wifi/spec/) list a secondary PCIe slot operating at x4, with lane-sharing caveats when x1 slots are in use.

Spending $600 on three MX Brio webcams adds color resolution and higher frame-rate options but still leaves the synchronization/reconstruction problem. It is not my first recommendation for this small-budget experiment.

## PC checked locally

- Intel Core i9-14900K, 24 cores.
- 64 GB system RAM.
- NVIDIA RTX 4070 Ti, 12,282 MiB reported GPU memory.
- ASUS ROG STRIX B760-A GAMING WIFI motherboard.
- One Intel USB 3.20 xHCI host controller reported by Windows.
- Approximately 1,018 GiB free on C: at inspection time.

This is suitable for capture and reconstruction experimentation. It does not establish a processing-time estimate for a trained multi-view model; that requires an actual synchronized dataset and a selected pipeline.

## Software now available

- The single-camera viewer has 82,944 / 230,400 / 518,400 / 921,600 Gaussian settings. The default is 230,400. Density is independent of model depth accuracy and does not add unseen geometry.
- `/rig.html` lists video devices and assigns distinct cameras to Front, Right, Back and Left slots. It supports one through four connected streams, so it can be inspected before purchasing cameras.
- The workspace provides live previews, negotiated capture modes, observed preview FPS, device-change notices, duplicate-device rejection, and focus/exposure locking where the browser and camera expose those controls.
- Record/stop applies to all connected cameras. Each original stream is stored separately; a group manifest links them. Uploads are ordered and retry safely. Saved groups can be reopened, and surviving streams can be recovered after an interruption.
- Browser frame-observation timestamps and operator sync-cue markers are saved. These are **not exposure timestamps or hardware synchronization**. Group review offers approximate start-aligned playback only.
- Calibration, multi-view fusion, body tracking and generative completion are **not implemented** in this capture workspace.

## Verification

The server test verifies four simultaneous sessions, byte-identical saved originals, timestamp-batch retry deduplication, rejection of premature group completion, and a saved four-camera manifest.

A browser simulation opened four independent canvas streams, recorded them concurrently, saved all four videos and timing batches, then reopened them for group review. These tests do not validate four physical USB cameras, exposure synchronization, calibration or 3D reconstruction. Test media stays in the project's isolated `.test-recordings` folder.

The existing real recording was also opened at 921,600 samples and exercised through playback and orbiting. Its original video was not rewritten.
