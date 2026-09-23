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

## Fifth isolated implementation: touch work card

The drill and driver work card now uses the Site Pro graphite/yellow treatment
and occupies only the space needed for its title and current instruction. A
missing height value and an inactive progress bar no longer appear as empty UI.
The laser retains its separate placement button and displays a height when one
exists. This changes HUD presentation only; tool selection and use remain on
their existing input paths.

`capture-touch-hud.mjs` intercepts the isolated production build through the
unchanged 5365 URL with real coarse-pointer/touch browser emulation. Matching
390×844 portrait and 844×390 landscape screenshots are
`touch-hud-{before,after}-{portrait,landscape}.png`, with measured panel bounds
and errors in the two JSON reports. The portrait drill card fell from 121 to
79 CSS pixels high; the landscape card fell from 102 to 61. In both after
captures the top controls and thumb zones remain separate, the laser card and
placement button are visible, and no page error was observed. This is Chrome
emulation, not physical iPhone/Safari or final mobile performance proof.

## Sixth isolated implementation: courtyard olive

The retained mansion olive now has a broader 1.35-scale canopy and trunk, with
larger narrow leaf blades, dark green and silver-backed variation, two central
sprays filling the fork, and tapered branch ends. The old detached vertical
twigs were removed. Its body obstacle now covers the larger trunk. The same
tree source continues to feed the exterior grove's near and distant LODs.

`capture-courtyard-olive.mjs` renders the isolated production build from one
camera in `?mansion=preview`. `courtyard-olive-{before,after}-{desktop,portrait}.png`
and the JSON reports document the visible change, 1,620 to 1,760 leaf clusters
and 45,360 to 49,280 corresponding leaf triangles. The 90-frame headless Chrome
samples remained close to 16.7 ms, but they are too short to establish real
mobile GPU performance. The four-viewport courtyard route, return, wind and
trunk-contact test passed with no page errors; see
`courtyard-olive-route-check.json`. The tree is still procedural and the larger
mansion scene remains much simpler than the selected image concept. Further
environment assets, lighting and real-device checks remain open.

## Seventh isolated implementation: mansion sunlight coverage

The mansion preview's directional sun now keeps a 16 m shadow map centred near
the active camera, so the courtyard and other distant bays receive actual
structure and tree shadows. Its 1024-pixel map resolution is unchanged; the
original workroom keeps its prior 10 m shadow area and light position. The
camera anchor advances in metre steps to avoid shifting the map on every small
view movement. Studio light direction edits remain relative to the sun target.

`courtyard-olive-after-desktop.png` and
`courtyard-olive-sun-follow-{desktop,portrait}.png` show the same courtyard
camera before and after the source change. The new shadows make the brick and
concrete spatial relationships clearer, but the courtyard still has simplified
structure, a flat ground finish and a conspicuous circular tree bed; it is not
the selected concept's final quality. The isolated production build passed the
four-viewport courtyard route/return/tree-contact test and
`tests/mansion-shadow-follow.mjs`: the mansion target follows a moved view from
`[0, 0.95, 5]` to `[10, 0.95, 14]`, while the original room retains
`[0, 1.1, -2.4]`. The desktop/portrait 90-frame headless Chrome captures
reported 16.7/16.8 ms median/p95 versus 16.7/16.8 ms before, but this brief
host sample cannot establish phone GPU cost or frame-time stability.

## Eighth isolated implementation: olive ground transition

The retained courtyard olive no longer stands in a perfect dark disc of
concrete-screed texture. A shallow irregular basin uses the same CC0 scanned
gravel as the surrounding court, with world-aligned UVs and a graded edge.
The original trunk obstacle and ground walking surface are unchanged. The
basin replaces one mesh with one mesh and reuses the loaded gravel map.

