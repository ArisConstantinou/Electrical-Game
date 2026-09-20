# Full-body directional locomotion reference

## Intended motion set

The worker has eight travel directions — forward, backward, left, right and all four diagonals — in three authored modes: walk, jog and crouch-walk. Diagonal input is normalized so two pressed keys do not increase the player's speed.

The pelvis transfers weight toward the planted leg and counter-rotates against the rib cage. The chest leans into travel, the head counter-rotates to preserve aim, the toes lift during swing, and an unloaded arm counter-swings from the clavicle. A hand that is holding a tool reduces upper-body sway while the legs retain their full stride; a seated tool contact has priority over gait motion.

## Visual guide

- Generated direction/pose sheet: `output/imagegen/worker-eight-direction-locomotion.png`
- Runtime phase captures and WebM loops: `output/worker-three-fixes/motion/`
- Neutral Blender renders: `output/full-body-locomotion/blender-review/`

The generated sheet is a composition and direction guide, not ground-truth biomechanics. The runtime and editable Blender actions are accepted against the measurable foot-plant, joint-continuity and contact constraints below.

## Primary technical references

- [Epic Games: Locomotion Based Blending](https://dev.epicgames.com/documentation/unreal-engine/locomotion-based-blending-in-unreal-engine) — directional speed/blend-space structure.
- [Blender Manual: Actions](https://docs.blender.org/manual/en/4.2/animation/actions.html) — named editable animation clips.
- [Three.js: AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html) — runtime clip playback contract.
- [Three.js: SkinnedMesh](https://threejs.org/docs/pages/SkinnedMesh.html) — skeleton/skin runtime contract.
- [CMU Graphics Lab Motion Capture Database](https://mocap.cs.cmu.edu/) — public human-motion reference library.

## Acceptance evidence

- `tests/worker-movement-input.mjs`: native W/A/S/D plus W+A, W+D, S+A and S+D; diagonal speed equals cardinal speed.
- `tests/worker-directional.mjs`: 24 direction/mode cases; foot travel, no leg crossing, pelvis motion, torso/head/clavicle contribution and normalized direction.
- `tests/worker-glb-contract.mjs`: one 52-joint skin, two meshes and the exact 24 named clips in the GLB.
- `tests/grasp-frame-motion.mjs`: tool contact remains locked while the arm changes continuously through crouch.
- `scripts/validate-worker-actions.py`: exact editable Blender action set, finite bone matrices and representative renders after reopening the file.
