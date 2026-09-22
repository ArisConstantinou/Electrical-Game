# Site Pro 04 — five mobile portrait editor directions

These are selection concepts, not a shipped editor. Each set has a 3D image, a live-rendered top view marked 2D, and a 3D image with the floor viewer open. The world backgrounds were captured from the Electrical-Game renderer; the editor controls and gizmos are design mockups. The top view capture temporarily hid overhead meshes for clarity. Actual per-floor visibility, orthographic projection, picking, save, and transform behavior still require implementation and runtime tests.

Decision: the user selected **gizmo 02, Orbit Halo**. The surrounding UI layout remains undecided; the five images show five different UI directions, and the chosen gizmo can be combined with the eventual UI choice. Do not implement a full visual layout based solely on the gizmo selection.

Placement refinement: the halo's touch controls belong just outside the lower edge of the selected wall in screen space, linked to a small pivot marker. The object surface must stay readable. On a small or clipped selection the control can flip to another free edge. The transform pivot and the visible touch controls are separate concepts: moving the touch UI alone must not silently change the rotate/scale origin. Multi-selection uses one deliberate group pivot. [Unreal's coordinate-space guide](https://dev.epicgames.com/documentation/unreal-engine/coordinate-system-and-spaces-in-unreal-engine) places the standard gizmo at the actor pivot, which can be moved; [its predefined shape tool](https://dev.epicgames.com/documentation/unreal-engine/predefined-shapes-in-unreal-engine) permits base, center or top pivots. Unreal therefore does not impose a universal lower-edge gizmo. The lower external touch control is our mobile-specific design decision.

For the five UI layouts shown as images in one mobile-friendly page, open [UI-GALLERY.md](UI-GALLERY.md).

The design target is one selectable floor at a time: B2, B1, ground, and floors 01–04 (five above-ground levels including ground). In 3D, isolate the selected floor while allowing a temporary context overlay if wanted later. In 2D, show the same textured world from directly above, with only the selected floor visible and fully editable. The 2D view is **not** a blueprint substitute. Tapping the compact floor chip opens the selector; closing it restores the scene. This may reduce rendered geometry, but performance improvement is unmeasured until implementation.

| Direction | Gizmo and edit affordance | Navigation |
| --- | --- | --- |
| 01 Anchor Rail | Dashed boundary, drag rail, central move puck and dimension ticket | Horizontal editor bottom nav plus contextual tool rail |
| 02 Orbit Halo | Circular transform ring, pivot puck and orbit handles | Contextual radial controls, fold away when idle |
| 03 Top View Grip | Wall endpoint handles, length line and angle arc | Collapsible measurement tab; strongest for top view |
| 04 Finger Lens | Offset touch target, drag trail, corner brackets and delta chip | Minimal floating lens, gesture hints only when needed |
| 05 Builder Belt | Jointed pivot, length grips and angle arc | Compact construction belt at bottom |

Shared behavior proposed for all five: tap select with contrasting outline and object badge; one-finger drag on a selected grip edits it; two-finger pan/pinch navigates; rotation is explicit; long press or selection mode supports multiple items and groups; dimensions are editable on demand, not permanently over the world; snap can be enabled and adjusted without blocking the scene. Floor picker, 2D/3D switch, save and undo need touch targets large enough for phones and safe-area placement.

Research anchors, used as interaction patterns rather than copied visual designs:

- [Nomad Sculpt interface](https://nomadsculpt.com/manual/interface): collapsible/customizable bars, Solo visibility, floating shortcuts and touch gestures.
- [Onshape navigation](https://cad.onshape.com/help/Content/View/view_navigation_and_the_view_cube.htm) and [triad manipulator](https://cad.onshape.com/help/Content/Home/triad_manipulator.htm): direct selection, camera pan/zoom, axis and pivot manipulation.
- [SketchUp for iPad Move tool](https://help.sketchup.com/en/sketchup-ipad/move-tool): touch move with precise measurements.
- [Apple game controls](https://developer.apple.com/design/human-interface-guidelines/game-controls): visible touch feedback and controls that do not obstruct the game scene.

Use the 3D, 2D and expanded-floor PNG for each direction to choose a layout. The top-down capture currently frames the garage wing only; it does not claim the complete multi-floor mansion is modeled or that the floor viewer already runs in the game.
