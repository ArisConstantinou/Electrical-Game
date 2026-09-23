# Electrical-Game visual overhaul

## Approved direction and scope

The user asked for a complete visual upgrade across the game, using the first two
supplied moonlit-swamp screenshots as a quality and atmosphere reference, while
retaining Electrical-Game's Cypriot construction-site subject. The already
selected `artifacts/site-pro-04/reference/site-pro-04-selected-concept.png` is
the workroom target. The existing mansion exterior, ground corridor and garage
concepts in `artifacts/site-pro-04/mansion-concept/` cover wider-world direction.
These are visual concepts, not runtime screenshots or proof of attainable
performance. No new concept generation is needed for the current direction.

## Protected starting state, 2026-09-23

- Port: only `http://127.0.0.1:5365/Electrical-Game/`.
- The active Vite command's root was `site-pro-04-mansion/Electrical-Game`,
  branch `codex/site-pro-04-mansion`, commit `aabc0f34c686349a6d19461d3fd8a3209b4d615f`.
- That checkout had extensive tracked and untracked changes from other work.
  The listener and files were left untouched. This branch starts from that
  commit and does not include those uncommitted changes.
- Live gameplay baseline: `artifacts/visual-overhaul/baseline-client/shot-0.png`
  in the active checkout. It shows the exterior passage viewed into the workroom.
- This branch uses `artifacts/visual-overhaul/capture-isolated.mjs` to serve its
  production `dist` through Playwright request interception at the same URL,
  without starting or replacing any server. Its capture is from the older clean
  commit, so it cannot serve as a like-for-like comparison with the dirty live
  checkout.

## Coverage required before completion

| Area | Visual acceptance |
| --- | --- |
| Workroom and construction stages | Clay, mortar, concrete, screed, dust, wetness, PVC and box states read as physical materials at working distance. |
| Mansion interior and exterior | Every accessible floor, stair, garage, courtyard, terrain and neighbouring structure shares scale, material quality, lighting and believable construction detail. |
| Tools and workers | Held and world models, hands, body, grips and motion maintain silhouette and surface detail at gameplay camera distances. |
| Effects | Water, impact, debris, mixing, spray and work feedback remain readable and match the material response. |
| UI | Desktop, portrait, landscape and tablet controls stay legible and do not conceal critical scene details. |
| Performance and integration | Compare matching runtime poses before/after, frame times and memory on representative devices; confirm interactions, Editor selection and gameplay routes. Mobile emulation is not physical-phone proof. |

## First isolated implementation

The existing scanned floor, concrete and plaster albedo maps now receive
restrained normal detail. Two official Poly Haven OpenGL normal maps were reduced
to 512-pixel WebP and licensed under CC0 (sources recorded in
`public/assets/site-materials/SOURCES.md`). This is a shared material improvement,
not completion of any area above. The reference concept remains substantially
richer in geometry, props, material variety, light and surface damage.

A temporary electrician workbench under the workroom window is the first new
modeled prop. It uses a separate timber structure, shelf, case, level and
fasteners with a CC0 photographed timber surface. The static parts are batched
to eight rendered meshes and 12,220 triangles. The player obstacle follows
its Level Editor transform. Same-camera screenshots with the asset hidden and
shown are `artifacts/visual-overhaul/isolated-workbench-before.png` and
`isolated-workbench.png`; `isolated-workbench-mobile-viewport.png` records
the 390 × 844 portrait layout. Browser checks confirmed a 0.28 m player clearance,
Level Editor inventory inclusion, and no page errors. In a short 90-frame
headless Chrome comparison, hidden and shown both recorded median 16.7 ms and
p95 33.4 ms; that run cannot establish physical-phone performance. The prop
improves scene specificity but is not yet a final-quality workroom or proof of
whole-game visual fidelity.

## Second isolated implementation

The held drill now loads the CC0 1K Poly Haven Drill 01 mesh and PBR textures as
a visual shell. The original grip, trigger and spinning bit remain in place. The
asset adds 2,926 triangles and about 501 KB of source files, replacing 49 visible
procedural body parts when loaded. If loading fails, the old tool remains usable.
The same-camera `artifacts/visual-overhaul/drill-before.png` and `drill-after.png`
show the visual change. `drill-mobile-viewport.png` is a 390 × 844 emulation
capture. In browser checks, the tool-tip world position was identical with the
shell shown and hidden, the trigger and motor objects remained present, and no
page errors appeared. A short 90-frame headless Chrome comparison again measured
median 16.7 ms and p95 33.4 ms in both modes. This is not physical-phone proof.

