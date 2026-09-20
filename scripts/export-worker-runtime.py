"""Export the validated editable worker source as a compact animated GLB."""
import bpy, json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/assets/worker/worker.glb'
rig=bpy.data.objects['WorkerRig']
source=next(c for c in rig.users_collection if c.name.startswith('WORKER'))
runtime=bpy.data.collections.new('RUNTIME export copies')
bpy.context.scene.collection.children.link(runtime)
groups={'WorkerBodyMesh':[],'WorkerHeadMesh':[]}

for original in list(source.all_objects):
    if original.type!='MESH':continue
    copy=original.copy();copy.data=original.data.copy();runtime.objects.link(copy)
    bpy.ops.object.select_all(action='DESELECT');copy.select_set(True);bpy.context.view_layer.objects.active=copy
    for modifier in list(copy.modifiers):
        if modifier.type!='ARMATURE':bpy.ops.object.modifier_apply(modifier=modifier.name)
    # Match the established runtime contract: at most four normalized bone
    # influences per vertex, while preserving the editable source untouched.
    for vertex in copy.data.vertices:
        weights=sorted([(g.group,g.weight) for g in vertex.groups],key=lambda pair:-pair[1])[:4]
        total=sum(weight for _,weight in weights)
        for group in copy.vertex_groups:group.remove([vertex.index])
        if total:
            for index,weight in weights:copy.vertex_groups[index].add([vertex.index],weight/total,'REPLACE')
    group='WorkerHeadMesh' if original.name.startswith('WorkerHead') or 'eye.' in original.name else 'WorkerBodyMesh'
    groups[group].append(copy)

merged=[]
for name,objects in groups.items():
    if not objects:raise RuntimeError(f'No export objects for {name}')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();objects[0].name=name;merged.append(objects[0])

bpy.ops.object.select_all(action='DESELECT')
for obj in merged+[rig]:obj.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(
    filepath=str(OUT),export_format='GLB',use_selection=True,export_apply=True,
    export_yup=True,export_animations=True,export_animation_mode='ACTIONS',
    export_force_sampling=True,export_anim_slide_to_zero=True,
    export_optimize_animation_size=True,export_optimize_animation_keep_anim_armature=True,
)
report={'glb':str(OUT),'bytes':OUT.stat().st_size,'meshes':len(merged),'actions':len([a for a in bpy.data.actions if a.name.startswith('Worker_')]),'bones':len(rig.data.bones)}
(ROOT/'output/full-body-locomotion/export-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
