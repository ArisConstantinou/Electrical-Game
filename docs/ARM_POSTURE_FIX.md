# Spray arm twist and working distance — 2026-09-19

Preview stays on http://127.0.0.1:5365/Electrical-Game/.
Comparison: http://127.0.0.1:5365/Electrical-Game/output/arm-posture/review.html.

## Reproduction and cause

The reported downward-looking spray pose was reproduced before editing. Its arm solve pushed the elbow inward and down, then imposed the palm's full roll on the forearm. The incoming IK-to-palm orientation correction measured 141 degrees. Measured consistently relative to the final upper-arm frame and bind pose, the old forearm roll was 106.7 degrees (121 degrees at the steeper view).

`WorkerBody.setHandOrientation` now reconstructs neutral swing frames from the bind pose on every solve. It shares the required axial rotation between the upper arm and forearm, with a 90-degree upper-arm cap, without accumulating rotation between IK passes. The shoulder, elbow and wrist endpoints and the held-object grasp are preserved by this orientation solve.

The spray elbow target moves slightly outward and farther forward. Looking down, the hand is now 28.7 cm ahead of the eye plane instead of 20.9 cm, and 8.4 cm higher. From the shoulder, forward reach is 46.5 cm instead of 38.6 cm. This changes the actual body/tool posture, not camera FOV or body visibility. The existing grasp, actuator target, index direction and maximum wrist bend remain constrained.

## Validation

- `tests/worker-arm-posture.mjs`: five views (level, down, crouched, steep down, up), actual skin screenshots in first person and from the side. Before/after use identical 1440×900 camera fixtures. `--before` substitutes the archived source module from `output/arm-posture/before/WorkerBody.ts`; no source checkout is overwritten for baseline capture.
- After: down pose upper/forearm roll 53.1/45.7 degrees; steep view 61.0/52.7 degrees. Tests require outward elbow clearance, raised hand position, forward reach, roll bounds and preserved forward index/wrist limits. Original source fails the inward-elbow, lowered-hand and excessive-roll conditions.
- `--motion`: 150 changing yaw/pitch/lateral-velocity frames, 30 warm-up frames. No arm snap: maximum measured local joint step 0.0165 radians after, below the 0.15-radian guard. This is deterministic runtime pose simulation; separate grip regressions use native keyboard events.
- Four spray skin/button/shadow cases pass on WebGL and WebGPU. The thumb and index surface contact tests were retained unchanged. Eighteen tool states and the previous idle/A/D/S/W/stop contact tests pass for both hammer sides and the cordless mixer. These are regression checks, not artistic acceptance of all other tool poses.
- TypeScript/build, whitespace check and bundled web-game client pass. Existing Vite chunk-size and bundled-client module-format advisories remain.
- Sequential desktop diagnostic: Chrome 153, RTX 5080, WebGL, 1440×900. CPU update/render submission p95 9.7 → 8.0 ms; frame p95 10.1 → 8.3 ms; max 12.8 → 9.8 ms; zero samples above 50 ms. Renderer draw calls stay 253, reported allocations about 449.8 MB. Eight triangles / 456 bytes differ between independent scene runs. This short sample establishes no observed regression, not a statistically significant speedup or mobile/GPU-time proof.

## Scope and recovery

Runtime pose correction only; no remeshing, body scale changes or baked-animation/export changes. Current work remains in the dirty isolated `codex/full-body-worker` checkout at base `ec81f1a`. The protected main checkout, server process and fixed port are unchanged. Original source and captures are retained. No commit, push or promotion. Broader character artwork remains an unaccepted sample.
