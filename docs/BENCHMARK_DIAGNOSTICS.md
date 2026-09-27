# Automatic device benchmark v4

The recorder now inspects every authored room in the default mansion, rather than a main room on each floor. It runs two measurement passes, followed by separate controlled functional checks. It preserves the game's renderer, resolution, geometry, materials, graphics settings, movement speed, collisions and stair profiles. No server, telemetry upload or paid service is added.

Open **PERFORMANCE TEST** beside **LEVEL EDITOR** in the main menu. The test stays on `/Electrical-Game/?performance=1`; the separate `/perf/` document is removed. Renderer/version parameters are preserved for the game iframe. Loading starts only after START BENCHMARK. MAIN MENU remains available during loading, the route, stopped/completed results and restored reports. Returning stops recording, restores runtime hooks and leaves the test. New measurements reload only the child game; saved reports restore without a game renderer. Saved/editor layouts do not pretend to complete the fixed mansion route.

## Coverage

- Ground: original work room, foyer, garage, courtyard and exterior.
- L1: main, west and front rooms, both east bedrooms and east veranda.
- L2: main, west, front and east rooms, east veranda.
- L3/L4: main, west and front rooms, open terraces.
- B1/B2: circulation, garage, workshop/electrical store.

There are **24 internal spaces and 6 exterior/veranda inspection spaces**, each visited in both passes, across **414 waypoints**. Each inspection rotates the camera through a complete turn, including upward/downward views. Camera headings align before the measured inspection sweep. Coverage only counts completed inspections at the expected physical position and floor; blocked paths keep the missing visits in the report. This manifest describes the default mansion, not custom levels or an editor-modified site.

Two passes take longer than the previous short tour. The interface shows phase and progress without a countdown. A user can stop and export partial evidence at any time. The tour does not teleport or pass through walls. If an NPC or obstacle blocks the path, the recorder reports that position rather than claiming coverage.

## Diagnostics

Report schema 4 includes recorder version `4.0.2`, room identifiers, pass, camera pose, frame intervals, P95/P99, counts over 50/100/250 ms and over the nominal 60 FPS budget. CPU game-step and CPU render-submission measurements are distinct; neither is an isolated GPU timing. The full raw intervals and rolling no-frame windows remain available.

Findings distinguish observed exceptions, resource-load errors, graphics loss, no-frame stalls and route failures from correlated CPU-heavy, long-task or capture-overhead indications. Unexplained frame delays remain unresolved, rather than being assigned to the GPU. Relevant nearby renderer lifecycle telemetry, resource timing and thumbnails accompany slow-frame evidence. Findings are bounded, while raw sample data retains the rest.

Room-by-room comparisons use the same camera sweep and graphics configuration in both visits. A faster second visit is a useful observation; it does not uniquely prove shader compilation, asset loading or caching, since thermal state and asynchronous work can also change.

Resource history samples geometry/texture counts and, when exposed, an estimated JS heap. Pass-end growth is reported as a warning, **not a proven leak**. Heap estimates are not total RAM or VRAM. Browser capabilities are checked at runtime; unsupported long-task or heap measurement is explicitly unavailable. GPU timing, RAM bytes and VRAM bytes are unavailable in this recorder.

