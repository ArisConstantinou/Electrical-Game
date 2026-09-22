# Chrome stall diagnosis — 2026-09-22

## Protected runtime

The user reports that loading `http://127.0.0.1:5365/Electrical-Game/` can freeze all of Chrome or the PC. With `?waterPro=0`, the user reports that the PC stays responsive but Chrome still freezes. This is user-observed device evidence; an intermittent whole-system freeze was not reproduced by isolated automated Chrome. Port 5365 was owned by PID 28524: Vite executable from the wheelbarrow dependency tree, serving `site-pro-04-mansion/Electrical-Game` at commit `7a28a48` plus concurrent uncommitted work. The port and listener were not changed. Candidate branch `codex/chrome-freeze-5365` starts from `7a28a48` in a separate worktree and uses no additional preview port.

## Measurements

All automated browser samples used Chrome at 1600×900 on the local Intel Core Ultra 9 / RTX 5080 host. They are short comparative samples, not the user's existing tab or total system CPU. Accepted render submissions are not necessarily displayed GPU frames.

- Live WebGPU route: START enabled in 8.7 s. In a 3.5 s menu sample, 22.2 accepted renders/s and CDP main-thread busy time 48.3%. After START, 75.6 renders/s and 99.8% busy time. No renderer/page error appeared.
- A later live comparison enabled START in 10.6 s with Water Pro versus 2.6 s with `?waterPro=0`. The Vite checkout was being edited concurrently, so this is diagnostic rather than a controlled before/after benchmark.
- Stable candidate production build, WebGPU with Water Pro: START in 8.6 s, longest startup long task 4.2 s. V8 sampling put the bundled Water Pro module at the top of startup JavaScript work.
- Stable candidate production build, WebGL with Water Pro: START in 15.1 s, longest startup long task 5.1 s. V8 sampling put Three.js WebGLBackend `_completeCompile` at the top, consistent with shader/pipeline setup. This does not establish the exact cause of the user's PC-wide freeze.
- Stable candidate with Water Pro disabled: START in 2.3 s. This diagnostic route removes Water Pro visuals and does not fully prevent the user's Chrome freeze.
- Same candidate in 4 s stationary gameplay samples: 30 FPS setting delivered about 30 renders/s and 44% main-thread busy time; 60 FPS about 58/s and 97%; display-refresh mode about 63/s and 99.8%. Load varied, so these are local snapshots. The cap reduces steady load, especially at 30 FPS, but does not eliminate startup's long task.
- No System event 4101 or recent `Display`/`nvlddmkm` entry was returned in a two-day check. Absence of an event does not rule out a GPU/driver issue. Native hidden-tab behavior could not be verified in the automated browser setup.

## Candidate change and verification

`FramePacer` limits the welcome scene to 15 FPS and defaults gameplay/editor to 60 FPS, with visible 30, 60, 120, and display-refresh choices in Settings. It preserves accepted-frame elapsed simulation time, skips missed deadlines, and resets on start and resume. The mobile tool strip is hidden while Settings is open so it cannot cover the new control.

- `node tests/frame-pacing.mjs`: passed 25 refresh/cap combinations, long-stall/reset, and storage cases.
- Direct TypeScript build and Vite production build: passed. The existing large-chunk warning remains; the shared dependency junction lacks npm `.bin` commands, so direct `node node_modules/...` entrypoints were used without reinstalling.
- `tests/frame-pacing-ui.mjs` with `QA_DIST` route interception: passed menu/gameplay caps, native held movement at all settings, freeze/resume event path, held water after leaving Apprentice input mode, persistence, and 390×844 layout. The routed build was tested at the same URL without replacing the live server. Actual native tab visibility is unverified.
- `tests/renderer-lifecycle.mjs` and `tests/throw-timing-physics.mjs`: passed.
- Bundled develop-web-game client passed against the live 5365 route with `?waterPro=0`; this is a baseline smoke, not validation of the candidate code.
- Stable mobile Settings screenshot was inspected; editor activation showed that a saved 30 FPS choice applies to the editor rather than the welcome-only 15 FPS limit.

Local ignored evidence: `output/frame-pacing-candidate/report.json`, `output/backend-compare.json`, and `output/frame-pacing-final/` in the candidate checkout. The live listener still lacks the candidate patch. Remaining work: isolate the Chrome freeze that persists without Water Pro on the user's normal Chrome, reduce Water Pro's startup block without silently lowering graphical quality, coordinate concurrent menu changes, then test the actual integrated 5365 route and the user's ordinary Chrome session.

## Deeper isolation after the user's follow-up

The user asked whether the game alone is responsible. A clean Chrome with a second blank tab stayed responsive during game loading: 22 control probes with Water Pro disabled had a 10 ms worst response, and 93 probes with Water Pro enabled had a 5 ms worst response. This rules out a reproducible whole-browser hang in that isolated profile, not an issue in the user's ordinary Chrome profile. The user could not test Guest mode. No profile/extension, OS driver, or GPU root cause is confirmed.

On the live route, the blank page had 0.3% main-thread busy time. Gameplay with WebGPU and no Water Pro was 28.6% busy and used 84.1% of one CPU core in Chrome's GPU process during a short post-START sample; with Water Pro it was 67.8% and 58.9%, respectively. WebGL without Water Pro reached 99.8% main-thread busy and an approximately 4.3 s startup long task. V8 startup profiling attributed WebGL's costly path to Three.js `_completeCompile`. These are short, non-identical loading phases, not stable FPS comparisons or proof of a driver bug. The game still issues roughly 738 draw calls and 2.76 million triangles in the tested view.

The Water Pro vendor module allocates eight 2048×2048 mask layers and calls `getImageData` once per temporary canvas. Targeted measurement found the first readback alone blocked for 4.2–5.9 s; later readbacks were 11–22 ms each. Chrome's `willReadFrequently` canvas hint reduced the eight readbacks together to about 0.22 s in two controlled runs. It also reduced the largest startup long task from about 4.2 s to 1.5 s when comparing the live asset with the candidate production asset at the same route in isolated Chrome. START readiness remained around 8.5–9.0 s, so there are other startup costs. We added a strict Vite transform for this single vendor call instead of editing the 6 MB generated source; the transform fails the build if the call changes. Sampled red-channel mask pixels differed by at most 1/255 in fewer than 2% of 4096 samples per mask; full pixel equality and physical-device visuals were not established.

The production candidate built and passed the full frame-pacing UI suite after this change: START, menu/gameplay cadence, held movement, explicit freeze/resume, held water output, saved setting, and 390×844 Settings fit. No renderer/page error occurred. At 30 FPS, stationary gameplay consumed 36% of one renderer main thread in this run; at 60 FPS it used 93%, and 120/display modes used about 100%. A 60 FPS default limits the upper frame rate but cannot guarantee a smooth or low-load Chrome session on this scene. The candidate remains isolated; the live 5365 listener still serves the separate, actively edited mansion checkout. Integration and a real test in the user's ordinary Chrome remain open.
