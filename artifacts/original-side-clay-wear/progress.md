# Original room side-wall fired clay — 2026-09-24

The 5365 baseline showed 471 right and 426 left side-wall pieces, all on one exact face plane with no physical corner wear. `before-right.png`, `before-left.png`, and `before-mobile.png` are direct browser frames at the same cameras and viewports used for the candidate. The focused wear test failed as expected on the baseline.

The candidate retains each wall's existing pickable masonry mesh and all its positions in the Studio hierarchy. A deterministic subset gets a separate batched fired-clay exterior geometry with either a small chip or a broken corner; the original render instance is hidden only at those slots. The shared original pick plane and opening mask remain in place. Individual clay faces also receive a small depth variation and fired-clay tint. The hidden internal chambers of this original room's side units have not been modelled. `candidate-right.png`, `candidate-left.png`, and `candidate-mobile.png` show the same scene after the edit.

The candidate has 116 visibly chipped right units and 98 left units, with about 5 mm of face-plane range. The original `site-pro-room-tour` passed 40 desktop/mobile cases, including 471 right units, 426 left units, the unblocked left opening, valid atlas crops, and concrete slab bearing. TypeScript and Vite production builds passed. No browser render errors were recorded.

Same-view headless Chrome measurements: right desktop 530 → 534 draw calls and 1,673,584 → 1,727,184 triangles; left desktop 823 → 834 calls and 2,457,438 → 2,529,942 triangles; 390×844 right view 1,104 → 1,115 calls and 3,174,060 → 3,242,884 triangles. The 90-frame p95 was 16.7 → 16.8 ms on desktop and narrow viewport in this host run. This is not physical mobile performance proof.
