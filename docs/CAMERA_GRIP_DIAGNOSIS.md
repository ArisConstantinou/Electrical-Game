# Camera-dependent fitting grip: confirmed diagnosis, rejected correction

Status: NOT FIXED. No runtime change from this investigation remains.

Preview: http://127.0.0.1:5365/Electrical-Game/
Workspace: C:/Users/arz0r/.codex/worktrees/full-body-worker/Electrical-Game
Branch: codex/full-body-worker, HEAD ec81f1a (pre-existing dirty work preserved).

The user's ceiling observation reproduces with the same fitting box and fixed player position. Measured wrist bend is about7 degrees toward the ceiling,36 degrees looking straight and93 degrees looking down. Yaw-only changes did not reproduce additional bending in this controlled fixture.

The runtime generic grip solver uses the changing forearm direction to compute the hand rotation around the handle axis. Thus camera pitch changes the hand pose relative to the held object. A fixed ceiling-derived hand/tool pose removed that bending, but its shoulder/elbow placement failed near-wall crouch visibility. Screenshots show an offscreen hand while looking down and a completely missing held object while looking up. This candidate is rejected, not delivered.

Evidence is under output/camera-grip:
- before/{ceiling,straight,down}.png: unchanged baseline, same resolution and player position.
- baseline-check/report.json: failing baseline regression and numeric pose data.
- visibility-proof/{motion-83,motion-140}.png: actual rejected candidate failures.
- rejected-final/: candidate sources retained solely for diagnosis.
- skill/: restored-source browser smoke screenshot.

Reproduction: node tests/camera-grip-diagnostic.mjs reproduction --motion --verify
This command is expected to fail until the defect is corrected. It does not modify game sources. Its movement fixture inherits the gameplay work-position constraint near the wall. Its frame-time report includes automation screenshot overhead and is not a performance acceptance result.

Restoration: WorkerBody.ts, FPSRig.ts and Game.ts match this-turn backups byte-for-byte. Earlier unrelated dirty changes remain. The main checkout was not edited. Build and diff checks passed after restoration. All-tool grips, clothing, locomotion and physical-mobile acceptance remain unresolved separately.

## Follow-up: all tools, downward and lateral camera directions

User confirms both pitch and yaw can expose deformation. The scope includes every tool except spray; earlier fitting-only yaw results must not be generalized.

`tests/wrist-pitch-review.mjs before` captures16 selections at three pitches. `node tests/wrist-pitch-review.mjs yaw-before --yaw` captures the same selections with both yaw signs and two pitches. Evidence is under output/wrist-pitch. Measured joint bend is a diagnostic, not proof of skin quality.

Two isolated browser experiments were rejected without editing live source: an elbow-pole adjustment produced raised elbows despite reducing wrist bend; a universal fixed grip frame worsened other handles. The three runtime files were hash-checked against the preceding baseline. No new correction has been delivered. The accepted spray remains unchanged. Further work requires tool-specific contact frames and jointly solved arm/tool placement, with visual acceptance at neutral/downward/lateral angles and during use. A single generic pose has not passed these requirements.
