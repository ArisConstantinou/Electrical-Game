import bpy,bmesh,json,pathlib
root=pathlib.Path.cwd()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root/'public/assets/tools/sds-max-reference.glb'))
meshes=[o for o in bpy.data.objects if o.type=='MESH']
audit=[]
for o in meshes:
 bm=bmesh.new();bm.from_mesh(o.data)
 # glTF splits vertices at hard-normal/material seams. Weld only the audit
 # copy to test geometric closure, without modifying the authored asset.
 bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
 audit.append({'name':o.name,'volume':bm.calc_volume(signed=True),'nonmanifold':sum(not e.is_manifold for e in bm.edges)})
 bm.free()
assert len(meshes)==114
assert all(x['volume']>0 for x in audit),[x for x in audit if x['volume']<=0]
assert all(x['nonmanifold']==0 for x in audit),[x for x in audit if x['nonmanifold']]
assembly=next(o for o in bpy.data.objects if 'handClearanceSolids' in o)
assert abs(assembly['gripRadiusM']-.024)<1e-8
assert len(json.loads(assembly['handClearanceSolids']))==5
report={'pass':True,'closedMeshes':len(meshes),'positiveVolumes':True,'materials':len(bpy.data.materials),'rootScale':list(assembly.scale),'rearGrip':list(assembly['gripPoint']),'checks':['GLB reimport','closed solids','outward face winding','unit root scale','five casing clearance profiles','rear grip datum']}
assert all(abs(v-1)<1e-8 for v in assembly.scale)
(root/'output/forge-hammer-wrists/export-audit.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
