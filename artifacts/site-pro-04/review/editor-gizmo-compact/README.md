# Level Editor selection and gizmo review

The live screenshots in this folder and `../level-editor-selection/` show the revised editor on the mansion scene. The transform gizmo shrinks with a small piece's screen size; the world-space `SELECTED` badge is gone. Wall endpoint buttons are visible only during explicit wall continuation. For broad surfaces, a small cyan ring marks the clicked location and the transform pivot stays there.

Verified on the shared `5365` preview: desktop and mobile selection, empty-sky deselection, wall continuation, mobile terrain handle drag, asset and terrain save/reload, original-room floor height following its visual edit, floor isolation, grouping, and room-to-courtyard movement. The browser screenshots are Chrome viewport/touch emulation on Windows, not physical phone proof.

The remaining original-room interaction systems and individual instances in batched geometry still need edit/collision mapping before the entire environment can be called fully editable.
