"""Import the exact runtime geometry exports into an editable, packed Blender file.
Run after export-site-equipment.mjs, from the project root, with Blender 5.1.
"""
import bpy, json, pathlib
root = pathlib.Path.cwd()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = 1
report = {}
for name, offset in [('wheelbarrow', (-1.0, 0, 0)), ('concrete-mixer', (1.0, 0, 0))]:
    existing = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(root / 'assets' / 'exports' / (name + '.glb')))
    objects = set(bpy.data.objects) - existing
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    for obj in objects:
        for old in list(obj.users_collection):
            old.objects.unlink(obj)
        collection.objects.link(obj)
        if obj.parent is None:
            obj.location += __import__('mathutils').Vector(offset)
    report[name] = {'objects': len(objects), 'meshes': sum(o.type == 'MESH' for o in objects),
                    'polygons': sum(len(o.data.polygons) for o in objects if o.type == 'MESH')}
    assert report[name]['meshes'] > 20

# glTF does not define a bump-map channel. Rebuild the same fine aggregate as
# editable procedural bump nodes in the source file, without changing geometry.
for obj in bpy.data.objects:
    if obj.name.startswith('ready-wet-mortar') and obj.type == 'MESH':
        for mat in obj.data.materials:
            if not mat or not mat.use_nodes:
                continue
            nodes, links = mat.node_tree.nodes, mat.node_tree.links
            principled = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
            noise = nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 420
            bump = nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = .22
            bump.inputs['Distance'].default_value = .0011
            links.new(noise.outputs['Fac'], bump.inputs['Height']); links.new(bump.outputs['Normal'], principled.inputs['Normal'])

notes = bpy.data.texts.new('READ ME - site equipment')
notes.write('Photo-led site props. Metres. Editable meshes grouped by assembly.\n'
            'Authoritative construction source: src/world/SiteEquipmentModels.ts.\n'
            'Wheelbarrow: yellow pressed tray, black tubular frame, 60 L ready mortar.\n'
            'Mixer: open drum with paddles, gear ring, tilt wheel, motor, cable and wheeled stand.\n'
            'Drum rotation and contained mix are controlled by src/systems/DrumMixer.ts.\n'
            'No wheelbarrow refill animation. No third-party model downloads.\n'
            'The runtime changes mortar surface height as the finite supply is consumed.\n')
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.region_3d.view_distance = 4.4
            area.spaces.active.region_3d.view_location = (0, 0, .7)
bpy.ops.file.pack_all()
bpy.context.preferences.filepaths.save_version = 0
destination = root / 'assets' / 'source'; destination.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(destination / 'site-equipment.blend'))
(root / 'output' / 'site-equipment-blend.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report))
