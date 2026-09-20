# Gang-box casing grip and scale — 2026-09-20

Preview: http://127.0.0.1:5365/Electrical-Game/

Checkout: `worker-box-integration/Electrical-Game`, branch `codex/worker-box-integration`. Baseline `8e0c26c`; main and the original worker checkout were preserved. No new model assets, dependencies, generated images or paid tools.

## Reproduced faults

- Straight wrists did not guarantee upright casings: the previous shoulder solver tilted the whole hand/box unit by 30 degrees at level aim. The new contact regression fails on that baseline.
- Box fingers wrapped around an imaginary handle. The old shared flex axes also contained rotation along the finger bones; the little finger's proximal longitudinal component was approximately 0.53. This produced unwanted twisting during curling.
- The next box was scaled to 68%; the assembly started at 72% and shrank further as it grew. The hand stayed full size.

## Change

- Box orientation stays fixed relative to the view while the shoulder/elbow place the rigid forearm–hand–box unit. Manual candidate quarter-turns remain available.
- Calibrated palm clearance permits thumb contact inside the side wall and index/middle contact outside. Ring/little fingers fold toward the palm. Box finger flex axes are perpendicular to each bone's length. Joint angles remain bounded; bone lengths and translations are unchanged.
- Both held roots retain unit scale. Existing casings remain 74 × 74 × 37 mm (1G) or 134 × 74 × 37 mm (2G), matching placed geometry. Arm fitting handles the framing instead of shrinking the object.
- Changes are confined to fitting poses. The shared solver's optional rotation lock defaults off for other tools; spray retains its existing path.

## Visual evidence

Same 2076 × 641 viewport, camera and six-box fixture; original captures are unedited. Lighting/shadows respond to the changed pose. The transient help notification can differ with load timing.

| View | Before | After |
|---|---|---|
| Straight | [Before](../output/box-grip-before/straight.png) | [After](../output/box-grip-contact-final/straight.png) |
| Down | [Before](../output/box-grip-before/down.png) | [After](../output/box-grip-contact-final/down.png) |
| Up | [Before](../output/box-grip-before/up.png) | [After](../output/box-grip-contact-final/up.png) |

[Nine-box desktop assembly](../output/box-grip-ui-final/desktop-built-puzzle.png) · [Two-box portrait assembly](../output/box-grip-ui-final/mobile-built-puzzle.png).

## Validation

- `box-grip-contact`: 15 cases, both hands; single 1G, six-box assembly and quarter-turned 2G; straight/up/down/left/right. Casing tilt 0 degrees, three contact-pad targets within 3 mm, unchanged bone translations and bounded finger flexion.
- `box-wrist-stability`: 12 desktop/portrait camera poses and two 91-frame sweeps. Maximum wrist bend below 0.001 degrees, maximum consecutive hand rotation 1.785 degrees, reach residual below 0.001 mm.
- `box-hand-assembly-ui`: nine modules on desktop, two in portrait; contextual inputs, quarter-turns, viewport bounds, placement, reset, Esc and draft preservation pass.
- `box-escape-pointerlock`: unlock without keydown, settings, inspector, key-only Esc, normal Esc and re-entry pass. OS Pointer Lock is blocked; events are emulated.
- `fitting-held-preset`: casing geometry, sizes, rebuilds and close-wall clearance pass (38 mm).
- `grasp-frame-motion`: the existing driver grasp passes 360 camera/movement/crouch frames, with no hidden wrist or lost contact. One run was invalidated by Vite reload during a comment edit; the unchanged test passed after source edits stopped.
- TypeScript/production build pass; pre-existing large-chunk warning remains. Bundled web-game client completed and its spray screenshot was inspected.

Comparable short headless Chrome 153/WebGL samples, 24 reported logical cores, 40 measured frames after warmup:

| Viewport | CPU submit median before/after | CPU submit P95 before/after | Frame P95 before/after | Draw calls before/after |
|---|---|---|---|---|
| 1440 × 900 | 6.1 / 6.9 ms | 11.6 / 8.4 ms | 12.2 / 8.8 ms | 64 / 64 |
| 390 × 844 | 6.9 / 7.1 ms | 11.1 / 8.8 ms | 12.0 / 9.4 ms | 63 / 63 |

Evidence: `output/box-grip-performance-before/report.json`, `output/box-grip-wrist-final/report.json`. These are CPU submission/frame samples, not GPU timings, whole-game guarantees or physical mobile measurements. Small median differences are not evidence of a user-visible regression.

This validates the reported gang-box issue. The earlier all-tool anatomy/garment work remains incomplete; this is not an all-tool release or approval to promote unfinished anatomy work to main.
