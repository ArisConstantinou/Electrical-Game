# Carried-tool directional gait correction

User report: A/D still opened the legs sideways and diagonal walking did not
look like walking. Investigated on the shared Electrical-Game port 5365.

## Provenance and cause

- Starting integration commit: `394f75a`, branch `codex/wheelbarrow-physics`.
- Active checkout: `C:/Users/arz0r/.codex/worktrees/wheelbarrow-physics/Electrical-Game`.
- Listener 48420 already served that checkout with `--port 5365 --strictPort`.
  Its Vite executable resides in the prepared-multi-pipe-wall dependency
  checkout, but its explicit application root is wheelbarrow-physics.
  No listener replacement or second preview was needed.
- `WorkerBody.update()` suppressed all travel yaw whenever any grip was
  active, including merely carrying a spray can. Low-speed empty-handed gait
  also had a 0.8 m/s turning threshold. The remaining lateral stride cap made
  A/D at 2.2 m/s run about 4.5 complete gait cycles per second.

## Correction

Hips, knees and boots now turn into the travel axis at walking speeds while
carrying a tool. The existing world-contact and wheelbarrow body-frame
constraints still anchor the body. Camera input, movement/collision logic,
tool contact solvers and assets are unchanged.

## Evidence

- `node tests/worker-carry-gait.mjs --before` captured the original implementation;
  the same test without the flag captured the correction. Sixteen cases:
  eight directions at 0.7 and 2.2 m/s, with an active carried-tool grip.
  Before A/D body-axis error was 90 degrees, diagonal error 45 degrees.
  After: 13.50 and 6.75 degrees respectively. At 2.2 m/s A/D cadence fell
  from 4.507 to 2.008 cycles per sampled 59-frame interval.
- `node tests/worker-directional.mjs`: 24 cases passed, including diagonal
  foot travel, leg separation, torso/head motion at three speeds.
- `node tests/worker-movement-input.mjs`: eight native key combinations,
  equal diagonal speed, release/stop and standing/crouching spray input passed.
  Its original centre start intersected the now-solid wheelbarrow on W+A.
  The fixture now uses a verified clear aisle and asserts no equipment contact;
  collision behavior was not disabled or modified.
- `node tests/worker-carry-tools.mjs`: 24 actual Game.step cases passed for
  spray, trowel, hose, drill, level and fitting while moving A/D/WA/SD;
  grip reach, body bounds and body turning checked. Representative in-game
  tool screenshots were visually inspected.
- `node tests/wheelbarrow-grip.mjs`: camera angles and moving grips, fingers,
  wrists and elbows passed. No cart code changed.
- Required develop-web-game client completed two gameplay bursts; state was
  `playing`, screenshot inspected, no page-error artifact.
- Production build/typecheck and diff check passed. Build retains existing
  large-chunk and runtime-resolved start-image warnings.

Original and corrected evidence is in `output/worker-carry-gait/before` and
`after` (report, screenshots and recorded WebM). Fixed comparison camera and
1200x900 viewport; isolated body view intentionally hides the room and tool
mesh while keeping the carried-tool pose calculation active. This is an
animation comparison, not a first-person ground-contact capture. In-game
tool views are in `output/worker-carry-tools`. All these outputs are local.

## Performance and limits

Same headless Chrome 153 / WebGL / RTX 5080 / 1440x810 worker-motion fixture:

| Metric | Before | After |
| --- | ---: | ---: |
| Pose CPU P95 | 1.3 ms | 1.2 ms |
| CPU submission P95 | 7.5 ms | 8.9 ms |
| Frame interval P95 | 7.9 ms | 9.4 ms |
| Maximum frame interval | 8.3 ms | 11.7 ms |
| Frames over 50 ms | 0 | 0 |
| Draw calls | 542 | 542 |

This small sample does not establish GPU timing, general performance parity,
mobile behavior or user acceptance of the whole character. Concurrent PVC
work remained separate and was not staged with this fix. No model change,
new agent, paid asset or dependency installation was used. Task-attributable
weekly usage and credits are unavailable.
