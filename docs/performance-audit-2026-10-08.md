# Desktop/mobile performance and wall contact audit

Base: `2f1b4b76d13bbee6b07b4bb02dba2a1383985e36`. Candidate branch:
`codex/performance-wall-contact`. The protected integration listener remains on
`http://127.0.0.1:5365/Electrical-Game/`; candidate production files are intercepted
on that same origin by the browser QA harness. No additional game server is used.

## Findings and retained fixes

- The 2560×1440 display reports 60 Hz. Lighter scenes approach 60 FPS; five
  apprentices increase CPU transform/rig and draw-submission work. A matched
  four-scene production comparison measured the demanding work room at
  48.9/51.6 FPS before and 50.6/53.0 after, with step CPU
  14.6/13.5 ms before and 13.3/12.0 ms after. A separate dry-scene GPU timestamp
  was about 1 ms; it does not include CPU/driver or wet-scene cost.
- `MansionMasonryDemolition.aim` selected an empty facing brick after its shaft
  cut cleared, although the ray still reached neighbouring material. It now
  queries actual clay/joints through bounded row intervals, respects world reach
  under nonuniform scaling, and retains at most 32 lightweight pristine volumes.
  Same damaged fixture: the old query returns no contact; the repaired query
  reaches brick 292. A separate 20-strike reproduction advances 78→694 removed
  nodes. Tool grip, clearance, energy, and range remain unchanged.
- Four rigs loaded after READY were missing the existing hidden-transform
  preparation. Invalidating material preparation after `crewReady` registers
  their loaded trees. Each hidden rig now performs zero stowed-child traversals
  instead of one per camera update. All five workers and their appearance remain.
- Water Pro constructed an unused ocean SpraySystem atlas and captured temporary
  sunset/ocean settings before applying the room configuration. CPU profiling
  found about 5.2 seconds in Canvas2D readback. The scoped room factory skips the
  unused atlas and that unpublished capture, restores both method seams on
  completion/failure, and preserves unrelated renderers, offscreen FFT draws and
  cameras. The first normal optical update captures the configured room. The
  existing disabled ocean billboards are separate from the actual hose stream
  and iWave impacts. The compiled room component was regenerated from the
  existing licensed Water Pro 3.5.1 SDK; its license/banner are preserved.

## Coverage and results

- Original full tours: 828/828 checkpoints, 24 rooms / 30 spaces; original
  seven-profile full matrix: 448 samples. This original matrix is development
  runtime and must not be treated as the same production A/B below.
- Wall/crew production matrix: seven profiles × four scenes × two sweeps =
  56 normal-simulation samples. Desktop WebGPU/WebGL; touch portrait and
  landscape WebGL; Android-UA WebGPU; tablet; 4× CPU-throttled WebGL.
  The water-only lazy module was subsequently changed. Its final build was
  checked separately with native tool use, water optics and controlled resume.
- Wall/crew/water production matrix before the later idle-pose change: all 32 authored scenes × seven
  profiles × two normal-clock sweeps = 448 samples. This additional matrix uses
  runtime source commit `902bb62e065529fba259fc374382145cfdb6000b`, including the
  retained wall, crew and water changes. Profiles execute serially, with five
  apprentices; other user applications remain open. It is separate from the
  original development-runtime matrix and from the four-scene production A/B.
- 64/64 native mouse/touch wall positions remove material; full-depth work-wall
  shaft tests clear the complete 100 mm probe on both platforms.
- Neighbour material query: 54 comparisons across both faces, offsets, rotations
  and nonuniform scales against an exhaustive material oracle, plus reach and
  deleted-brick rejection. The new query and crew regressions pass on the final
  water-enabled release build.
- Current hand-selection checks, 24 body poses and two transitions, free-look
  logic, renderer transforms/recovery, 14 spray cases and shallow chase pass.
- Water UI regression: eight large atlas reads before, zero after. Same native
  desktop fixture measures a final first-use gap of about 3.05 s; touch WebGL
  emulation measures 8.69 s. Separate previous native samples had roughly
  5.5–5.8 s desktop and 13.3–13.5 s WebGL gaps. Cold shader initialization still
  stalls and is not claimed eliminated. Independent repeat tool measurements are
  retained in the local report, including their potentially different gaps.
