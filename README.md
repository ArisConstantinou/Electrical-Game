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

Fit the boxes with **5**, then use **7**. Hold left mouse / **E** to charge the swing and release to cast. **Up / Down** adjust loft; the gold ring predicts the current trajectory's first contact. Aim at the real support around each side and build outward in layers. **P** presses a small trowelful against nearby support. **Ctrl** lowers working height for low boxes; touch players have **CROUCH**, angle, hold/release and packing buttons. Tool changes, right click, pointer cancellation and lost focus cancel a charged cast.

Once the four sides contain stable mortar, **6** opens leveling. If moving the box opens gaps, the game keeps its alignment and asks you to pack those gaps before confirming again. This is a playable workability stage, not a claim that fresh mortar has fully cured. Unretained material falls or rests on actual cavity ledges. Moisture, adhesion and accelerated setting are qualitative gameplay models.

Research: [tool references](docs/TOOLS_REFERENCE_RESEARCH.md), [mortar application](docs/MORTAR_APPLICATION_RESEARCH.md). Validation: [acceptance report](docs/TOOLS_MORTAR_ACCEPTANCE.md).

Checks: `npm run test:mortar`, `node tests/mortar-geometry.mjs`, `npm run test:tools-visual`, `npm run test:gameplay`.
