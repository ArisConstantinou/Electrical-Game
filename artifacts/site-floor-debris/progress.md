# Original workroom floor offcuts — 2026-09-24

The 5365 baseline had one regular row of 26 identical-looking clay chips. The `before-*` captures are direct live frames at the same cameras and viewports as the isolated candidate `after-*` captures. The approved Site Pro 04 concept and the user's site photographs show broken clay and mortar near the actual first-fix work areas.

The candidate replaces the row with 88 varied photographed clay shell shards, 66 smaller mortar/concrete crumbs, and six larger broken units with actual four-chamber openings. They collect below the box chases, temporary workbench, and mixing area, leaving the centre walk route clear. All fragments are static render geometry; this does not change demolition yield or inventory. The previous `Brick rubble` Studio name and `world:site-clay-rubble` ID are retained, and the whole group remains registered as the same editable asset. Small visual fragments do not intercept gameplay rays.

The first candidate looked like uniformly orange confetti and was revised before delivery. The final still has limited close-up fidelity compared with the concept. These screenshots show the actual result rather than a generated target image.

Candidate checks: TypeScript and Vite builds passed. The same-camera desktop front-floor view went from 213 calls / 899,353 triangles to 215 calls / 904,817 triangles; 90-frame headless Chrome p95 was 16.8 ms in both. The 390×844 viewport went from 450 calls / 1,632,024 triangles to 454 calls / 1,642,952 triangles; p95 was 16.7 → 16.8 ms. The 40-case room tour passed on desktop and mobile viewport with no browser errors, and the Studio registry retained the original asset ID. Physical mobile performance is unverified. Integration into the sole 5365 listener is pending.
