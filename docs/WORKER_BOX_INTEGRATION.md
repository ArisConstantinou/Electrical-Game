# Combined worker and box preview

- Sole preview: http://127.0.0.1:5365/Electrical-Game/
- Checkout: C:/Users/arz0r/.codex/worktrees/worker-box-integration/Electrical-Game
- Branch: codex/worker-box-integration, based on box commit 389886b.
- Integrates the existing dirty full-body-worker implementation and latest worker assets without modifying either source checkout or dirty main.
- Start/reuse with `npm run dev`. Launcher pins the checkout and port and compares served source plus worker asset SHA-256 before reusing an occupied port. It refuses mismatches without killing a process.

## Cause and change
The previous 5365 listener served box-hand-builder, whose Game did not import WorkerBody. Its independent procedural hands were therefore visible. Both features now run in the same Game. Anatomical skin replaces legacy skin while retaining both box hand targets and attachment animations. The obsolete single-right-hand fitting reference is excluded because it would reposition the entire new two-hand assembly.

## Verification (2026-09-20)
- Same desktop/mobile box fixture before and after: 9/2 modules assembled and placed; screenshots in output/integration-before and output/integration-after. Mobile is Chromium emulation.
- Regression asserts worker loaded, 52 bones, hidden legacy arms/hands, two independent fitting targets, contextual input, placement and builder reset.
- Build, box logic, finish plane/back-stop and held preset/clearance tests passed.
- Worker preview: forward/down/crouch/overview views and deformed bounds passed, no page errors.
- Inspector: all 6 drag/release combinations passed with zero post-release drift.
- Reference board: 17 tools, no broken images/console errors/portrait overflow.
- GLB contract: 52 joints, two meshes, 24 embedded locomotion clips. Runtime still uses existing procedural locomotion.
- Bundled game client smoke passed; output/integration-skill/shot-0.png visually reviewed.
- Bounded headless Chrome/WebGL A/B on RTX 5080, 1440x810: new body frame P95 8.9-10.6 ms vs old visible rig 8.0-8.8 ms; new body max 12.1 ms, zero >50 ms samples. This frozen-scene sample is not a mobile or whole-game performance guarantee.

## Limits
This restores and integrates the existing anatomical body. Prior wrist/grip and garment defects are still open; it is not a final anatomy release. Original checkouts and main remain preserved. No new model or animation assets were generated for this integration. Do not replace 5365 with one of the individual feature checkouts.
