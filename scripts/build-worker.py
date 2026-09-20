"""Editable CC0 anatomical worker, fitted deformation skeleton and work clothes.
Run with Blender 5.1 --background --python scripts/build-worker.py.
The downloaded original remains untouched in output/human-reference/extracted.
"""
import bpy, bmesh, json, math, pathlib, collections
from mathutils import Vector
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'public/assets/worker';OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
source=next((ROOT/'output/human-reference/extracted').rglob('*.blend'))
with bpy.data.libraries.load(str(source),link=False) as (src,dst):dst.collections=['Body Male - Realistic']
collection=dst.collections[0];bpy.context.scene.collection.children.link(collection);collection.name='WORKER · anatomical source and garments'
body=bpy.data.objects['GEO-body_male_realistic'];body.name='WorkerSkin';offset=body.location.x
for ob in list(collection.all_objects):
 ob.location.x-=offset
 if ob!=body:
  ob.location*=1.04;ob.location.z+=.012;ob.scale*=1.04
# Source coordinates are metres, Z up, facing -Y. Preserve the sculpted original mesh.
body.location=(0,0,0)
for v in body.data.vertices:v.co*=1.04;v.co.z+=.012
body.data.update()
faces=body.data.attributes['.sculpt_face_set'];regions=collections.defaultdict(set)
for p in body.data.polygons:regions[faces.data[p.index].value].update(p.vertices)
def center(ids):return sum((body.data.vertices[i].co for i in ids),Vector())/len(ids)
def border(a,b):return center(regions[a]&regions[b])
def P(x,y,z):return Vector((x*1.04,y*1.04,z*1.04+.012))
def material(name,color,rough=.75):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;return m
skin=material('Skin · warm neutral',(.43,.235,.145),.65)
skin.node_tree.nodes.get('Principled BSDF').inputs['Subsurface Weight'].default_value=.07
nail=material('Natural nail plate',(.57,.36,.29),.37)
shirtmat=material('Milwaukee grey cotton',(.10,.093,.084),.94)
pantsmat=material('Milwaukee black work twill',(.018,.022,.025),.92)
leather=material('Milwaukee black safety shoe upper',(.032,.035,.038),.78)
rubber=material('Tread rubber',(.014,.017,.018),.95)
thread=material('Dark fly stitching',(.03,.033,.035),.95)
metal=material('Dark metal eyelets',(.07,.075,.07),.35);metal.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value=.7
body.data.materials.clear();body.data.materials.append(skin);body.data.materials.append(nail)
for p in body.data.polygons:p.material_index=1 if faces.data[p.index].value in [67,71,75,79,83,87,91,95,99,103] else 0;p.use_smooth=True
# Deformation rig fitted to the mesh, including joint rings authored by the artist.
arm=bpy.data.armatures.new('WorkerSkeleton');rig=bpy.data.objects.new('WorkerRig',arm);collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
def bone(name,a,b,parent=None):
 e=arm.edit_bones.new(name);e.head=a;e.tail=b
 if parent:e.parent=arm.edit_bones[parent]
 return e
