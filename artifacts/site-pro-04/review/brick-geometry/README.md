# Original room brick geometry check

The side and rear wall brick instances now use one rounded-box segment instead of two. They remain separate chamfered 3D units with the same per-brick material patches, mortar and collision behavior.

Windows Chrome, 390 × 844 touch viewport at DPR 3, WebGL, editor ground-top camera:

| Metric | Before | After |
| --- | ---: | ---: |
| Original room nominal triangles | 922,020 | 482,030 |
| Rendered scene triangles in the inventory camera | 1,849,283 | 1,409,293 |
| Rendered ground-top triangles in the floor benchmark | 3,330,255 | 2,597,295 |

The mobile landscape side/rear screenshots were captured from the same camera positions. Side-image mean absolute pixel difference was about 0.2% (normalized), so the normal-distance appearance is effectively unchanged. Frame-time improvement is **unproven**: isolated post-change host runs were slower in ground and untouched L1 scenes while Windows CPU use was about 88%. This does not establish performance on a physical phone.

Reproduce the geometry inventory with `node tests/mansion-render-inventory.mjs` and the images with `node tests/room-brick-view.mjs before|after` against the established port 5365 preview.
