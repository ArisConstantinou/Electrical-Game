# Character movement, grips and inspector investigation

Status: **incomplete character correction**. 2026-09-20, isolated `codex/full-body-worker`, base `ec81f1a`; preview stays at `http://127.0.0.1:5365/Electrical-Game/`. Main checkout is untouched. No purchase, account upload, agent, public deployment or promotion.

## Verified change

The inspector panel stopped `pointerup` from reaching the ownerDocument listener used by Three 0.185 OrbitControls. The control stayed in ROTATE after release. Let pointerup/pointercancel propagate and disable damping for immediate inspection response. Six native mouse tests cover rotate and pan in CHARACTER, ALL ASSETS and LIVE CONTROL. After release and subsequent hover, state is NONE and maximum camera drift is 2.22e-16. This is independent of character art quality.

Evidence: `output/motion-grip-rework/before/report.json`, `output/motion-grip-rework/orbit/report.json`; regression: `tests/model-inspector-release.mjs`.

## Why previous grip checks were insufficient

The old tests checked wrist reach and finger planes, not anatomical wrist deviation, skin contact, trigger-pad contact or silhouette. A hand can satisfy those tests while bending more than 90 degrees. Current baseline diagnostics found approximately 69 degrees for hammer, 120 for hose, 85 for tape and 74 for drill. Tool positions and palm orientation must be solved together with elbow position; a universal cylindrical grip does not represent every tool.

Two experimental methods reduced wrist error but failed close-up thumb/trigger evaluation. They are retained under `output/motion-grip-rework/prototype`, **not enabled in the preview**. The candidate clothing repair was also rejected. No new finger-pose success is claimed.

## Ready-made animation findings