bone('root',P(0,0,0),P(0,0,.18));bone('pelvis',P(0,.018,.86),P(0,.012,1.0),'root')
bone('spine',P(0,.012,1),P(0,.013,1.18),'pelvis');bone('chest',P(0,.013,1.18),P(0,0,1.37),'spine')
bone('neck',P(0,0,1.37),P(0,-.01,1.47),'chest');bone('head',P(0,-.01,1.47),P(0,-.025,1.66),'neck')
finger_regions={};nail_bones={}
for suffix,sign,upper,fore,palm,fingers in [('R',1,21,12,9,[76,72,68,64,80]),('L',-1,20,11,10,[88,92,96,100,84])]:
 shoulder=P(sign*.175,.007,1.325);elbow=border(upper,fore);wrist=border(fore,palm)
 bone('clavicle.'+suffix,P(sign*.035,0,1.335),shoulder,'chest')
 bone('upper_arm.'+suffix,shoulder,elbow,'clavicle.'+suffix)
 bone('forearm.'+suffix,elbow,wrist,'upper_arm.'+suffix)
 head=border(palm,fingers[1]);hand=bone('hand.'+suffix,wrist,head,'forearm.'+suffix);hand.align_roll(Vector((sign,0,0)))
 for digit,start in zip(['index','middle','ring','little','thumb'],fingers):
  a=border(palm,start);b=border(start,start+1);c=border(start+1,start+2)
  # Thumb opposition pivots at the carpometacarpal joint in the heel
  # of the palm, not the distal web skin boundary used by finger MCPs.
  if digit=='thumb':a=wrist.lerp(a,.45)
  ids=regions[start+2];tip=center(sorted(ids,key=lambda i:body.data.vertices[i].co.z)[:4])
  points=[a,b,c,tip]
  for j in range(3):
   name=f'{digit}.{j+1:02}.{suffix}';e=bone(name,points[j],points[j+1],'hand.'+suffix if j==0 else f'{digit}.{j:02}.{suffix}');e.align_roll(Vector((sign,0,0)))
   finger_regions[start+j]=name
  nail_bones[start+3]=f'{digit}.03.{suffix}'
 hip=P(sign*.10,.018,.82);knee=P(sign*.145,-.008,.445);ankle=P(sign*.18,.055,.075)
 bone('thigh.'+suffix,hip,knee,'pelvis');bone('shin.'+suffix,knee,ankle,'thigh.'+suffix)
 bone('foot.'+suffix,ankle,P(sign*.218,-.10,.022),'shin.'+suffix);bone('toe.'+suffix,P(sign*.218,-.10,.022),P(sign*.223,-.143,.018),'foot.'+suffix)
bpy.ops.object.mode_set(mode='OBJECT')
# Automatic heat weighting gives smooth shoulders and knees. Finger face-set
# membership then isolates adjacent digits so touching fingers never share weights.
bpy.ops.object.select_all(action='DESELECT');body.select_set(True);rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
for region,name in {**finger_regions,**nail_bones}.items():
 ids=list(regions[region]);group=body.vertex_groups.get(name)
 if not group:group=body.vertex_groups.new(name=name)
 # Interior vertices rigid to their phalanx; shared rings blend at the actual joint.
 for i in ids:
  memberships=[r for r in finger_regions if i in regions[r]]
  names=[finger_regions[r] for r in memberships] or [name]
  if i in regions[9] or i in regions[10]:names.append('hand.'+name[-1])
  for g in body.vertex_groups:g.remove([i])
  for n in names:body.vertex_groups.get(n).add([i],1/len(names),'REPLACE')
for mod in body.modifiers:
 if mod.type=='MULTIRES':mod.levels=1;mod.render_levels=1