- Six fixed-depth optical scenarios pass before/after: moving FFT waves,
  centimetre-scale displacement, normals, volume/geometry agreement, mass
  conservation, optical reflections, submersion, and no unsolicited normal-frame
  ocean readback. Native hose tests additionally verify actual nozzle attachment,
  filling, conservation and held-input release. No resolution, SSR step count,
  wave geometry, shadows, assistants or optical quality were reduced.

### Full wall/crew/water production results

Each FPS minimum is the lowest whole 3-second sweep average. The median is over
64 sweeps, and each p95 belongs to an individual sweep. Submitted triangles and
draw calls include recorded rendering passes; they are not unique asset counts.

| Profile | FPS minimum / median | Worst p95 ms | Maximum frame gap ms | Sweeps below 30 FPS |
|---|---:|---:|---:|---:|
| Desktop 2560×1440 WebGPU | 50.7 / 60.0 | 30.2 | 221.9 | 0/64 |
| Desktop 1920×1080 WebGL | 52.3 / 60.0 | 36.6 | 248.8 | 0/64 |
| Android portrait WebGPU emulation | 40.3 / 60.0 | 66.7 | 152.6 | 0/64 |
| Touch portrait WebGL emulation | 50.5 / 60.0 | 33.6 | 110.4 | 0/64 |
| Touch landscape WebGL emulation | 29.0 / 60.0 | 100.0 | 164.9 | 1/64 |
| Touch WebGL with CPU ×4 stress | 4.2 / 13.3 | 483.7 | 645.0 | 64/64 |
| Tablet WebGL emulation | 44.0 / 60.0 | 63.9 | 107.6 | 0/64 |

All 448 samples have nonzero actual rendered frame counts, five apprentices and
no page, console or renderer errors. This is execution validity, not a performance
pass. The CPU ×4 profile is inadequate for smooth gameplay. Unthrottled profiles
also contain local spikes; a median near 60 FPS must not hide them. The first
landscape work-room sweep averaged 29 FPS and its second 54.3 FPS. In Android
WebGPU the B2-service pair averaged 59.1 / 40.3 FPS. These variations were observed
with other user applications still open; no clean disable experiment established
which application, garbage collection or other external activity caused them.

Across the final route, renderer counters reach 893 draw calls and 7.21 million
submitted triangles on desktop; unthrottled touch profiles reach 736–806 calls
and 6.16–6.31 million submitted triangles. JS heap samples range approximately
413.7–774.5 MB across all profiles. Those route bounds are not a physical phone
memory measurement and do not establish or exclude a leak. The raw reports retain
per-scene CPU spans, long tasks, geometry/texture counts, heap samples and GPU
identification. The separate final dry-room GPU timestamp probe measured a mean
of 0.914 ms across 40 samples, with p95 0.983 ms. It is not total frame latency or
proof about active wet rendering.

`full-production-summary.json` lists the five worst sweeps per profile;
`post-repair-full-matrix.json` records all seven completed jobs. The interactive
report exposes all three distinct matrices and was checked at desktop 1440 px
and portrait 390 px: all 21 dataset/profile selections, no viewport overflow and
all local report links accessible.

### Additional guarded idle-crew catch-up repair

Slow frames perform up to five bounded simulation steps before presenting one
image. Four idle additional workers previously solved their complete skeletal
hierarchies on every step, despite having no assignment or visible tool rig.
`Game.step` now passes presentation intent through `ApprenticeSystem` to those
crew members. `WorkerBody` advances each original clock, gait phase and blend
increment, and defers idle bone/IK work until the presented state. Assigned crew,
the lead hammer carrier, active grips and work stations retain every full pose.
Five workers, all models, shadows and physical contact cadence remain.

The broad initial attempt to defer active grasps was rejected. A properly reset
comparison exposed history-dependent grip differences; the accepted guard never
defers those inputs. The regression's strict pose tolerance was not loosened.
The final regression passes 24 pose/state comparisons across desktop and touch,
including forward, reverse, lateral and low poses with a hidden rig: zero
measured final skeletal or temporal difference. In a 0.213 s catch-up fixture,
all five actors receive all five physics updates. The four idle crew perform one
complete pose each; the lead carrier performs five. An assigned reachable cutter
performs all five full poses, advances its cut timer by 0.213 s and invents no
stock receipt. The same regression fails before the change with 16 intermediate
hierarchy updates per idle body.

