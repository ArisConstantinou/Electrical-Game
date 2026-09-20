"""Bake verified runtime review cycles into the existing editable worker rig.

Run after tests/worker-motion-review.mjs. Runtime continues to use continuous
directional IK; these named in-place Actions are editable source equivalents
for all eight directions at walk, jog and crouch speeds.
"""
import bpy, json, math
from pathlib import Path
from mathutils import Matrix

ROOT=Path(__file__).resolve().parents[1]
data=json.loads((ROOT/'output/worker-three-fixes/motion/source-poses.json').read_text())
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/source/worker.blend'))
rig=bpy.data.objects['WorkerRig']
lookup={b.name.replace('.',''):b for b in rig.pose.bones}
conversion=Matrix.Rotation(math.pi/2,4,'X')
inverse=rig.matrix_world.inverted()
def matrix(values):return Matrix([[values[c*4+r] for c in range(4)] for r in range(4)])
def targets(entries):return {lookup[e['name'].replace('.','')].name:inverse@conversion@matrix(e['matrix']) for e in entries}

# A world-space round trip must reproduce the source's actual rest skeleton;
# a blind quaternion-axis swap is not accepted as an animation conversion.
rest=targets(data['rest'])
rest_error=max(max(abs(rest[b.name][r][c]-b.bone.matrix_local[r][c]) for r in range(4) for c in range(4)) for b in rig.pose.bones)
if rest_error>0.0001:raise RuntimeError(f'Rest conversion mismatch: {rest_error}')
rig.animation_data_create()
scene=bpy.context.scene;scene.render.fps=60
errors=[]
# The previous eight-clip sample used StrafeLeft/StrafeRight names that are no
# longer part of the complete 24-cycle set. Remove the whole owned namespace
# first so stale Actions cannot survive a successful-looking rebake.
for action in [a for a in bpy.data.actions if a.name.startswith('Worker_')]:bpy.data.actions.remove(action)
for clip in data['clips']:
 name='Worker_'+clip['name']
 action=bpy.data.actions.new(name);action.use_fake_user=True;rig.animation_data.action=action
 for sample in clip['frames']:
  frame=1+sample['time']*60;desired=targets(sample['bones'])
  for pb in rig.pose.bones:
   kwargs={'parent_matrix':desired[pb.parent.name],'parent_matrix_local':pb.parent.bone.matrix_local} if pb.parent else {}
   pb.matrix_basis=pb.bone.convert_local_to_pose(desired[pb.name],pb.bone.matrix_local,invert=True,**kwargs)
   pb.rotation_mode='QUATERNION'
   for path in ['location','rotation_quaternion','scale']:pb.keyframe_insert(data_path=path,frame=frame,group=pb.name)
  bpy.context.view_layer.update()
  error=max((pb.matrix.translation-desired[pb.name].translation).length for pb in rig.pose.bones)
  if error>0.0001:raise RuntimeError(f'{name}: pose conversion mismatch {error}')
  errors.append(error)
 action['source']='Verified runtime directional IK; in-place editable review cycle'
 action['duration_seconds']=clip['duration']
rig.animation_data.action=None
for pb in rig.pose.bones:pb.matrix_basis=Matrix.Identity(4)
scene.frame_set(1)
expected=len(data['clips'])
rig['animation_actions']=f'{expected} full-body in-place cycles: eight directions across walk, jog and crouch; runtime retains continuous contact IK'
target=ROOT/'output/worker-three-fixes/worker-animation-review.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(target),compress=True)
bpy.ops.wm.open_mainfile(filepath=str(target))
assert len([a for a in bpy.data.actions if a.name.startswith('Worker_')])==expected
report={'actions':expected,'rest_matrix_error':rest_error,'max_pose_position_error_m':max(errors),'reopened':True,'source':str(target)}
(ROOT/'output/worker-three-fixes/bake-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