# Make tailored clothing from the anatomical surface, with an air gap, shaped
# hems, fold relief and thickness. This retains the artist's shoulder topology.
def garment(name,planes,mat,gap):
 ob=body.copy();ob.data=body.data.copy();collection.objects.link(ob);ob.name=name
 bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
 for m in list(ob.modifiers):
  if m.type=='MULTIRES':bpy.ops.object.modifier_apply(modifier=m.name)
 bm=bmesh.new();bm.from_mesh(ob.data)
 # Cut continuous edge loops at exact tailoring planes. Vertex deletion alone
 # leaves a saw-tooth collar and disconnected scraps around sleeve openings.
 for point,normal in planes:
  bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=point,plane_no=normal,clear_outer=True,clear_inner=False)
 if name=='WorkShirt':
  for sign in [-1,1]:
   verts={v for v in bm.verts if sign*v.co.x>.19}
   geom=list(verts)+[e for e in bm.edges if all(v in verts for v in e.verts)]+[f for f in bm.faces if all(v in verts for v in f.verts)]
   bmesh.ops.bisect_plane(bm,geom=geom,dist=.00001,plane_co=(sign*.25,0,1.245),plane_no=(0,0,-1),clear_outer=True,clear_inner=False)
  bmesh.ops.delete(bm,geom=[v for v in bm.verts if abs(v.co.x)>.18 and v.co.z<1.235],context='VERTS')
 boundary=[v for v in bm.verts if v.is_boundary]
 for _ in range(3):bmesh.ops.smooth_vert(bm,verts=boundary,factor=.25,use_axis_x=True,use_axis_y=True,use_axis_z=True)
 # Keep the connected garment, discard cut-off scraps of limbs.
 todo=set(bm.verts);parts=[]
 while todo:
  seed=todo.pop();part={seed};queue=[seed]
  while queue:
   v=queue.pop()
   for e in v.link_edges:
    n=e.other_vert(v)
    if n in todo:todo.remove(n);part.add(n);queue.append(n)
  parts.append(part)
 if parts:
  keep=max(parts,key=len);bmesh.ops.delete(bm,geom=[v for v in bm.verts if v not in keep],context='VERTS')
 bm.to_mesh(ob.data);bm.free();ob.data.update()
 # Cache normals before writing coordinates: Blender invalidates/recomputes
 # them after each write, otherwise earlier vertices distort later offsets.
 coordinates=[v.co.copy() for v in ob.data.vertices];normals=[v.normal.copy() for v in ob.data.vertices]
 for v,p,n in zip(ob.data.vertices,coordinates,normals):
  v.co=p+n*gap;p=v.co
  if name=='WorkTrousers':
   # Flatten the front fly; trousers span the anatomy rather than trace it.
   if abs(p.x)<.105 and p.z>.77 and p.y<0:
    blend=max(0,min(1,(.105-abs(p.x))/.035))*max(0,min(1,(p.z-.77)/.07))
    p.y=p.y*(1-blend)+(-.125+.018*(p.z-.88))*blend
   p.x+=math.copysign(.003*math.sin(p.z*85+p.y*22),p.x)
  else:
   if abs(p.x)<.21 and p.z<1.44:
    # Smooth envelope bridges the chest and waist. A hard coordinate clamp
    # would create a visible rectangular step where it meets the shoulder.
    blend=max(0,min(1,(1.44-p.z)/.07))*max(0,min(1,(.21-abs(p.x))/.04))
    waist=max(0,min(1,(1.30-p.z)/.30));p.x*=1-.07*waist
    target=((- .174+.029*waist) if p.y<0 else (.12-.020*waist))*math.sqrt(max(.12,1-(p.x/(.23-.025*waist))**2))
    p.y=p.y*(1-blend)+target*blend
    folds=.001+.004*math.exp(-((p.z-1.07)/.09)**2)
    p.y+=folds*math.sin(p.z*71+p.x*24+2*math.sin(p.x*13))*(1 if p.y>0 else -1)*blend
 bm=bmesh.new();bm.from_mesh(ob.data)
 for v in bm.verts:
  if name=='WorkShirt' and v.co.z>1.43:
   # Keep the anatomical opening: radial projection made the collar fold
   # back over its adjacent vertices. Cap the full lip to its cutting plane.
   v.co.z=min(v.co.z,1.47+.012*max(-1,min(1,(v.co.y+.015)/.08)))
   neck=max(0,min(1,(v.co.z-1.40)/.065))*max(0,min(1,(.19-abs(v.co.x))/.05))
   v.co.x*=1-.20*neck;v.co.y=-.015+(v.co.y+.015)*(1-.16*neck)
  if not v.is_boundary:continue
  if name=='WorkShirt':
   if v.co.z>1.43:
    v.co.z=1.47+.012*max(-1,min(1,(v.co.y+.015)/.08))
   elif v.co.z<1.08:v.co.z=.98
   else:v.co.z=1.245
  elif v.co.z<.22:v.co.z=.145
  elif v.co.z>.99:v.co.z=1.045
 bm.to_mesh(ob.data);bm.free()
 ob.data.materials.clear();ob.data.materials.append(mat)
 for p in ob.data.polygons:p.material_index=0;p.use_smooth=True
 sub=ob.modifiers.new('Tailored surface','SUBSURF');sub.levels=1
 solid=ob.modifiers.new('Fabric and rolled edges','SOLIDIFY');solid.thickness=.003;solid.offset=0
 return ob
shirt=garment('WorkShirt',[((0,0,.995),(0,0,-1)),((0,0,1.485),(0,0,1))],shirtmat,.016)
pants=garment('WorkTrousers',[((0,0,.145),(0,0,-1)),((0,0,1.045),(0,0,1)),((.285,0,0),(1,0,0)),((-.285,0,0),(-1,0,0))],pantsmat,.025)
# Stitching uses the evaluated cloth surface rather than a coarser control cage.
# Otherwise the seams intersect the smoothed garment and produce jagged pixels.
for cloth in [shirt,pants]:
 bpy.ops.object.select_all(action='DESELECT');cloth.select_set(True);bpy.context.view_layer.objects.active=cloth
 bpy.ops.object.modifier_apply(modifier='Tailored surface')
