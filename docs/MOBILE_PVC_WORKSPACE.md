# Mobile workspace and PVC hand correction

## Scope and baseline

Base: `5ab5b276bf6c3412045963a31a77d13de67f7ad6`, integration branch `codex/wheelbarrow-physics`. The original main checkout and unrelated `assets/source-images/` references were not changed. The existing integrated listener is reused at `http://127.0.0.1:5365/Electrical-Game/`; no second preview port was started.

The user's mobile screenshots showed desktop assembly controls, keyboard prompts, an obstructive wheelbarrow panel, a stock placard and absent spring-bending hands. Subsequent references required downward bending, a retrieval lead running through the bore, and a right power grip with the thumb up. A further screenshot correctly identified the first revised forearm as deformed; that intermediate pose was rejected.

## Changes

- Touch assembly uses two rows of actual action buttons below the live hand-held boxes. Side attachment, 1G/2G selection, rotation, undo, reset and placement remain physical gameplay. A touch-release compatibility click is suppressed at the container because reflow could otherwise activate a different attachment button.
- Mobile wheelbarrow stability remains live in a 244 by 58 pixel instrument strip. Fast/release controls stay at the bottom; desktop keyboard labels are replaced in the affected touch workflows. Movement/look pads retain independent touch ownership.
- The black PVC stock placard is removed on both desktop and mobile. Real graduations and marking remain.
- The anatomical worker is now shown during spring work. The held pipe bends down and the camera looks down. Spring coils, the marker and contact positions follow the same transformation; installed pipe recipes keep their existing material coordinates.
- The initial hand-axis constraint could choose a crossed or raised elbow despite near-zero wrist contact error. The replacement solves a natural elbow pole, then fits the palm obliquely around the real pipe. The authored elbow crease follows the bend plane. It preserves bone lengths and neutral wrist alignment without scaling the arms. The working distance is 46 cm, keeping both wrists visible in portrait.
- The retrieval lead starts at the actual spring tail, follows the exact pipe centreline to its open mouth, then hangs with gravity and rests on the floor. It does not use a smoothing spline that can shortcut through the pipe wall.

## Verification

- `tests/mobile-pvc-hands.mjs`: native touch marking, insertion, ten progressive bends, undo/rebend, review and production at 390x680 and 844x390. Both wrists remain visible; grip error below 0.001 mm in the recorded run and neutral wrist deviation below 0.001 degrees. Thumb-up and downward-working-hand assertions pass at 45 and 90 degrees.
- `tests/pvc-arm-review.mjs`: ten desktop bend positions; elbows below shoulder level, right elbow on the right side, retained contacts and neutral wrists. Front and side images inspected. Before/after front images share scene, camera and 1366x768 viewport; pipe working distance changed from 39 to 46 cm. This is an anatomical correction, not a crop of the defective elbow.
- `tests/manual-pvc-ui.mjs`: complete desktop workflow through a 20-pipe batch, fitting, repeated cutting, blocked-lane rejection, placement and transparency passes.
- `tests/pvc-lead.mjs`: bore containment, spring-tail attachment, mouth exit, floor contact and 2 m arc length across marks and bend angles pass.
- `tests/box-hand-assembly-ui.mjs`: desktop and native touch live assembly, history, draft restoration and placement pass.
- `tests/mobile-aligned-controls.mjs`: independent movement/look/held use and cart touch actions pass at four portrait/landscape sizes including 320 and 667 pixel widths.
- `tests/mobile-workspace.mjs`: compact cards, absent stock placard and device-specific hints pass in three layouts. The original no-hands/full-panel captures are in `output/mobile-workspace/before`; those captures precede the separately requested downward camera change.
- `tests/wheelbarrow-grip.mjs`: camera-independent handle contacts and moving-grip regression pass.
- `tests/production-startup.mjs`: compiled WebGPU desktop and WebGL mobile startup, hammer, water and equipment checks pass through the existing 5365 origin, without another server.
- The develop-web-game bundled client passes startup/movement with an inspected gameplay screenshot and text state. TypeScript and production build pass; pre-existing chunk-size/runtime asset warnings remain.

Evidence directories: `output/mobile-pvc-hands`, `output/pvc-forearm-review`, `output/mobile-workspace`, `output/manual-pvc`, `output/box-hand-assembly-ui`, `output/mobile-aligned-controls`, `output/production-startup`.

## Performance boundary

`tests/mobile-workspace-performance.mjs` compares the published baseline `index-CBP1LyQe.js` with the local change in the same warmed WebGL bending scene on Windows Chrome / RTX 5080. The final instrumented run measures CPU submission P95 of 7.4/7.8 ms before and 18.8/19.4 ms after (desktop/portrait). The added worker costs 44/43 draw calls; triangles increase from roughly 0.70/0.62 million to 1.30/1.22 million because the formerly hidden body is now rendered. No sampled frame exceeds 50 ms. The main CPU contributor is anatomical thumb surface fitting, approximately 10.3-10.5 ms P95 per invocation; the pipe solver outside that work is small. The visible anatomical correction is retained rather than hiding hands to reproduce the baseline cost. These host measurements do not establish physical-phone frame rate. Detailed frame peaks, memory observations and renderer counters are in `output/mobile-workspace/performance.json`.

All mobile automation is Chrome touch/viewport emulation on the Windows host, not physical iPhone/Safari performance proof. No generated or retouched image is used as gameplay evidence. Task-attributable account usage and credits are unavailable.
