# Replay geometry stability

The original sequence rebuilt and trained each time sample independently. Fixed
camera poses alone did not stop depth jitter, per-view scale disagreement, or
appearance training from shifting geometry. Unconfirmed points were retained.

New multi-view builds anchor stationary reference depth and retain existing
occlusion-aware cross-view checks. An experimental `strictGeometry` build removes
depth-edge pixels, requires another view
to confirm depth within 5% and rejects any reliable free-space contradiction.
That strict variant is NOT the default: the first three-camera test lost too
much coverage (96% to 20%) and worsened the temporal error (0.033 to 0.063).
Existing per-camera scale corrections remain. Pixels whose appearance
remains stable across reference samples and whose current depth agrees within
4% reuse reference depth, with a margin around changed silhouettes. During
Gaussian training, experimental `lockGeometry` can keep means on accepted seeds;
it is off by default because the tested locked variant worsened fidelity.
Existing surface guidance constrains thickness and orientation when enabled.
These are fixed-rig heuristics, not calibrated occupancy or persistent tracking.

Expected tradeoff: fewer floaters but more holes. Missing overlap, wrong inferred
poses, reflections, and correlated depth errors still cause failures. A lower
splat count is not itself a quality improvement. Existing replays retain the old
algorithm; create a new build from the saved originals to use this correction.

## Three-camera A/B test, September 23, 2026

Same saved eight-sample take, Quick profile, all available splats:

| Variant | Worst source score | Worst coverage | Temporal image-change error (lower is better) |
| --- | ---: | ---: | ---: |
| Original | 21.64 | 96.23% | 0.03310 |
| Strict confirmation + position/scale lock | 0.00 | 20.36% | 0.06276 |
| Gentler filtering + common scale + position lock | 14.91 | 84.30% | 0.04046 |
| Stationary anchors only (retained default) | 21.34 | 96.19% | 0.03227 |

Anchors reduced this temporal diagnostic by about 2.5%, with essentially unchanged
coverage and a small reduction in worst source score. This is a modest experimental
result, not evidence that floaters or motion reconstruction are solved. The first
two variants failed the release comparison and are not the default. The retained
build is `65b9e93b-e985-4cdf-9e78-2bd4caf82f01`; the baseline is
`383f29bd-d81a-4255-96a0-64235d8dbe60`. Large mirrors visible in the source imagery
are a likely contributor to incorrect inferred surfaces.

Acceptance requires source-view fidelity, novel-view visual inspection, and
temporal stability together. The existing temporal image-change metric is a
diagnostic, not a tracked-motion score. No perfect-realism score is awarded.

The next architectural step is a shared static map plus foreground masks,
cross-view/time correspondences, persistent moving-surface identities, and
occlusion-aware motion fitting. A space-time trail should display selected
foreground moments in their shared coordinates without duplicating the room.
Simply overlaying whole independently reconstructed frames makes ghosts.

Reference: Bilawal Sidhu describes his demo as geolocated video converted to
per-frame Gaussians positioned in space and time. The post does not identify the
depth model, calibration method, training procedure, or prove unseen-view accuracy:
https://www.linkedin.com/posts/bilawalsidhu_space-and-time-reconstructed-in-4d-is-this-activity-7508022505614426113-l1f_
