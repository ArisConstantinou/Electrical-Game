"""Export a lighter copy of the existing rigged worker for Apprentice rendering.

The editable worker.blend and the full-detail worker.glb remain unchanged.
Run with Blender background: blender assets/source/worker.blend -b -P scripts/export-worker-apprentice-lod.py
"""
import bpy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets/worker/worker-apprentice-lod.glb'
REPORT = ROOT / 'output/apprentice/performance/lod-export.json'
rig = bpy.data.objects['WorkerRig']
source = next(collection for collection in rig.users_collection if collection.name.startswith('WORKER'))
runtime = bpy.data.collections.new('APPRENTICE_LOD_EXPORT')
bpy.context.scene.collection.children.link(runtime)
groups = {'WorkerBodyMesh': [], 'WorkerHeadMesh': []}
before = after = 0
parts = []

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
    triangles_before = sum(len(p.vertices) - 2 for p in copy.data.polygons)
    before += triangles_before
    # Keep small facial/finger parts intact. Larger parts retain at least a
    # quarter of their triangles, preserving the silhouette at room range.
    if triangles_before >= 500:
        modifier = copy.modifiers.new('Apprentice LOD reduction', 'DECIMATE')
        modifier.ratio = 0.25 if not original.name.startswith('WorkerHead') else 0.35
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    triangles_after = sum(len(p.vertices) - 2 for p in copy.data.polygons)
    after += triangles_after
    parts.append({'name': original.name, 'before': triangles_before, 'after': triangles_after})
    for vertex in copy.data.vertices:
        weights = sorted(((group.group, group.weight) for group in vertex.groups), key=lambda pair: -pair[1])[:4]
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
    if not objects:
        raise RuntimeError(f'No export objects for {name}')
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
    filepath=str(OUT), export_format='GLB', use_selection=True, export_apply=True,
    export_yup=True, export_animations=False,
)
REPORT.parent.mkdir(parents=True, exist_ok=True)
REPORT.write_text(json.dumps({'bytes': OUT.stat().st_size, 'before': before, 'after': after, 'parts': parts}, indent=2))
print('APPRENTICE_LOD', json.dumps({'bytes': OUT.stat().st_size, 'before': before, 'after': after}))
