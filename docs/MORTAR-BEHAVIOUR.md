# Wheelbarrow mortar reference and behaviour

User corrections, 2026-09-20/21: mortar is sticky and slippery, slips unevenly, and must not look or move like water. The supplied six site photos are the visual reference; the earlier smooth sloping plane and repeating ripples were rejected.

## Observations from the supplied photographs

- Photos 1, 2 and 6: cohesive heaps with ragged edges, sandy surface detail, and persistent shovel/trowel impressions.
- Photo 3: pronounced shovel grooves retain their shape; adjoining masses fold and smear together. It is neither a self-levelling pool nor loose dry sand.
- Photos 4 and 5 have visibly coarser inclusions. A still photograph alone cannot establish the mix recipe or rheological parameters. Do not use their coarsest inclusions as the fine masonry mortar grain size.
- Overall colour depends on sand, binder, moisture and lighting. Use a neutral warm grey, granular diffuse response and subtle damp highlights; do not substitute glossy liquid shading.

## Primary-source research

- [MPA Mortar, Properties of masonry mortar](https://www.mortar.org.uk/MPAMortar/media/Mortar/Publications/Learning-Texts/LT06-Masonry-Mortar.pdf): workability includes cohesion, sticking/sliding on a trowel, spreading, and resistance to excessive dropping or smearing.
- [NIST, Rheology](https://www.nist.gov/itl/math/rheology): viscosity is resistance to flow; yield stress is the force threshold required to initiate flow. Cement, mortar and concrete are dense suspensions.
- [NIST, Testing and Modeling of Fresh Concrete Rheology](https://www.nist.gov/publications/testing-and-modeling-fresh-concrete-rheology): measured mortar/concrete behaviour is nonlinear and mixture-dependent. The game parameters below are authored, not measured constitutive constants.

## Game acceptance criteria

- Low force leaves the material attached and stationary. Persistent local creases are visible at rest.
- Increasing tilt, acceleration or steering makes separate regions yield at different times. Shapes remain after the force is removed; there is no returning sinusoidal wave.
- Displaced regions pile up and leave depressions. The moving material contacts the flared tray and can reach the lip before the cart flips.
- Side tilts transport bulk depth from the high side to the low lip, not merely a thin surface ridge. Retained patch mass and position drive a load-centre offset, which reinforces the corresponding cart lean. Material shed from that side reduces its weight; parked support legs restore the level stance.
- Overflow releases irregular cohesive pieces. The part that breaks off reduces the local crest. No delayed emission is allowed from a calm or newly refilled tray merely because old overflow stress was stored.
- Fallen pieces remain thicker than a water splash and retain their mass for shovel recovery.
- Keep the existing cart controls, collisions, wheel rotation and anatomical grip attachment. Keep the shared preview on 5365.

## Implementation and scope

`MortarSlump.ts` implements twelve heterogeneous yield-limited patches, permanent displacement, local erosion and seeded irregular fracture sizes. `MortarAppearance.ts` supplies 16,385 shared vertices / 32,512 triangles with real 5–15 mm clod relief and torn creases, plus subtle original sand/paste colour and bump textures. Equal arc-length sampling prevents sparse radial strips. Large deposited masses have irregular shoulders and interrupted shovel furrows instead of circular ripple ridges. `Wheelbarrow.ts` interpolates the expensive bulk deformation from a 33×49 grid and carries the small relief with the material; unchanged surfaces are cached. It applies gravity/inertia, tray contact, floor impacts and exact kilogram accounting. This is bounded gameplay dynamics, not a calibrated continuum or particle fluid simulation.

Tests: `tests/mortar-slump.mjs`, `tests/wheelbarrow-slosh.mjs`, existing wheelbarrow gameplay/grip/performance regressions. Reports and actual runtime images are under `output/wheelbarrow-slosh` and `output/wheelbarrow-performance`.

The 2026-09-21 follow-up specifically rejected detail represented only by textures. `tests/mortar-relief.mjs` captures the same seeded load/camera both before and after, including a material with all texture and bump maps removed and a grazing view. `tests/wheelbarrow-balance.mjs` separately checks non-tipping ordinary sprints, severe directional impacts, and actual downhill emission at all four rims at 0.55 and 1.4 radian tilts. Controlled tilt fixtures do not claim to be native player input; native E/righting/shovel recovery remains covered by the UI test.

The later annotated high-side screenshot also exposed missing feedback from material transport to cart balance. Source/destination kernels now transport bulk depth and the weighted retained patch centres feed roll/pitch loading. The front wheel and operator provide stronger fore/aft support than lateral support; these are tuned game response coefficients, not measured material constants. Regression coverage checks high-side depletion, low-lip buildup, the sign of the additional lean, ordinary sprint safety, and both violent steering directions. Adhesion remains above the normal carry incline so a stopped load does not acquire a continuous water-like downhill drift.