# Remove the hidden skin beneath clothing, retain a fully editable source copy.
original=body.copy();original.data=body.data.copy();archive=bpy.data.collections.new('SOURCE · uncut anatomical mesh');bpy.context.scene.collection.children.link(archive);archive.objects.link(original);original.name='SourceBody_CC0';original.hide_render=True;original.hide_set(True);archive.hide_render=True;archive.hide_viewport=True
# Apply one sculpt level before cutting hidden geometry; original remains intact.
bpy.ops.object.select_all(action='DESELECT');body.select_set(True);bpy.context.view_layer.objects.active=body
for mod in list(body.modifiers):
 if mod.type=='MULTIRES':bpy.ops.object.modifier_apply(modifier=mod.name)
bm=bmesh.new();bm.from_mesh(body.data)
# Skin fully enclosed by trousers/shirt is retained in SourceBody_CC0 only.
# This also prevents thigh and abdomen penetration when joints flex.
bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.co.z<1.03 and abs(v.co.x)<.29 or 1.03<=v.co.z<1.435 and abs(v.co.x)<.20],context='VERTS')
bm.to_mesh(body.data);bm.free()
head=body.copy();head.data=body.data.copy();head.name='WorkerHead';collection.objects.link(head)
for ob,normal in [(head,(0,0,-1)),(body,(0,0,1))]:
 bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),plane_co=(0,0,1.455),plane_no=normal,clear_outer=True,dist=.00001);bm.to_mesh(ob.data);bm.free()
def rigid(ob,bone_name):
 for g in list(ob.vertex_groups):ob.vertex_groups.remove(g)
 ob.vertex_groups.new(name=bone_name).add(list(range(len(ob.data.vertices))),1,'REPLACE');ob.parent=rig
 a=ob.modifiers.new('Skeleton deformation','ARMATURE');a.object=rig
def curve(name,pts,r,mat,bone_name):
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.bevel_depth=r;c.bevel_resolution=2;s=c.splines.new('BEZIER');s.bezier_points.add(len(pts)-1)
 for p,co in zip(s.bezier_points,pts):p.co=co;p.handle_left_type=p.handle_right_type='AUTO'
 ob=bpy.data.objects.new(name,c);collection.objects.link(ob);c.materials.append(mat)
 bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob;bpy.ops.object.convert(target='MESH');rigid(ob,bone_name);return ob
def loft(name,rings,mat,bone_name):
 verts=[p for ring in rings for p in ring];n=len(rings[0]);faces=[]
 for j in range(len(rings)-1):
  for i in range(n):a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
 faces.extend([tuple(range(n-1,-1,-1)),tuple((len(rings)-1)*n+i for i in range(n))])
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();ob=bpy.data.objects.new(name,mesh);collection.objects.link(ob);mesh.materials.append(mat)
 for p in mesh.polygons:p.use_smooth=True
 bevel=ob.modifiers.new('Soft manufactured edges','BEVEL');bevel.width=.004;bevel.segments=3
 rigid(ob,bone_name);return ob
# Garment hems deform with their actual vertices, not rigid chest-bound curves.
curve('Trouser fly stitching',[(-.007,-.125,1.03),(-.007,-.126,.95),(.004,-.116,.88)],.0013,thread,'pelvis')
exec((ROOT/'scripts/worker-outfit.py').read_text(),globals())
# Assign visible source nails their authored material, and export anatomy landmarks.
rig['asset_source']='Blender Human Base Meshes v1.4.1 / CC0';rig['sample_scope']='Full body, locomotion, crouch and spray grip; other tool poses pending approval'
for ob in list(collection.objects):
 if 'eye.' in ob.name:
  rigid(ob,'head')
  centre=ob.location.copy();points=[centre+Vector((0,-.0128,0))]
  points.extend([centre+Vector((.0055*math.cos(i*math.tau/40),-.0115,.0055*math.sin(i*math.tau/40))) for i in range(40)])
  me=bpy.data.meshes.new('Iris');me.from_pydata(points,[],[(0,i+1,(i+1)%40+1) for i in range(40)]);me.materials.append(material('Brown iris '+ob.name,(.028,.019,.011),.35));iris=bpy.data.objects.new('WorkerHead.iris.'+ob.name,me);collection.objects.link(iris);rigid(iris,'head')
