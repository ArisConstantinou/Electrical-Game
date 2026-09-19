# Preparation bay, ready wheelbarrow and drum mixer

Preview: <http://127.0.0.1:5364/Electrical-Game/>. Work is isolated on
`codex/mortar-mixing-fixes`; protected main checkout and public deployment are unchanged.

## Layout and models

- User-approved references: yellow single-wheel pressed-steel wheelbarrow and orange electric drum mixer. New geometry is authored locally; no purchased/downloaded models, brand artwork or dependencies.
- Final user correction: the two mixers stand beside each other at the rear. Sand/shovel, cement, water and rinse pail form an open horseshoe around them. The wheelbarrow parks beside the approach, within reach of the initial player position. The central 1.36 m × 2.30 m approach does not intersect any equipment's world bounds.
- Rounded double-wall tray and rolled rim, continuous tubular frame, tyre/rim/tread, hollow drum, internal mixing fins, gear teeth, tilt wheel and spring, motor vents, fasteners and a connected site power lead. Hidden sides are plausible construction, not a claim of exact manufacturer CAD.
- Runtime construction source: `src/world/SiteEquipmentModels.ts`, with named parts and Studio IDs. Layout: `src/world/MixingStationModels.ts`.
- Editable Blender 5.1 source: `assets/source/site-equipment.blend`; standard glTF exports: `assets/exports/wheelbarrow.glb`, `assets/exports/concrete-mixer.glb`. Blender import and saved-file reopen verified 266 editable mesh objects with finite vertices. Generate again with `scripts/export-site-equipment.mjs` and `scripts/build-site-equipment-blend.py`.
- Runtime uses the procedural source. The Blender file is an editable snapshot; it is not silently loaded in place of the source. Runtime drum rotation is in `src/systems/DrumMixer.ts`. The wheelbarrow remains parked; no pushing, scooping/refill or tipping animation was added.

## Supplies and use

- Fresh sessions include a full wheelbarrow: nominal 60 L / 114 kg of ready mortar. Selecting the wall trowel shows its load immediately. Actual wrist release consumes 0.65 kg; cancelling or selecting tools consumes nothing. The visible surface recedes with stock and disappears when empty. Refresh starts a new full stock.
- The original 20 L bucket/cordless workflow remains available. A ready prepared batch takes priority over the wheelbarrow; exhausted prepared stock falls back to the barrow. Exhausting all ready sources leaves the blade empty.
- Drum capacity is 60 L. Pick the water jug, aim at the drum, press E/INTERACT: each pour adds up to 5 L toward the 20 L recipe water target. This also selects the drum as the preparation destination.
- Use the preparation trowel on a sack (first interaction opens it), or the shovel on sand. With the drum selected, the dose stays visibly on the tool. Walk to and aim at the drum, then E/INTERACT pours the dose. A loaded dose can also be poured into the bucket. Overflow keeps the dose on the tool.
- In-game full drum recipe: 20 L water, 18 cement scoops, 36 sand scoops. Shared source stock is consumed once; the two vessels have separate contents, readiness and mass accounting.
- Put down the held tool; E/INTERACT on the drum starts/stops the motor. Drum rotation continues while using the cordless station. Ingredients and blending progress appear inside the actual tilted drum, clipped to a horizontal surface at the calculated volume. Stop a ready drum and press FINISH to use its mortar with the wall trowel. A running drum does not supply the wall trowel. Blur/backgrounding stops its motor.
- Receipt titles identify the selected vessel, and source prompts identify the destination. The receipt and wall throw gauge do not cover each other while changing workflows.

## Verification

- `tests/site-equipment-ui.mjs`: initial load, three native casts with exact stock reduction, cancelled windup, prepared-batch priority, depletion/empty mesh, refresh, finite geometry, clear aisle, desktop/portrait/landscape views and paired performance samples.
- `tests/drum-mixer-logic.mjs`: shared stock/transfer conservation, overflow retention, readiness only after mixing, exclusion of running supply, finite contained geometry and depletion.
- `tests/drum-mixer-ui.mjs`: complete native desktop/touch drum preparation, retained doses, explicit pours, rotating drum, simultaneous bucket/cordless use, stop/finish and wall mortar from the drum.
- `tests/immersive-mixing-ui.mjs`: complete original bucket workflow on desktop, portrait and landscape. Aim fixtures now use the relocated bucket and real visible preparation-trowel surfaces; no reliance on decorative line hits or the former station origin.
- `tests/mixing-world-tool-switch-ui.mjs`: queued tool changes, exact pickups and put-down. Its competing-target regression uses an explicit nearby-sack fixture because the new production layout deliberately separates sack and shovel; ordinary-layout access is covered by the two full workflow tests.
- Existing MortarBatch and trowel supply/view checks; TypeScript/build; unmodified production bundle startup on WebGPU desktop and WebGL touch, including loaded trowel and drum rotation; bundled game client with Pointer Lock blocked and owned browser cleanup.
- Screenshots and detailed JSON reports: `output/site-equipment-before`, `output/site-equipment-after`, `output/drum-mixer-ui`, `output/immersive-mixing-ui`, `output/site-equipment-production`, `output/site-equipment-skill`.

## Performance and limits

Chrome on Windows, Core Ultra 9 285K / RTX 5080 host (also Intel graphics), WebGL, fixed bay camera. The 390×844 viewport is desktop emulation, not physical phone or Safari evidence. Alternating the new equipment off/on after warmup: absent mean 5.64–6.15 ms / p95 7.9–8.3 ms; present mean 7.43–7.99 ms / p95 9.8–10.2 ms, maximum 13.4 ms. Present bay: 404 draw calls including shadow/render passes and 202,783 triangles across passes. Geometry: wheelbarrow 20,352 triangles; drum mixer 34,256. No geometry resolution or render quality was reduced to reach these numbers.

The initial full-scene baseline and final desktop view differ in material/equipment placement by user request; the paired visibility samples isolate equipment rendering cost more closely. Performance measurements are bounded samples, not a promise for all hardware. Vite retains the existing large-chunk warning. Account usage is available only in aggregate and cannot be attributed precisely to this task; no paid credits, downloads or model services were used.
