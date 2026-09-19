# Mortar, box placement and debris follow-up

User confirmed the affected runtime as `http://127.0.0.1:5364/Electrical-Game/`.
Protected comparison: `d8bd3a8`. Work remains isolated on `codex/mortar-mixing-fixes`; the dirty main checkout and public Pages deployment are unchanged.

## Findings and changes

- **Boxes on unbroken masonry:** actual mouse/touch insertion already succeeds on fresh mortar without chasing bricks first. The casing protrudes where intact masonry prevents full recessing. A clear neighbouring group also fits; overlapping rims remain blocked. The blocked preview incorrectly moved back to the wall plane, disguising the real overlap. It now shows the assessed insertion depth, and the HUD identifies box overlap instead of instructing the player to remove material.
- **Persistent brick motion:** downward collision and support detection sampled different parts of the irregular fragment. Support now also checks the same real surface probes used for collision, requiring free space at the original sample and masonry immediately below it. A second defect repeatedly injected sideways velocity because the conservative floor rectangles overlapped. Chamber rest now depends on actual wall contact; floor stacking keeps its existing coverage/overlap rules. Chips on real webs remain stationary and wake when those webs are removed. No forced drop, deletion, new fracture geometry or full mesh-to-mesh physics system was introduced.
- **Delayed mortar and box displacement:** opening changes previously invalidated the entire mortar bed and published only after processing one chunk per frame. Old/new opening regions now invalidate locally. The mesher consumes a bounded portion of the update budget and still publishes coherent generations together, preserving chunk seams. The budget is shared with deposition to avoid stacking meshing work on an expensive impact; it is a soft 8 ms target because an individual chunk is indivisible. A smaller 4 ms budget could still delay a native first impact by six frames, so it was not retained.
- **Second click discarded:** a fresh hold during the previous wrist recovery now charges immediately. A release during recovery retains one queued scoop and its release timing. The physical wrist completes the current cast first. Holding never automatically throws; expiry, cancellation and finite supply behavior remain intact.

## Evidence

`tests/followup-physics.mjs --baseline` loads the protected implementations from `d8bd3a8`; the normal invocation uses the current sources. The browser test uses the same explicit source override for its baseline, matching scene, camera and viewport. Desktop uses mouse down/up; mobile uses native emulated touch.

| Fixed fixture | Before | After |
| --- | --- | --- |
| First press during recovery | Discarded, phase 0 | Charging, phase 0.702 after 40 held frames |
| New deposit first geometry publication | Frame 6 | Frame 3 |
| Native mouse / touch impact publication | 8 / 9 frames after contact | 4 / 3 frames after contact |
| Box displacement first geometry publication on broad bed | Frame 70 | Frame 4 |
| Unsettled fragments above 20 cm after 20 seconds | 16 | 0 |
| Unsupported settled fragments | 0 | 0 |
| Wall-supported fragments still high after their support is removed | 0 | 0, all 50 released |

Reports/screenshots, excluded from Git:

- `output/followup-before/physics.json`, `output/followup-after/physics.json`.
- `output/followup-ui-before/`, `output/followup-ui-after/`: first re-press, empty bed, box after two/four frames, adjacent placement, actual blocked overlap, and debris after 20 seconds. Browser reports contain native impact-to-visible latency and console error lists.
- `output/followup-raf-before/`, `output/followup-raf-after/`: actual RAF profiles, fixed camera, native touch casts, 390 x 844 DPR 3, WebGL. No HMR, source changes or page errors during either measured run.
- `output/followup-production/`: compiled WebGPU desktop and WebGL touch startup; local dist is routed unchanged on the existing 5362 origin, so no server or main source is replaced.
- `output/followup-skill-client/`: bundled develop-web-game client screenshot/state and owned-browser cleanup report. Pointer Lock is disabled throughout automated tests.

## Validation and performance

Passed targeted before/after physics and browser checks, throw timing/queued-release physics, existing throw timing UI, volume conservation, mortar residue stability, atomic mesh/seam checks, box fit and partial seating, debris plate/re-strike checks, cached debris performance, typecheck/production build and compiled backend startup. The previous rough-cavity mortar regression also passed again: 24 finite casts fill every sampled gap around a 2G box in desktop and touch emulation, with stable final geometry and no old moving clods. No test weakens physical box collision to accept an overlapping group.

On this desktop, the 20-second debris fixture update p95 falls from about 2.38 ms to 0.0013 ms once pieces settle; peak from 9.65 to 2.84 ms. The bed fixture peak update is 7.47/16.12 ms for deposit/box before and 8.62/14.45 ms after. The mesher trades a small amount of work per update for shorter publication latency.

Three native RAF casts measured 219-227 FPS before and 213-222 FPS after; ready-state p95 frame intervals were 6.0-6.3 ms and 5.9-6.1 ms. Maximum simulation CPU per cast was 22.1/36.3/50.7 ms before and 23.6/35.7/47.4 ms after. Impact/field-deposition spikes remain; this is not a claim of stutter-free play. No graphical quality or field resolution was reduced. Live host inspection confirmed an Intel Core Ultra 9 285K, Intel Graphics and RTX 5080; viewport emulation is not phone hardware performance or physical iPhone/Safari evidence.

The pre-existing historical byte-comparison failure in `mortar-mesh-performance.mjs` is documented in the preceding six-issue report. This follow-up changes invalidation/scheduling, with functional field conservation and seam checks passing. Vite retains its large-bundle advisory. The small Vite middleware plate test passed its assertions but logged an asynchronous dependency-scan shutdown warning.

At the verification milestone on 2026-09-19, account limits reported ordinary subscription usage allowed, 2% weekly used and no paid-credit balance. Those shared-account values cannot be attributed to this task; task usage and credits are unavailable.