# Blender source faces -Y; glTF's Y-up conversion maps that to +Z.
# Gameplay faces -Z. Rotate the rig once and rename anatomical sides so
# runtime R remains +X. Meshes, shoes and their bindings share this transform.
def gameplay_side(name):
 return name[:-2]+('.L' if name.endswith('.R') else '.R') if name.endswith(('.R','.L')) else name
renames=[(b,b.name) for b in arm.bones]
for b,name in renames:b.name='AXIS_'+name
for b,name in renames:b.name=gameplay_side(name)
# Blender propagates bone renames to the bound mesh vertex groups.
rig.rotation_euler.z=math.pi
metadata={b.name:{'head':list(b.head_local),'tail':list(b.tail_local),'matrix':[list(row) for row in b.matrix_local]} for b in arm.bones}
(OUT/'skeleton.json').write_text(json.dumps(metadata))
# Neutral lighting, camera and saved editable pose-ready source.
scene=bpy.context.scene;scene.world=bpy.data.worlds.new('Neutral studio');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.18,.18,.18,1)
def camera(name,position,target,scale):
 d=bpy.data.cameras.new(name);o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=position;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();d.type='ORTHO';d.ortho_scale=scale;return o
scene.camera=camera('Full body review',(-2,4,1.8),(0,0,.92),2.05)
for loc,power in [((-2,-3,3),350),((2,-1,3),220),((0,2,3),400)]:
 d=bpy.data.lights.new('Studio softbox','AREA');d.energy=power;d.shape='DISK';d.size=2;o=bpy.data.objects.new('Studio softbox',d);scene.collection.objects.link(o);o.location=(-loc[0],-loc[1],loc[2]);o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.render.resolution_x=800;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
bpy.ops.object.select_all(action='DESELECT')
for ob in collection.all_objects:ob.select_set(True)
bpy.context.view_layer.objects.active=rig
source_path=ROOT/'assets/source/worker.blend';bpy.ops.wm.save_as_mainfile(filepath=str(source_path),compress=True)
scene.render.filepath=str(ROOT/'output/human-reference/worker-rest.png');bpy.ops.render.render(write_still=True)
# Export copies consolidate material draws, while the saved source keeps every
# garment/tool panel editable. All deformation groups remain on the same rig.
export_collection=bpy.data.collections.new('RUNTIME export copies');scene.collection.children.link(export_collection)
groups={'WorkerBodyMesh':[],'WorkerHeadMesh':[]}
for ob in list(collection.all_objects):
 if ob.type!='MESH':continue
 copy=ob.copy();copy.data=ob.data.copy();export_collection.objects.link(copy)
 bpy.ops.object.select_all(action='DESELECT');copy.select_set(True);bpy.context.view_layer.objects.active=copy
 for m in list(copy.modifiers):
  if m.type!='ARMATURE':bpy.ops.object.modifier_apply(modifier=m.name)
 # Make the source/export's four-influence skinning contract explicit.
 for v in copy.data.vertices:
  weights=sorted([(g.group,g.weight) for g in v.groups],key=lambda p:-p[1])[:4];total=sum(w for _,w in weights)
  for g in copy.vertex_groups:g.remove([v.index])
  for index,w in weights:
   if total:copy.vertex_groups[index].add([v.index],w/total,'REPLACE')
 groups['WorkerHeadMesh' if ob.name.startswith('WorkerHead') or 'eye.' in ob.name else 'WorkerBodyMesh'].append(copy)
merged=[]
for name,objects in groups.items():
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();objects[0].name=name;merged.append(objects[0])
bpy.ops.object.select_all(action='DESELECT')
for o in merged+[rig]:o.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT/'worker.glb'),export_format='GLB',use_selection=True,export_apply=True,export_animations=False,export_yup=True)
print('WORKER_EXPORT',json.dumps({'bones':len(arm.bones),'source':str(source_path),'glb':str(OUT/'worker.glb')}))
