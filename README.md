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

After chasing, select **8** and mist the **exposed internal sides and back of the chase / box recess**. The nozzle ray stops at the first real surface; water does not paint a fake front face over the hole. Watch for damp material without excess surface water.

Paint marks are optional guidance. Use **4** to excavate at any reachable location, then aim **5** at a sufficiently clear recess to fit the active box group. Fit checks use the remaining masonry volume. The hammer settings include **CHISEL SPEED** (0–250%); **− / +** also adjust it in 25% steps. At 0%, impacts stop.

Use **7** to fill any reachable gap, before or after fitting a box. Hold left mouse / **E** to charge the swing and release to cast. **Up / Down** adjust loft; the gold ring predicts the current trajectory's first contact. Aim at actual support and build outward in layers. **P** presses a trowelful against nearby support. About four well-positioned 0.65 kg loads fill the tested single-gang recess; larger excavations need more. Deposits merge into one cohesive surface and keep the box interior clear. **Ctrl** lowers working height for low boxes; touch players have **CROUCH**, angle, hold/release and packing buttons. Tool changes, right click, pointer cancellation and lost focus cancel a charged cast.

Once the four sides contain stable mortar, **6** opens leveling. If moving the box or washing the fresh bed opens gaps, repack the support before continuing. Initial stability is distinct from curing. Excess hose water erodes fresh mortar and carries slurry down; pre-wetting a dry chase and washing an already filled recess have different effects.

Runoff and missed hose spray form finite puddles which spread, merge and raise the room water level. The optical surface uses the actual **Water Pro 3.5.1** package from Trials, with WebGPU and WebGL2 backends. Indoor water disables ocean foam and underwater effects. Water depth and volume are conserved by a bounded room flow grid; this is a qualitative fluid model, without swimming or structural flood damage. See [integration and build instructions](docs/ROOM_WATER_PRO.md).

Brick fissures remove material from the same 8 mm masonry volume used by collision and tool contact; there are no separate drawn crack lines. Sub-grid weaknesses remain internal until they open into resolvable fractures.

Research: [tool references](docs/TOOLS_REFERENCE_RESEARCH.md), [mortar application](docs/MORTAR_APPLICATION_RESEARCH.md), [cohesion and washout](docs/MORTAR_COHESION_RESEARCH.md), [physical fissures](docs/MASONRY_PHYSICAL_CRACKS.md). Mortar flow, adhesion and erosion parameters are qualitative game approximations, not measured predictions for a construction product.

Checks: `npm run typecheck`, `npm run build`, `npm run test:mortar`, `node tests/mortar-geometry.mjs`, `node tests/mortar-volume-regression.mjs`, `node tests/mortar-masonry-regression.mjs`, `node tests/masonry-cracks.mjs`, `node tests/room-water-field.mjs`, `node tests/room-water-smoke.mjs`, `node tests/free-work-smoke.mjs`, `npm run test:tools-visual`, `npm run test:gameplay`.
