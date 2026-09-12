# Masonry chasing and impact-damage reference

## Findings used by the game

- A wall chaser makes a controlled groove rather than removing complete masonry units. Bosch publishes common groove widths of 23–40 mm and depths of 20–65 mm, and explicitly includes a break-out tool to remove the cut centre material.
- Hilti's DCH 150-SL uses two spaced diamond discs, recommends straight vertical cuts and states that curves are not possible with the slitting tool itself. The game's demolition hammer represents the subsequent break-out stage, so its edge is deliberately rougher than the parallel saw cuts.
- HSE guidance identifies chasing brickwork with hand-held power tools as an extremely dusty process. The game therefore uses visible fine chips as well as larger fragments instead of a clean disappearing surface.
- Laboratory impact studies describe cumulative damage under repeated impact: initial local cracking, crack growth and displacement/spalling before a breach. The game compresses this into four readable hammer impacts instead of deleting a brick on contact.
- Masonry fractures through both brick units and mortar interfaces. Fragment size and direction are therefore varied deterministically rather than cloning equal rubble pieces.

## Runtime translation

- CHASE: 55 mm deep, approximately 50–65 mm visually irregular break-out channel, sampled across the complete painted route.
- DEMOLISH: chip → branching crack → spall → fracture; the fourth hit creates non-uniform tetrahedral, dodecahedral and block fragments with different dimensions, spin, velocity and floor bounce.
- The simulation is a readable gameplay abstraction, not a structural-failure solver. It preserves the observed sequence and visual character without claiming engineering prediction.

## Primary and manufacturer sources

- Bosch Professional, Wall chasers: https://www.bosch-professional.com/gb/en/wall-chasers-101329-ocs-c/
- Hilti, DCH 150-SL operating instructions: https://www.hilti.com/medias/sys_master/documents/hb2/h57/10020437655582/Operating-Instruction-DCH-150-SL-01-Operating-Instruction-PUB-5551813-000.pdf
- UK HSE, COSHH essentials CN2, Chasing with hand-held tools: https://www.hse.gov.uk/pubns/guidance/cn2.pdf
- Godio and Flansbjer, experimental repeated-impact response of clay brick masonry: https://doi.org/10.1016/j.ijimpeng.2025.105461
- Gilbert, Hobbs and Molyneaux, low-velocity impact experiments on masonry walls: https://doi.org/10.1016/S0734-743X(01)00049-5
