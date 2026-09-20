# Chrome frame pacing — 20 September 2026

The visible welcome screen previously ran the entire game loop at display cadence. On the user's 240 Hz desktop, the initial read-only sample observed 229 FPS in the menu and 210 FPS in stationary gameplay, occupying almost one full main thread. The clean samples did not reproduce the reported intermittent stall.

This change defaults gameplay to 60 FPS, exposes saved 60 / 120 / display-refresh choices in Settings, and limits the welcome screen to 15 FPS. Simulation advances by actual accepted-frame elapsed time with the existing bounded substeps. Input collection, graphics quality, resolution, water rendering, assets, and physics parameters are unchanged. The pacer skips missed deadlines rather than issuing a catch-up burst, and resets on start, settings changes, and lifecycle recovery.

## Protected base and preview

- Base: `dc723642d7a5fc89a4311bdd9c2b1ce328bd18e1`, `codex/prepared-multi-pipe-wall`, port 5365. Left unchanged.
- Candidate: `codex/chrome-frame-pacing`, strict port 5366. Vite, Studio manifest, launcher scripts and preview command agree. The Studio contract's expected port is updated for this isolated preview.
- Dependency versions were reused without installation or upgrade. `node_modules` is a junction to the existing dependency tree; Vite cache, build, output, and Studio override files are checkout-local. No game assets were edited.

## Measured desktop comparison

Chrome / WebGPU, 2560×1215, DPR 1, Intel Core Ultra 9 285K (24 logical processors), machine with RTX 5080. Same initial camera and scene. Each sample is four seconds; other desktop applications remain running. These are comparative desktop samples, not physical-phone measurements or a guarantee that all stalls are resolved.

| Sample | FPS | Main-thread busy | Renderer process CPU, whole-PC scale |
|---|---:|---:|---:|
| Baseline menu | 154.3 | 99.7% | 4.56% |
| Candidate menu, first comparison | 15.0 | 18.2% | 1.04% |
| Baseline stationary gameplay | 155.4 | 99.7% | 4.49% |
| Candidate gameplay, 60 FPS, first comparison | 60.0 | 47.9% | 2.29% |
| Candidate gameplay, 60 FPS, final repeat | 60.0 | 45.3% | 2.16% |

The first comparison reduced main-thread occupancy by approximately 82% in the menu and 52% in stationary gameplay. CPU percentages refer to the measured thread/process, not all Chrome processes. No GPU timing or total-PC reduction is claimed. The lower baseline FPS than the earlier user-browser sample reflects a separate controlled browser and concurrent desktop activity.

Final run: 60 FPS p95 render-submission interval 18.4 ms, maximum 21.1 ms, zero gaps above 50 ms during the measured stationary gameplay. The 120 FPS setting measured 120.0 FPS; display-refresh mode remained uncapped. Those later cases follow movement, so their CPU costs are not camera-identical comparisons. Menu intervals above 50 ms are expected at 15 FPS, not classified as stalls. Frame counts measure accepted render submissions, not GPU presentation.

## Verification

- Passed typecheck and production build. Vite retains its existing large-chunk warning.
- Passed 20 synthetic refresh/cap combinations (30–240 Hz displays), long-stall/no-burst behavior, reset, and missing/corrupt/blocked persistence storage.
- Passed six existing renderer lifecycle cases and the existing mortar throw timing/physics suite.
- Passed Studio contract 10/10.
- Dedicated UI suite passed default/60/120/display modes, native held keyboard movement at all three settings, saved preference reload, held water emission (160 L in the game's boosted flow), explicit freeze/resume event coverage, and 390×844 settings layout (16px select text, no horizontal overflow).
- Explicit freeze event stopped accepted renders (0 FPS); explicit resume returned to approximately 60 FPS. This is event-path verification, not native tab-visibility proof.
- Inspected before/after gameplay screenshots and the desktop/mobile settings. Graphics remain consistent; slight idle-hand pose differences are time-dependent. Final gameplay capture waits for the start overlay to finish fading.

## Outstanding limits — do not treat as passes

Native tab-switch visibility remains unverified on this automation host. The inspected Chrome page kept `document.hidden=false` when another real same-window tab was selected and when minimized. Tests with focus emulation disabled and a separate native-profile CDP connection also reproduced this tooling/environment limitation without the game. No game visibility code was changed. The UI report explicitly records `nativeVisibility.verified=false`; its `passed` flag covers the other stated checks only.

The bundled develop-web-game client was run for WebGPU and WebGL, but its fixed five-second start-button timeout expired during resource preparation. It produced initial-screen captures, so these runs are not gameplay passes. Both managed browser cleanup reports confirm zero remaining owned PIDs. The dedicated UI suite waits for real readiness and provides the gameplay evidence instead. No skill or installed tool was changed.

Raw local evidence: `output/frame-pacing/report.json` (initial comparison; native visibility failed), `output/frame-pacing-final-check/report.json` (feature checks and explicit limitations), before/after PNGs in those folders, and `output/frame-pacing-client*/browser-lifecycle.json`. Output artifacts are local and ignored by Git.

Before promotion to the existing 5365 runtime, verify native hidden-tab behavior in an ordinary user session and obtain promotion approval. The intermittent stall itself has not been reproduced or proven resolved. No promotion or public deployment is included in this preview.
