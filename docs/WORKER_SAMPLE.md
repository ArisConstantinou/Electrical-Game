# Full worker sample — in progress

Protected base: `codex/mortar-mixing-fixes`, commit `ec81f1a03a64600eea7b138580b2b149306230e3`, preview 5364.
Isolated work: `codex/full-body-worker`, preview http://127.0.0.1:5365/Electrical-Game/.
Main and the previous preview are not modified or promoted.

## Approved scope

Full anatomical adult worker including head, torso, hands, fingers, nails, legs and shoes. First review sample: spray-can grip, relaxed free hand, standing, walking and crouching. Subsequent user corrections extended the shared body to every tool and mixing state; wider artistic acceptance remains pending. Editable Blender source, exported model and runtime verification are required. No paid generation, agents or dependency changes approved/used.

## Outfit correction, 19 September 2026

User supplied `F:/Chrome Downloads/IMG_9569.JPEG` as the outfit reference (not an instruction to reproduce the person's face). Replace the initial green shirt/brown boots direction with:

- Grey Milwaukee pocket T-shirt; reinforced crew collar, short sleeves, small red/white chest-pocket badge. Reference: https://uk.milwaukeetool.eu/en-gb/work-t-shirt-short-sleeve/wtssg/
- Black Milwaukee FREEFLEX work trousers, holster tool pockets, side pockets, reinforced knee-pad panels, belt loops. Reference: https://www.milwaukeetool.eu/en-eu/freeflex-work-pants-black/wp/?variant=1039814 . Product features agree with the visible outfit; exact trouser SKU not specified.
- User explicitly identified shoes as **FXT S3S B1M110133 ESD SC FO SR 36, 4932498119**. Official page confirms SKU and model: https://www.milwaukeetool.eu/en-eu/flextred-s3s-safety-boots-black-b1m110133-esd-sc-fo-sr/fxt-s3s-b1m110133/ . The official hero image was visually inspected: black mid-height nubuck upper, BOA dial/cables, black toe scuff cap, layered dark sole with grey tread edge and red heel stabiliser. This supersedes the tentative low-cut/laces assumption.
- Private reference photo stays outside version control; no upload to external generation services.

## Source

Official Blender Human Base Meshes v1.4.1, CC0, `Body Male - Realistic` collection. https://www.blender.org/download/demo-files/ . Original downloaded archive remains untouched under ignored `output/human-reference`; uncut anatomical source also retained in the editable `.blend`.
Clothes, shoes, fitted skeleton and runtime posing are task-authored adaptations; no claim that the base bundle provided ready-made rigging or garments.

## Current limitations

This is an unfinished experimental sample. Garment cut/fit, finger contact, body-camera placement and footwear details are still being corrected. Do not treat a successful build or model export as visual acceptance. No final performance, animation clip or gameplay acceptance claim yet.

## Visual rejection and correction checkpoint — 19 September 2026

User rejected the neutral render: boots/legs misaligned, shirt too wide, pockets unnatural. Original rejection preserved unchanged at output/human-reference/rejected-outfit-before.png. Corrected neutral review: output/human-reference/worker-rest.png. The relative camera, lighting and 800x1000 output are preserved; model, camera and lights were jointly rotated to standardize the gameplay-facing axis without changing the relative review view.

Changes:
- Boot collar now follows the ankle position; sole outline follows the upper rather than a smaller ellipse.
- Shirt air gap reduced from 24 to 16 mm, tapered at the waist; smooth cut collar and fabric-bound hems replace intersecting overlapping strips.
- Smaller open holsters follow front/side trouser surfaces; thigh pockets moved to the sides. Dark stitching replaces the oversized bright grid. One tape measure remains, with knife/pencil and thigh drivers.
- Flattened trouser fly instead of tracing the underlying anatomy.
- Runtime inspection found source facing +Z after glTF conversion while locomotion assumes -Z. Source rig now turns once, and anatomical side names follow that change. Blender automatically propagates bone renames to deformation groups; manually renaming groups a second time was an unsuccessful intermediate attempt and was removed. Runtime hand orientation was updated for the corrected anatomical sides.
- Crouch pelvis/knee/torso relationship corrected and checked visually with forward-facing boots.

Validation at this checkpoint:
- npm run build and git diff --check pass (existing bundle-size warning remains).
- tests/worker-preview.mjs passes with no page errors; verifies left/right foot order, forward-facing toes and finite bounded deformed meshes, and captures six actual runtime views. These are fixture poses, not physical mouse validation.
- tests/worker-performance.mjs: Chrome 153 headless, WebGL, 1440x810, RTX 5080, 24 logical cores. Frozen-scene A/B: old rig 226 draws/125665 submitted triangles, worker 245 draws/668525 submitted triangles including render passes. New worker CPU submission median 5.6–5.7 ms, p95 8.0–8.4 ms, pose p95 0.6 ms, no >50 ms sampled frames. This is a short desktop diagnostic, not GPU timing or mobile performance evidence.
- Runtime GLB: 12,034,268 bytes, 308086 source triangles, two consolidated meshes, 18 materials, one skeleton/52 joints, no baked clips.

Still pending: user visual acceptance; more natural cloth/material detail compared with product photography; close-contact finger refinement and movement transitions; editable baked clips and wider locomotion coverage; mobile/representative-device performance validation and possible mesh optimization without losing visible details. Other tools still use the previous rig by the approved staged scope. Do not claim final completion, full product fidelity or production readiness.

Protected previews remain unchanged. No commit, push, merge or deployment made for this unaccepted sample. No paid generation or agent work used.

Latest pose report: user supplied the earlier backward-facing crouch screenshot while verification was running. Rechecked current preview GLB against the local export: SHA256 d2e11e50d43b7a3dab7f8f39b26e51993ffaa396268e085683e37be70d7326a8 matches on both sides. Current output/worker-review/overview-crouch.png shows the corrected facing and forward boots with the same fixture camera; no browser-cache assumption is needed. Bundled skill client also reaches gameplay with the worker loaded and its owned browser processes closed. Its first attempt hit the client's fixed 5-second start-click timeout; a test-only navigation readiness wait resolves that without changing game readiness or bypassing Pointer Lock protection.

## Fixed preview port — 19 September 2026

User instruction: keep 5365 as the default port; do not change it again. The worker checkout uses http://127.0.0.1:5365/Electrical-Game/ for dev, dev:worker, studio:webgame and preview. Vite server and preview both enforce strictPort. If the port is occupied, diagnose its owner; do not silently choose another port. The protected older mortar checkout on 5364 is separate and is not the default worker preview.


## Head shadow, thumb contact and directional gait — 19 September 2026

This checkpoint supersedes earlier spray-only and no-baked-actions notes; it does not claim final acceptance of the entire character.

- Head meshes remain in the shadow pass; cloned head materials disable colour/depth writes only in first person. The inspection view restores both. Verified in WebGL and WebGPU.
- Spray orientation now follows the palm consistently across standing, looking down and crouching. The thumb uses a nearly straight distal joint, flesh-envelope avoidance and sampled deformed-skin contact, with cached solutions. Endpoint-only fitting previously left 8–10 mm penetration; the final four-case checks measure positive thumb gaps under 2 mm.
- Index target comes from the actual actuator mesh. LMB depresses that actuator by 2 mm and the index follows it. Final index pad-to-button gaps were approximately 2.0–2.7 mm, with 141–146 distal finger vertices above the button footprint. This is geometric evidence, not a claim of skin compression simulation.
- Gait follows travel direction, including backwards and diagonal motion. Slow lateral steps remain lateral; faster lateral travel turns the body toward travel to avoid an implausibly rapid shuffle. Gaze/tool aim stay independent. Resting hands preserve the forearm rest relationship to avoid elbow twisting.
- Source worker.blend contains eight editable in-place Actions: Worker_WalkForward, Worker_WalkBackward, Worker_StrafeLeft, Worker_StrafeRight, Worker_JogLeft, Worker_JogRight, Worker_CrouchLeft, Worker_CrouchRight. Runtime still uses directional IK rather than playing these review clips. Rebuild with tests/worker-motion-review.mjs then scripts/bake-worker-motion.py; the latter produces a verified staging .blend before replacing the editable source. Rest-space conversion error 1.46e-6; maximum baked joint-position error under 0.001 mm. Staged file reopened successfully before replacing source; prior source preserved under ignored output/worker-three-fixes/before.

Validation: 15 direction/speed cases; actual W/A/S/D press/release at rotated view yaw; LMB press/release standing and crouched; 18 tool/mixing/return states; four hand/shadow states on each of WebGL and WebGPU; bundled game-client screenshot/state inspection; typecheck/build and diff check. Existing large-bundle warning remains. Actual screenshots and eight recorded in-place cycles: output/worker-three-fixes/review.html. Reports live alongside it.

Desktop diagnostic (Chrome 153, RTX 5080, 1440x810, headless WebGL): stationary worker CPU submission median 3.6–3.9 ms and p95 4.5–5.2 ms, versus before median 3.1–3.3 ms and p95 4.9–5.7 ms. Pose p95 0.8 ms versus 1.0 ms before; zero sampled frames above 50 ms. Head restoration adds 8 draws (245 to 253) and raises submitted triangles, including render passes, from 668525 to 734413. These brief diagnostics do not establish physical phone or GPU-frame timing.

Remaining wider sample issues: material/detail fidelity and external head/eye appearance, broader body/tool animation acceptance, representative mobile performance. No publication, merge or promotion to the protected checkout. Default preview remains 5365 with strictPort.

Final moving/crouching/yaw diagnostic: median CPU submission 3.5 ms, p95 5.5 ms, pose p95 0.8 ms, sampled frame maximum 7.5 ms, zero >50 ms. An intermediate 16.1 ms p95 was traced to invalidating the palm-space thumb cache on crouch and signed-zero string differences; removing those irrelevant invalidations retained the full deformed-skin contact checks. Local/served GLB SHA256 both 514891996e7cb0cfc4d845b18ba72cf759ccf7cfdbde6161e107e8460ac36fb7. Review page returns HTTP 200 on the same 5365 server.

## Forward spray grip from both reference views — 19 September 2026

Supersedes the preceding grip measurements. The user supplied rear/front hand photographs and explicitly requested the index point forwards. The whole palm/contact frame now rotates behind the actuator, rather than merely curling the index sideways. Hand inclination relative to the can was corrected; the arm is placed from a reachable elbow and forearm with wrist deviation limited to 25 degrees. Looking down lowers the elbow and forearm while retaining the grasp. Pressing changes the actuator/index, not the whole grasp orientation.

The first fixed-can rotation produced roughly 80 degrees of wrist deviation. Translating that pose to straighten the wrist moved the can outside the view. Neither attempt was accepted. The final pose was checked from first person and an external arm/hand view; actuator visibility and forward finger direction are now regression assertions.

Four final WebGL/WebGPU states (idle, pressed, down, crouch) pass: forward direction dot above 0.9995, wrist about 7.8 degrees standing and at most 25 degrees looking down, index skin-to-button gap -0.15 to +1.05 mm, and thumb skin clearance approximately 0.008–0.05 mm. These are mesh contact tolerances, not simulated skin compression. All weighted thumb vertices are checked during fitting; the initial orientation pass fits only the index, avoiding two expensive thumb fits. The private reference photos remain outside the repository.

Native LMB down/up and W/A/S/D checks pass; 18 tool/mixing/return states pass. Typecheck/build pass with the existing bundle-size warning. Moving desktop diagnostic after this change: CPU median 3.4 ms, p95 4.5 ms, pose p95 1.1 ms, maximum sampled frame 11 ms, zero above 50 ms (same headless Chrome/RTX 5080 conditions as above). Runtime posing changed; the GLB and eight locomotion Actions were not rebuilt. The full character remains an experimental sample pending broader visual acceptance. Fixed preview 5365; no commit, push or promotion.
