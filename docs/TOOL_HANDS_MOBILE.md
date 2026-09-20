# Tool presentation and precise mobile controls

## Scope and source

User approved fixing the six supplied tool/hand screenshots, model appearance,
mobile integration, and final publication to main. The additional request was
aligned, more precise mobile joysticks.

The starting integration was `864eec3` on `codex/wheelbarrow-physics`, in
`C:/Users/arz0r/.codex/worktrees/wheelbarrow-physics/Electrical-Game`.
The existing listener remains exclusively
`http://127.0.0.1:5365/Electrical-Game/`. The original main checkout's dirty
files and untracked reference images were not included in this patch.

## Corrections

- Both mobile pads have equal size and a common baseline, including safe-area
  offsets. The movement pad no longer jumps to the touch position. An 8% radial
  dead zone rejects jitter; a continuous power curve gives fine low-speed
  positioning and reaches full speed at the outer radius. Diagonals stay
  normalized. Existing right-stick precision profiles and independent action
  ownership remain available.
- Mobile cart transport exposes hold-to-move-fast and release buttons, handles
  pointer cancellation, and uses a compact landscape stability panel. Steering
  is labelled explicitly. Work cards, model viewer access and interaction
  controls no longer overlap at the tested sizes.
- The torso follows the actual eased eye height throughout crouch and low-wall
  work. The previous binary pose threshold could place the camera inside the
  torso during transitions. Cart body/grip constraints are preserved.
- The downward spray solve moves the calibrated can, fingers and forearm as a
  rigid grasp. The resting hammer uses an upright body-relative carry pose.
- The tape casing stays attached to the measured wall datum; the pencil keeps
  its actual left-hand grip between strokes. The drill/driver solve preserves
  tool orientation instead of rotating the tool vertically to fit the screen.
- Drill/driver housings have tapered shells, rounded grip/battery edges, vents,
  fasteners and continuous drill-bit flutes. The laser mount has a connected
  rear plate and a grip section matching its housing. These remain editable
  procedural game models, not exact product scans.
- The nozzle now has a continuous reusable 1,024-triangle hose to the site coil.
  Its coupling follows the held nozzle and the line remains above the floor.

## Evidence and checks

All generated reports and screenshots below are local ignored artifacts.

- `tests/tool-view-regression.mjs`: 14 desktop/mobile cases; actual visible
  spray vertices stay on screen, tape outlet remains connected, hose endpoint
  and floor clearance verified, no page errors. Captures in
  `output/tool-view-regression/before` and `after`. The earliest standing-spray
  baseline still has the fading startup overlay; use the separate matched eye
  transition captures for the torso comparison.
- `tests/worker-eye-transition.mjs`: five actual camera heights from 0.68 to
  1.65 m. Before captures reproduce the torso intersecting the eye; after
  assertions keep the neck below the eye clearance. Captures in
  `output/worker-eye-transition/{before,after}`.
- `tests/mobile-aligned-controls.mjs`: native CDP touches at 390x844,
  844x390, 320x740 and 667x375; aligned pads, monotonic precision, neutral
  off-centre touch, bounded diagonal input, simultaneous move/aim/use,
  cancellation and actual cart entry/movement/fast/release.
- `mobile-manual-input`, `mobile-hud-layout`, `height-measure-ui`,
  `laser-level-ui`, `hose-nozzle-ui`, `worker-carry-tools`, `wheelbarrow-grip`,
  `worker-movement-input`, `manual-pvc-ui`, `mixing-tool-highlights-ui`, and
  `box-mixing-context-ui` passed. Logs in `output/tool-view-regression`.
- `mobile-hammer-contact`: nine distance/angle cases passed on the current
  AUTO stance, including held use, lateral movement, release and real material
  contacts. The test now waits for startup/tool selection, does not assume
  every close AUTO pose collides with the head, and accepts physically striking
  the loose fragments that shield masonry as continued cutting.
- Two test harness corrections: the laser fixture derives the actual side
  wall surface instead of assuming a 6 m room; the manual-input fixture waits
  for accepted WebGPU frames before mutating geometry, matching `Game.loop`.
  No application reach or renderer safety was weakened to pass these tests.
- The develop-web-game client exercised the same port; actual gameplay
  screenshots and text state are in `output/tool-view-regression/skill`.

## Performance and limits

Matched moving-spray benchmark: Windows, headless Chrome 153, RTX 5080,
1440x810, WebGL. Pose P95 remained 1.4 ms; frame P95 remained 16.9 ms;
maximum frame 17.0 ms and zero frames over 50 ms in both warm samples.
CPU submission P95 was 7.6 ms before and 6.4 ms after (not GPU timing).
Both samples submitted 542 calls / 1,336,628 triangles.

`tests/held-tool-performance.mjs` records the full simulation/render cost of
spray, drill and hose at desktop/mobile viewports separately. These PC samples
and native touch emulation do not establish physical iPhone/Safari frame rate
or thumb comfort. No physical phone was connected.

All six tool/viewport samples passed: frame P95 16.8–16.9 ms, maximum 17.1 ms,
zero frames over 50 ms; CPU submission P95 8.6–12.3 ms. Rendered workload was
527–606 calls and 1.42–1.45 million triangles, including the prepared room.
The compiled build also passed `production-startup` on WebGPU desktop and
WebGL mobile through the existing 5365 origin, without a second server.

Build warnings about large chunks and runtime-resolved start images are
pre-existing; the referenced public images are present. No paid assets,
dependency upgrades or alternative preview ports were introduced.
