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
