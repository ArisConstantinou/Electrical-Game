# Site Pro 04 — Cypriot mansion construction site

Status: visual and plan concept for review; the mansion geometry is **not yet built into gameplay**. The three SVG drawings are accessible in-game by aiming at the apprentice and pressing USE/E. The current 7.6 × 7.2 m work room and port 5365 remain the protected playable baseline. Four levels above grade and two below are the working design assumption; the requested range is three to five above grade.

## Reviewable images and drawings

- `exterior-concept.png`: AI-generated massing/material concept, not a screenshot or measured plan.
- `section-concept.png`: AI-generated cutaway explaining program and construction character, not a measured plan.
- `ground-corridor-concept.png`: AI-generated eye-level view from the future ground circulation spine toward the open courtyard, kitchen rough-ins and stair/lift core. The actual current game room is not yet connected to this space.
- `basement-garage-concept.png`: AI-generated eye-level B1 garage/workshop and ramp study with stairs toward B2. Vehicles, lighting and equipment are visual scale cues, not shipped game assets.
- `ground-floor.svg` / `.png`: original dimensioned concept zoning for a 30 × 28 m ground floor and 10 × 10 m open courtyard; the existing 7.6 × 7.2 m room remains in its current world position.
- `building-section.svg` / `.png`: original vertical program at B2, B1, G, L1, L2 and L3 with indicative elevations.
- `electrical-workroom.svg` / `.png`: original front-wall elevation using actual game installation point data: A at x=−1.72 m, B at x=0 m, C at x=+1.65 m; A/B bottom edge 0.30 m and C bottom edge 1.20 m. Dashed PVC routes are explicitly proposed and do not claim an installed or energized circuit.

The in-game viewer has tabs for the three drawings, a readable horizontally pannable portrait view, a full-sheet overview toggle and a live progress line for point heights and PVC cuts. It is reachable with USE/E when the crosshair is on the apprentice; V remains the existing direct shortcut. The whole-house electrical distribution, protective devices, wiring sizes and final circuit routes remain open design decisions, rather than fabricated engineering data.

## Architectural direction

A large contemporary Cypriot residence under construction, arranged around an open, planted courtyard. The street side is comparatively private; internal corridors and shaded verandas face the courtyard. Keep exposed fired-clay masonry, cast-concrete frame/slab bearing, locally plausible earth-toned stone and plaster, deep reveals and sun-shading. Do not furnish finished American-style interiors: kitchens, bedrooms and workshops are identifiable from partitions, service rough-ins, openings and construction staging. The shell needs believable structural continuity rather than unrelated textured planes.

Reference decisions, not imagery to copy:

- [ASK Architects, RMX Residence, Nicosia](https://www.ask-thearchitects.com/rmx-residence): inward-facing private courtyard and covered verandas.
- [Fereos Architects, Residence, Nicosia](https://www.fereos.net/project/private-residence-nicosia/): L-shaped indoor/outdoor circulation, shaded openings, earthy stone/timber/concrete palette.
- [Sence Architects, STONE, Limassol](https://www.sencearchitects.com/projects/stone): large Cypriot residence with garage, workspace and a substantial basement.
- [Visit Cyprus, Lythrodontas](https://www.visitcyprus.com/discover-cyprus/rural/villages-rural/lythrodontas-village-2/): local olive-grove landscape reference for the real outdoor courtyard and distant surroundings.

The drawings here are original game-world schematics. Manufacturer/architect imagery is not embedded or treated as permission to copy their designs. This is not a structural design or a representation of planning permission.

## Coordinates and program

- Existing room stays centred at **(0, 0, 0)**, `x=-3.8…+3.8`, `z=-3.6…+3.6`, floor `y=0`. It remains the first electrical work room, including its primary wall, material supply area and unglazed opening on the left.
- Ground-floor conceptual footprint: **30 × 28 m**, `x=-4…+26`, `z=-4…+24`, with a **10 × 10 m open courtyard** at `x=8…18`, `z=6…16`. Future massing can step back on upper levels instead of forming a plain tower.
- Ground floor: existing work room; service connection to a 3–4 m circulation spine; shaded entrance hall; large kitchen/pantry, dining and living zones; guest room; private ground garage; client workshop and open courtyard. A continuous stair/lift core links every level. The plan shows zones and routes, not invented finished room fixtures.
- B1 at `y≈-3.4 m`: generous vehicle garage, motorbike bay, own workshop, tools/material storage, loading ramp and direct stair/lift access.
- B2 at `y≈-6.8 m`: mechanical/electrical plant, water tanks/pumps, generator/ventilation and dedicated storage. Place equipment with service clearances and actual pipes/conduits in later construction phases.
- G at `y=0 m`: the protected present room and the courtyard-centred social/service wings.
- L1 at `y≈+3.3 m`: family bedrooms, master suite, corridor and shaded verandas.
- L2 at `y≈+6.6 m`: office/workspace, guest rooms, gym/flexible rooms and terraces.
- L3 at `y≈+9.9 m`: smaller family lounge/studio, roof terrace and service access; roof plane around `y≈+13.2 m`.

## Buildable game integration

Do **not** multiply `GAME_CONFIG.room` or stretch the existing `Room` mesh. `PlayerController` currently clamps X/Z to that one room and keeps the eye at its floor height; wall targeting, work surfaces, water simulation and mission coordinates also refer to the current room. Treat it as a stable construction cell inside a new site graph. A usable first slice should connect one real doorway to a corridor, stair core and garage/workshop, with full collision, navigation and return to the original work wall. Stairs require continuous height-aware locomotion and fall/landing behavior, not a visual staircase paired with teleport-only movement. Basement ramp, doors and wall openings require explicit physical hitboxes and exact first-hit targeting.

Keep the sole live preview at `http://127.0.0.1:5365/Electrical-Game/`; an opt-in preview mode can isolate incomplete new geometry on the existing server. Preserve the current save and four-wall work-room interactions. Stream/occlude distant rooms and floors; do not instantiate every brick and every level at once. Compare the first slice to the current ~544 draw-call mobile-emulation work scene, using frame-time spikes and memory as well as FPS. Mobile portrait, landscape, tablet portrait/landscape and desktop must all be visually inspected, with physical-phone performance reported separately.

## First acceptance slice and sequence

1. **Reference/plan gate:** approve floor count, ground orientation and the two concept drawings. Replace any mismatch before building geometry.
2. **Playable sample of final quality:** preserve the current room; cut one correctly supported masonry doorway into a new corridor; build the stair/lift core and ground private garage/workshop with convincing Cypriot construction materials, true openings, collision and 3-touch MOVE+AIM+USE. Same-camera before/after and a complete walk out/back are required.
3. **Whole shell and basement navigation:** add the four stepped levels, B1/B2, garage ramp, courtyard/verandas and all circulation while keeping level streaming and stable saves.
4. **Room-by-room construction state:** kitchen, living areas, bedrooms, service rooms, client work areas, electrical/plumbing rough-ins, material deposition and distinctive, non-repeating damage/finishing stages.
5. **Final QA:** full route and tool interactions on each floor, hitboxes/occlusion, visual comparisons in daylight and work lighting, supported devices, p95/worst frame timings, draw calls, RAM/VRAM where measurable and a physical-phone pass. Concept drawings alone do not complete this work.

Open decisions: exact count above grade, whether B2 should be fully explorable at first release, and final garage vehicle capacity. The working default is four above-grade levels, two explorable basements and a two/three-car ground garage plus larger B1 parking.
