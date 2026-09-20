"""Tailor the existing editable outfit, preserving skeleton, hands, boots and Actions.
Writes candidate .blend / GLB under output/outfit-correction/candidate for review.
"""
import bpy,bmesh,math,json,sys
from pathlib import Path
from mathutils import Vector,Matrix
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'output/outfit-correction/candidate';OUT.mkdir(parents=True,exist_ok=True)
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
source=Path(args[args.index('--source')+1]) if '--source' in args else ROOT/'assets/source/worker.blend'
bpy.ops.wm.open_mainfile(filepath=str(source))
if bpy.context.scene.get('outfit_tailored'):raise RuntimeError('Use the retained original source; this source is already tailored')
rig=bpy.data.objects['WorkerRig'];arm=rig.data
if rig.animation_data:rig.animation_data.action=None
for b in rig.pose.bones:b.matrix_basis=Matrix.Identity(4)
rig.data.pose_position='POSE';bpy.context.scene.frame_set(0)
collection=bpy.data.objects['WorkShirt'].users_collection[0]
shirt=bpy.data.objects['WorkShirt'];pants=bpy.data.objects['WorkTrousers'];skin=bpy.data.objects['SourceBody_CC0']
body_tree=BVHTree.FromPolygons([v.co for v in skin.data.vertices],[list(p.vertices) for p in skin.data.polygons])
def smoothstep(v):v=max(0,min(1,v));return v*v*(3-2*v)
def color(name,c):
 m=bpy.data.materials[name];m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*c,1)
color('Milwaukee grey cotton',(.245,.227,.205));color('Grey cotton topstitch',(.245,.227,.205))
color('Milwaukee black work twill',(.047,.050,.052));color('Reinforced black Cordura',(.035,.038,.041));color('Black workwear stitching',(.070,.072,.073))
# Surface drape, retained on the existing garment topology and weights.
old=[v.co.copy() for v in shirt.data.vertices]
bm=bmesh.new();bm.from_mesh(shirt.data);bm.verts.ensure_lookup_table()
for v in bm.verts:
 p=v.co.copy()
 # Gentle asymmetric tension folds gather toward the waist/side seams.
 if p.z<1.28 and abs(p.x)<.19:
  front=smoothstep((-p.y-.025)/.055);waist=math.exp(-((p.z-1.055)/.10)**2)
  folds=.0035*math.sin(78*(p.z+abs(p.x)*.16))*waist+.0025*math.sin(42*(p.z-p.x*.32))*math.exp(-((abs(p.x)-.14)/.045)**2)
  v.co.y-=folds*front
  if v.is_boundary and p.z<1.06:v.co.z+=.007*math.sin(p.x*17+.6)
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(shirt.data);bm.free();shirt.data.update()
# Keep the existing fitted chest pocket and badge on the moved cloth.
oldkd=KDTree(len(old))
for i,v in enumerate(old):oldkd.insert(v,i)
oldkd.balance()
for ob in collection.objects:
 if ob.type=='MESH' and ob.name.startswith('Milwaukee chest'):
  for v in ob.data.vertices:
   _,i,_=oldkd.find(v.co);v.co+=shirt.data.vertices[i].co-old[i]
# A sewn patch pocket sits close to the cloth with rounded bottom corners.
shirt_tree=BVHTree.FromPolygons([v.co for v in shirt.data.vertices],[list(p.vertices) for p in shirt.data.polygons])
pocket=bpy.data.objects['Milwaukee chest patch pocket']
for v in pocket.data.vertices:
 p=v.co;a=max(0,min(1,(p.x+.135)/.09));b=max(0,min(1,(p.z-1.225)/.105));p.z+=.008*(abs(a-.5)*2)**4*(1-smoothstep(b/.25))
 hit=shirt_tree.ray_cast(Vector((p.x,-1,p.z)),Vector((0,1,0)))[0]
 if hit:p.y=hit.y-.002-.0015*math.sin(a*math.pi)*math.sin(b*math.pi)
pocket_tree=BVHTree.FromPolygons([v.co for v in pocket.data.vertices],[list(p.vertices) for p in pocket.data.polygons])
for v in bpy.data.objects['Milwaukee chest woven badge'].data.vertices:
 hit=pocket_tree.ray_cast(Vector((v.co.x,-1,v.co.z)),Vector((0,1,0)))[0]
 if hit:v.co.y=hit.y-.0018
