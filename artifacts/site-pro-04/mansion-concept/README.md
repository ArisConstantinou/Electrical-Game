# Site Pro 04 — Cypriot mansion construction site

Status: the user selected **five levels above grade and two below** on 2026-09-22. An opt-in `?mansion=preview` branch now connects the existing work room to an unfinished brick passage, ground foyer, ground private garage/workshop, open courtyard and continuous two-flight cast stairs reaching L1 through L4. Each modeled room has an unfinished door-ready opening, with no installed door or teleport. L3/L4 step back over exposed lower slabs and have rough open terrace apertures with temporary edge guards. The courtyard is reachable through a doorless opening and includes an animated olive, open window apertures into recessed unfinished rooms, temporary walking pads and exposed structural frame. This remains an **incomplete construction slice**, not the full mansion or a release: kitchens, bedrooms, lift core, two basements and more of the 30 × 28 m shell still need construction. The three SVG drawings are accessible in-game by aiming at the apprentice and pressing USE/E. The current 7.6 × 7.2 m work room and port 5365 remain the protected default playable baseline.

## Reviewable images and drawings

- `exterior-concept.png`: AI-generated massing/material concept, not a screenshot or measured plan.
- `section-concept.png`: earlier AI-generated cutaway explaining program and construction character, not a measured plan; its old four-level massing is superseded by the selected 5+2 section drawing.
- `ground-corridor-concept.png`: AI-generated eye-level view from the future ground circulation spine toward the open courtyard, kitchen rough-ins and stair/lift core. The current game room now connects to a first incomplete ground/first-floor slice, not all spaces in this concept.
- `basement-garage-concept.png`: AI-generated eye-level B1 garage/workshop and ramp study with stairs toward B2. The garage is an empty construction zone with materials, temporary lights and open shafts; no vehicles or fitted doors.
- `ground-floor.svg` / `.png`: original dimensioned concept zoning for a 30 × 28 m ground floor and 10 × 10 m open courtyard; the existing 7.6 × 7.2 m room remains in its current world position.
- `building-section.svg` / `.png`: selected vertical program at B2, B1, G, L1, L2, L3 and L4 with indicative elevations.
- `electrical-workroom.svg` / `.png`: original front-wall elevation using actual game installation point data: A at x=−1.72 m, B at x=0 m, C at x=+1.65 m; A/B bottom edge 0.30 m and C bottom edge 1.20 m. Dashed PVC routes are explicitly proposed and do not claim an installed or energized circuit.

The in-game viewer has tabs for the three drawings, a readable horizontally pannable portrait view, a full-sheet overview toggle and a live progress line for point heights and PVC cuts. It is reachable with USE/E when the crosshair is on the apprentice; V remains the existing direct shortcut. The whole-house electrical distribution, protective devices, wiring sizes and final circuit routes remain open design decisions, rather than fabricated engineering data.

Actual L1-to-L2 gameplay screenshots and the four-viewport route report are in `artifacts/site-pro-04/review/mansion-second-floor/`. The route checks the exposed L1 side-deck guard, both 11-riser flights, the L2 rough doorway and return to L1. `artifacts/site-pro-04/performance/mansion-ground-preview.json` compares the released room, the same pose in preview, foyer, both stair levels, courtyard and L2 room using Chrome mobile emulation on a Windows host; it is not physical-phone evidence.