CPU ×4 ABBA, two fresh contexts per source and the same four scenes:

| Scene | Mean sweep FPS before / after | Apprentice CPU ms before / after | Apprentice CPU reduction |
|---|---:|---:|---:|
| G-work | 7.04 / 7.76 | 8.33 / 6.80 | 18.3% |
| L1-main | 10.37 / 10.61 | 7.93 / 6.70 | 15.5% |
| B1-service | 11.39 / 12.55 | 7.63 / 6.40 | 16.2% |
| stairs-ground | 12.61 / 12.94 | 7.56 / 6.49 | 14.2% |

These means are over whole sweep averages and are not pooled frame intervals.
The relative CPU reduction is limited to the apprentice subsystem. It is not a
global frame-time reduction or a physical phone result. The desktop WebGL control
remains near 53–54 FPS in G-work and 60 FPS in the lighter three scenes.

The additional build has a full 32-scene CPU ×4 route and representative
four-scene checks for the other six profiles, including the desktop control.
Its full stress route still has a 12.65 FPS median and a 2.90 FPS worst sweep;
all 64 sweeps remain below 30 FPS. Median uses the mean of the two middle sweep
averages. The later full baseline replay gives a 13.95 FPS median and 4.46 FPS
worst sweep, also with all 64 below 30. Whole-route improvement is not established.
The runtime toggle diagnostic is preserved separately: the original full-pose
cadence and guarded deferral run in ABBA order in one context. Its first sweep
still includes cold work after fixed-yaw warmup; later B2/A2 pairs retain the
apprentice CPU benefit but also vary. The data do not establish the cause of
every large spike. No hidden downgrade or global 60 FPS claim is made.

Both native hammer-hold regressions pass on this build: two-hand carry, walking,
20 PVC cuts and conservation, cutter visibility, construction cancellation and
rehold, wall demolition and zero-crew visibility. The five-worker legacy test
completes 20 socket and 20 switch cuts with length conservation on both sources,
then fails identically at its obsolete `paper.visible === true` assertion.
Current `ApprenticeSystem` opens the drawing panel and keeps that old world-paper
object hidden. The original legacy assertion and failed logs are preserved;
they are not reported as a passing full script. Separate current-panel checks
pass on desktop and touch: all three authored drawing tabs load their real SVGs
and `paper.visible` stays false. The mobile route first opens the worker bar,
then COORDINATOR and the plan action. Two diagnostic attempts that selected
hidden entry buttons are preserved; no gameplay/UI change was made to bless them.

Evidence: `idle-pose-before/`, `idle-pose-after/`, `idle-pose-performance.json`,
`idle-pose-summary.json`, `idle-pose-toggle/`, `idle-coverage-*`,
`idle-full-baseline-mobile-cpu4-webgl/`, `idle-coverage-summary.json`,
`current-drawing-panel/` and `idle-pose-validation.json`.
The earlier 448-sample full matrix remains evidence for runtime `902bb62`,
not an unchanged-source claim for the later guarded idle-pose build.
The installed develop-web-game client also runs two real hammer/movement loops
on the guarded production build with five workers; screenshots, state and owned
browser cleanup evidence are retained in `skill-client-idle/`. The review checks
all 28 dataset/profile selections at 1440 and 390 px without viewport overflow.

### Remaining first-use shader stall

A new CPU profile of the retained build confirms the unused Canvas2D reads are
gone. WebGL still spends about 6.6 s in measured synchronous render-pipeline
waits: roughly 1.94 s for 128×128 cube draws, 4.64 s for the room colour/capture
size and 0.06 s for FFT draws. The capability check reports
`KHR_parallel_shader_compile` available. Local installed Three.js 0.185.1 uses
that path when pipeline promises are supplied by `compileAsync`; ordinary render
calls still perform completion queries. Inclusive CPU stacks overlap and must
not be added to those timing totals.

