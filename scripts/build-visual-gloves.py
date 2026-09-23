"""Apply a photographed dark textile to the existing rigged hands.

Writes review candidates only. The editable source and shipped GLB are not
changed until the candidate is checked in the actual game.
"""
import bpy
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/visual-overhaul/glove-candidate'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = ROOT / 'output/visual-overhaul/glove-before/worker.blend'
if not SOURCE.exists():
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    with SOURCE.open('wb') as original:
        subprocess.run(['git', 'show', '4a032b7:assets/source/worker.blend'],
                       cwd=ROOT, stdout=original, check=True)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))

skin = bpy.data.objects['WorkerSkin']
faces = skin.data.attributes['.sculpt_face_set']
if skin.data.materials.get('Scanned graphite work glove'):
    raise RuntimeError('The source already includes this visual glove treatment')

diffuse = bpy.data.images.load(str(ROOT / 'assets/source/denim_fabric_06_diff_1k.jpg'), check_existing=True)
normal = bpy.data.images.load(str(ROOT / 'assets/source/denim_fabric_06_nor_gl_1k.jpg'), check_existing=True)
normal.colorspace_settings.name = 'Non-Color'
diffuse.pack()
normal.pack()

glove = bpy.data.materials.new('Scanned graphite work glove')
glove.use_nodes = True
glove.diffuse_color = (.058, .055, .052, 1)
nodes = glove.node_tree.nodes
links = glove.node_tree.links
surface = nodes.get('Principled BSDF')
surface.inputs['Roughness'].default_value = .89
surface.inputs['Metallic'].default_value = 0
color_image = nodes.new('ShaderNodeTexImage')
color_image.name = 'Poly Haven dark work fabric colour'
color_image.image = diffuse
links.new(color_image.outputs['Color'], surface.inputs['Base Color'])
normal_image = nodes.new('ShaderNodeTexImage')
normal_image.name = 'Poly Haven dark work fabric OpenGL normal'
normal_image.image = normal
normal_node = nodes.new('ShaderNodeNormalMap')
normal_node.inputs['Strength'].default_value = .4
links.new(normal_image.outputs['Color'], normal_node.inputs['Color'])
links.new(normal_node.outputs['Normal'], surface.inputs['Normal'])
skin.data.materials.append(glove)
glove_index = len(skin.data.materials) - 1

# Sculpt face sets are the original anatomical regions. The digit range covers
# the articulated finger shells and nail tips. It ends on the original wrist
# loop, avoiding a jagged material cutoff across the forearm.
hand_count = 0
uv = skin.data.uv_layers.active.data
for face in skin.data.polygons:
    region = faces.data[face.index].value
    hand = region in (9, 10) or 64 <= region <= 103
    if not hand:
        continue
    face.material_index = glove_index
    hand_count += 1
    for loop_index in face.loop_indices:
        vertex = skin.data.vertices[skin.data.loops[loop_index].vertex_index]
        # The fabric is a continuous photographed tile with a recorded 0.3 m
        # width. Project at that physical scale onto each articulated hand.
        # Each face retains its original posed vertices and bone weights.
        x = min(.46, max(.35, abs(vertex.co.x)))
        z = min(.96, max(.78, vertex.co.z))
        uv[loop_index].uv = (.2 + (x - .35) / .3,
                             .15 + (z - .78) / .3)
skin.data.update()
if hand_count < 2500:
    raise RuntimeError(f'Unexpected glove coverage: {hand_count} hand faces')

bpy.context.scene['visual_glove_source'] = 'Poly Haven denim_fabric_06 / CC0 / dark woven work glove'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'worker.blend'), compress=True)

# Match the shipped two-mesh export contract while leaving the source objects
# and their full-weight editable rig in the candidate .blend.
rig = bpy.data.objects['WorkerRig']
source = next(c for c in rig.users_collection if c.name.startswith('WORKER'))
runtime = bpy.data.collections.new('RUNTIME glove export copies')
bpy.context.scene.collection.children.link(runtime)
groups = {'WorkerBodyMesh': [], 'WorkerHeadMesh': []}
for original in list(source.all_objects):
    if original.type != 'MESH':
        continue
    copy = original.copy()
    copy.data = original.data.copy()
    runtime.objects.link(copy)
    bpy.ops.object.select_all(action='DESELECT')
    copy.select_set(True)
    bpy.context.view_layer.objects.active = copy
    for modifier in list(copy.modifiers):
        if modifier.type != 'ARMATURE':
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    for vertex in copy.data.vertices:
        weights = sorted([(g.group, g.weight) for g in vertex.groups], key=lambda pair: -pair[1])[:4]
        total = sum(weight for _, weight in weights)
        for group in copy.vertex_groups:
            group.remove([vertex.index])
        if total:
            for index, weight in weights:
                copy.vertex_groups[index].add([vertex.index], weight / total, 'REPLACE')
    group = 'WorkerHeadMesh' if original.name.startswith('WorkerHead') or 'eye.' in original.name else 'WorkerBodyMesh'
    groups[group].append(copy)

merged = []
for name, objects in groups.items():
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    objects[0].name = name
    merged.append(objects[0])

bpy.ops.object.select_all(action='DESELECT')
for obj in merged + [rig]:
    obj.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(
    filepath=str(OUT / 'worker.glb'), export_format='GLB', use_selection=True,
    export_apply=True, export_yup=True, export_animations=True,
    export_animation_mode='ACTIONS', export_force_sampling=True,
    export_anim_slide_to_zero=True, export_optimize_animation_size=True,
    export_optimize_animation_keep_anim_armature=True,
)
report = {
    'source': str(SOURCE),
    'candidateBlend': str(OUT / 'worker.blend'),
    'candidateGLB': str(OUT / 'worker.glb'),
    'gloveFaces': hand_count,
    'cuffFaces': 0,
    'bones': len(rig.data.bones),
    'actions': len([a for a in bpy.data.actions if a.name.startswith('Worker_')]),
    'glbBytes': (OUT / 'worker.glb').stat().st_size,
}
(OUT / 'report.json').write_text(json.dumps(report, indent=2))
print('VISUAL_GLOVE_CANDIDATE', json.dumps(report))
