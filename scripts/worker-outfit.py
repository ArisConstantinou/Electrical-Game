"""Milwaukee outfit panels, seams and BOA boots; executed by build-worker.py.
Uses fitted garment surfaces, preserving their deformation weights.
"""
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree
import numpy as np
red=material('Milwaukee red heel stabiliser',(.5,.005,.019),.65)
binding=material('Reinforced black Cordura',(.011,.013,.015),.94)
seammat=material('Grey cotton topstitch',(.115,.11,.103),.95)
darkthread=material('Black workwear stitching',(.031,.035,.037),.96)
soleedge=material('Grey abrasion tread edge',(.095,.11,.12),.88)
labelmat=material('Official Milwaukee woven red label',(1,1,1),.85)
tex=labelmat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/'assets/source/milwaukee-label.png'));tex.image.pack()
labelmat.node_tree.links.new(tex.outputs['Color'],labelmat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
printmat=material('Milwaukee white footwear print',(1,1,1),.75)
tx=printmat.node_tree.nodes.new('ShaderNodeTexImage');tx.image=bpy.data.images.load(str(ROOT/'assets/source/milwaukee-print.png'));tx.image.pack()
printmat.node_tree.links.new(tx.outputs['Color'],printmat.node_tree.nodes.get('Principled BSDF').inputs['Base Color']);printmat.node_tree.links.new(tx.outputs['Alpha'],printmat.node_tree.nodes.get('Principled BSDF').inputs['Alpha'])
printmat.surface_render_method='DITHERED'

# Portable tiled cloth micro-normal, embedded in GLB and packed in .blend.
N=128;yy,xx=np.mgrid[:N,:N];height=.35*np.sin(xx*math.pi/2)*np.sin(yy*math.pi/2)+np.random.default_rng(6).normal(0,.09,(N,N))
gx,gy=np.gradient(height);pixels=np.ones((N,N,4),dtype=np.float32);pixels[:,:,0]=.5-gx*.14;pixels[:,:,1]=.5-gy*.14;pixels[:,:,2]=1
weave=bpy.data.images.new('Woven twill normal',width=N,height=N);weave.colorspace_settings.name='Non-Color';weave.pixels.foreach_set(pixels.ravel());weave.pack()
for mat in [shirtmat,pantsmat,binding,leather]:
 nodes=mat.node_tree.nodes;links=mat.node_tree.links;t=nodes.new('ShaderNodeTexImage');t.image=weave;t.extension='REPEAT'
 uv=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeMapping');mapping.inputs['Scale'].default_value=(22,22,22)
 links.new(uv.outputs['UV'],mapping.inputs['Vector']);links.new(mapping.outputs['Vector'],t.inputs['Vector'])
 norm=nodes.new('ShaderNodeNormalMap');norm.inputs['Strength'].default_value=.28 if mat==leather else .45;links.new(t.outputs['Color'],norm.inputs['Color']);links.new(norm.outputs['Normal'],nodes.get('Principled BSDF').inputs['Normal'])

def fitted_panel(name,surface,x0,x1,z0,z1,mat,bulge=.003):
 verts=[v.co.copy() for v in surface.data.vertices];tree=BVHTree.FromPolygons(verts,[list(p.vertices) for p in surface.data.polygons]);kd=KDTree(len(verts))
 for i,p in enumerate(verts):kd.insert(p,i)
 kd.balance();points=[];weights=[];u=[];hits=[];nx=8;nz=10
 for j in range(nz+1):
  for i in range(nx+1):
   a=i/nx;b=j/nz;x=x0+(x1-x0)*a;z=z0+(z1-z0)*b
   hit=tree.ray_cast(Vector((x,-1,z)),Vector((0,1,0)))[0]
   hits.append(hit is not None)
   p=Vector((x,(hit.y if hit else -.10)-.004-bulge*math.sin(a*math.pi)*math.sin(b*math.pi),z));points.append(p);u.append((a,b))
   _,index,_=kd.find(hit if hit else p);weights.append([(surface.vertex_groups[g.group].name,g.weight) for g in surface.data.vertices[index].groups])
 faces=[]
 for j in range(nz):
  for i in range(nx):
   a=j*(nx+1)+i;f=(a,a+1,a+nx+2,a+nx+1)
   if all(hits[k] for k in f):faces.append(f)
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(points,[],faces);mesh.update();ob=bpy.data.objects.new(name,mesh);collection.objects.link(ob);mesh.materials.append(mat)
 uv=mesh.uv_layers.new(name='UVMap')
 for p in mesh.polygons:
  p.use_smooth=True
  for k in p.loop_indices:uv.data[k].uv=u[mesh.loops[k].vertex_index]
 for i,groups in enumerate(weights):
  for name,w in groups:(ob.vertex_groups.get(name) or ob.vertex_groups.new(name=name)).add([i],w,'REPLACE')
 ob.parent=rig;m=ob.modifiers.new('Follows garment skeleton','ARMATURE');m.object=rig
 m=ob.modifiers.new('Woven panel thickness','SOLIDIFY');m.thickness=.0015
 return ob

pocket=fitted_panel('Milwaukee chest patch pocket',shirt,-.135,-.045,1.225,1.33,shirtmat,.003)
fitted_panel('Milwaukee chest woven badge',pocket,-.119,-.067,1.261,1.285,labelmat,.0002)
# Hem tapes use the actual boundary coordinates and inherited bone weights.
def hem_tape(ob,name,width):
 # The sewn band belongs to the cloth surface. Separate overlapping strips
 # caused z-fighting and faceted silhouettes after subdivision and deformation.
 bm=bmesh.new();bm.from_mesh(ob.data);bm.verts.ensure_lookup_table();bm.faces.ensure_lookup_table()
 boundary=[v.co.copy() for v in bm.verts if v.is_boundary];kd=KDTree(len(boundary))
 for i,p in enumerate(boundary):kd.insert(p,i)
 kd.balance();ob.data.materials.append(seammat if ob==shirt else binding);index=len(ob.data.materials)-1
 for face in bm.faces:
  if kd.find(face.calc_center_median())[2]<width:ob.data.polygons[face.index].material_index=index
 bm.free()
hem_tape(shirt,'Crew collar, sleeve and waist double hems',.009)
hem_tape(pants,'Trouser waistband and lower hems',.012)
for sign,side in [(1,'R'),(-1,'L')]:
 a,b=sorted([sign*.073,sign*.201]);fitted_panel('Cordura knee pad pocket '+side,pants,a,b,.38,.56,binding,.004)
 fitted_panel('Knee protective flap '+side,pants,a,b,.545,.578,pantsmat,.006)
 for x in [sign*.07,sign*.13]:fitted_panel('Waist belt loop '+str(x),pants,x-.009,x+.009,.992,1.037,binding,.004)

def side_pocket(side,sign,name,z0,z1,angle0,angle1,depth,bone_name):
 # Front-to-side arc around the real trouser surface. The top remains open.
 verts=[v.co.copy() for v in pants.data.vertices];tree=BVHTree.FromPolygons(verts,[list(p.vertices) for p in pants.data.polygons])
 pts=[];front=[];nx=12;nz=12
 for j in range(nz+1):
  b=j/nz;z=z0+(z1-z0)*b
  for i in range(nx+1):
   a=i/nx;angle=math.radians(angle0+(angle1-angle0)*a);d=Vector((sign*math.sin(angle),-math.cos(angle),0));origin=d+Vector((0,0,z));hit=tree.ray_cast(origin,-d)[0]
   p=hit if hit else Vector((sign*.17,-.07,z));bulge=depth*math.sin(math.pi*a)*min(1,b*5)
   pts.append(p+d*.004);front.append(p+d*(.009+bulge))
 points=front+pts;off=len(front);faces=[]
 for j in range(nz):
  for i in range(nx):k=j*(nx+1)+i;faces.append((k,k+1,k+nx+2,k+nx+1))
 for j in range(nz):
  for i in [0,nx]:k=j*(nx+1)+i;faces.append((k,k+nx+1,k+nx+1+off,k+off))
 for i in range(nx):faces.append((i,i+off,i+1+off,i+1))
 me=bpy.data.meshes.new(name+side);me.from_pydata(points,[],faces);me.update();o=bpy.data.objects.new(name+side,me);collection.objects.link(o);me.materials.append(binding)
 uv=me.uv_layers.new(name='Pocket pattern')
 for f in me.polygons:
  for k in f.loop_indices:
   vi=me.loops[k].vertex_index%off;uv.data[k].uv=((vi%(nx+1))/nx,(vi//(nx+1))/nz)
 for p in me.polygons:p.use_smooth=True
 rigid(o,bone_name);sol=o.modifiers.new('Pocket fabric thickness','SOLIDIFY');sol.thickness=.0018
 for row in [0,12]:curve(name+' stitched horizontal '+str(row)+side,[front[row*(nx+1)+i] for i in range(nx+1)],.0005,darkthread,bone_name)
 for col in [0,5,12]:curve(name+' sleeve divider '+str(col)+side,[front[j*(nx+1)+col] for j in range(nz+1)],.0005,darkthread,bone_name)
 return front[nz*(nx+1)+nx//2]

toolred=material('Milwaukee hand-tool red',(.46,.006,.015),.52)
steel=material('Tool steel',(.36,.39,.42),.29);steel.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value=.85
def driver(name,centre,length,bone_name,insulated=False):
 centre=Vector(centre)
 rings=[]
 for z,r in [(0,.009),(.004,.012),(.014,.014),(.055,.011),(.080,.016),(.089,.015),(.093,.008)]:
  rings.append([centre+Vector((r*math.cos(i*math.tau/24)*(1+.06*math.cos(i*math.tau/4)),r*math.sin(i*math.tau/24),z)) for i in range(24)])
 loft(name+' contoured grip',rings,toolred,bone_name)
 for a in range(6):
  t=a*math.tau/6;curve(name+' rubber grip flute '+str(a),[centre+Vector((r*math.cos(t),r*math.sin(t),z)) for z,r in [(.008,.012),(.020,.013),(.05,.012),(.075,.014)]],.002,rubber,bone_name)
 curve(name+' shaft',[centre,centre+Vector((0,0,-length))],.0025,toolred if insulated else steel,bone_name)
 loft(name+' working tip',[[centre+Vector((x,y,-length+z)) for x,y in [(-.004,-.001),(.004,-.001),(.004,.001),(-.004,.001)]] for z in [-.010,0]],steel,bone_name)
for side,sign in [('R',1),('L',-1)]:
 top=side_pocket(side,sign,'FREEFLEX waist holster ',.835,1.005,38,90,.018,'pelvis')
 cargo=side_pocket(side,sign,'FREEFLEX thigh tool pocket ',.585,.755,68,110,.012,'thigh.'+side)
 driver('Milwaukee screwdriver '+side,cargo+Vector((sign*.012,-.007,-.022)),.12,'thigh.'+side)
 driver('Milwaukee insulated driver '+side,cargo+Vector((sign*.008,.020,-.032)),.105,'thigh.'+side,True)
 # Tape-measure shell follows a rounded trapezoidal profile, with bumper,
 # metal clip and raised lock. It hangs on the exterior holster opening.
 if side=='R':
  c=top+Vector((sign*.021,-.025,-.075));outline=[(-.032,-.029),(.024,-.029),(.036,-.018),(.035,.024),(.016,.037),(-.017,.039),(-.037,.022),(-.039,-.008)]
  rings=[[c+Vector((x,y,z)) for x,z in outline] for y in [-.022,.016]]
  loft('Milwaukee tape housing '+side,rings,toolred,'pelvis')
  curve('Tape rubber bumper '+side,[c+Vector((x,-.024,z)) for x,z in outline+[outline[0]]],.004,rubber,'pelvis')
  curve('Tape belt clip '+side,[c+Vector((0,.02,-.015)),c+Vector((0,.027,.025)),c+Vector((.012,.025,.028))],.003,steel,'pelvis')
  me=bpy.data.meshes.new('Tape label '+side);me.from_pydata([c+Vector((x,-.027,z)) for x,z in [(-.027,-.009),(.026,-.009),(.026,.015),(-.027,.015)]],[],[(0,1,2,3)]);me.materials.append(labelmat);uv=me.uv_layers.new()
  for i,co in enumerate([(0,0),(1,0),(1,1),(0,1)]):uv.data[i].uv=co
  ob=bpy.data.objects.new(me.name,me);collection.objects.link(ob);rigid(ob,'pelvis')
 # Carpenter pencil and compact utility-knife handle show above the pouch.
 p=top+Vector((sign*.013,.018,-.03))
 loft('Milwaukee utility knife '+side,[[p+Vector((x,y,z)) for x,y in [(-.014,-.007),(.014,-.007),(.016,.005),(-.012,.007)]] for z in [0,.078,.089]],toolred,'pelvis')
 curve('Utility knife black spine '+side,[p+Vector((.014,0,.003)),p+Vector((.016,0,.08))],.003,rubber,'pelvis')
 p=top+Vector((-sign*.013,-.008,0));loft('Carpenter pencil '+side,[[p+Vector((x,y,z)) for x,y in [(-.005,-.003),(.005,-.003),(.005,.003),(-.005,.003)]] for z in [-.05,.105]],toolred,'pelvis')

# Boot sections follow a rounded toe, rising instep and padded mid-height collar.
# BOA cable guides replace the earlier ordinary lace concept.
for suffix,sign in [('R',1),('L',-1)]:
 def shoept(x,y,z):return (sign*(.205+x-y*.18),y-.045,z)
 sections=[(-.154,.012,.047),(-.146,.041,.067),(-.115,.058,.079),(-.075,.062,.088),(-.035,.058,.115),(.008,.052,.158),(.06,.048,.205),(.10,.044,.21),(.14,.031,.18),(.151,.012,.12)]
 outline=[(-w*1.065,y) for y,w,h in sections]+[(w*1.065,y) for y,w,h in reversed(sections)]
 loft('FLEXTRED grey tread edge.'+suffix,[[shoept(x,y,z) for x,y in outline] for z in [.006,.012,.016]],soleedge,'foot.'+suffix)
 loft('FLEXTRED ENERGY FOAM sole.'+suffix,[[shoept(x*(1+.03*math.sin(z*60)),y,z) for x,y in outline] for z in [.016,.022,.038]],rubber,'foot.'+suffix)
 rings=[]
 for y,w,h in sections:
  rings.append([shoept(w*math.cos(i*math.tau/32),y,.035+(1+math.sin(i*math.tau/32))*.5*(h-.035)) for i in range(32)])
 boot=loft('FLEXTRED nubuck upper.'+suffix,rings,leather,'foot.'+suffix)
 # Separate rubber scuff cap follows toe surface; not a painted flat toe.
 loft('FLEXTRED toe scuff protection.'+suffix,[[shoept(w*1.012*math.cos(i*math.tau/32),y-.001,.035+(1+math.sin(i*math.tau/32))*.5*(h-.035)+.0018) for i in range(32)] for y,w,h in sections[:4]],rubber,'foot.'+suffix)
 # Red heel stabilizer wraps both sides and rear, stepped higher at the heel.
 heel=[]
 for z in [.045,.062,.083]:heel.append([shoept(.047*math.cos(t),.086+.067*math.sin(t),z+.018*math.sin(t)) for t in [i*math.pi/24 for i in range(25)]])
 loft('FLEXTRED red ROLLCAGE heel.'+suffix,heel,red,'foot.'+suffix)
 # BOA dial has a toothed rim and recessed central face.
 y=.037;z=.187;center=Vector(shoept(0,y,z));axis=Vector((0,-.74,.67));u=Vector((1,0,0));v=axis.cross(u)
 dialrings=[]
 for depth,r in [(0,.016),(.004,.018),(.009,.018),(.011,.013)]:
  dialrings.append([center+axis*depth+(u*math.cos(i*math.tau/48)+v*math.sin(i*math.tau/48))*r*(1+.035*(i%2)) for i in range(48)])
 loft('BOA tension dial.'+suffix,dialrings,rubber,'foot.'+suffix)
 for i in range(3):
  y=-.075+i*.04;z=.098+i*.035
  curve(f'BOA steel cable {i}.{suffix}',[shoept(-.033,y,z),shoept(.033,y+.021,z+.016),shoept(-.032,y+.040,z+.033)],.0008,rubber,'foot.'+suffix)
  for s in [-1,1]:curve(f'BOA guide {s} {i}.{suffix}',[shoept(s*.027,y-.006,z),shoept(s*.038,y,z),shoept(s*.034,y+.014,z+.008)],.0025,binding,'foot.'+suffix)
 for s in [-1,1]:
  curve(f'Nubuck side seam {s}.{suffix}',[shoept(s*.058,-.065,.063),shoept(s*.047,-.005,.095),shoept(s*.039,.065,.168),shoept(s*.038,.12,.15)],.0012,seammat,'foot.'+suffix)
 for i in range(9):
  y=-.12+i*.029
  curve(f'Anti slip tread {i}.{suffix}',[shoept(-.048,y,.011),shoept(.048,y,.011)],.0045,rubber,'foot.'+suffix)
 mesh=bpy.data.meshes.new('Milwaukee side branding '+suffix)
 mesh.from_pydata([shoept(.058,-.035,.081),shoept(.052,.040,.081),shoept(.050,.040,.114),shoept(.057,-.035,.114)],[],[(0,1,2,3)])
 mesh.materials.append(printmat);uv=mesh.uv_layers.new()
 for i,co in enumerate([(0,0),(1,0),(1,1),(0,1)]):uv.data[i].uv=co
 ob=bpy.data.objects.new(mesh.name,mesh);collection.objects.link(ob);rigid(ob,'foot.'+suffix)
