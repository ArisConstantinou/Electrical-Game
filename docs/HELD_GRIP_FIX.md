# Held-tool contact during locomotion — 2026-09-19

Preview: http://127.0.0.1:5365/Electrical-Game/

Review: http://127.0.0.1:5365/Electrical-Game/output/mixer-anatomical-contact/review.html

## Confirmed defect and change

The supplied screenshots show the demolition hammer's auxiliary handle. The visible mixing toolbar initially suggested the cordless mixer; both tools were subsequently reproduced and tested.

The previous locomotion code turned the entire skeleton about 76 degrees into fast lateral travel while keeping the tool in camera space. This moved the shoulder beyond the arm's fixed reach. Separately, a tilted palm basis skewed the knuckle row relative to the cylindrical handle. With the auxiliary handle on the opposite side, a fixed clavicle left an additional 26 mm reach deficit even at rest.

`WorkerBody.ts` now keeps loaded shoulders facing the tool during lateral steps, projects the palm's long axis perpendicular to the handle, and allows the clavicle to protract/elevate only as needed, capped at 25 degrees from rest. Bone lengths remain unchanged. The existing directional foot placement and spray-specific grasp remain in place.

## Evidence

- Original source retained at `output/mixer-anatomical-contact/before/WorkerBody.ts`; baseline browser requests substitute its compiled module while preserving the same current assets and fixture.
- Right-side auxiliary grip: baseline idle reach error 25.7 mm, right strafe 149.8 mm. Final samples are below 0.001 mm numerically. These are wrist-target IK measurements, not claims of submillimetre skin accuracy.
- `node tests/mixer-anatomical-contact.mjs --hammer --swapped`: idle, A, D, S, W, plus release/deceleration after each case; every sampled frame requires wrist contact within 5 mm. Finger segment positions must remain in their transverse handle plane within 3 mm. Also passes default hammer side and cordless mixer.
- `--webgpu` right-side hammer case passes. Default tests force WebGL. Real keyboard events feed the actual game step; Pointer Lock is blocked for desktop safety.
- Runtime screenshots inspected from first-person, close-up and reverse hand view. Before/after use the same 1440×810 viewport, camera, tool side and input duration. Procedural tool sway can have a small phase difference between browser launches. The reverse close-up is an additional inspection angle, not a replacement for the first-person comparison.
- 18 worker tool states, 15 directional gait cases, four spray grip/shadow states, bundled web-game client, TypeScript/build and diff whitespace checks pass. Existing Vite large-chunk advisory remains.
- Sequential headless desktop Chrome 153 / RTX 5080 / WebGL sample, 90 measured frames after warm-up: CPU update/render submission p95 6.6 → 6.1 ms, frame p95 7.5 → 6.7 ms, maximum 8.3 → 7.5 ms, no frames above 50 ms. Same 522 renderer-reported draw calls, 812,839 triangles and 434,704,091 bytes reported allocations. This is a short stationary held-tool desktop comparison, not GPU timing or physical-phone evidence; it does not establish a statistically significant speedup.

## Boundary and recovery

Only this runtime grip correction, its diagnostic test, progress notes and this document were added in this follow-up. The isolated `codex/full-body-worker` checkout remains on base `ec81f1a` with pre-existing dirty work preserved. Main checkout and port configuration were not modified. No commit, push or promotion was performed. Broader character artwork remains an unaccepted sample; this correction does not claim that every hand pose or asset is artistically finished.