# Replace the complete old neckline/yoke strip. A joined surface avoids
# overlapping collar patches and degeneracies from projecting a ragged cut.
import heapq
bm=bmesh.new();bm.from_mesh(shirt.data);bm.verts.ensure_lookup_table()
seeds=[v for v in bm.verts if v.is_boundary and v.co.z>1.43]
distances={v:0 for v in seeds};queue=[(0,v.index,v) for v in seeds];heapq.heapify(queue)
while queue:
 d,_,v=heapq.heappop(queue)
 if d!=distances.get(v) or d>.075:continue
 for e in v.link_edges:
  n=e.other_vert(v);nd=d+(n.co-v.co).length
  if nd<distances.get(n,100):distances[n]=nd;heapq.heappush(queue,(nd,n.index,n))
bmesh.ops.delete(bm,geom=[f for f in bm.faces if all(distances.get(v,100)<.055 for v in f.verts)],context='FACES')
bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context='VERTS')
todo={v for v in bm.verts if v.is_boundary};components=[]
while todo:
 seed=todo.pop();part={seed};stack=[seed]
 while stack:
  v=stack.pop()
  for e in v.link_edges:
   if not e.is_boundary:continue
   n=e.other_vert(v)
   if n in todo:todo.remove(n);part.add(n);stack.append(n)
 components.append(part)
part=max(components,key=lambda p:sum(v.co.z for v in p)/len(p));first=min(part,key=lambda v:v.co.x);ring=[first];previous=None;current=first
while True:
 options=[e.other_vert(current) for e in current.link_edges if e.is_boundary and e.other_vert(current)!=previous]
 nxt=next(v for v in options if v in part)
 if nxt==first:break
 if nxt in ring:raise RuntimeError('Neckline is not a simple loop')
 ring.append(nxt);previous,current=current,nxt
N=len(ring)
if sum(ring[i].co.x*ring[(i+1)%N].co.y-ring[(i+1)%N].co.x*ring[i].co.y for i in range(N))<0:ring.reverse()
# Smooth the cut perimeter before bridging; preserve its actual angular
# spacing instead of stretching densely clustered source vertices uniformly.
for _ in range(8):
 co=[v.co.copy() for v in ring]
 for i,v in enumerate(ring):v.co=co[i]*.6+(co[(i-1)%N]+co[(i+1)%N])*.2
angles=[math.atan2(v.co.y,v.co.x) for v in ring]

# Low-pass the sampled neck radius; retain anatomy without copying mesh noise.
radii=[]
for i in range(N):
 a=angles[i];d=Vector((math.cos(a),math.sin(a),0));z=1.491+.020*math.sin(a);hit=body_tree.ray_cast(Vector((0,0,z)),d)[0]
 if hit is None:raise RuntimeError('Missing neck surface')
 radii.append(math.hypot(hit.x,hit.y))
for _ in range(8):radii=[(radii[(i-1)%N]+2*radii[i]+radii[(i+1)%N])/4 for i in range(N)]
mat=bpy.data.materials['Milwaukee grey cotton'].copy();mat.name='Grey rib-knit crew collar';mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.21,.192,.173,1)
shirt.data.materials.append(mat);collar_material=len(shirt.data.materials)-1
layer=bm.verts.layers.deform.verify();chest=shirt.vertex_groups.get('chest').index;uv=bm.loops.layers.uv.verify();outer=[v.co.copy() for v in ring];last=ring
for v in ring:v[layer].clear();v[layer][chest]=1
for row in range(1,7):
 t=row/6;new=[]
 for i in range(N):
  a=angles[i];target=Vector(((radii[i]+.009)*math.cos(a),(radii[i]+.009)*math.sin(a),1.491+.020*math.sin(a)))
  co=outer[i].lerp(target,t);v=bm.verts.new(co);v[layer][chest]=1;new.append(v)
 for i in range(N):
  j=(i+1)%N;f=bm.faces.new((last[i],last[j],new[j],new[i]));f.material_index=collar_material if row==6 else 0;f.smooth=True
  for loop,co in zip(f.loops,[(i/N,(row-1)/6),(j/N,(row-1)/6),(j/N,row/6),(i/N,row/6)]):loop[uv].uv=co
 last=new
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(shirt.data);bm.free();shirt.data.update();collar_vertices=N*6
# Subtle cloth compression at knees and boot tops, without changing the leg rig.
for v in pants.data.vertices:
 p=v.co;side=1 if p.x>0 else -1;centre=Vector((side*(.16+.025*(1-min(1,p.z))),.015,p.z));radial=Vector((p.x-centre.x,p.y-centre.y,0));radial.normalize()
 wave=.003*math.sin(p.z*86+p.x*9)*math.exp(-((p.z-.25)/.08)**2)+.0022*math.sin(p.z*63-p.x*12)*math.exp(-((p.z-.57)/.06)**2)
 p+=radial*wave
 if abs(p.x)<.12 and .70<p.z<1.02 and p.y<0:
  blend=smoothstep((.12-abs(p.x))/.05)*smoothstep((p.z-.70)/.075)
  p.y=p.y*(1-blend)+(-.127+.009*(1-p.z))*blend
