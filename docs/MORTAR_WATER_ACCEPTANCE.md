# Mortar, free work, physical fissures and room water

Candidate validation, 2026-09-13. Local route: `http://127.0.0.1:5362/Electrical-Game/`.

## Behavior

- Paint marks guide layout and are optional. Box placement projects the aim onto the installation plane and checks actual remaining masonry. An obstructed recess reports its required clearance instead of requiring a painted mission stage.
- Hammer speed ranges from 0 to 250% in 25% steps, through the settings slider or Minus/Equal. Zero stops impacts; release stops repeated use at every rate. Impact energy is unchanged, so speed changes cadence rather than silently changing masonry strength.
- Real tensile fissures remove material in the shared masonry volume. Drawn crack overlays are removed. Geometry, contact and persistent state agree at the existing 8 mm resolution.
- Wet mortar accumulates in a shared scalar field with a cohesive meshed surface. Box cutouts use all six local planes and preserve the rear bed. Unbacked material falls, and fresh washed slurry slips off ledges instead of becoming rotating or stacked rigid discs.
- Approximately four appropriately aimed 0.65 kg loads fill the tested single-gang recess. Clearance, scoop placement and cavity volume matter; there is no unconditional four-click completion counter.
- Hose water wets exposed inner chase surfaces, washes fresh mortar and carries runoff onto the floor. Missed spray and runoff enter a separate conserved water system. Water Pro supplies finite room water optics on WebGPU and WebGL2.

## Verified evidence

`tests/mortar-volume-regression.mjs` covers a non-mission cavity, connected filling, four-load single-gang support, six-minute washout, unsupported field removal, rear-bed preservation, tiny visible-volume retirement and integrated water callbacks. One callback fixture accounts for 0.24 L as 0.102 L absorbed plus 0.138 L entering RoomWater, within floating point tolerance.

`tests/mortar-masonry-regression.mjs` uses the actual hollow masonry and production box. Four pack actions produce approximately 83–92% perimeter coverage across runs, with one cohesive skin. Washing after six minutes reduces coverage and revokes readiness. This fixture uses diagnostic camera positioning and direct production impact/pack APIs. The separate full gameplay test supplies ordinary-input evidence.

The larger box-group mission exposed a coverage error: a ray beginning inside a thick continuous bed could find no surface crossing within its test segment and incorrectly report an empty side. Coverage must query occupied volume over the same bounded segment, including an origin already inside mortar. The corresponding regression fills all 48 sample origins and distinguishes volume support from surface-only intersections; the support threshold and reach remain unchanged.

`tests/masonry-cracks.mjs` verifies actual opened nodes, no visual overlay for weakness-only strikes, persistence and browser screenshots. `test:masonry-contact` verifies blade/contact direction, penetration into hollow material and cross-boundary removal. `test:hammer-stance` verifies desktop/touch camera and hand poses, fixed work contact and reversible left/right transitions.

`test:tools-visual` verifies all eight tools at desktop 1366×768 and touch-emulated 390×844, hand grips, selected tools, text sizes, page overflow and blocked controls. The bundled develop-web-game client was also run on the final Water Pro candidate and its screenshot inspected.

`tests/free-work-smoke.mjs` passed native slider, release and unmarked placement on both platforms. At 0/25/250%, the final tested input bursts produced 0/2/22 desktop and 0/2/24 touch impacts. Both accepted a physically cleared box cavity with zero paint marks. Native touch gestures are held beyond an impact interval after positioning, rather than mistaking a CDP delivery acknowledgement for a completed gameplay action. A separate 844×390 landscape check verified the slider stays accessible without page overflow and uses 14 px text.

`tests/room-water-field.mjs` verifies conservative filling across the finite 29.0848 m² floor. `test:room-water` checks both backends, actual held hose input, runoff, merging puddles and a separately labeled accelerated 1500 L flood fixture. Raising actual water mesh vertices is checked alongside the volume ledger. These fixtures are not claims that an ordinary hose added 1500 L during the short test.

## Scope of the simulation

Mortar rheology, erosion and adhesion are qualitative approximations informed by the primary sources in `MORTAR_COHESION_RESEARCH.md`; they are not calibrated construction predictions. Initial gameplay support at 1.3 seconds is distinct from the 3600-second fresh-work window and cement curing.

The floor solver is a bounded shallow-flow approximation. It retains water at the room perimeter, including the unfinished rear opening, to support the requested room-filling sandbox. It does not implement swimming, submerged-camera optics or flood damage to the building. Browser mobile results use Chromium emulation; a physical iPhone/Safari has not been tested.

Water Pro is distributed only as this game's compiled component, with required license notices and no vendor source files or source maps. See `ROOM_WATER_PRO.md` for reproducible integration details.

## Final integrated run

The clean `output/gameplay-cavity-priority-final/gameplay-report.json` run passed all A/B/C points on desktop and touch-emulated mobile, including actual excavation, prewetting inside the chase, mortar casts/packing, leveling and conduit installation. Point C used no paint marks on either platform. Browser errors were empty, the default Water Pro renderer was active, and hot reload was not intercepted. Independent front inspection screenshots confirm open box mouths and continuous thin repair material.

The final cavity deposition kernel prioritizes nearby exposed voids ahead of intact-face coating. It stops at the first surviving masonry backing in each local column, preserves sealed chambers, and caps exterior buildup at a thin application layer. Excess retains its mass and falls. A forward opening corridor prevents paste or loose residue from masking a box mouth while preserving its rear bed. These changes resolve the balloon-like accumulation seen in the earlier failed candidate.

Final post-leveling bed coverage A/B/C: desktop 91.7/100/100%; mobile 91.7/91.7/100%. This particular run needed no extra repack cycle. Moved/tilted exclusion, lost-support and washout regressions separately exercise bed changes.

The 60-animation-frame worked-scene samples measured desktop mean 16.67 ms and p95 16.7 ms. Mobile emulation measured mean 18.33 ms and p95 16.8 ms with one 116.7 ms spike; this is not evidence of uniformly smooth performance on a physical phone. The separate fenced water benchmark and its limits are documented in `ROOM_WATER_PRO.md`.
