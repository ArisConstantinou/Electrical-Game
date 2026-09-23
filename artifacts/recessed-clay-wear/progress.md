# Recessed mansion clay walls — 2026-09-24

Baseline: the four side/back walls of the two open courtyard recesses were identical box instances in aligned vertical columns. The direct 5365 browser test failed its staggered-course/wear check. `before-live.png` and `before-live-mobile.png` record desktop and 390×844 viewport frames.

Candidate: alternate rows receive correctly sized half units at both ends, while individual units have small deterministic joint, height, and depth variation. Four instanced geometries per wall reuse the mansion's intact, small-chip, and broken-corner clay shapes and photographed face atlas. The clay remains behind the surface wear. Brighter recessed mortar replaces the dark backing. The row-major slot map is retained for the wall demolition system and Studio state. `candidate.png` and `candidate-mobile.png` were taken at the same camera and viewport as the baseline.

The browser test confirmed all four walls contain four wear variants and a real offset between alternating courses. Three impacts on a recessed back wall removed 26 clay nodes, zero complete bricks; the Studio document restored those 26 nodes. `mansion-masonry-demolition` and `mansion-joint-fracture` passed. TypeScript and the Vite production build passed.

Same-scene headless Chrome measurements: desktop 134 → 148 draw calls, 709,619 → 721,379 triangles, 904 → 918 geometries, and 170 textures unchanged. At 390×844, draw calls were 806 → 815 and triangles 2,412,484 → 2,419,844. The 90-frame desktop and narrow-viewport p95 remained 16.8 ms in this host run. The viewport result is not a physical phone performance measurement.