# Fabric holsters have rounded lower corners, a flared open mouth and softly
# sagging dividers. Preserve the actual tool contents and attachment bones.
for ob in list(collection.objects):
 if ob.type!='MESH' or ob.name not in [n+s for n in ['FREEFLEX waist holster ','FREEFLEX thigh tool pocket '] for s in ['R','L']]:continue
 pocket_old=[v.co.copy() for v in ob.data.vertices]
 zs=[v.co.z for v in ob.data.vertices];lo=min(zs);hi=max(zs);sign=1 if sum(v.co.x for v in ob.data.vertices)>0 else -1
 for v in ob.data.vertices:
  p=v.co;b=(p.z-lo)/(hi-lo);a=(v.index%169)%13/12
  corner=(abs(a-.5)*2)**5*(1-smoothstep(b/.35));p.z+=.018*corner
  p.z-=.006*math.sin(math.pi*a)*smoothstep((b-.65)/.35)
  d=Vector((p.x,p.y,0)).normalized();p+=d*(.0025*math.sin(a*math.pi*4+.5)*math.sin(math.pi*b))
 # Rounded corners remain smooth when the wearer crouches; most of each
 # hanging waist pocket stays pelvis-bound, lower cloth partially follows leg.
 if 'waist' in ob.name:
  side='L' if sign>0 else 'R'
  for v in ob.data.vertices:
   blend=.22*(1-smoothstep((v.co.z-lo)/(hi-lo)))
   for g in ob.vertex_groups:g.remove([v.index])
   (ob.vertex_groups.get('pelvis') or ob.vertex_groups.new(name='pelvis')).add([v.index],1-blend,'REPLACE')
   (ob.vertex_groups.get('thigh.'+side) or ob.vertex_groups.new(name='thigh.'+side)).add([v.index],blend,'REPLACE')
 # Stitch meshes follow the displacement of their parent pocket surface.
 pkd=KDTree(len(pocket_old))
 for i,p in enumerate(pocket_old):pkd.insert(p,i)
 pkd.balance()
 prefix=ob.name[:-1];suffix=ob.name[-1]
 for seam in collection.objects:
  if seam==ob or seam.type!='MESH' or not seam.name.startswith(prefix) or not seam.name.endswith(suffix):continue
  for v in seam.data.vertices:
   _,i,_=pkd.find(v.co);v.co+=ob.data.vertices[i].co-pocket_old[i]
 # Recalculate actual cloth normals rather than relying on inherited winding.
 bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free()
# Preserve Actions and separate garment pieces in the editable source.
bpy.context.scene['outfit_tailored']='crew-neck-and-workwear-2026-09-19'
bpy.context.view_layer.update();source_path=OUT/'worker.blend';bpy.ops.wm.save_as_mainfile(filepath=str(source_path),compress=True)
# Same export-copy consolidation as the existing builder, no skeleton changes.
scene=bpy.context.scene
code=(ROOT/'scripts/build-worker.py').read_text();exec(code[code.index("export_collection=bpy.data.collections.new('RUNTIME export copies')"):],globals())
(OUT/'validation.json').write_text(json.dumps({'bones':len(arm.bones),'actions':[a.name for a in bpy.data.actions],'shirtVertices':len(shirt.data.vertices),'collarVertices':collar_vertices,'source':str(source_path)},indent=2))