`courtyard-olive-sun-follow-{desktop,portrait}.png` and
`courtyard-olive-gravel-bed-{desktop,portrait}.png` are matching isolated
production-build views before and after. The ground now reads as one material
around the trunk. The surface still lacks larger stones, excavation marks and
the richer environmental composition of the approved concept. The short Chrome
frame samples remained near 16.7–16.8 ms; this is not physical-mobile proof.

## Ninth isolated implementation: printed spray-can wrap

The aerosol tool no longer has two flat label cards hovering in front of its
curved body. A single 768×512 printed wrap follows the actual cylinder; its UV
seam sits behind the can. The metal shoulder, nozzle, selected-colour band,
actuator, grip and spray-tip anchors remain at their previous positions. The
model has 21 mesh parts instead of 23, with four fewer triangles.

`spray-wrap-{before,after}-{desktop,portrait}.png` are matching gameplay views
from the isolated production build. The printed face is partly covered by the
correct gripping glove in desktop play and outside the normal portrait field
of view, as it was before this change. The capture script verifies the wrap,
absence of flat label planes, selected-colour update, zero grip error, preserved
tip/grip coordinates and no browser render errors. The isolated 18-state
worker/tool browser test passed with the packaged build. The 90-frame desktop and
portrait Chrome intervals remained near 16.7–16.8 ms. A broader tool visual
smoke exposed existing fitting-tool assertions based on the old single-object
grip and hidden CSS text; it cannot yet be used as an all-tools pass. This is a
specific model improvement, not full tool/hand or physical-mobile acceptance.

## Tenth isolated implementation: laid masonry and concrete undersides

The supplied construction photographs establish separate material rules: laid
walls use ribbed terracotta blocks with four longitudinal bores, staggered
courses, varied mortar thickness and occasional handling damage; supported
room ceilings and opening lintels are concrete rather than overhead bricks.
The newer cut-opening photographs add rough mortar and plaster over the exposed
ends. The protected live 5365 checkout remains unchanged while this branch is
reviewed through production-build interception on that same URL.

The original room and mansion garage/upper rooms now have continuous concrete
undersides. A Level Editor startup visibility bug that hid gameplay roofs was
fixed; opening and closing the editor restores them. The mansion's laid units
vary in color, position and joint size; about 19% have small closed 3D corner
chips and 4% have a larger broken corner. The exposed wall ends now show the
actual 2×2 bores with recessed interiors and varied mortar at the cut edge.
Physical wall contact, collision and demolition remain owned by the existing
wall systems. This is still visually less irregular than the supplied real
construction, particularly at the plaster transition and in the original work
room's dynamic destructible wall.

The first chip trial left dark open slots, and a second trial exposed a grey
material assignment. Those trials were discarded; the final closed extruded
shape was inspected in the same mansion camera. See `wall-ceiling-before-*`,
`wall-ceiling-after-*` and the capture script and JSON in
`artifacts/visual-overhaul/`. The original before room-wall shot includes a hand
while the after inspection hides the FPS rig; compare the central clay face.
TypeScript, Vite, desktop/mobile original-room tours and the mansion editor
roof cycle passed. A single end-view frame reported 194 calls and 1.03 million
triangles; the garage ceiling view reported 294 calls and 1.17 million triangles.
Those are desktop-host counts without a same-state baseline, frame-time series
or physical-phone measurement. The capture does not establish final whole-game
visual or performance acceptance.

The subsequent electrical references show recessed DB and switch/socket boxes
at different build stages: molded mounting bosses, actual cable entries,
fasteners, DIN rails, breaker rows, terminal bars, wire routing and surrounding
plaster damage. Current 1G/2G models have only partial molded detail and
decorative knockout rings, while no modeled DB exists yet. These remain
required visual and interaction slices rather than completed work.

## Integration boundary

Do not promote this branch or replace the 5365 listener while the active
`site-pro-04-mansion` checkout has unrelated unfinished changes. Before
integration, compare its then-current commit and dirty state, bring approved
changes into a protected integration checkout, and repeat visual, gameplay and
performance checks on the combined build.
