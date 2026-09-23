# Reconstruction direction — September 22, 2026

**Keep Gaussian splatting as a rendering/output option. Benchmark stronger geometry
and world-model backends against recorded evidence. Prioritize offline replay before
live reconstruction.** A world model and a Gaussian renderer occupy different parts
of the system; choosing one does not require abandoning the other.

## What World Labs currently documents

World Labs' September 1 Atlas announcement describes multi-image reconstruction,
explicit point-cloud/Gaussian outputs, and video reframing from three to five camera
views. Its page offers early access and says Atlas will power future products. It
also explicitly describes imagining missing regions. These are promising vendor
demonstrations, not a benchmark on this room or proof of faithful live reconstruction
at our required latency. [Atlas announcement](https://www.worldlabs.ai/blog/atlas)

The public World API quickstart currently documents Marble 1.1 world generation from
text, images, multiple images and video. Requests return operations that clients poll
until completion. The documented flow is asynchronous world generation; it does not
establish a live, synchronized dynamic-scene reconstruction endpoint. No Atlas API
integration or account access has been assumed here.
[Official API quickstart](https://docs.worldlabs.ai/api)

Marble's use of splats and World Labs' Spark renderer also mean that improved world
generation is compatible with a splat viewer. Spark 2.0 documents streaming and
level-of-detail rendering for large Gaussian scenes. Those techniques address
delivery/rendering cost; they do not make incorrect geometry correct.
[Spark 2.0](https://www.worldlabs.ai/blog/spark-2.0)

## What to transfer into this lab

Atlas describes a spatial context containing observations and explicit geometry,
with camera-conditioned view/depth generation. The useful architectural lesson is
to keep poses, depth, observed images and generated completion distinguishable.
Its published descriptions do not give us its private weights, training data or
full training recipe. Reconstructing our captured room is a different evaluation
problem from producing a plausible new world.

This shipment generalizes joint geometry, cross-view visibility checks, appearance
optimization, evaluation and camera exports to all selected views. It also adds a
memory-only periodic geometry draft, with processing latency shown separately from
viewer frame rate. These are local engineering changes using the existing VGGT
and gsplat stack; they are not an implementation of Atlas.

Spark's global ordering, bounded memory and progressive detail are useful delivery
patterns if our scenes become too large. Our viewer already sorts a common splat
set in a worker. Adding a new renderer would not correct inaccurate source geometry.
Do not replace capture evidence with invented hidden walls to improve a coverage score.

## Easier first target

Offline **3D model replay** is the more achievable engineering milestone here.
Processing can use future frames, optimize longer, align timing, evaluate results,
and retry poor segments before viewers see them. Live 4D capture adds a sustained
compute and latency constraint while still needing synchronization, calibration,
coverage, and temporally consistent moving geometry. Fast rendering of a completed
scene is not the same as fast reconstruction of new observations.

The present app reconstructs independent time samples, not a persistent deforming
4D model. More detail or more splats does not remove that limitation.

## Practical order of work

1. Preserve each experiment, source angles, settings, every output sample, scores
   and comparison images. This is now implemented locally.
2. Test geometry and appearance changes against the same inputs. Occlusion-aware
   geometry, structural loss, and decaying position updates are implemented; the
   new source-fidelity report grades exported files instead of optimizer tensors.
3. Add measured lens/rig calibration and exposure alignment. Reserve an independent
   reference camera for novel-view tests rather than training on every available view.
4. Separate the static room from moving subjects and add temporal correspondence.
   Benchmark motion boundaries, missing limbs, flicker and occlusion; avoid letting
   a static background's good score hide poor moving-subject reconstruction.
5. With Atlas access, or another compatible backend, run the same offline captures
   and held-out tests. Require exportable geometry/replay, timing information,
   repeatability and measured latency. Treat generated completion as its own labeled
   layer; plausible invented surfaces must not count as observed capture coverage.
6. Only after offline results pass, measure incremental reconstruction on the target
   PC. Report capture-to-display latency and sustained throughput separately from
   viewer FPS. Consider splat LOD/streaming once scene size actually limits rendering.

No private footage was uploaded and no paid external generation was started for
this review. The local experiment system remains usable without a cloud account.