The upper-level review in `artifacts/site-pro-04/review/mansion-upper-level/` adds L3/L4 room and terrace screenshots plus a same-pose before/after view from the L3 terrace. The modeled exterior extends beyond the original left-side courtyard: rising terrain, field-boundary stonework, independently placed olive trees with moving canopies, low shrubs and a neighbouring unfinished residence with actual recessed openings. Near/far geometry LODs keep the visible depth while reducing distant draw calls. [Visit Cyprus's Lythrodontas description](https://www.visitcyprus.com/discover-cyprus/rural/villages-rural/lythrodontas-village-2/) supports olive-grove landscape character; it does not authorize copying any particular photograph or house design.

The ground garage review in `artifacts/site-pro-04/review/mansion-ground-garage/` compares the previously blocked foyer wall with the new doorless route, empty vehicle bay and separate workshop. The cast roof, exposed clay infill and actual walls/partitions are visible in gameplay captures. This is an early construction shell, not a finished architectural-quality scene or basement garage. The current bay is nearer the stair core than the conceptual plan's eastern 8 × 10 m private garage; its final position and connection must be reconciled as the 30 × 28 m ground shell grows.

`artifacts/site-pro-04/review/mansion-garage-junction/` records the same camera before and after adding cast ring beams and columns between the garage's masonry infill and roof slab, plus a subtle shared construction-dust contact at the wall/slab foot. The beams and columns are modeled geometry that casts/receives shadows; the dust is only a shallow material transition. An [engineering project portfolio in Cyprus](https://patsalosavvisbros.com/projects) documents examples of reinforced-concrete frames and ribbed slabs with clay infill, including an older structure; it is a reference for the game's visible construction logic, **not** an engineering specification for this fictional mansion. The current floor remains too uniform in broad views and needs further material/lighting work.

## Architectural direction

A large contemporary Cypriot residence under construction, arranged around an open, planted courtyard. The street side is comparatively private; internal corridors and shaded verandas face the courtyard. Keep exposed fired-clay masonry, cast-concrete frame/slab bearing, locally plausible earth-toned stone and plaster, deep reveals and sun-shading. All garage bays, room passages and the lift shaft remain rough open construction apertures with temporary edge protection: no installed doors, shutters, glazing, cars or motorcycles. Kitchens, bedrooms and workshops are identifiable from partitions, service rough-ins, openings and construction staging, with no finished furniture or commissioned plant. The shell needs believable structural continuity rather than unrelated textured planes.

Reference decisions, not imagery to copy:

- [ASK Architects, RMX Residence, Nicosia](https://www.ask-thearchitects.com/rmx-residence): inward-facing private courtyard and covered verandas.
- [Fereos Architects, Residence, Nicosia](https://www.fereos.net/project/private-residence-nicosia/): L-shaped indoor/outdoor circulation, shaded openings, earthy stone/timber/concrete palette.
- [Sence Architects, STONE, Limassol](https://www.sencearchitects.com/projects/stone): large Cypriot residence with garage, workspace and a substantial basement.
- [Visit Cyprus, Lythrodontas](https://www.visitcyprus.com/discover-cyprus/rural/villages-rural/lythrodontas-village-2/): local olive-grove landscape reference for the real outdoor courtyard and distant surroundings.

The drawings here are original game-world schematics. Manufacturer/architect imagery is not embedded or treated as permission to copy their designs. This is not a structural design or a representation of planning permission.

## Coordinates and program

- Existing room stays centred at **(0, 0, 0)**, `x=-3.8…+3.8`, `z=-3.6…+3.6`, floor `y=0`. It remains the first electrical work room, including its primary wall, material supply area and unglazed opening on the left.
- Ground-floor conceptual footprint: **30 × 28 m**, `x=-4…+26`, `z=-4…+24`, with a **10 × 10 m courtyard zone** at `x=8…18`, `z=6…16`. The current open gravel portion occupies `x=9…18` and the west metre is a shaded/covered edge. Future massing can step back on upper levels instead of forming a plain tower.
- Ground floor: existing work room; service connection to a 3–4 m circulation spine; shaded entrance hall; large kitchen/pantry, dining and living zones; guest room; private ground garage; client workshop and open courtyard. A continuous stair/lift core links every level. The plan shows zones and routes, not invented finished room fixtures.
- B1 at `y≈-3.4 m`: generous empty future vehicle garage and workshop, staged tools/material storage, loading ramp and direct stair/lift access. No vehicles are present during this construction phase.
- B2 at `y≈-6.8 m`: mechanical/electrical plant, water tanks/pumps, generator/ventilation and dedicated storage. Place equipment with service clearances and actual pipes/conduits in later construction phases.
- G at `y=0 m`: the protected present room and the courtyard-centred social/service wings.
- L1 at `y≈+3.3 m`: family bedrooms, master suite, corridor and shaded verandas.
- L2 at `y≈+6.6 m`: office/workspace, guest rooms, gym/flexible rooms and terraces.
- L3 at `y≈+9.9 m`: smaller family lounge and terrace.
- L4 at `y≈+13.2 m`: stepped-back studio, terrace and service access; roof plane around `y≈+16.5 m`.

## Buildable game integration

Do **not** multiply `GAME_CONFIG.room` or stretch the existing `Room` mesh. `PlayerController` currently clamps X/Z to that one room and keeps the eye at its floor height; wall targeting, work surfaces, water simulation and mission coordinates also refer to the current room. Treat it as a stable construction cell inside a new site graph. A usable first slice should connect one rough supported opening to a corridor, stair core and garage/workshop, with full collision, navigation and return to the original work wall. Stairs require continuous height-aware locomotion and fall/landing behavior, not a visual staircase paired with teleport-only movement. Basement ramp, open shafts and wall apertures require explicit physical hitboxes and exact first-hit targeting.

Keep the sole live preview at `http://127.0.0.1:5365/Electrical-Game/`; an opt-in preview mode can isolate incomplete new geometry on the existing server. Preserve the current save and four-wall work-room interactions. Stream/occlude distant rooms and floors; do not instantiate every brick and every level at once. Compare the first slice to the current ~544 draw-call mobile-emulation work scene, using frame-time spikes and memory as well as FPS. Mobile portrait, landscape, tablet portrait/landscape and desktop must all be visually inspected, with physical-phone performance reported separately.

## First acceptance slice and sequence

1. **Reference/plan gate:** the user selected five above-grade levels plus two basements; the ground footprint, courtyard and existing room position stay as drawn. The section drawing now matches 5+2. The older AI cutaway remains a material reference only.
2. **Playable sample of final quality:** preserve the current room; cut correctly supported unfinished masonry openings into corridors; build the stair/lift core and ground private garage/workshop with convincing Cypriot construction materials, open apertures, collision and 3-touch MOVE+AIM+USE. The opening, corridor, foyer, courtyard, ground garage/workshop, stacked stair flights and initial L1–L4 shells are in the isolated preview. Desktop/mobile-emulated walking passed from the work room to the foyer and back, from the foyer to the courtyard and back, through the garage/workshop and back, up to the L4 room/terrace and back down in linked level routes. The side-deck and terrace temporary guards have level-specific body hitboxes; the garage workshop partition also has a tested body hitbox. The lift, full room program, visual finish, simultaneous touch on the upper floors and physical-phone acceptance are still open. Same-camera before/after are required before release.
3. **Whole shell and basement navigation:** add the five stepped above-grade levels, B1/B2, garage ramp, courtyard/verandas and all circulation while keeping level streaming and stable saves.
4. **Room-by-room construction state:** kitchen, living areas, bedrooms, service rooms, client work areas, electrical/plumbing rough-ins, material deposition and distinctive, non-repeating damage/finishing stages.
5. **Final QA:** full route and tool interactions on each floor, hitboxes/occlusion, visual comparisons in daylight and work lighting, supported devices, p95/worst frame timings, draw calls, RAM/VRAM where measurable and a physical-phone pass. Concept drawings alone do not complete this work.

Open decision: whether B2 should be fully explorable in the first staged preview; the final selected house includes both basements. Garage spaces describe future use only; the playable construction phase contains no vehicles, doors or garage shutters.
