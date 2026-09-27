# Stair-view frame pacing investigation

User report: mobile cannot sustain 60 FPS; looking at new areas drops FPS; PC reaches 110 FPS but mostly drops to 30 FPS while watching the stairs. Approved targeted diagnosis and isolated correction, preserving visual quality and gameplay. Sole preview port: 5365.

Base: origin/main 619380c02ae961b8df286ba3b118c260214e7abe. Task branch codex/stairs-fps-20260927. Primary checkout main 27361e8 has unrelated dirty files and is protected. No agents. Another active chat is repairing preview startup; this task uses browser request routing for candidate builds and does not replace/start the listener.

Published asset observed during preflight: assets/index-tDBXhTd_.js. It includes the overload recovery wait: JS frame >32 ms adds min(18, workMs-24) ms. This is confirmed code, not a confirmed cause of stair slowdown. Prior performance reports do not prove physical-phone performance.

Test machine: Windows, Intel Core Ultra 9 285K, NVIDIA RTX 5080 and Intel Graphics available. Record actual browser renderer. Portrait emulation does not establish physical-device FPS.

Final change: `Game.loop` compares its recovery deadline with `performance.now()`, rather than the RAF callback timestamp. The callback timestamp describes its animation frame and can predate the actual callback execution. Comparing that older value with the previous frame's completion time discarded otherwise available frames. Simulation still uses RAF elapsed time; the existing overload recovery wait, bounded physics steps, asynchronous scene guard, and GPU submission limits remain intact.

The production loop regression in `tests/game-frame-deadline.mjs` fails on the protected base and passes on this change. It exercises an already expired deadline with a stale RAF timestamp, real recovery waits, a pending GPU frame, bounded catch-up steps, and yielding through RAF.

The strongest causal runtime test alternates only the clock comparison in the same loaded baseline game at a fixed stair landing with five apprentices. Two pairs improve 46.0 to 51.4 FPS and 47.1 to 53.6 FPS; frame p95 improves 25.6 to 22.8 ms and 24.9 to 22.0 ms. A separate production-build WebGPU desktop camera-sweep comparison improves the landing from 63.3 to 74.4 FPS, p95 23.7 to 16.9 ms. Separate runs varied significantly; portrait results alone are not a dependable estimate of phone performance. Full timing data, first-view spikes and environment: `performance/2026-09-27-stairs.json`.

Rejected experiments: splitting masonry into 8 m sectors increased draw calls and reduced FPS. Per-wall player-frustum compaction retained full shadows and reduced submitted triangles, but did not consistently improve FPS. Extending static transforms to authored assets also did not show consistent end-to-end gains. These experiments were removed from production code; no mesh, material, shadow or resolution downgrade ships.

Build: `index-CHjxVmch.js`; typecheck and Vite production build pass. Existing cinematic CSS asset-resolution and large-chunk warnings remain. All validation uses this worktree's immutable baseline or candidate build through browser request interception, without changing the actual listener. Owned browser sessions record PID/birth-time ownership and cleanup under `output`.

Current listener: the startup repair completed independently and restored the protected `jump-controls-release` checkout on 5365. This task does not replace its server, source, Manager configuration or startup task. The public `main` ref was rechecked at 619380c.

Validation passed: compiled production loop regression, building batch matrices/colors/UV packing and editor restoration, stair ascent/descent and room entry/return on desktop and touch emulation, masonry demolition and damage restoration, static/hidden transforms, site occlusion and shadow stability. The actual develop-web-game client reaches gameplay with no recorded browser errors and inspected screenshots. `game-frame-resume-ui.mjs` passes native touch hose work, explicit freeze/resume, scene preservation, emission/input cancellation and fresh input after waking on both WebGL and WebGPU. All managed browser reports for completed candidate checks show closed owned processes.

Legacy fixture limitations discovered during validation: `renderer-eye-snapshot.mjs` waits for Water Pro before activating it; its unmodified run timed out before gameplay. `phone-resume-ui.mjs` refers to the removed `#site-pro-use` control. The new resume test uses the current quick AIM tap and actual hose emission. `queued-work-input.mjs` waits for an optical pass while its puddle is outside the close-wall camera view. A scoped copy with that optical boundary forced passes all original queued-input assertions (no legacy pack dispatch, level adjustment deferred until the optical frame finishes, and no Pointer Lock). These failures were not hidden or counted as passing unmodified tests, and no gameplay code was changed to satisfy stale fixtures.

Final cleanup audit: 25 managed browser lifecycle reports, zero unclosed sessions, zero remaining owned PIDs and zero cleanup errors. The real client uses its manual simulation-time hook for interaction screenshots; its instantaneous HUD counter is not performance evidence.

Remaining acceptance: physical-phone test and the user's approval to integrate/promote under AGENTS section 12. The exact reported 110-to-30 drop has not reproduced on this machine, and no constant-60 guarantee is established. The measured initial landing view can still spike to 92.9 ms; this timing correction does not eliminate all shader, shadow or scene workload. Mobile device/browser and user PC hardware remain unspecified. Changing the model is not implemented by source edits; Sol High was recommended, and the actual active model setting is not visible to the task.

Usage checkpoint: 2026-09-27 at approximately 11:22 Asia/Nicosia, Codex get_usage_limits reported account weekly usedPercent 5 (10080-minute window), ordinary usage allowed, credit balance 0. Account-wide, not task-attributable.

Task usage and attributable credits: unavailable. The unchanged rounded account reading does not establish zero task consumption. No agents, paid API services, dependency installs or model escalation were used for this work.

Reproduce after `npm run build` with the existing develop-web-game skill browser lifecycle helper:

```powershell
node tests/game-frame-deadline.mjs
node scripts/stairs-performance-review.mjs --label candidate --dist dist --turn --scenes foyer-stairs,ground-landing-down
node scripts/stairs-performance-review.mjs --label portrait --dist dist --portrait --webgl --turn
```

Local untouched before/after screenshots: `output/stairs-performance/deadline-before-pc-desktop-webgpu/ground-landing-down.png` and `output/stairs-performance/deadline-after-pc-desktop-webgpu/ground-landing-down.png`. The HUD counter in each screenshot is instantaneous, not the subsequent sweep's measured average. The camera, viewport, materials and resolution match; normal idle character motion may differ.
