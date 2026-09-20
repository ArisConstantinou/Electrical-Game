# Wheelbarrow transport

Shared preview: http://127.0.0.1:5365/Electrical-Game/ . Electrical-Game uses this one port across tasks. The existing launcher verifies served source and worker assets before reusing a listener.

Aim at the cart and press **E** to hold its handles. **WASD** moves in every direction; mouse turning steers. **Shift** accelerates progressively to 3.1 m/s; straight acceleration alone must not tip the cart. The wheel rotates with actual travel. The guide shows speed, combined pitch/roll risk, danger and remaining mortar. Press **E** to park and level it. Aim at an overturned cart and press **E** to right it.

Acceleration and turning can overcome local mortar adhesion: cohesive regions slip unevenly, retain their deformed shape and break off in irregular chunks at the rim. There is no water-wave surface. Abrupt movement can tip the cart in any direction. Parcels retain mass and produce impact-dependent footprints. Pick up the physical shovel with **E**, aim at a spill and press **E** to scoop up to 3.5 kg, then aim at the parked cart and press **E** to return it. Capacity is 114 kg. Existing sand and mixer interactions remain available when the shovel is empty. Photo observations, source research and material criteria are in [MORTAR-BEHAVIOUR.md](MORTAR-BEHAVIOUR.md).

The anatomical worker holds the cart independently of camera pitch. The thumb faces inward; actual skin contact is checked before reusing a pose. Elbows stay nearly straight. When handles rise, the grounded stance retreats instead of lifting the worker off the floor. Arm lengths stay fixed and the wrist can articulate during manoeuvres.

## Simulation boundary

This is bounded, fixed-step gameplay dynamics using the authored cart geometry, not a general rigid-body simulation. Ground support comes from model vertices. Spill rendering uses at most 240 instances; nearby settled footprints merge when needed so the rendering budget cannot lose mass or trap material in an inverted tray.

## Verification

- `node tests/wheelbarrow-balance.mjs`: all four straight sprint directions remain upright; hard collision impulses can tip in each direction; partial tilts and overturns shed material from the actual downhill rim. Open-ground/collision fixtures isolate dynamics from the room props. The original regression reproduced ordinary sprint flips in all four directions before the correction.
- `node tests/mortar-relief.mjs`: close-up and grazing views, including texture-free geometry, in the same seeded before/after scene.

- `node tests/wheelbarrow-ui.mjs`: native E entry, LMB isolation, wheel rotation, parking, controlled severe directional/diagonal disturbances followed by native righting, physical shovel pickup, recovery/deposit, mass conservation and a full parcel pool.
- `node tests/wheelbarrow-grip.mjs`: camera-independent grasp, elbow/wrist angles, actual thumb skin clearance, moving contact and stance; close and whole-arm screenshots.
- `node tests/wheelbarrow-performance.mjs`: same-scene controller baseline, active transport, settled spills, CPU timing, frame pacing, render counters, heap snapshots and portrait layout. PC browser evidence does not establish physical-phone performance.
- Existing PVC, highlight, equipment collision, hose nozzle and trowel pose regressions cover integration.

Generated screenshots and JSON reports are under `output/wheelbarrow*`.
