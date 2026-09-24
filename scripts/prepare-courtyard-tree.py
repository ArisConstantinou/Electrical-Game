"""Make a game-sized editable tree from Poly Haven's Island Tree 02 glTF.

Run with Blender: blender -b -t 4 --python scripts/prepare-courtyard-tree.py
The original CC0 1K glTF and its includes belong in output/tree-source/.
"""
from pathlib import Path
import bpy

root = Path.cwd()
source = root / "output/tree-source/island_tree_02_1k.gltf"
destination = root / "public/assets/vegetation/courtyard-tree"
editable = root / "artifacts/courtyard-tree/source"
destination.mkdir(parents=True, exist_ok=True)
editable.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(source))
mesh = next(obj for obj in bpy.data.objects if obj.type == "MESH")
bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.separate(type="MATERIAL")
bpy.ops.object.mode_set(mode="OBJECT")

for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
    material = obj.data.materials[0].name
    part = "leaves" if "leaves" in material else "branches" if "branches" in material else "trunk"
    obj.name = f"courtyard_tree_{part}"
    start = len(obj.data.polygons)
    ratio = {"trunk": 1.0, "branches": 0.11, "leaves": 0.095}[part]
    if ratio < 1:
        modifier = obj.modifiers.new("Game LOD: preserve tree silhouette", "DECIMATE")
        modifier.ratio = ratio
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    print("TREE_OPT", part, start, len(obj.data.polygons),
          tuple(round(v, 3) for v in obj.dimensions))

bpy.ops.object.select_all(action="DESELECT")
for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
    obj.select_set(True)
bpy.context.view_layer.objects.active = next(o for o in bpy.data.objects if o.name == "courtyard_tree_trunk")
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(editable / "courtyard-tree-optimized.blend"))
bpy.ops.export_scene.gltf(filepath=str(destination / "courtyard-tree-optimized.glb"),
                          export_format="GLB", use_selection=True,
                          export_draco_mesh_compression_enable=True,
                          export_draco_mesh_compression_level=6,
                          export_draco_position_quantization=14,
                          export_draco_normal_quantization=10,
                          export_draco_texcoord_quantization=12)
