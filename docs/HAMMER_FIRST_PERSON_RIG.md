# Hammer first-person rig

## Scope and source

The first-person arms use a separate skeleton cloned from the existing worker.
The world body still owns locomotion, full-body inspection and shadows. The worker,
gloves and hammer assets have not been replaced. `FirstPersonWorkerArms.ts` and
`hammerGripPoses.json` are the editable rig and grasp source.

The four grasps (left/right hand on rear/auxiliary handle) were captured from the
world rig at `590be18`: standing eye height 1.65 m, pitch -0.55 radians, wall distance
1.08 m, chisel tilt 15 degrees, side -15/+15 degrees for right/left main hand.
The original worker GLB SHA256 is
`1B481277D37F3A28769F7A715D27DC534B7E61E2E3C574C5AE3FF9C606279078`.
Capture residuals were below 0.00000014 m at the wrists. The fixture stores actual
glove surface samples in cylindrical handle coordinates, not generated ideal hands.

## Constraints

- Normalize visible arm weights so the torso cannot pull sleeves across the eye.
- Preserve authored upper-arm and forearm lengths and the elbow's bind hinge.
- Keep the wrist neutral and preserve the calibrated finger contact on the handle.
- Solve elbow flexion and grasp swivel independently from world-body IK.
- Limit pose changes per frame; keep the shoulder outside the view and penalize
  proximity to the eye, aiming region and actual hammer battery envelopes.
- Carry the complete tool smoothly between work and rest. Suppress impacts while
  the displayed bit is moving to its physical contact position.

The previous rig extended its upper arm to force a shoulder behind the eye while
retaining a world-body wrist. A continuous camera sweep exposed a singular frame
with more than 300 m of upper-arm extension. Static endpoint tests missed it.

## Regression commands

Build using the existing installed TypeScript and Vite versions, then run:

```powershell
node tests/hammer-first-person-body.mjs
node tests/hammer-arm-motion-ui.mjs
node tests/hammer-pose-gallery.mjs
node tests/hammer-full-depth-ui.mjs
node tests/hammer-rig-performance.mjs
```

Browser tests intercept the existing port 5365 to load this checkout's compiled
`dist`; they do not launch another server. Set `QA_LIVE=1` to verify the real served
checkout after integration. Performance compares the served baseline first and
compiled candidate second, so run it before replacing the baseline and without
other test browsers running concurrently.

The motion regression checks every simulated frame for fixed lengths, wrist/hinge
alignment, elbow bind continuity, grip contact and bounded shoulder motion. Actual
visible surfaces are ray-tested every ninth frame. `aimIntersections` retains all
hand intersections, including a normal glove visible when looking at its handle.
`occluded` rejects body/sleeve/upper-arm intrusion and surfaces entering the eye.
Opaque hammer surfaces occlude hidden gloves in this diagnostic. Screenshots remain
necessary; these counters alone do not establish visual quality.

## Full-depth masonry

`demolish` is the default. FULL DEPTH (desktop) / THROUGH (touch) removes masonry
through the wall; CHASE 75 mm deliberately preserves backing. Upward demolition
does not silently switch to edge cleanup. The UI regression holds the actual use
control and verifies a ray through the complete 100 mm wall is empty. Damage-node
counts or a shallow groove alone are insufficient.
