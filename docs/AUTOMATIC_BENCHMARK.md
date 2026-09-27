# Automatic device benchmark

Approved scope: one START BENCHMARK gesture, loading and menu timings, automatic normal-physics traversal of the original mansion, no countdown, explicit minimum FPS and stalled-frame evidence, bounded screenshots and a local report with a final sharing action. The user separately authorized commit and push on 2026-09-27.

Entry points: `/Electrical-Game/perf/` and `/Electrical-Game/review/performance/`. The short entry preserves renderer/level query parameters. Loading starts only after the gesture, before the game iframe navigates. The existing graphics configuration and apprentice selection are retained. A new benchmark reloads the iframe and starts cleanly. Saved/editor layouts do not pretend to complete the fixed mansion route.

The Vite development middleware maps these two public-directory routes to their actual index documents, preserving query strings and adding a missing trailing slash. Otherwise Vite's SPA fallback serves the game instead of the benchmark; the production build fixture alone could not reveal this local routing mismatch.

The tour walks through 112 waypoints/checkpoints: original room, foyer, court, garage/outdoors, stairs and landings, L1–L4 room/terrace openings, B1/B2 corridors and rooms, and a return to the ground-floor entrance. It supplies movement intent to the existing player controller. It never teleports or removes collisions. A blocked route yields an explicit partial report, including the position and contacts. Background/freeze pauses do not count toward FPS or navigation progress. Hidden safety bounds report an incomplete outcome; there is no two-minute countdown or elapsed-time cutoff presented as completion.

Schema 3 records menu DOM observation, READY and first game submission from the benchmark gesture, navigation/resource timings, first contentful paint where available, asset URLs, UA/backend/canvas/viewport/settings, frame intervals, CPU work, reciprocal minimum instantaneous FPS, actual game HUD values, worst fixed 500/1000 ms windows including zero-frame tails, all frames of at least 100 ms, the 20 longest intervals, per-area statistics, lifecycle/renderer diagnostics and the complete reached route. A 378 ms interval is explicitly 2.6 instantaneous FPS; this need not match the game's half-second HUD counter.

Thumbnails are event-driven, at most 320 pixels wide, 18 retained images and 3 MB of encoded image data, with at least three seconds between attempts. Frame stalls, route observation checkpoints and graphics/error events request captures. Costs of every attempted copy/encode are measured and annotated in raw intervals; frames are not silently corrected. Captures describe the available scene at the recorded time, not a guaranteed video of the exact start of a stall. Blank or unavailable canvas readback is disclosed. No automatic classifier promises to detect every visual glitch.

The last report, including images, is retained in local IndexedDB where available. Download exports one JSON bundle with embedded JPEGs; sharing checks native support and offers a text report plus individual JPEG files, with download fallback. Clipboard text includes the metrics and diagnostic context. There is no upload server and nothing automatically posts into a Codex/ChatGPT conversation. The user chooses the native share destination.

On completion or interruption, the game runtime is suspended while the report is reviewed. Cancelling startup also retires the iframe navigation. A delayed new navigation cannot accidentally attach the preceding game's ready runtime.

Protected base: task checkout `C:/Users/arz0r/.codex/worktrees/stairs-fps-20260927/Electrical-Game`, branch `codex/stairs-fps-20260927`, starting at `3b153ac`. The sole listener remains the integration checkout on port 5365 during candidate QA. Browser request routing serves the isolated production build on that origin without a second listener. Dirty primary-checkout work is excluded.

Validation commands:

```text
npm run build
node tests/benchmark-metrics.mjs
node tests/benchmark-route.mjs
node tests/phone-performance-recorder.mjs
node tests/benchmark-controls.mjs
node output/run-benchmark-skill.mjs
```

`benchmark-route.mjs` is accelerated route feasibility with the actual player/collision/surface controller; its time is not FPS evidence. `phone-performance-recorder.mjs` performs a real-time portrait WebGL tour and a deliberately injected 450 ms main-thread stall, freeze/resume, export, persistence, clean restart, frozen-tail accounting, and a WebGPU landscape blocked-route check. Any FPS from that injected QA tour is not a claim of ordinary gameplay performance. Physical iPhone verification of the new capture flow remains a device-level check; desktop touch emulation does not prove it.

Recorded acceptance: the real-time portrait tour reaches all 112 checkpoints and ten areas, with 23,445 intervals, no runtime errors and 18 nonblank JPEGs (436,826 encoded bytes). The injected-stall run exposes a minimum instantaneous 1 FPS and actual HUD minimum 3.4 FPS. Retained thumbnail copy/encode costs were 180.4 ms total, maximum 19 ms per image, over the full route. The final implementation also accounts for attempts discarded by retention limits. No pure FPS improvement is inferred from this injected capture run. The controls check passes startup cancellation, automatic 15-second frozen-tail stop, FCP timing, delayed-reload protection, suspension during report review, native file payload creation, cancellation and download fallback. The original skill client also reaches the automatic tour and produces an inspected desktop screenshot/state with no error artifact. Before/after UI and actual captured scene images are retained under ignored `output/phone-performance-recorder/`; detailed reports and browser ownership checks remain local QA evidence.
