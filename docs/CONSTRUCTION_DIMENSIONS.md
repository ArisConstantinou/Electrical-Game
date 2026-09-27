# Wall and column defaults

User-approved dimensions, 27 September 2026. All values in code are metres.

| Element | Default |
| --- | --- |
| Unplastered brick wall | 10 cm |
| Future plaster on each face | 2.5 cm |
| Finished wall | 15 cm |
| Concrete column depth perpendicular to the wall | 15 cm |

The game currently shows the unplastered stage. A centred 15 cm column projects
**2.5 cm beyond the 10 cm brick wall on each face**. It is therefore not flush
with the exposed bricks. No plaster layer is added by this change. Once a wall
has its specified plaster on both faces, its finished depth matches the column.

These are this game's defaults, not a restriction on custom construction.
The editor's size fields still allow deeper columns and different wall depths.
Column height and width along a single wall remain authored; at a wall corner,
both perpendicular depths use 15 cm. Free-standing supports retain their width.

`src/data/constructionDefaults.ts` is the shared specification. Mansion masonry
and fracture lattices retain their local coordinates; ordinary editor transforms
apply their physical depth. Picking, broken brick geometry and collision use the
same transforms. The work/practice walls use a physical 10 cm voxel volume so
installation clearances and mortar raycasts remain in metres. The existing 1 cm
player collision margin remains unchanged. The work wall's front face stays fixed
to preserve installation alignment.

New level saves record physical column dimensions and wall thickness. Legacy
default columns/walls migrate to the new defaults; explicit legacy column depth
scales and wall thickness scales retain their physical size. Custom column
positions remain editable.

Validation: `node tests/construction-depth.mjs`, full benchmark route and functional
checks, masonry demolition/chasing, plus a matched before/after PC frame sample.
PC mobile viewports verify UI and geometry; they do not measure a physical phone.

The matched PC sample is stored in `performance/2026-09-27-construction-depth.json`.
At 1280x900, headless Chrome/WebGL on RTX 5080, ground-column FPS was 99.4 -> 100.7
and L1-angle FPS was 128.8 -> 137.2. Frame P95 increased by 0.7 / 0.5 ms.
These short samples check for substantial regressions; they do not establish
performance gains, stable 60 FPS on mobile, GPU timing or VRAM usage.