One bounded experiment precompiled the six actual cube faces and configured room
using the matching render-target/camera state. The
[official Three.js Renderer API](https://threejs.org/docs/pages/Renderer.html#compileAsync)
describes asynchronous scene compilation. In the matched native WebGL fixture,
the experiment reduced the longest browser task from 5704 to 2083 ms but increased
the total presentation gap from 8.92 to 9.22 s. The world remains paused during
the factory task. Desktop WebGPU stays near 3.1 s. The experiment was rejected;
only its source, isolated build and measurements remain in the ignored artifact
folder. Runtime source and generated component were restored exactly to the
retained commit. No dependency update or optical downgrade was used.

Raw evidence: `water-cpu-current/`, `shader-baseline/`, `shader-async/` and
`shader-compare.json`. CPU-profiler timings are distinguished from native UI
timings without profiler overhead. A smaller individual long task does not prove
responsive gameplay when the whole presentation remains paused.

The raw profiles, comparable screenshots, failures, normal-clock tool timings,
and interactive report are preserved under the ignored
`output/performance-repair-20261008/` directory in the candidate checkout.
Controlled-clock functional screenshots are not FPS measurements. Fixed-volume
optical screenshots use paused gameplay but real optical frames; dynamic wave
phase differs between screenshots.

## Reproduction

Use the existing lockfile-installed dependencies and the sole project origin.
Set `QA_DIST_ROOT` to an isolated production build to test that build instead of
the live source. Set `QA_OUTPUT` / `QA_MANAGED_OUT` to an ignored artifact folder.
Run GPU-heavy cases serially. The managed runner requires the installed
`develop-web-game` lifecycle helper under `CODEX_HOME` (or the user's `.codex`).

```powershell
npx.cmd tsc --noEmit
node tests/room-water-construction-policy.mjs
npx.cmd vite build --outDir output/performance-candidate
$env:QA_DIST_ROOT = (Resolve-Path output/performance-candidate).Path
node tests/mansion-neighbor-contact.mjs
node tests/apprentice-render-preparation.mjs
node tests/water-first-use-ui.mjs
node tests/managed-game-regression.mjs tests/water-pro-waves.mjs
node scripts/performance-audit-profile.mjs desktop-1440-webgpu --dist $env:QA_DIST_ROOT --scenes G-work,L1-main,B1-service,stairs-ground
```

Regenerating `src/generated/room-water-runtime.js` is optional maintainer work
with the already licensed SDK via `tools/build-room-water-runtime.mjs`. Ordinary
build/CI consumes the compiled component and needs no SDK installation/download.

## Limits and preserved failures

**Confirmed drainage defect:** the current `RoomWaterField` models a closed
rectangular floor. Its neighbour fluxes never leave that rectangle; it has no
door, sill, perforated-wall or connected-room boundary input. The authored
original-room rear passage is open at floor level, and its west window sill is
about 1.05 m. Consequently even native filling is not a realistic open-building
flood model. The 1.8 m optical images were deliberately injected diagnostic
volumes, not native hose outcomes, and must not be shown as natural flooding.
The new performance integration preserves this existing field; it does not
repair drainage. Correct drainage needs actual floor/opening connectivity,
height-aware sill/shaft outflow and accounting for water transferred or escaped.
Closed-field conservation is not proof of those behaviours. This finding arose
from the user's screenshot review and remains a required functional decision
before treating the water system as physically correct.

Mobile results are desktop Chrome emulation on a Core Ultra 9 285K / RTX 5080
machine with about 64 GB RAM. They are not physical iPhone/Safari or Android
performance, thermal, RAM or operating-system resume evidence. Renderer resource
bytes are not externally measured VRAM; allocation growth during first wet use
alone is not a leak diagnosis. Weekly usage/credits attributable to this task
are unavailable.
The installed browser inventory has no Playwright WebKit or Firefox executable;
ADB is not on PATH, and the connected-device check identified no phone test
transport. No browser/device runtime was downloaded or installed. Therefore
physical iPhone/Safari and Android checks remain unverified.

Legacy wall-hug (0.46 m), bilateral setting (-15 versus 15), and the later
procedural mansion-action fixture fail identically on the protected production
baseline and candidate; they were not relaxed. Current clearance/hand/shaft
contracts pass. Legacy mobile strafe/free-look scripts contain hidden/ambiguous
selectors; their failures are retained alongside current native control checks.
A missing cleanup-report directory in an early run was repaired in the managed
runner and the functional test rerun successfully with no owned browser left.
Two broad transform-cache experiments and a global atmosphere experiment were
rejected because their matched timings did not show stable benefit.

This candidate is not a promoted release. The sole live integration source is
preserved pending separate promotion approval, followed by live verification.
Actual physical mobile verification and remaining water shader latency remain
explicit limitations; this audit does not promise 60 FPS everywhere.
