# WIRE THE HOUSE

3D first-person Cyprus electrical first-fix simulator built with Vite, TypeScript and Three.js.

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5362/Electrical-Game/`.

Web Game Studio can open the repository through `studio.webgame.json`; its runtime entrypoint is `/Electrical-Game/?studio=1`.

The first vertical slice ends at first-fix inspection. Cable pulling is intentionally out of scope until after the future plaster phase.

## Tools and wet mortar

Keys **1–8** select the internal PVC bending spring, single-action cutter, paint spray, demolition hammer, back box, spirit level, mortar trowel and water hose. The mobile tool strip scrolls horizontally.

The hose now starts in **FLOOD**, with boosted game flow to visibly fill the room. Hold **8** + left mouse / **E**, or hold the mobile aim pad, to keep adding water. The HUD reports the actual floor-water level and litres. Select **MIST** in Settings before gently wetting the **exposed internal sides and back of the chase / box recess**. The nozzle ray stops at the first real surface; water does not paint a fake front face over the hole. Watch for damp material without excess surface water.

Paint marks are optional guidance. Use **4** to excavate at any reachable location. Aim **5** at the wall and use it to trial-fit the active box group, with or without mortar. Surviving masonry limits insertion across the full casing footprint, so shallow or narrow holes leave the box visibly proud. A loose box settles onto a real ledge or falls to the floor. Aim at the placed box with **5** to retrieve and reposition it. Fresh mortar yields around the casing; cured mortar stops insertion. Approach the wall to settle at hand-working distance; aiming low lowers the body, and moving backward releases the stance. Distant and high areas still require repositioning.

The fit is a constrained rigid casing simulation with vertical settling and contact-based adhesion; free tumbling and impact deformation are not modeled. Run `npm run test:box-placement` for native desktop/mobile fitting and geometry checks.

 The hammer settings include **CHISEL SPEED** (0–250%); **− / +** also adjust it in 25% steps. At 0%, impacts stop. **BLADE WIDTH** adjusts the flat chisel from **1 to 5 cm** in 0.5 cm steps; **comma / period** decrease/increase it while holding the hammer. Wider blades contact a broader strip, produce larger connected chips and stop on the edges of narrow holes. The pointed bit retains its own tip and remembers the flat width for switching back. Tilt upward with **[** (or **HAMMER TILT** in touch settings) to shave the inner ribs under the crosshair in an existing cavity. Finishing locks to the nearby exposed backing and preserves its depth, including delayed fragment release. Straight/downward strokes resume deeper excavation. Upward strokes on an intact face can still chip the surface. Hammer impacts keep the camera steady.

Use **7** to fill any reachable gap, before or after fitting a box. Hold left mouse / **E** to advance the live swing bar; release in the green central window (42–58%). The wrist gauge shows actual swing degrees and applied strength separately from loft. Early casts have weaker adhesion and shed loose mortar; late casts split progressively more of the same scoop backward into face splashes, while the remainder travels forward. The bar stops at full strength without auto-throwing. **Up / Down** adjust loft; the gold ring predicts the current trajectory's first contact. Aim at actual support and build outward in layers. **P** presses a trowelful against nearby support. About four well-positioned 0.65 kg loads fill the tested single-gang recess; larger excavations need more. Deposits merge into one cohesive surface and keep the box interior clear. **Ctrl** lowers working height for low boxes; touch players have **CROUCH**, angle, hold/release and packing buttons. Tool changes, right click, pointer cancellation and lost focus cancel a charged cast.

Once the four sides contain stable mortar, **6** opens leveling. If moving the box or washing the fresh bed opens gaps, repack the support before continuing. Initial stability is distinct from curing. Excess hose water erodes fresh mortar and carries slurry down; pre-wetting a dry chase and washing an already filled recess have different effects.

Runoff and missed hose spray form finite puddles which spread, merge and raise the room water level. The optical surface uses the actual **Water Pro 3.5.1** package from Trials, with WebGPU and WebGL2 backends. Indoor water disables ocean foam and underwater effects. Water depth and volume are conserved by a bounded room flow grid; this is a qualitative fluid model, without swimming or structural flood damage. See [integration and build instructions](docs/ROOM_WATER_PRO.md).

Brick fissures remove material from the same 8 mm masonry volume used by collision and tool contact; there are no separate drawn crack lines. Sub-grid weaknesses remain internal until they open into resolvable fractures.

Research: [tool references](docs/TOOLS_REFERENCE_RESEARCH.md), [mortar application](docs/MORTAR_APPLICATION_RESEARCH.md), [cohesion and washout](docs/MORTAR_COHESION_RESEARCH.md), [physical fissures](docs/MASONRY_PHYSICAL_CRACKS.md). Mortar flow, adhesion and erosion parameters are qualitative game approximations, not measured predictions for a construction product.

Checks: `npm run typecheck`, `npm run build`, `npm run test:mortar`, `node tests/mortar-geometry.mjs`, `node tests/mortar-volume-regression.mjs`, `node tests/mortar-masonry-regression.mjs`, `node tests/masonry-cracks.mjs`, `node tests/room-water-field.mjs`, `node tests/room-water-smoke.mjs`, `node tests/free-work-smoke.mjs`, `npm run test:tools-visual`, `npm run test:gameplay`.
