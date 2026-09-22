# Site Pro 04 editor selection, 2026-09-23

The desktop before/after images use the same 1440 × 900 camera aimed at the garage masonry stack. Before, clicking the visible stack left the selection empty. After, the stack has a cyan outline, a small offset badge and editable dimensions. The mobile portrait image shows the same asset selected by touch.

- `asset-before.png`: live runtime with authored asset registration disabled for the controlled before capture.
- `asset-selected.png`: live runtime after registration and a canvas click.
- `mobile-asset-selected.png`: 390 × 844 Chrome touch emulation after a tap.

The previous editor registered 50 wing masonry walls and no authored wing assets. It now registers 203 additional direct wing parts with stable IDs and edit pivots. Moving and rotating the garage masonry stack survives Save/Reload; its collision footprint follows the edit. Clicking another wall while Continue is active changes selection instead of creating a stray wall section.

`tests/editor-selection-coverage.mjs` covers those interactions. Existing editor, groups, floor-view, wall-path and mansion-room route tests passed. The controlled editor render comparison measured identical draw calls with registration on/off: 1,603 at ground TOP and 1,311 at L1 TOP, on Windows Chrome WebGL mobile emulation. This is not a physical-device frame-rate claim.

The original workroom, animated courtyard and distant surroundings are not part of this asset registry. Collision and gameplay mappings for other movable construction assets still need individual verification; do not call this complete Full Control.
