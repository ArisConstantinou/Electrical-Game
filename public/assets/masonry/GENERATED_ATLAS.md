# Human-laid brick face atlas v3

- Runtime asset: `human-laid-brick-face-atlas-v3.png` (1774 × 887, 2 columns × 4 rows).
- Created with the built-in OpenAI image generation tool from the user's
  photographs of laid grooved clay bricks and damaged site bricks, plus the
  approved Site Pro 04 visual concept. No third-party photo is bundled here.
- Initial generation prompt: eight flat orthographic long-face terracotta
  brick tiles in an exact 2 × 4 atlas, horizontal pressed ridges, natural
  pores, cement dust and a few chipped corners; no perspective, mortar,
  border, cast shadow, broad-face holes or text.
- Final edit prompt: preserve the exact atlas geometry and all dirt, chips
  and ridges; bring all eight faces toward the user's warm salmon terracotta
  wall photograph, with only subtle natural kiln variation rather than a
  red/light checkerboard. Do not add mortar or change tile boundaries.
- `BrickFacePatch.ts` samples within each cell, favours the less damaged
  faces, and mirrors individual bricks to reduce repeated stains. The wall's
  mortar, hollow chambers, collision and damage remain separate geometry.
- The previous atlas is retained as a fallback; this asset is versioned.
