# Mobile frame stalls, 2026-09-27

The user authorized continuing targeted FPS repairs after supplying a physical
iPhone benchmark: 48.9 mean FPS, P95 39 ms, maximum interval 489 ms and an L3
stair frame of 348 ms. That report predates this candidate. Stable physical
iPhone 60 FPS remains an acceptance criterion, not an established result.

Protected base: `1b1caa7`, existing managed `stairs-fps-20260927/Electrical-Game`
worktree, task branch `codex/mobile-frame-stalls`. The dirty primary checkout is
untouched. Candidate builds use browser request routing on the existing 5365
origin. The integration listener still serves the protected base until final QA.
No agents, dependency installs, paid APIs or model changes. Task-attributable
usage/credits and the active model setting are unavailable. Account usage at
preflight was 7% of the weekly allowance; ordinary subscription usage allowed.

Changes:

- Update world transforms once for a synchronous colour/shadow submission.
  Three r185 enters `render(scene, shadowCamera)` again for the sun. Automatic
  scene updates are restored in `finally`; logical cameras, callbacks, later
  optical submissions and explicit transform policies remain active.
- Cache immutable uploaded masonry transforms' bounds. Combine exact source
  boxes and transformed instance spheres in their original order after
  compaction. Sphere union is order-dependent, so grouping wall spheres would
  be incorrect. Editor rebuilds replace these caches. Actual frustum bounds,
  instances, colours, UV patches, geometry, materials and shadows are unchanged.
- Prepare three specific ground/L1/L3 stair approaches in the existing bounded
  loading sequence. Each one-pixel submission yields and waits for completion;
  room-facing warmups alone missed first-use stair resources. Restore spawn,
  camera, tool, water and visibility before READY. Custom/blank/editor startup
  continues to skip the default-site route preparation.

Initial evidence, Windows Core Ultra 9 285K / RTX 5080, Chrome, touch emulation:

- Actual 752x1303 framebuffer. Exact cached bounds of 29,034 active instances
  across 69 batches; scanning all bounds 10.1-12.4 ms versus cached 2.3-3.2 ms.
  This isolates a CPU operation, not the time of every complete game frame.
- WebGL same operation: 3.6-4.1 ms versus 0.6-1.1 ms.
- Same paused posed courtyard, regenerating identical shadow casters: zero
  differing screenshot pixels on WebGPU. Shadow frames traverse the scene
  once instead of twice. Repeated FPS gains vary; no benefit is asserted for a
  warmed staircase that already reuses its shadow map.
- First cold stair comparison: ground maximum interval 114.6 -> 47.8 ms;
  L3 141.6 -> 22.8 ms. READY 10,072 -> 10,239 ms. No errors; initial state equal.
- Reverse-order cold comparison confirms ground 160.4 -> 53.0 ms and L3
  161.2 -> 24.5 ms. READY 9,930 -> 10,396 ms. This leaves one >50 ms ground
  interval; it does not establish that every first-use stall has disappeared.
- The transform regression fails on the protected production renderer (two
  traversals), passes here, and covers movement, explicit scenes and failure
  restoration. Bounds tests compare exactly with Three's original scans,
  including rotated/scaled instances, empty/reordered membership and frusta.
- Existing frame deadline, GPU encoder/lifecycle, hidden transform, occlusion,
  shadow stability, benchmark metrics and actual building batch/editor checks
  pass. Existing build warnings concern cinematic CSS paths and large chunks.

Raw evidence is in ignored `output/mobile-frame-stalls-*`,
`output/stair-startup-views*`, and `output/stairs-performance/mobile-followup-*`.
The first WebGPU same-page run accidentally read Three's cumulative render-pass
counter for `maxCalls`; those values must not be used as draw-call evidence.
The test now reads the game's actual per-frame draw-call proxy. Separate-process
FPS sweeps show large environment variation and are not causal proof.

Reproduce with `npm.cmd run build`, then `node tests/mobile-frame-stalls.mjs`
(set `QA_BACKEND=webgl` for fallback), `node tests/stair-startup-views.mjs`
(set `QA_STARTUP_ORDER=after,before` for reverse order), and the unit regressions.
The actual develop-web-game client was run and its gameplay screenshot inspected.
The 112-checkpoint normal-controller route feasibility, native stair ascent and
descent/room passage on desktop and touch emulation, masonry demolition and
damage, batch/editor restoration, and all ten editor menu/save/cancel cases pass
with no recorded page errors. Browser ownership/cleanup reports are retained.
Actual WebGL and WebGPU freeze/resume tests also preserve the scene and hose
input/emission state and accept fresh input after waking.
Publication is checked separately after this candidate's acceptance. Stable
physical iPhone FPS remains unverified; use the automatic `/perf/` tour to record
the new deployed asset before comparing it with the supplied old report.
