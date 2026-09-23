# Electrical-Game visual overhaul

## Approved direction and scope

The user asked for a complete visual upgrade across the game, using the first two
supplied moonlit-swamp screenshots as a quality and atmosphere reference, while
retaining Electrical-Game's Cypriot construction-site subject. The already
selected `artifacts/site-pro-04/reference/site-pro-04-selected-concept.png` is
the workroom target. The existing mansion exterior, ground corridor and garage
concepts in `artifacts/site-pro-04/mansion-concept/` cover wider-world direction.
These are visual concepts, not runtime screenshots or proof of attainable
performance. No new concept generation is needed for the current direction.

## Protected starting state, 2026-09-23

- Port: only `http://127.0.0.1:5365/Electrical-Game/`.
- The active Vite command's root was `site-pro-04-mansion/Electrical-Game`,
  branch `codex/site-pro-04-mansion`, commit `aabc0f34c686349a6d19461d3fd8a3209b4d615f`.
- That checkout had extensive tracked and untracked changes from other work.
  The listener and files were left untouched. This branch starts from that
  commit and does not include those uncommitted changes.
- Live gameplay baseline: `artifacts/visual-overhaul/baseline-client/shot-0.png`
  in the active checkout. It shows the exterior passage viewed into the workroom.
- This branch uses `artifacts/visual-overhaul/capture-isolated.mjs` to serve its
  production `dist` through Playwright request interception at the same URL,
  without starting or replacing any server. Its capture is from the older clean
  commit, so it cannot serve as a like-for-like comparison with the dirty live
  checkout.

## Coverage required before completion

| Area | Visual acceptance |
| --- | --- |
| Workroom and construction stages | Clay, mortar, concrete, screed, dust, wetness, PVC and box states read as physical materials at working distance. |
| Mansion interior and exterior | Every accessible floor, stair, garage, courtyard, terrain and neighbouring structure shares scale, material quality, lighting and believable construction detail. |
| Tools and workers | Held and world models, hands, body, grips and motion maintain silhouette and surface detail at gameplay camera distances. |
| Effects | Water, impact, debris, mixing, spray and work feedback remain readable and match the material response. |
| UI | Desktop, portrait, landscape and tablet controls stay legible and do not conceal critical scene details. |
| Performance and integration | Compare matching runtime poses before/after, frame times and memory on representative devices; confirm interactions, Editor selection and gameplay routes. Mobile emulation is not physical-phone proof. |

## First isolated implementation

The existing scanned floor, concrete and plaster albedo maps now receive
restrained normal detail. Two official Poly Haven OpenGL normal maps were reduced
to 512-pixel WebP and licensed under CC0 (sources recorded in
`public/assets/site-materials/SOURCES.md`). This is a shared material improvement,
not completion of any area above. The reference concept remains substantially
richer in geometry, props, material variety, light and surface damage.

A temporary electrician workbench under the workroom window is the first new
modeled prop. It uses a separate timber structure, shelf, case, level and
fasteners with a CC0 photographed timber surface. The static parts are batched
to eight rendered meshes and 12,220 triangles. The player obstacle follows
its Level Editor transform. Same-camera screenshots with the asset hidden and
shown are `artifacts/visual-overhaul/isolated-workbench-before.png` and
`isolated-workbench.png`; `isolated-workbench-mobile-viewport.png` records
the 390 × 844 portrait layout. Browser checks confirmed a 0.28 m player clearance,
Level Editor inventory inclusion, and no page errors. In a short 90-frame
headless Chrome comparison, hidden and shown both recorded median 16.7 ms and
p95 33.4 ms; that run cannot establish physical-phone performance. The prop
improves scene specificity but is not yet a final-quality workroom or proof of
whole-game visual fidelity.

## Integration boundary

Do not promote this branch or replace the 5365 listener while the active
`site-pro-04-mansion` checkout has unrelated unfinished changes. Before
integration, compare its then-current commit and dirty state, bring approved
changes into a protected integration checkout, and repeat visual, gameplay and
performance checks on the combined build.
