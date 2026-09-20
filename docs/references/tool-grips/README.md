# Tool-specific grip references

Local board: http://127.0.0.1:5365/Electrical-Game/docs/references/tool-grips/index.html#driver

Research dated 2026-09-20. This is a reference deliverable, **not an approved rig or a claim that the game is repaired**.

## Coverage

17 entries cover all 12 FPS tool selections, four station selections (including the separate station trowel), and the marking pencil. The fitting entry separates 1G, 2G and 2G+1G pose requirements. There are 33 visual-reference placements (31 distinct media sources; the two trowels share two photographs), including a manufacturer illustration sheet and a manufacturer photo sheet from PDFs.

Every entry records visible camera direction, source, observed hand contact, proposed game contact criteria, action states, model mismatch and missing evidence. Manufacturer photos are preferred. The water-container and fitting photos are retailer-hosted visual references, explicitly marked. The spray photo links to its original photographer. None is an animation asset or permission to copy a brand/model.

**Six orthographic views of the same correct hand pose are not yet available for every tool.** Photographs of different users/poses are not interchangeable calibrated views. The manifest's orthographic flags remain false rather than presenting inferred hidden finger positions as observations. No AI-generated hand photograph was used.

## Implementation criteria established by the references

- Drill/driver: index trigger contact is independent of the three lower gripping fingers. A camera-facing generic fist is insufficient.
- Hammer/mixer/shovel: two distinct hand contact frames must be solved together on one tool. The support hand cannot float or be solved against a separately moved handle.
- Tape: casing support, thumb slider, blade extension and controlled return are separate states. Do not give it a pistol grip or copy an absent finger-stop feature.
- Laser: casing support and placed adjustment, not an invented handle or trigger.
- Trowels: pickup, loaded carry, spread and scrape require distinct tool orientations, driven by the action rather than camera pitch.
- Hose/cutter: moving lever contact must follow the actual lever; fixed fingers through a moving part are invalid.
- Spring: insertion holds the spring and conduit separately; bending holds the conduit with the spring inside it.
- Water: carry-handle hand plus open supporting palm while pouring.
- Pencil: precision grip and tip contact, not a power grip.
- Fittings: casing/rim contacts depend on the actual variant dimensions.

These criteria do not establish numeric joint rotations, skin weights or collision-free anatomy. Pose authoring must measure the actual mesh, preserve the desired local wrist/finger pose and validate front/back/left/right/top/bottom views before camera movement tests. Do not blindly copy the ceiling capture: existing trowel and shovel-support samples already contain deformation.

## Files and verification

- `references.json`: editable manifest; `data.js`: matching browser data.
- `index.html`, `style.css`, `app.js`: local viewer with search, navigation, thumbnails, full-size view and printing.
- `spring-page4.png`, `cutter-page3.png`: cropped visual excerpts rendered from the linked manufacturer PDF pages for research review; retain attribution. Do not include these in game assets.
- External photos load directly from their attributed hosts and require an internet connection. No external scripts, account actions, uploads or paid APIs are involved.
- Run `node tests/tool-grip-reference-board.mjs` against existing port 5365. It checks all 17 selections, image loading, modal open/Escape close, search, thumbnail selection and 390px overflow. Evidence: `output/hand-reference-research/board/report.json` and screenshots.

The board is not imported into the game runtime and adds no game draw calls, geometry or rig evaluation. Browser layout checks do not establish physical-device game performance.