The existing photographed brick diffuse map now has its matching 1K OpenGL
normal map on side, rear and ceiling clay courses. The shader samples the same
mortar-free crop as its color map and uses restrained normal strength. The
matching close-camera comparison is `brick-normal-before.png` and
`brick-normal-after.png`. It adds surface relief under raking light, although
the room still has much less geometry, natural wear and prop density than the
approved concept. The main destructible work wall uses a separate shader and
has not received this normal response. A same-camera close-wall trial there
changed the sampled wall region by less than one RGB level on average, so its
extra normal texture sample was rejected. The next work-wall pass needs a
visible geometry, mortar and edge-wear solution rather than another subtle map.

## Third isolated implementation: fitted boxes and mortar

The 1G and 2G casings now show shallow moulded screw bosses, stiffening ribs,
entry knockouts, cross-head slots and steel screw faces. The front rim has a
1 mm bevel. These details stay inside the existing fitting envelope and are
non-interactive; the original fit dimensions, collision, mortar mass and
installation sequence are unchanged. The shape language is informed by the
[Legrand Batibox masonry box](https://www.legrand.com/ecatalogue/en/catalog/products/batibox-flush-mounting-box-square-1-gang-depth-40-mm-for-masonry-080141),
while the game retains its own sizes and concept palette. Three batched visual
meshes per casing keep the small features from becoming dozens of draw calls.

The dynamic mortar surface now samples the already licensed Poly Haven
`plastered_wall_03` albedo by world position. This is a visual approximation of
cement variation, not a claim that the scan depicts wet mortar. It does not
modify field nodes or mesh topology. In the same-camera B-box crop, more than
half the measured patch pixels changed by over 3 RGB levels compared with the
flat material, with a mean channel change of roughly 3 levels. A bump-shading
trial gave no measurable pixel change and was removed. The square voxel contour
and the surrounding unfinished scene still fall short of the selected concept.

Matching isolated browser screenshots: `box-B-before.png`, `box-B-after.png`,
`box-C-before.png`, `box-C-after.png`, `mortar-before.png`, `mortar-after.png`.
`box-C-mobile-viewport.png` is a fixed work camera in portrait emulation;
`box-C-gameplay-mobile.png` is a normal player view. The source and visual
metadata are in `capture-box-detail.mjs` and `box-detail-check.json`.

## Fourth isolated implementation: articulated work gloves

The existing anatomical worker now wears dark woven work gloves in every pose.
The colour and OpenGL normal use Poly Haven's CC0 Denim Fabric 06 as a textile
proxy. An earlier glove-atlas crop stretched visibly at close range and was
rejected. `scripts/build-visual-gloves.py` assigns the tileable scan to 5,496
hand faces in the editable Blender source, ending at the original wrist loop.
The original hand vertices,
deformation weights and 52-joint rig have identical SHA-256 fingerprints before
and after. The exported GLB keeps two meshes, one skeleton and all 24 existing
locomotion clips. It grew from 12.9 MB to 14.9 MB; the embedded normal map and
texture account for most of that change.

The isolated game rendered spray and drill before/after at matching desktop
and portrait camera poses: `glove-{before,candidate}-{spray,drill}-{desktop,mobile}.png`.
`glove-{before,candidate}-hand-close.png` checks the wrist transition and
visible hand surface from outside the first-person camera.
The candidate passed the 18-state worker/tool browser test using the isolated
production build. Twenty-one measured wrist reach errors were identical to
the original. The new material changes rendered body-mesh bounds by material
partition, so per-primitive bounds cannot be treated as a changed silhouette.
Short headless Chrome frame intervals varied widely between runs; they do not
prove a performance gain or phone parity. A full character close-up and real
mobile GPU check remain necessary for final acceptance. Source and rights are
recorded in `assets/source/WORKER_SOURCES.md`.

## Integration boundary

Do not promote this branch or replace the 5365 listener while the active
`site-pro-04-mansion` checkout has unrelated unfinished changes. Before
integration, compare its then-current commit and dirty state, bring approved
changes into a protected integration checkout, and repeat visual, gameplay and
performance checks on the combined build.
