# First turn into the original work room

The reported PC slowdown happened only on the first turn after START. Base
`d88cc85e5534a2831961dae0bcbb1db1e8cff846` reproduces it: the first turn from
the launch passage creates 23 node shader builders, 12 GPU programs, and uploads
rear-facing masonry/equipment resources. Turning back in the same session does
not repeat those builds. The previous warmup viewed the room from inside it,
missing the rear infill and equipment faces visible from the actual launch spot.

Preparation now includes two views from `[0, 1.65, 5.2]` at the accepted launch
pitch `-0.08`, after the existing route views and before READY. Each uses the
existing yielding/GPU-completion fence. The original spawn, orientation, spray
tool, zero water, crew setting and full framebuffer are restored. Materials,
geometry, shadows, resolution and runtime movement are unchanged.

## Comparable PC measurements

Windows, Intel Core Ultra 9 285K / NVIDIA RTX 5080, Chrome 153, WebGPU,
1718 x 1259 framebuffer at DPR 1, default one apprentice. Serial fresh-browser
production runs use the same native START and 1.5-second turn, followed by a
six-second room hold and a repeat. Simulation remains active. Screenshots are
taken after timing. Saved baseline build and raw reports are retained locally
under `output/` rather than published as large traces.

| Measurement | Before | After |
| --- | ---: | ---: |
| First-turn FPS, matched pair 1 | 57.4 | 79.4 |
| Maximum first-turn interval, pair 1 | 211.7 ms | 18.3 ms |
| New shader builds, turn + first hold | 23 | 0 |
| READY, pair 1 | 11.72 s | 13.00 s |
| First-turn FPS, matched pair 2 | 37.9 | 91.5 |
| Maximum first-turn interval, pair 2 | 251.8 ms | 20.5 ms |
| READY, pair 2 | 12.75 s | 10.66 s |

Startup and FPS vary with host load; the repeatable regression is 23 new shader
builds before versus zero after. Preparation moves work before READY and is not
a promise of a fixed loading duration. The fixed room view still submits about
602 draw calls / 3.61 million triangles and measured about 70-80 FPS in WebGPU.
Its steady render cost remains a separate performance issue.

WebGL also passes the shader/program guard, with a 19.7 ms maximum first-turn
interval. Portrait PC checks at 752 x 1303 preserve startup state and both stair
views. They are not physical-iPhone performance evidence.

## Reproduction and acceptance

Build with `npm.cmd run build`, then run `node tests/start-turn-performance.mjs`.
The test uses the existing port 5365 and intercepts the compiled `dist` files;
it does not start another server or write saved levels. Set `QA_RENDERER=webgl`
for the other backend, `QA_DIST_ROOT` for a saved baseline, `QA_OUTPUT` for a
separate receipt, or `QA_LIVE=1` to inspect the actual listener. `QA_BASE` can
select the deployed game URL. Only owned QA browsers are used; Pointer Lock is
blocked to preserve the user's cursor.

The guard fails on the protected baseline (23 builders instead of zero) and
passes after preparation. It checks the requested backend without fallback,
real submitted frames in every phase, stable GPU program counts, exact startup
state, and absence of runtime/graphics faults. It reports frame timing rather
than asserting a machine-dependent FPS number. `tests/stair-startup-views.mjs`
accepts `QA_STARTUP_BASE` so the same protected build can be compared. The actual
develop-web-game client also exercises normal W movement after the turn.

Local raw receipts: `output/first-turn-production-{before,after}/`,
`output/start-turn-regression-{before,after}/`, `output/start-turn-webgl-after/`,
`output/start-turn-stairs/`, and `output/start-turn-skill/`.
