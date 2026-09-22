# Mobile Level Editor — five distinct navigation concepts

These are **UI storyboards**, not the implemented editor. Each image uses a capture of the live game world and shows the same task in sequence: clean canvas → open navigation → choose a brick wall in Build → position its preview → select and edit with the offset Orbit Halo → switch to live top view and isolate a floor. The captions between frames name the state; they are not permanent top panels in the proposed UI.

Every primary action combines a symbol and a short label. The compact closed controls use a single recognizable symbol to give the 3D world almost the entire screen. Asset cards use material thumbnails. The selected wall gets a cyan outline and name badge; the Orbit Halo sits beside the wall rather than over its center.

## 01 — Dock Nest

Only a small arc remains when the dock is closed. Tap it to expand the bottom navigation; tap the arc/close gesture again to recover the full scene. Build opens a temporary asset drawer. This is the clearest familiar layout and the direct answer to the requested collapsible bottom navigation.

![Dock Nest full mobile flow](editor-flow-v2-01.png)

## 02 — Asset Track

A narrow edge handle opens a vertical rail from the left. Build and floor controls open beside that rail, keeping the bottom free. The rail closes completely when inspecting the model.

![Asset Track full mobile flow](editor-flow-v2-02.png)

## 03 — Orbit Wheel

A thumb-sized hub opens a radial command wheel. Choose Build, Edit, Group, View, or Save, and the wheel disappears while that task's temporary controls open. Shortcuts for Select, View, and Save stay accessible at the bottom.

![Orbit Wheel full mobile flow](editor-flow-v2-03.png)

## 04 — Context Cards

One small Build launcher sits in the corner of the clean canvas. It opens a floating contextual asset card; selecting an object brings only its editing controls. The card closes to reveal the entire scene again. No fixed navigation bar.

![Context Cards full mobile flow](editor-flow-v2-04.png)

## 05 — Dual Thumb

Two small thumb controls remain when collapsed: Build on the left, View on the right. They expand into separate left/right action belts. The asset library is a horizontal strip suited to quick thumb browsing.

![Dual Thumb full mobile flow](editor-flow-v2-05.png)

The floor example shows B2, B1, G-0, and L1–L4. In 2D only the chosen floor remains visible and editable; 3D can use the same isolation. The 2D backdrop is a top view of the rendered game world, not a blueprint illustration.

Design references: [SketchUp for iPad customizable radial toolbar](https://help.sketchup.com/en/sketchup-ipad/customizing-sketchup-ipad), [Onshape mobile touch navigation and precision selection](https://cad.onshape.com/help/Content/Mobile/mobile_touch_interface_videos.htm), [Onshape resizable mobile feature list](https://cad.onshape.com/help/Content/PartStudio/part_studios.htm). These informed the control patterns; the graphics and layout here are original proposals for Site Pro 04.
