# Masonry chasing and impact-damage reference

## Findings used by the game

- A wall chaser makes a controlled groove rather than removing complete masonry units. Bosch publishes common groove widths of 23–40 mm and depths of 20–65 mm, and explicitly includes a break-out tool to remove the cut centre material.
- Hilti's DCH 150-SL uses two spaced diamond discs, recommends straight vertical cuts and states that curves are not possible with the slitting tool itself. The game's demolition hammer represents the subsequent break-out stage, so its edge is deliberately rougher than the parallel saw cuts.
- HSE guidance identifies chasing brickwork with hand-held power tools as an extremely dusty process. The game therefore uses visible fine chips as well as larger fragments instead of a clean disappearing surface.
- Laboratory impact studies describe cumulative damage under repeated impact: initial local cracking, crack growth, out-of-plane displacement/spalling and only then a breach. Full-scale tests also show that crack paths change with masonry-unit strength and propagate beyond the impact unit.
- Hollow-clay units absorb impact energy through gradual brittle fracture of their thin cellular webs. The supplied Cyprus field photographs show the practical result during first-fix work: exposed cell cavities, torn webs, bonded remnants and chase edges whose width and depth vary continuously across brick and mortar.
- Brickwork is treated as a bonded brick–mortar composite. Mortar-edge cells resist removal more strongly, cracks can step along a bed joint and then cross a unit, and detached regions are rejected unless they remain connected to material beyond the local brick boundary.

## Runtime translation

- CHASE: the operator aims for a nominal 55 mm recess, but every impacted surface cell resolves to a deterministic 28–86 mm depth. Low-frequency route variation prevents a mechanically constant channel width; adjacent intact edges deform inward or outward, deep cells expose dark hollow-clay cavities, and solid terracotta side/step faces bridge depth differences across the complete painted route.
- DEMOLISH: chip → wall-scale crack/deformation → partial-depth crater → eventual breach only after sustained repeated work. Four blows no longer delete the full wall thickness: one completed impact cycle removes roughly 18–44 mm at its strongest cells, with mortar-edge resistance and radial falloff reducing most of the surrounding depth. Each later individual blow adds only about 4–14 mm at its own strongest point while still spreading broad vibration and deformation, so holding the hammer cannot treat every animation tick as a new full-depth demolition cycle. Later blows accumulate at different eccentric centres, so depth and width do not grow as a copied ellipse. Every impact receives a fresh runtime seed controlling orientation, aspect ratio, asymmetric lobes, directional bias, penetration depth and crack topology. Intact masonry is not plastically waved: outside the excavated footprint the face stays on its original plane, visible displacement is capped at 6 mm, and removed depth is expressed as irregular, quantized brittle facets. The retained face is rendered as a continuous indexed surface; micro-cell cuboids, internal box walls and repeated tiny void rectangles are forbidden. Full-depth perimeter returns close brick/mortar seams, while dark cavity faces exist only on a real through-breach boundary. Connected-component pruning keeps only eventual through-breach remnants that reach a real, intact neighbouring wall unit. Crack networks vary from one-sided splits to multi-trunk paths, use different branch counts and only snap to a real staggered head/bed joint when already close to it.
- Loose pieces remain non-uniform tetrahedral, dodecahedral and block fragments with different dimensions, spin and velocity. They collide through conservative solid bounds, lose support when lower rubble expires, settle without unsupported suspension and persist as capped floor piles.
- The simulation is a readable gameplay abstraction, not a structural-failure solver. It preserves the observed sequence and visual character without claiming engineering prediction.

## Primary and manufacturer sources

- Bosch Professional, Wall chasers: https://www.bosch-professional.com/gb/en/wall-chasers-101329-ocs-c/
- Hilti, DCH 150-SL operating instructions: https://www.hilti.com/medias/sys_master/documents/hb2/h57/10020437655582/Operating-Instruction-DCH-150-SL-01-Operating-Instruction-PUB-5551813-000.pdf
- UK HSE, COSHH essentials CN2, Chasing with hand-held tools: https://www.hse.gov.uk/pubns/guidance/cn2.pdf
- Godio and Flansbjer, experimental repeated-impact response of clay brick masonry: https://doi.org/10.1016/j.ijimpeng.2025.105461
- Gilbert, Hobbs and Molyneaux, low-velocity impact experiments on masonry walls: https://doi.org/10.1016/S0734-743X(01)00049-5
- Janaraj et al., repeated-impact response of clay brick masonry walls: https://doi.org/10.1016/j.ijimpeng.2023.104521
- Březina et al., gradual brittle fracture of thin-walled cellular ceramic blocks under dynamic loading: https://doi.org/10.1016/j.tws.2017.10.050
- Korswagen Eguren, Longo and Rots, high-resolution observation of crack initiation and propagation in masonry walls: https://doi.org/10.1016/j.engstruct.2020.110365

These ranges are visual/gameplay calibration from the supplied field references, not construction guidance. Real chase limits depend on wall thickness, orientation and the applicable structural rules; Eurocode 6 explicitly assesses chases using their deepest reached hole, not only their intended nominal depth.
