# Directional jumping and two-joystick controls

Candidate branch: `codex/directional-jump-controls`, based on `4f16ebb` plus the protected, uncommitted integration source from `codex/building-concept-access`. The sole project URL remains `http://127.0.0.1:5365/Electrical-Game/`. Browser QA intercepts this URL with the candidate production build; it does not replace the shared listener or start another port.

## Behavior

- Space or ordinary desktop right click jumps while idle, walking or running. The existing right-click placement action takes priority during live box assembly.
- Takeoff retains horizontal movement, including diagonal sprinting. Releasing movement in the air preserves momentum; deliberate input can gently steer. Walls, ledges, ceilings and landing still constrain movement.
- Mobile/tablet left joystick: move; double tap toggles crouch/stand. The second touch can continue into movement.
- Right joystick: short tap uses/interacts; stationary hold of 350 ms jumps once; movement beyond 10 px cancels the hold and aims instead.
- Continuous tools use tap to start and the next tap to stop. Discrete placements, pickups and PVC phase transitions get one action. A jump hold stops a latched tool. Gesture cancellation, blur and settings stop pending gestures.
- Dedicated crouch, stand, jump, USE and INTERACT buttons are absent. Tool-specific PVC marking/quantity controls remain available.

## Cause and protection

Jumping released automatic mixing stance through `resetTransientInput`, which erased held movement keys and both mobile vectors. Jump/stance handlers now preserve those inputs. The player controller also previously recalculated zero horizontal velocity when movement was released during flight.

The protected input manifest and source backups are in `output/directional-jump/`. Unrelated renderer, building, worker-rig and performance changes remain outside this task's commit. Only the constructor callback and three stance-release changes in `Game.ts` belong to this task.

## Verification

- `node tests/directional-jump.mjs`: 288 direction/input/sprint/yaw/floor combinations plus idle steering, walls, risers, tall ledges and no double jump. `QA_COMPARE_BEFORE=1` reproduces the old airborne-release failure against the source backup.
- `node tests/player-jump.mjs`: ballistic height at four floor levels and three time steps; low ceiling.
- `node tests/mobile-stick-neutral.mjs`, `node tests/hand-work-stance.mjs`: neutral aiming, pointer ownership and work stance.
- `node tests/directional-jump-ui.mjs`: native keyboard/right click and touch in desktop, phone, tablet and landscape; both movement-stick and aim modes; cancellation and simultaneous movement/aim/use.
- `node tests/building-jump-ui.mjs`: foyer, doorway, stairs and landings plus three touch layouts.
- `node tests/right-joystick-use-ui.mjs`: actual water discharge, mixing start/stop, stock interactions and eight PVC bend grips.
- `node tests/jump-performance.mjs`: matched production before/after draw and simulation intervals on the same desktop GPU. Phone layout is emulation, not physical phone performance.
- The unchanged develop-web-game skill client is run against the candidate build and its gameplay image/text are inspected.

Runtime reports and original screenshots: `output/directional-jump/{before,after,tool-use,performance,skill-client}/`. Broad legacy HUD tests still encode the removed USE/INTERACT controls and older toolbar layout; their historical contracts are not claimed as passing this redesign. Targeted replacement tests exercise the requested controls with native input.

Shared-preview integration remains subject to the user's separate promotion approval. Physical iPhone/iPad verification and the existing broader building performance issues remain outside the evidence from browser emulation.

## Candidate acceptance, 2026-09-27

Production build `index-Cw2ZAZCp.js` and TypeScript compilation passed. Native acceptance passed 14 desktop cases and five cases in each phone/tablet/landscape profile, including all four movement/aim mode combinations. Stair acceptance passed 14 desktop locations and three touch layouts. Actual hose discharge, mixer insertion/start/stop/restart and all eight PVC grips (12, 24, 36, 48, 60, 72, 84, 90 degrees) passed on phone and tablet. The skill-client gameplay state was `playing`, with no page errors and no remaining owned browser processes.

Final serial render measurements on RTX 5080 / 24 CPU threads / WebGL / DPR 1 / zero apprentices, same courtyard camera: desktop P95 13.2 ms before versus 11.8 ms after; phone viewport 13.4 versus 12.1 ms. No sampled interval exceeded 50 ms and texture/geometry/triangle counts were unchanged. These short samples do not establish a general performance improvement. Earlier samples varied, including a slower candidate sample; controller-only paired measurements isolate the added movement cost at approximately 0.038 microseconds per update during jump cycles (grounded median 0.241 to 0.231 microseconds; jump-cycle median 0.256 to 0.294). This is browser emulation on the same desktop hardware, not physical-phone FPS. Original comparable control images are `performance/before-phone.png` and `performance/after-phone.png`; manually stepped motion screenshots' on-screen FPS labels are not performance evidence.

No new dependencies, agents, alternate ports or graphics-quality reductions were used. Account usage is recorded only in local QA notes.
