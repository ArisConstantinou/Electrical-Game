# Mortar and tool regression report — 2026-09-19

Request: fill irregular brick gaps, stop unjustified PERFECT-cast loss, stop rotating/flickering residue, stop the held hand/trowel twisting near sand, show shovel-sand actions across the sand pile, and start with an empty wall trowel.

## Delivery boundary

- Preview: http://127.0.0.1:5364/Electrical-Game/
- Checkout: `C:/Users/arz0r/.codex/worktrees/mortar-mixing-fixes/Electrical-Game`
- Branch: `codex/mortar-mixing-fixes`; starting commit `1f8c2a5`.
- Reused the existing Vite listener, PID 33284, whose command line identifies this checkout and strict port 5364.
- Main checkout remains at `27361e8` with its pre-existing modified Game, BoxFitPreview, MixingStation, MortarSystem and tests, plus untracked artifacts/tests. No files in that checkout were edited by this task.
- This branch already included corrected exact-camera station raycasts, actionable shovel prompts, fixed contact-frame residue and wider finite PERFECT footprints. Those fixes were retained and verified here.
- No merge or public deployment is included. The build was checked locally through browser routing to unmodified `dist` files.

## Findings and changes

| Report | Evidence and result |
| --- | --- |
| Irregular gaps | Baseline small-cavity native test failed on mobile emulation: four casts left only 82.9% of sampled columns flush. Tiny clay/mortar contact facets incorrectly reduced a sighted transfer. PERFECT retention now also considers approach to the receiving wall. Native small-cavity regression passes; the larger impact-cut cavity around a 2G box reaches every sampled accessible column, in both layouts. |
| PERFECT mortar falling | Empty dry-wall tests retain 1.949999 kg of three 0.65 kg casts, with no visible floor clod. The first eight casts into the large box recess lose under 0.002 kg total. Capacity, casing obstruction, poor batches, water and weak/glancing casts still apply; timing does not give unlimited storage. |
| Flicker / rotation | Existing fixed contact orientation retained. Contact regression reports zero rebound rotation. Actual fractured-wall residue settles within the bounded simulation, with no old airborne clods. Box-gap test compares all settled mesh positions before/after a further two seconds; they remain identical. Atomic mesh publication test passes. |
| Held-tool rotation | World-axis shortest-arc wrist orientation could flip when the camera turned around. Rotation now uses the camera frame, with a continuous carry/work blend and unchanged arm lengths. Full yaw sweep maximum adjacent change fell from 0.879/1.097 radians to 0.028/0.042 radians, desktop/mobile. |
| Shovel sand prompt | Existing actionable targeting passes five sand aim samples from one camera position, a native scoop, immediate look changes and incompatible-tool checks. Visible action is `E · ΠΑΡΕ ΜΙΑ ΦΤΥΑΡΙΑ`; no mixing-trowel pickup over those sand samples. |
| Initially full trowel | Visible load now queries ready finite supply without consuming it. Fresh/unmixed and depleted batches show an empty blade; a prepared batch shows the load. Reservation still occurs once at physical release. |

## Verification

- `tests/trowel-supply-view-ui.mjs`: desktop/mobile startup, prepared batch, depletion, 361 yaw samples and screenshots.
- `tests/mortar-box-gap-ui.mjs`: real deterministic clay impacts, visible 2G box fixture, fixed perimeter targets, 24 finite native casts, complete sampled fill, conservation and stable final geometry. Sixteen casts still showed progressive filling, not a plateau; a third fixed pass supplies the remaining volume.
- `tests/mortar-residue-stability.mjs`: 12 ordinary casts into real fractured masonry plus 20 seconds of settling; no indefinite contact loop.
- Existing native small-cavity, PERFECT casts, actionable prompts, full immersive preparation (desktop/portrait/landscape), contact stability, atomic mesh, volume conservation, batch supply and throw-timing checks passed.
- Typecheck, production build and unmodified compiled WebGPU desktop / WebGL mobile startup passed, including hammer/hose interaction and no page errors.
- Bundled develop-web-game client ran with a Pointer Lock guard, produced gameplay state/screenshot, and closed all owned browser processes.
- Visual artifacts were opened and inspected. Mobile evidence is Chromium touch emulation, not a physical iPhone/Safari claim. Geometry remains the existing 8 mm scalar-field approximation.

## Evidence files (local, excluded from Git)

- `output/trowel-supply-view-before/` and `output/trowel-supply-view-after/`: matching carry-view screenshots, supply state, and yaw samples. Initial after screenshot waits for the start-overlay fade; the earlier initial screenshot includes that transition.
- `output/six-issues-before/`, `output/six-issues-after/`: seeded small-cavity native contact/fill reports and frame sequences. Final filled images can contain different scoop counts; compare report quantities, not image area alone.
- `output/mortar-box-gaps/`: excavation and fully filled box perimeter; `report.json` records quantities and stability.
- `output/mixing-actionable-prompts/`: sand prompts and native interaction results.
- `output/six-production/`: compiled backend checks.
- `output/six-issues-performance/`, `output/six-issues-performance-before/`, `output/trowel-pose-stability.json`: actual RAF profiles and focused pose comparison.
- `output/*final.log`: build/test command logs.

## Performance and limitations

Focused identical pose benchmark: 0.167 ms baseline versus 0.189 ms current, with zero normal rebuilds. The change adds approximately 0.022 ms per pose in this run. Full RAF timing is a separate browser measurement, not a mobile hardware result. Test host reports an Intel Core Ultra 9 285K, Intel Graphics and NVIDIA GeForce RTX 5080; browser tests use Chromium, including portrait 390×844 at DPR 3.

Matched three-cast RAF measurements, using original `1f8c2a5` FPSRig/MortarSystem modules as the baseline: baseline 211.9–221.5 FPS, current 204.5–223.2 FPS. Maximum per-cast simulation CPU times were 22.7/35.8/49.3 ms before and 19.8/37.0/56.9 ms after. Normal ready/prepare stage p95 frame intervals remain around 5.8–6.9 ms; impact/follow-through peaks remain present in both versions (worst stage p95 50.4 ms before, 57.6 ms after). This is a short benchmark, not evidence of stutter-free play or phone performance. No HMR/source changes or browser errors occurred during either run.

The known pre-existing `mortar-mesh-performance.mjs` historical byte-comparison failure is recorded in the preceding progress entry; this task does not edit MortarField or change that test to conceal it. Current functional volume and atomic-geometry checks pass. Production build retains its existing large-chunk advisory.

Task-attributed subscription usage and credits are unavailable. Account limits were read at the verification milestone: 1% weekly used, zero paid-credit balance, ordinary subscription use allowed. That shared-account reading cannot be attributed to this task.