- [Blender Human Base Meshes](https://www.blender.org/download/demo-files/): the retained original v1.4.1 file was opened in Blender 5.1.2. It has **zero armatures and zero Actions** (`original-bundle.json`). It is a base mesh bundle, not this character's animation pack. The worker's eight existing Actions were previously baked from its procedural runtime; they are not independent motion-capture clips.
- [Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html): ready-made character animation is available through an Adobe ID. This does not establish exact construction-tool hand poses or compatibility without retargeting.
- [Quaternius Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html): ready-made humanoid animation, including directional locomotion. The complete commercial/source tier and the free subset differ; do not assume all advertised clips are in a free download.
- [Mesh2Motion source assets](https://github.com/Mesh2Motion/mesh2motion-assets): public CC0 Blender sources. Downloaded only the Quaternius aggregate, rig dependency and three directional files into `output/motion-grip-rework/library`, with license texts. Inspected actual Walk, Jog, Sprint, Crouch_Walk, Crouch_Idle, Idle_A, Strafe_left, Strafe_right and Walk_Backwards Actions. Resolved their original absolute linked-rig path locally before sampling.

An isolated lower-body retarget sample was rendered on the actual worker (frames in `output/motion-grip-rework/locomotion`). It establishes a viable import path, **not accepted final locomotion**: directional crouch, phase alignment, transitions, foot sliding, upper-body layering and full movement/tool regression remain to be completed. Candidate runtime is `prototype/WorkerBody-ready-animation.ts`; sampled data is `candidate/locomotion.json`. Neither is enabled. Existing source assets were not replaced.

## Tool-specific contact specification

Manufacturer facts below establish parts and controls. The proposed animation requirements are design criteria for our actual geometry, not a claim that each source supplies finger animation. Confirm dimensions against each in-game mesh before authoring poses.

| Tool | Required grip / actuation in this game | Primary reference or evidence gap |
|---|---|---|
| Drill / driver | Palm behind pistol grip, three lower fingers around handle, index pad on trigger, opposed thumb; wrist follows forearm. Index depresses trigger only during use. | [Milwaukee drill](https://www.milwaukeetool.com/products/details/3-8-magnum-drill-0-2500-rpm-with-all-metal-chuck/0201-20), [trigger/handles manual](https://documents.milwaukeetool.com/58-14-0312d1.pdf). Model-specific trigger dimensions still need measurement. |
| Demolition hammer | Rear D-handle and auxiliary handle require different grasp frames; rear index at trigger, support fingers around side handle. Both contacts retained through A/D/S and vibration. Inspector must call the same grip-role setup as gameplay. | [Milwaukee rotary-hammer manual](https://documents.milwaukeetool.com/58-14-2611d4.pdf). The game's exact hammer model must govern the final rear-handle pose. |
| Mortar trowel | Power grip around wooden/rubber handle, blade and shank clear of fingers; orientation changes between scoop, carry and spread. Do not use drill or can grip. | [Marshalltown masonry tools](https://marshalltown.com/blog/masonry-101-tools-and-techniques), [pointing trowel](https://marshalltown.com/pro-3818-pointing-trowel). Exact motion/contact sequence needs authoring. |
| Level | Support the actual rectangular rail or grip opening; thumb opposes fingers on opposite face. Keep vial readable and measuring edge unobstructed when placed. | [Stabila Type 82 S](https://www.stabila.com/en/products/details/type-82-s-spirit-level.html). Its grip opening is not permission to invent an opening on our level mesh. |
| Tape measure | Palm supports casing, thumb on lock as appropriate; fingers clear of exiting blade, support/finger-stop placement depends on casing. Wrist should not fold up toward shoulder. | [Milwaukee tape and finger stop](https://www.milwaukeetool.com.au/hand-tools/measuring/tape-measures/4932498780T.html). Separate carrying, extending, locking and retracting states. |
| Hose spray gun | Palm around handle, fingers on squeeze lever, thumb opposing handle; release lever when flow stops. | [Gardena multi-purpose spray gun](https://www.gardena.com/uk/products/watering/hose-fittings/multi-purpose-spray-gun/967687201.html). |
| Pipe cutter | Palm and fingers span the two lever handles and close with the cut; avoid static grip through moving lever or blade. | [RIDGID ratchet cutters](https://www.ridgid.eu/rs/en/ratchet-cutters-with-ergonomic-grips). Exact in-game lever pivot/contact still to validate. |
| Paddle mixer | Two distinct handles, index on drive trigger, both hands remain attached during vibration. | [Milwaukee paddle mixer](https://www.milwaukeetool.eu/header/news-media/press-releases/2018/milwaukee%C2%AE-introduces-the-m18-fuel%E2%84%A2-paddle-mixer/). |
| Shovel | One hand on D-grip, other around shaft; move support hand for digging/lifting/tipping without wrist inversion. | [Fiskars shovel anatomy](https://www.fiskars.com/en-en/pages/anatomy-of-a-shovel-1). Source confirms parts; exact game animation remains authored work. |
| Pencil / marking | Small precision grip with thumb, index and middle support, not a full cylindrical power grip. | Geometry/task-derived specification; no exact pose asset verified. |
| Fittings | Casing/part-specific pinch or support depending on size; keep connecting ends clear during placement. | Must split the game's actual fitting variants; no universal manufacturer pose established. |
| Bending spring | Hold the actual conduit/spring assembly according to insertion/bending action; do not treat the coil as a pistol handle. | PVC-specific reference still needed. Copper-pipe spring references were rejected as an unsupported substitute. |
| Laser | Support the actual casing, operate its real buttons, then release it when placed. | Exact game model and control layout still need verification. |
| Spray | Preserve the accepted index-forward actuator pose and thumb contact as a regression boundary. | User's supplied hand photographs; do not replace with another generic grip. |

## Required acceptance before publishing character changes

1. Same-camera before/after close-ups: palm, thumb, trigger and opposite side of every tool; no skin passing through handle, no folded wrist, no fingertip hovering over trigger.
2. Real idle, start, stop, W/A/S/D and diagonals; crouched equivalents; slow/normal/fast transitions. Review a complete cycle, not one favourable frame.
3. Both hammer sides, mixer and shovel two-hand contact; trowel scoop/carry/spread; tape extension/retraction; trigger rest/pressed/released states.
4. Tool switching preserves the worker body/clothes, the existing spray contact, head shadow, full-body C view and inspector LIVE interactions.
5. Validate editable Blender Actions and exported/runtime playback separately. Per-frame checks supplement visual acceptance; they cannot replace it.
6. Build, focused regressions and comparable desktop frame-time/geometry measurements. A desktop viewport is not physical-mobile performance evidence.

The broad character task remains unfinished. Next work must replace the failing generic-grip approach with per-tool authored poses/contact frames and a validated animation retarget, not another blind thumb-coordinate adjustment.
