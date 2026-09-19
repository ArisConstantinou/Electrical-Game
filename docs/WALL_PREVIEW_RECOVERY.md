# Wall crossing: preview provenance recovery

User report: "i can still get through wall", 2026-09-19.

The isolated branch at `600f064` already bounded the body against the masonry facade. However, listener PID 50000 on port 5364 served the protected main checkout's older controller. Its command line contained both `--port 5362` and `--port 5364`, without an explicit Vite root. The normalized source-map source SHA-256 matched main exactly (`06f3d383ae258d9316f4b397203d774739ea606ccdd1b221e2c7c10637500e7e`), not the worktree (`3f69df9a320fd9a59bfab31d924080e0621d3ab27f4540eca33454767e1f94df`). This was a wrong preview checkout, not evidence of a browser cache fault.

## Recovery and prevention

- Stopped only the identified 5364 listener; preserved protected main, its dirty files and public deployment.
- Started the existing isolated checkout on the same strict port. No gameplay or collision algorithm changes were necessary.
- Added `npm run dev:mortar-preview`, backed by `scripts/start-mortar-preview.mjs`. The script resolves its own checkout, supplies an explicit Vite root and working directory, and never changes ports silently. It verifies controller, Game and mixing source against an occupied preview before reusing it; a mismatched server is refused without killing any process.
- Verified mismatch refusal, startup deliberately invoked from the main directory, and correct-server reuse. The new listener serves the worktree source.

## Evidence

`node tests/wall-boundary-ui.mjs --before` failed on the original listener. The same test without `--before` passed after recovery. Both use 1366×768 Chrome/WebGL, the same initial camera, native keyboard movement, TOOL LEFT/RIGHT selection, crouched/standing and ordinary/sprint movement: eight combinations. Pointer Lock is blocked only in automated test contexts.

Before: minimum camera Z −3.07 m, 0.66 m behind the facade at −2.41 m. After: minimum Z −2.13 m, retaining the configured 0.28 m clearance. Retreat remains functional (Z −1.03 m after 30 frames). No page errors. Screenshots use identical input/camera fixtures; the resulting positions necessarily differ because collision now stops movement.

- Before screenshot: `output/wall-boundary-before/left.png`
- After screenshot: `output/wall-boundary-after/left.png`
- Per-trial reports: `output/wall-boundary-{before,after}/report.json`
- Bundled game-client smoke, screenshot/state inspection and owned browser cleanup passed: `output/wall-boundary-skill`.

Bounded simulation-step measurements: before p95 2.1–2.6 ms; after p95 2.4–2.9 ms. One after sample peaked at 52.2 ms. These are simulation CPU samples, not rendered FPS; the served versions differ by earlier equipment/features, so they do not isolate the cost of the collision clamp. No rendering or geometry settings were reduced. No physical-phone or Pointer Lock validation is claimed for this recovery. Build was not repeated because runtime source and assets are unchanged from the previously built branch.

Preview: <http://127.0.0.1:5364/Electrical-Game/>. Refresh an already open tab to load the corrected runtime.