Browser references: [supported PerformanceObserver entry types](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver/supportedEntryTypes_static), [limitations of performance.memory](https://developer.mozilla.org/en-US/docs/Web/API/Performance/memory).

## Functional phase

After performance collection finishes, normal simulation input checks movement response, jump/landing, work-room wall contact, spray marks, release without further marking, and a controlled game suspend/resume. They run in the owned benchmark iframe after both passes, so work marks and lifecycle changes do not contaminate the performance comparison.

Response time is measured from controlled input to simulation response. It is **not physical touch-to-display latency**. Controlled suspend/resume is **not an actual browser background transition or physical device lock**; natural visibility/freeze/resume events are also recorded when they occur. Physical iPhone acceptance remains separate.

Functional failures carry evidence and appear in findings. Finishing a route does not mean every functional check passed. Stopping before functional checks leaves them incomplete.

## HUD, captures and overhead

The compact benchmark panel sits below the measured bottom of visible top-navigation/FPS elements and responds to viewport changes. The actual game HUD remains visible; the recorder does not replace its FPS counter.

Thumbnails retain source-frame time and camera pose before asynchronous encoding. Existing limits remain 320 px width, 18 images, 3 MB and at least 3 seconds between captures. The 32 ms CPU guard now includes both snapshot acquisition and JPEG encoding for one capture, rather than checking those portions independently. An expensive capture disables subsequent captures while numeric collection continues. Screenshots aid manual visual review; they are not automatic detection of every rendering glitch.

The report labels measured tour, recorder-bookkeeping, monitoring and capture CPU costs. These are measured portions, not all browser overhead. Raw frame intervals keep the overhead visible. Data is bounded to 180,000 frame samples, 2,000 long tasks, 1,024 resource snapshots and the existing 1,800 lifecycle snapshots. Important room/pass-end resource samples replace older periodic snapshots if the history fills. The game is suspended while results are reviewed.

Reports and screenshots remain local to the device until the user chooses share/download/copy. The entire benchmark module graph has a version query, so the new recorder cannot silently import an older cached tour. Schema 3 reports still render with a message that the additional diagnostics require a new run.

Copy Numbers produces a bounded text summary with the recorded device/build, both room visits, overhead, capabilities, loading, slow frames and diagnosis. It omits raw frame histories and embedded pictures; the full JSON remains available. If clipboard access is denied or unavailable, a modal exposes selected read-only text for manual copy, a retry triggered by another user tap, and a small TXT download. Reloading on the same origin restores the previous report; no new tour is needed to use the fallback. This does not upload results automatically.

## Verification

- `tests/benchmark-hud-layout.mjs`: the protected benchmark failed because its panel overlapped both `fps-counter` and `mobile-top-rail` at 430×745. The candidate passes portrait 430×745 and 320×740, landscape 844×390 and desktop 1366×768. Before/after screenshots are retained in `output/benchmark-hud-before/` and `output/benchmark-hud-layout/`.
- `tests/benchmark-route.mjs`: accelerated feasibility through actual player physics, independent of real-time FPS measurements; checks all 24 internal spaces and both passes.
- `tests/benchmark-diagnostics.mjs`: incomplete coverage, unsupported APIs, CPU/capture/task/unknown evidence, resource-growth qualification and functional/performance separation.
- `tests/benchmark-functional.mjs`: the actual game executes all six functional checks; writes evidence and errors to `output/benchmark-functional/`.
- `tests/benchmark-functional-phase.mjs`: a labelled short test-only route exercises the real recorder transition and proves functional FPS/HUD samples are excluded, without claiming complete coverage or real-time tour performance.
- `tests/benchmark-faults.mjs`: real 180 ms CPU blocking, runtime exception, failed image request, incomplete route, and supported/unsupported measurement paths.
- `tests/benchmark-controls.mjs`: existing stop/loading, no-frame-tail, delayed restart, share/cancel/download and capture-budget regressions.
- `tests/benchmark-capture-total.mjs`: runs the actual production capture function with a controlled CPU clock. The previous per-portion rule misses 20+20 ms; the new aggregate rule stops further images. Real browser readback made the attempted sub-budget UI fixture unreliable in two runs, so it is retained as diagnostic evidence, not a passing test. Real browser capture stopping remains covered by `benchmark-controls.mjs`.
- `tests/benchmark-address.mjs`: main-menu Performance Test entry and start/stop/new-run stay on the same parent page, game-root/query preservation, and absence of requests to the removed directory.
- `tests/benchmark-public-smoke.mjs`: actual served prompt, version, HUD visibility, route manifest, bounded report and pause while reviewing, without candidate interception.
- `tests/benchmark-copy.mjs`: denied/missing clipboard access, readable selected fallback, retry failure, matching small TXT, success, native Chrome clipboard readback and report restoration without another tour. Physical iPhone acceptance remains separate.
- `tests/benchmark-report-text.mjs`: original recorded device/version, per-pass comparison, overhead and diagnosis retained while large raw histories and image payloads are excluded; bounded output and older report compatibility.
- `tests/benchmark-full-tour.mjs`: a complete real-time two-pass run with room coverage, measured per-room samples and all functional checks; no time scaling or generated FPS data. `QA_LIVE=1` skips candidate interception for final listener verification; `QA_BENCH_URL` selects the published benchmark.

All browser tests use the existing managed browser lifecycle and close only owned processes. Candidate checks use the protected sole 5365 URL with test-local production-build interception; actual listener and published checks are separate receipts. Local results use Windows Chrome on the development PC, including mobile viewport emulation, and do not establish iPhone performance.

The complete real-time candidate run finished in 970.7 seconds with 83,372 performance intervals, both visits to all 30 spaces, six functional passes and no application errors. Both pass endpoints retained 1,467 geometries and 89 textures. It used a 430×745 touch viewport, DPR 3 and a 752×1303 WebGPU canvas on a Windows PC with Core Ultra 9 285K and RTX 5080 inventory. The driver also took periodic screenshots; their cost is retained in raw intervals. Its 87.6 FPS average, P95 17.5 ms and 715.2 ms maximum are not a before/after optimisation comparison or physical-iPhone result. Raw evidence is retained in `output/benchmark-full-tour/`. Final capture-budget aggregation and FPS phase separation receive dedicated regression checks.
