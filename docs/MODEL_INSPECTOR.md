# In-game model inspector — 2026-09-19

Preview: http://127.0.0.1:5365/Electrical-Game/ (strict port, unchanged).
Isolated checkout: `C:/Users/arz0r/.codex/worktrees/full-body-worker/Electrical-Game`, branch `codex/full-body-worker`, base `ec81f1a`. Main checkout and previous preview remain untouched. This completes the inspection-panel feature; the broader worker artwork remains an unaccepted sample. No commit, push or promotion.

## Controls

- Enter the site, then **3D MODELS**. Layout and controls reuse the user's Trials viewer (`trials/src/ui/ModelViewer.ts` and `model-viewer.css`), adapted to Electrical-Game.
- **CHARACTER**: standing/crouch/forward/backward/left/right/jog/crouched strafe/spray/tool poses, pause, restart and speed. Uses the same WorkerBody and FPSRig as gameplay.
- **ALL ASSETS**: searchable scene hierarchy, including inactive held tools and individual parts. Initial scene has 1,758 entries (groups and parts, not 1,758 unique authored models). Selected geometry/material copies do not reparent or change world assets. No external assets are downloaded.
- Left drag rotates, right drag pans, wheel zooms. FRONT/BACK/SIDE/RESET VIEW reset the inspection camera. C also resets it to FRONT.
- **LIVE CONTROL** runs the actual game, its real character, tools, ingredient quantities, contacts and interactions. WASD/Shift move, V crouches, Space/USE holds tool use, E/INTERACT interacts. Tool selector includes every FPS tool plus shovel, mixing trowel, cordless mixer and water container. AIM + drag (or Alt + drag) changes the actual player's aim. Ordinary orbit does not change aim. Touch pads support simultaneous movement and use.
- The projected + shows the logical player's aiming point; orbit camera and logical aiming camera remain separate. FOLLOW tracks movement; disable it to leave the camera in place.
- LIVE actions affect the game. Static character/asset inspection pauses simulation and continuous sounds. Closing returns to the game and clears held controls. It does not undo actions performed in LIVE.
- **C in normal gameplay** toggles a full-body front view, head to shoes. Room geometry between that camera and the worker receives a presentation-only cutaway; collisions and first-person tool targeting are unchanged.

## Validation

- `npm run build` / typecheck and `git diff --check` pass. Vite's existing large-chunk warning remains.
- `node tests/model-inspector.mjs` and `--webgpu`: full-body C toggle, preview/pause, drill search and selection, movement, crouch, independent orbit/aim/use, all 17 tool/put-down options, real water pour (6.6667 L), sack opening and cement scoop, sand shovel, mixer insertion/running (mixProgress > 0), portrait view and return to game; no page errors.
- `node tests/model-inspector-touch.mjs`: WebGPU touch emulation, simultaneous move/use, release movement without releasing use, touch AIM, landscape layout and close; no page errors or horizontal overflow. CDP touchEnd specifies the contact to release; event tracing confirmed this rather than changing application code to accommodate an incorrect test event.
- Bundled develop-web-game Playwright client passed; screenshot and state inspected under `output/model-inspector/skill`.
- Actual runtime screenshots: `output/model-inspector/`, `/webgpu`, `/touch`. Pre-feature C screenshot preserved as `before-c.png`.

## Performance and limits

Headless Chrome 153, Windows, RTX 5080, 1440x810, WebGL, 90 sampled frames after warmup. CPU submission p95: game before 4.9 ms, isolated character 1.8 ms, LIVE 8.1 ms, game after close 5.0 ms. LIVE RAF interval p95 8.7 ms, max 11.9 ms, no sampled frame >50 ms. These are local desktop diagnostic measurements, not GPU execution time, monitor FPS or physical-phone performance. Renderer-reported allocation increases approximately 12.2 MB after the cached preview character loads.

Room cutaways initially used triangle raycasts and LIVE CPU p95 measured 17.3 ms; bounds-based cutaways reduced that cost without changing gameplay geometry. Floor/wall presentation is restored before each simulation step. The viewer shares the existing renderer/context and restores viewport/scissor state.

This feature exposes existing visual defects; it does not certify anatomical/art quality or repair every tool animation. LIVE uses existing real actions rather than newly authored animation clips. Physical iPhone/Safari was not tested. Exact legacy tool geometry is displayed, including its existing simplicity.
