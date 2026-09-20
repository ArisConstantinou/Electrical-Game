# Manual PVC workshop — approved specification

Source request: 20 bundled approximately 3 m rigid PVC pipes, factory plastic straps cut with a visible cutter on E, pipes laid parallel with aligned ends, movable straightedge and marker across all pipes. Optional mark presets 0.50 m / 1.40 m are player-requested preparation marks, not building-code heights. User can choose any supported mark. Insert an internal spring with its centre at the mark, show the pipe transparent, attach a roughly 2 m retrieval cable. A/D shifts the supporting hand; mouse pressure bends locally in successive small sections until 90 degrees. Inspect angle/radius; duplicate an accepted sample across a user-chosen quantity, bounded by actual stock. Carry one to an actual secured box, approach into a close working camera, move a visible cutter to the chosen cut position, click to cut and E to insert. Retrieve spring before transport. Preserve offcuts and stock accounting.

## Implementation boundary and baseline

- Original checkout: C:/Users/arz0r/Documents/ChatGPT/Electrical-Game; main at 27361e8.
- Active isolated checkout: C:/Users/arz0r/.codex/worktrees/manual-pvc-current/Electrical-Game; codex/manual-pvc-current, based on c649dd5 from the current prepared-wall preview. The initial stale-main experiment remains separate in manual-pvc-workflow for recovery only.
- Current WorkerBody source and worker.glb are preserved. Original main's unrelated dirty files were not copied to this corrected base.
- Dependencies reused via read-only-intent node_modules junction; no installation or dependency upgrade. Builds, output and Studio overrides belong to this checkout.
- Current preview (user-requested migration): http://localhost:5365/Electrical-Game/; strict port, source-verifying launcher. The previous 5365 listener was replaced with this preview and 5367 closed; the previous checkout and unrelated 5366 server remain untouched.
- No approval to promote to main or publish an unverified result. No auxiliary agents.

## References and interpretation

- GEWISS DX51320: https://www.gewiss.com/ww/en/products/product.1000002.1000091.DX51320 — actual internal spring for cold bending 20 mm rigid conduit; galvanised steel. Existing detailed cutter and worker hand models are reused.
- Exact pressure/material yielding and bend limits are game approximations. Geometry must preserve centreline length and local bend continuity; no claim of structural simulation or regulatory certification.
- The user said 6 mm retrieval cable; render it 6 mm overall diameter, without treating it as a verified conductor specification.
- A/D is the final requested grip control; E enters/confirms modes, never adds bend by itself.

## Acceptance

Real input tests cover stock opening/marking, optional presets/custom marking, spring insertion and centring, repeated local bends/hand feed, underbent rejection, accepted batch and finite quantity, retrieval, carrying, correct/incorrect cutting and installation collision checks. Escape pauses without losing work. Desktop and touch equivalents, actual screenshots, compiled startup and bounded frame/memory measurements. Physical iPhone evidence remains separate.

## Latest approved revisions (2026-09-20)

- No PVC side panel or measurement sliders. Blue preset marks are in the world at 50 cm and 140 cm; the carpenter square carries a live adjacent distance readout. Mouse moves it; LMB marks; E continues.
- P saves the current guide distance to browser-local storage (`wirehouse:pvc-presets:v1`), Tab cycles marks, Shift+P removes only a matching custom preset. At most 20 custom distances, validated on load; storage rejection is reported rather than silently claiming persistence. Records are specific to this browser/origin, not cloud saves.
- R toggles opaque/transparent physical PVC while working, holding a PVC tool or aiming at an installed pipe. Applies to held, stock, prepared and installed pipe material. Default is opaque. It does not alter the body. The spring is extracted before installation.
- Quantity is controlled by wheel or −/+ at review. Touch uses individual compact action buttons, not a sidebar card; direct touch movement adjusts the guide/cutter.
- User rejected body obstruction in the overhead marking view. Character visibility is disabled only for marking/spreading in normal first-person view, and restored for spring/bending/carrying and full-body inspection. No severed-body geometry or alternate worker is retained. The marker remains visible as the work-view tool.
- Verified: full physical-input workflow through one installed pipe, stock accounting, recut and blocked-channel rejection; R held/installed; desktop/touch-emulated panel absence, visible in-viewport readout, preset persistence after reload, body visibility restoration; typecheck/build. No physical-phone claim.
- Broader PVC workflow is still an experimental preview: refine opening-strap tool contact, cutter/pipe grip contact, full retrieval-lead shape and additional malformed/short-cut cases before final release/promotion. The latest UI/visibility changes do not imply that these original quality criteria are complete.
