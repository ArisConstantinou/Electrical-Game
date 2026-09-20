"""Validate and render the complete editable worker locomotion Action set.

Open the baked review .blend before running this script. It verifies the exact
24 owned Actions, finite bone transforms, complete rig coverage and renders
four representative mid-cycle poses for visual review.
"""
import bpy, json, math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/full-body-locomotion/blender-review'
OUT.mkdir(parents=True,exist_ok=True)
directions=['Forward','ForwardLeft','Left','BackwardLeft','Backward','BackwardRight','Right','ForwardRight']
expected={f'Worker_{mode}{direction}' for mode in ['Walk','Jog','Crouch'] for direction in directions}
actual={a.name for a in bpy.data.actions if a.name.startswith('Worker_')}
if actual!=expected:raise RuntimeError(f'Worker Actions mismatch: missing={sorted(expected-actual)}, extra={sorted(actual-expected)}')

rig=bpy.data.objects['WorkerRig']
rig.animation_data_create()
scene=bpy.context.scene
scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=720;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
samples=['Worker_WalkForward','Worker_WalkForwardLeft','Worker_JogRight','Worker_CrouchBackwardRight']
rows=[]
for name in samples:
    action=bpy.data.actions[name];rig.animation_data.action=action
    start,end=action.frame_range;frame=round((start+end)/2);scene.frame_set(frame);bpy.context.view_layer.update()
    matrices=[value for bone in rig.pose.bones for row in bone.matrix for value in row]
    if not all(math.isfinite(value) for value in matrices):raise RuntimeError(f'{name}: non-finite pose matrix')
    # Blender 5 Actions store curves in a slot-specific channel bag rather
    # than exposing action.fcurves directly.
    strip=action.layers[0].strips[0];curves=len(strip.channelbag(action.slots[0]).fcurves)
    if curves<len(rig.pose.bones)*3:raise RuntimeError(f'{name}: incomplete keyed rig coverage')
    scene.render.filepath=str(OUT/f'{name}.png');bpy.ops.render.render(write_still=True)
    rows.append({'name':name,'frame':frame,'frameRange':[start,end],'fcurves':curves,'bones':len(rig.pose.bones)})
rig.animation_data.action=None;scene.frame_set(1)
report={'passed':True,'actions':len(actual),'expectedActions':sorted(expected),'samples':rows}
(OUT/'report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
