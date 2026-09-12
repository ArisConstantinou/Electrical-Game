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
- DEMOLISH: chip → wall-scale crack/deformation → spall → breach. Every blow deforms a broad continuous field before the fourth blow opens a seeded, non-rectangular core across several bricks and joints. Mortar-adjacent cells receive extra resistance; connected-component pruning keeps only remnants that reach a real, intact neighbouring wall unit rather than merely reaching their own cell-grid edge. Supported remnants stay targetable for later impacts. Final cracks begin outside the open core, span multiple courses, follow actual staggered head/bed-joint coordinates where appropriate and are clipped again when a later breach crosses them.
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
