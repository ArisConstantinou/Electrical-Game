"""Milwaukee M18 FID3 / FPD3 reference models, metres, editable Blender source.
Run Blender --background --python scripts/build-m18-tools.py -- <workspace>.
Product photographs are research references only; no photograph is a body texture.
"""
import bpy, bmesh, math, os, sys, json
from mathutils import Vector
ROOT=os.path.abspath(sys.argv[sys.argv.index('--')+1])
OUT=os.path.join(ROOT,'public','assets','tools','milwaukee-m18')
SOURCE=os.path.join(ROOT,'visual-upgrades','assets','tools','milwaukee-m18')
REVIEW=os.path.join(ROOT,'output','m18-tools','models')
for path in (OUT,SOURCE,REVIEW):os.makedirs(path,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for material in list(bpy.data.materials):bpy.data.materials.remove(material)
def xyz(p):return (p[0],-p[2],p[1]) # Game +Y up, +Z towards worker -> Blender Z up.
def fix_normals(mesh):
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
def mat(name,color,rough=.5,metal=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 return m
RED=mat('Milwaukee moulded red polymer',(.48,.008,.018),.42)
BLACK=mat('Black textured rubber overmould',(.009,.011,.013),.84)
PLASTIC=mat('Black structural polymer',(.014,.017,.021),.48)
METAL=mat('Cast gearbox satin aluminium',(.27,.30,.32),.43,.82)
STEEL=mat('Chuck and hardened bit steel',(.24,.27,.29),.27,.92)
CHUCK=mat('Black oxide machined chuck steel',(.024,.026,.029),.42,.78)
WHITE=mat('White printed markings',(.91,.92,.89),.5)
LED=mat('Worklight diffusing lenses',(.93,.91,.78),.24)
p=LED.node_tree.nodes.get('Principled BSDF');p.inputs['Emission Color'].default_value=(.93,.90,.75,1);p.inputs['Emission Strength'].default_value=.2
# Fine mould stipple and rubber diamond pattern are material detail, not thousands of meshes.
for m,scale,strength in [(RED,850,.10),(BLACK,620,.20),(METAL,1100,.055)]:
 n=m.node_tree.nodes;t=m.node_tree.links;noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=scale;noise.inputs['Detail'].default_value=2
 bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=strength;bump.inputs['Distance'].default_value=.00016;t.new(noise.outputs['Fac'],bump.inputs['Height']);t.new(bump.outputs['Normal'],n.get('Principled BSDF').inputs['Normal'])
# An authored tiled normal map exports the rubber diamond texture into glTF.
normal=bpy.data.images.new('M18 moulded diamond traction normal',128,128,alpha=True);normal.colorspace_settings.name='Non-Color';values=[]
for y in range(128):
 for x in range(128):
  u=x/128*math.pi*8;v=y/128*math.pi*8
  dx=.24*(math.cos(u+v)+math.cos(u-v));dy=.24*(math.cos(u+v)-math.cos(u-v));vec=Vector((-dx,-dy,1)).normalized();values.extend([vec.x*.5+.5,vec.y*.5+.5,vec.z*.5+.5,1])
normal.pixels=values;normal.update();normal.filepath_raw=os.path.join(SOURCE,'m18-rubber-normal.png');normal.file_format='PNG';normal.save();normal.pack()
node=BLACK.node_tree.nodes.new('ShaderNodeTexImage');node.image=normal;mapping=BLACK.node_tree.nodes.new('ShaderNodeNormalMap');BLACK.node_tree.links.new(node.outputs['Color'],mapping.inputs['Color']);BLACK.node_tree.links.new(mapping.outputs['Normal'],BLACK.node_tree.nodes.get('Principled BSDF').inputs['Normal'])
collection=None
def register(o,name,material):
 o.name=name
 if material:o.data.materials.append(material)
 for c in list(o.users_collection):c.objects.unlink(o)
 collection.objects.link(o)
 o['toolModelPart']=True
 return o
def bevel(o,size=.001,segments=3):
 mod=o.modifiers.new('Manufactured edge radii','BEVEL');mod.width=size;mod.segments=segments
 mod=o.modifiers.new('Weighted surface normals','WEIGHTED_NORMAL');mod.keep_sharp=True
 for p in o.data.polygons:p.use_smooth=True
 return o
def box(name,size,pos,material,r=.001):
 bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(pos));o=register(bpy.context.object,name,material);o.scale=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if r:bevel(o,r,3)
 return o
def cyl(name,radius,length,pos,material,axis='z',vertices=48):
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=length,location=xyz(pos));o=register(bpy.context.object,name,material)
 if axis=='z':o.rotation_euler[0]=math.pi/2
 if axis=='x':o.rotation_euler[1]=math.pi/2
 bevel(o,.00045,2);return o
def profile(name,points,width,material):
 # Continuous hand shaped side contour; extrusion is across the tool width.
 verts=[xyz((side*width/2,y,z)) for side in (-1,1) for y,z in points];n=len(points)
 faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();fix_normals(mesh);o=bpy.data.objects.new(name,mesh);collection.objects.link(o);o.data.materials.append(material);o['toolModelPart']=True;bevel(o,.002,3);return o
def loft(name,sections,material):
 # Sections: game z, centre y, half width, half height, roundness.
 verts=[];N=32
 for z,cy,rx,ry,power in sections:
  for i in range(N):
   a=2*math.pi*i/N;c,s=math.cos(a),math.sin(a)
   verts.append(xyz((rx*math.copysign(abs(c)**power,c),cy+ry*math.copysign(abs(s)**power,s),z)))
 faces=[tuple(range(N-1,-1,-1)),tuple(range((len(sections)-1)*N,len(sections)*N))]
 for j in range(len(sections)-1):
  for i in range(N):a=j*N+i;b=j*N+(i+1)%N;faces.append((a,b,b+N,a+N))
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();fix_normals(mesh);o=bpy.data.objects.new(name,mesh);collection.objects.link(o);o.data.materials.append(material);o['toolModelPart']=True
 for p in mesh.polygons:p.use_smooth=True
 bevel(o,.0007,2);return o
def vertical_grip():
 sections=[(.022,.006,.018,.023),(.004,.009,.019,.021),(-.032,.017,.018,.020),(-.066,.025,.017,.019),(-.082,.027,.020,.020)]
 verts=[];N=32
 for y,z,rx,rz in sections:
  for i in range(N):
   a=2*math.pi*i/N;verts.append(xyz((rx*math.copysign(abs(math.cos(a))**.65,math.cos(a)),y,z+rz*math.copysign(abs(math.sin(a))**.65,math.sin(a)))))
 faces=[tuple(range(N)),tuple(range(len(verts)-1,len(verts)-N-1,-1))]
 for j in range(len(sections)-1):
  for i in range(N):a=j*N+i;b=j*N+(i+1)%N;faces.append((b,a,a+N,b+N))
 mesh=bpy.data.meshes.new('Swept grip surface');mesh.from_pydata(verts,[],faces);mesh.update();fix_normals(mesh);o=bpy.data.objects.new('Ergonomic black overmould grip',mesh);collection.objects.link(o);mesh.materials.append(BLACK);o['toolModelPart']=True
 for face in mesh.polygons:face.use_smooth=True
 uv=mesh.uv_layers.new()
 for face in mesh.polygons:
  for loop in face.loop_indices:
   v=mesh.vertices[mesh.loops[loop].vertex_index].co;uv.data[loop].uv=(v.y*160,v.z*160)
 return o
def bore(o,r,pos,vertices=48):
 cutter=cyl('Temporary chuck bore',r,.015,pos,None,'z',vertices)
 mod=o.modifiers.new('Actual open bit socket','BOOLEAN');mod.operation='DIFFERENCE';mod.object=cutter;mod.solver='EXACT'
 bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_move_up(modifier=mod.name);bpy.ops.object.modifier_move_up(modifier=mod.name);bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
def side_panel(name,points,x,material):
 verts=[xyz((x+side*.0008,y,z)) for side in (-1,1) for y,z in points];n=len(points);faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();fix_normals(mesh);o=bpy.data.objects.new(name,mesh);collection.objects.link(o);o.data.materials.append(material);o['toolModelPart']=True;bevel(o,.0006,2);return o
font_path='C:/Windows/Fonts/arialbd.ttf'
font=bpy.data.fonts.load(font_path)
font.pack()
def label(name,text,width,pos,side=1,material=WHITE):
 curve=bpy.data.curves.new(name,'FONT');curve.body=text;curve.font=font;curve.size=.012;curve.align_x='CENTER';curve.align_y='CENTER';curve.extrude=0;curve.resolution_u=2
 o=bpy.data.objects.new(name,curve);collection.objects.link(o);curve.materials.append(material)
 # Text local X follows game Z, local Y is vertical, normal points sideways.
 from mathutils import Matrix
 right=Vector(xyz((0,0,-side)));up=Vector(xyz((0,1,0)));normal=right.cross(up)
 o.rotation_euler=Matrix((right,up,normal)).transposed().to_euler();o.location=xyz(pos);bpy.context.view_layer.update();scale=width/max(o.dimensions);o.scale=(scale,scale,scale);o['toolModelPart']=True;return o
def logo(pos,side):
 # Official logo alpha is used as printing, never as a photographed tool shell.
 reference=os.path.join(ROOT,'output','m18-tools','references','logo-red.png')
 original=bpy.data.images.load(reference,check_existing=True) if os.path.exists(reference) else None
 # Extract the white ink into a print mask; the unchanged official artwork is
 # retained separately. This is a UV decal material, not a tool photograph.
 image=bpy.data.images.get('Milwaukee white ink decal')
 if not image and not original:image=bpy.data.images.load(os.path.join(SOURCE,'milwaukee-white-ink.png'),check_existing=True)
 if not image and original:
  width,height=original.size;pixels=list(original.pixels[:]);crop=(0,80,330,242)
  x0,y0,x1,y1=crop;image=bpy.data.images.new('Milwaukee white ink decal',x1-x0,y1-y0,alpha=True)
  ink=[]
  for y in range(y0,y1):
   for x in range(x0,x1):
    i=(y*width+x)*4;alpha=max(0,min(1,(min(pixels[i:i+3])-.28)/.60)) if x<310 or y<100 else 0;ink.extend([.94,.94,.92,alpha])
  image.pixels=ink;image.filepath_raw=os.path.join(SOURCE,'milwaukee-white-ink.png');image.file_format='PNG';image.save();image.pack()
 m=bpy.data.materials.get('Milwaukee white wordmark')
 if not m:
  m=mat('Milwaukee white wordmark',(.94,.94,.92),.5);p=m.node_tree.nodes.get('Principled BSDF');node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;m.node_tree.links.new(node.outputs['Color'],p.inputs['Base Color']);m.node_tree.links.new(node.outputs['Alpha'],p.inputs['Alpha']);m.surface_render_method='DITHERED';m.use_backface_culling=False
 w=.067;h=w*image.size[1]/image.size[0]
 verts=[xyz((pos[0],pos[1]+dy*h/2,pos[2]+dz*w/2)) for dy,dz in [(-1,side),(-1,-side),(1,-side),(1,side)]]
 mesh=bpy.data.meshes.new('Milwaukee wordmark plane');mesh.from_pydata(verts,[],[(0,1,2,3)]);mesh.update();fix_normals(mesh);o=bpy.data.objects.new('Milwaukee white wordmark',mesh);collection.objects.link(o);mesh.materials.append(m)
 uv=mesh.uv_layers.new();coords=[(0,0),(1,0),(1,1),(0,1)]
 for i in range(4):uv.data[i].uv=coords[i]
 o['toolModelPart']=True
def screw(name,pos,axis='x'):
 cyl(name,.0019,.0009,pos,STEEL,axis,16)
 if axis=='x':box(name+' screw slot',(.001,.0006,.0026),pos,BLACK,.0001)
def battery():
 loft('M18 B5 red upper pack',[(-.071,-.103,.032,.015,.55),(-.056,-.102,.041,.021,.38),(.047,-.102,.041,.021,.38),(.056,-.103,.035,.016,.50)],RED)
 loft('M18 B5 five amp hour lower pack',[(-.073,-.132,.030,.020,.38),(-.065,-.130,.042,.022,.30),(.048,-.130,.042,.022,.30),(.057,-.130,.034,.019,.40)],PLASTIC)
 box('M18 battery slide shoe',(.075,.019,.064),(0,-.084,.020),BLACK,.004)
 for side in (-1,1):
  side_panel('M18 recessed pack label',[(-.116,-.058),(-.116,.042),(-.141,.039),(-.144,-.050)],side*.0422,BLACK)
  label('REDLITHIUM print','REDLITHIUM',.045,(side*.0435,-.121,-.016),side,RED)
  label('5.0 battery print','5.0',.029,(side*.0435,-.132,.025),side)
  label('Ah battery print','Ah',.008,(side*.0435,-.136,.002),side)
  label('M18 battery print','M18',.025,(side*.0435,-.133,-.032),side)
  box('Battery red release button',(.004,.012,.023),(side*.042,-.104,.015),RED,.001)
 for z in (-.059,-.023,.023,.042):box('Battery moulded lower bumper feet',(.086,.009,.012),(0,-.150,z),BLACK,.002)
 # Fuel gauge button and four physical light apertures at the pack front.
 box('Battery fuel gauge face',(.050,.021,.003),(0,-.098,-.073),BLACK,.001)
 for i in range(4):box('Battery fuel gauge aperture',(.006,.003,.001),(i*.008-.012,-.099,-.075),RED,.0005)
 cyl('Battery fuel gauge test button',.004,.001,(.021,-.099,-.075),BLACK,'z',16)
def grip():
 profile('Continuous swept red trigger shoulder',[(.037,-.027),(.037,.035),(.021,.034),(.008,.005),(-.012,-.004),(-.025,-.005),(-.023,-.011),(-.005,-.020),(.014,-.022)],.043,RED)
 vertical_grip()
 box('Index finger trigger',(.026,.024,.014),(0,.014,-.018),PLASTIC,.005)
 box('Forward reverse selector',(.049,.008,.012),(0,.032,-.016),PLASTIC,.0018)
 for side in (-1,1):
  side_panel('Swept palm raised rubber inlay',[(.014,.018),(-.005,.027),(-.063,.039),(-.068,.031),(-.045,.027),(-.029,.016),(-.003,.012)],side*.018,PLASTIC)
def belt_clip():
 x=.044
 side_panel('Reversible metal belt clip', [(-.096,.031),(-.106,.043),(-.140,.042),(-.145,.017),(-.136,.009),(-.105,.018)],x,METAL)
 clip=collection.objects.get('Reversible metal belt clip') or list(collection.objects)[-1]
 for name,points in [('lower',[(-.125,.013),(-.127,.035),(-.133,.035),(-.133,.014)]),('upper',[(-.108,.022),(-.112,.036),(-.117,.035),(-.116,.019)])]:
  cutter=side_panel('Clip cutout '+name,points,x,BLACK)
  for v in cutter.data.vertices:v.co.x=x+(v.co.x-x)*8
  bpy.context.view_layer.update()
  mod=clip.modifiers.new('Open '+name+' slot','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
  bpy.context.view_layer.objects.active=clip;bpy.ops.object.modifier_move_up(modifier=mod.name);bpy.ops.object.modifier_move_up(modifier=mod.name);bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
 screw('Belt clip retaining screw',(x+.0019,-.117,.024))
def build(kind):
 global collection
 name='M18_FPD3' if kind=='drill' else 'M18_FID3';collection=bpy.data.collections.new(name);bpy.context.scene.collection.children.link(collection)
 drill=kind=='drill';front=-.120 if drill else -.055
 # Precisely 175/113 mm from rear bumper to chuck/hex face, accessories excluded.
 rear=.055 if drill else .058
 sections=[(rear-.001,.064,.024,.025,.68),(rear-.004,.064,.029,.030,.56),(.047,.064,.031,.031,.57),(-.013 if drill else -.014,.064,.030,.030,.59),(-.026 if drill else -.024,.064,.026,.027,.72)]
 loft('Sculpted red motor shell',sections,RED);loft('Black rear impact bumper',[(rear,.064,.026,.027,.64),(rear-.003,.064,.031,.032,.57),(rear-.009,.064,.032,.032,.57)],BLACK)
 for side in (-1,1):
  side_panel('Angular branded red side plate',[(.042,-.013),(.064,-.028),(.078,-.014),(.087,.047),(.050,.047)],side*.031,RED)
  logo((side*.0321,.068,.012),side);label('FUEL side print','FUEL',.025,(side*.0322,.047,.028),side)
  for y in (.085,.044):
   for z in (.038,.044):box('Recessed black cooling aperture',(.001,.003,.006),(side*.031,y,z),BLACK,.0005)
  for y in (.077,.051):screw('Motor casing Torx screw',(side*.032,y,.040))
  for i in range(5):box('Rear cooling vent',(.027,.002,.0003),(0,.048+i*.006,rear+.0001),BLACK,.0001)
 grip();battery();belt_clip()
 if drill:
  loft('FPD3 stepped gearbox cover',[(-.021,.064,.028,.029,.62),(-.046,.064,.028,.029,.72),(-.069,.064,.026,.028,.88),(-.075,.064,.024,.026,.95)],PLASTIC)
  cyl('Fixed torque selection collar',.027,.029,(0,.064,-.061),PLASTIC)
  for i in range(16):
   a=i*math.pi/8;x=.0272*math.cos(a);y=.064+.0272*math.sin(a);box('Torque collar moulded flute',(.002,.002,.012),(x,y,-.061),BLACK,.0004)
  for side in (-1,1):label('Torque setting numerals','16',.010,(side*.0278,.060,-.058),side)
  box('Two speed gearbox selector',(.021,.005,.026),(0,.096,.008),BLACK,.0015)
  # Auxiliary handle clamps the fixed gearbox; it never rotates with the chuck.
  cyl('Auxiliary handle gearbox clamp',.029,.009,(0,.064,-.035),METAL)
  box('Auxiliary clamp saddle',(.019,.017,.015),(-.024,.081,-.035),PLASTIC,.002)
  cyl('Auxiliary handle cross shaft',.005,.083,(-.065,.083,-.035),PLASTIC,'x')
  cyl('Auxiliary handle grip',.013,.059,(-.122,.083,-.035),BLACK,'x')
  cyl('Auxiliary handle round end cap',.017,.005,(-.153,.083,-.035),PLASTIC,'x')
  cyl('Auxiliary palm guard',.026,.003,(-.091,.083,-.035),PLASTIC,'x')
  box('Trigger work light lens',(.012,.005,.003),(0,.032,-.027),LED,.001)
  motor=bpy.data.objects.new('reference-motor',None);collection.objects.link(motor);motor.location=xyz((0,.064,-.075));rotating=[]
  rotating.append(cyl('13 mm all metal keyless chuck',.023,.036,(0,.064,-.096),CHUCK));rotating.append(cyl('Chuck red accent ring',.0232,.002,(0,.064,-.112),RED))
  nose=loft('Chuck forward tapered nose',[(-.113,.064,.020,.020,1),(-.116,.064,.017,.017,1),(-.120,.064,.009,.009,1)],CHUCK);bore(nose,.0065,(0,.064,-.122));rotating.append(nose)
  for i in range(48):
   a=2*math.pi*i/48;x=.023*math.cos(a);y=.064+.023*math.sin(a);rotating.append(box('Chuck machined knurl',(.0008,.0008,.025),(x,y,-.095),BLACK,.0001))
  face=front
 else:
  loft('FID3 black triple LED gearbox nose',[(-.017,.064,.030,.030,.58),(-.036,.064,.028,.029,.64),(-.044,.064,.022,.026,.79),(-.045,.064,.019,.022,.95)],PLASTIC)
  for i in range(3):
   a=2*math.pi*i/3+math.pi/2;cyl('Triple LED impact face lens',.0037,.0013,(.020*math.cos(a),.064+.020*math.sin(a),-.0455),LED,'z',16)
  motor=bpy.data.objects.new('reference-motor',None);collection.objects.link(motor);motor.location=xyz((0,.064,-.045));rotating=[]
  sleeve=cyl('Quarter inch hex quick release sleeve',.010,.010,(0,.064,-.050),CHUCK);bore(sleeve,.00367,(0,.064,-.058),6);rotating.append(sleeve)
  for i in range(24):
   a=2*math.pi*i/24;rotating.append(box('Quick release sleeve knurl',(.0006,.0006,.007),(.0102*math.cos(a),.064+.0102*math.sin(a),-.050),BLACK,.0001))
  box('Four mode DRIVE CONTROL panel',(.028,.0018,.022),(0,-.073,-.025),PLASTIC,.001)
  for i in range(4):box('DRIVE CONTROL mode indicator',(.003,.001,.005),(-.009+i*.006,-.0718,-.025),LED,.0003)
  face=front
 bpy.context.view_layer.update()
 for o in rotating:matrix=o.matrix_world.copy();o.parent=motor;o.matrix_world=matrix
 root=bpy.data.objects.new(name,None);collection.objects.link(root)
 for o in list(collection.objects):
  if o!=root and o.parent is None:matrix=o.matrix_world.copy();o.parent=root;o.matrix_world=matrix
 root['productModel']='Milwaukee M18 '+('FPD3' if drill else 'FID3');root['bodyLengthMm']=175 if drill else 113;root['gripPoint']=[0,-.005,.011];root['tipAxis']=[0,.064,front];root['chuckFaceZ']=front;root['motorDatumZ']=-.075 if drill else -.045
 if drill:root['secondaryGripPoint']=[-.122,.083,-.035]
 return root,collection
models=[build('driver'),build('drill')]
def bit_asset(name,diameter,length,driver=False):
 global collection
 collection=bpy.data.collections.new(name);bpy.context.scene.collection.children.link(collection)
 root=bpy.data.objects.new(name,None);collection.objects.link(root);root['bitDiameterMm']=diameter*1000;root['tipPoint']=[0,0,-length];root['bitLengthM']=length
 if driver:
  cyl('Quarter inch impact hex shank',.003667,length-.004,(0,0,-length/2+.009),STEEL,'z',6)
  cross=[(-.0024,-.0008),(-.0008,-.0008),(-.0008,-.0024),(.0008,-.0024),(.0008,-.0008),(.0024,-.0008),(.0024,.0008),(.0008,.0008),(.0008,.0024),(-.0008,.0024),(-.0008,.0008),(-.0024,.0008)]
  verts=[xyz((x*scale,y*scale,z)) for z,scale in [(-length+.008,1),(-length,.20)] for x,y in cross];N=len(cross);faces=[tuple(range(N-1,-1,-1)),tuple(range(N,2*N))]+[(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)]
  mesh=bpy.data.meshes.new('PH2 forged cross point');mesh.from_pydata(verts,[],faces);mesh.update();fix_normals(mesh);o=bpy.data.objects.new('PH2 forged cross point',mesh);collection.objects.link(o);mesh.materials.append(STEEL)
 else:
  radius=diameter/2;cyl('Masonry bit core',radius*.78,length+.010,(0,0,-length/2+.005),STEEL,'z',16)
  for phase in (0,math.pi):
   verts=[];segments=80;sides=6
   for i in range(segments+1):
    t=i/segments;a=phase+t*math.pi*12;z=-.012-t*(length-.016)
    for j in range(sides):
     b=j*math.tau/sides;r=radius*.80+radius*.20*math.cos(b);verts.append(xyz((r*math.cos(a),r*math.sin(a),z+radius*.20*math.sin(b))))
   faces=[]
   for i in range(segments):
    for j in range(sides):n=i*sides+j;m=i*sides+(j+1)%sides;faces.append((n,m,m+sides,n+sides))
   mesh=bpy.data.meshes.new('Twin masonry flute');mesh.from_pydata(verts,[],faces);mesh.update();fix_normals(mesh);o=bpy.data.objects.new('Continuous helical cutting land',mesh);collection.objects.link(o);mesh.materials.append(STEEL)
   for f in mesh.polygons:f.use_smooth=True
  # Brazed chisel insert spans the nominal diameter, including its cutting edge.
  verts=[xyz((x,y,z)) for x,y,z in [(-radius,-radius*.23,-length+.004),(radius,-radius*.23,-length+.004),(radius,radius*.23,-length+.004),(-radius,radius*.23,-length+.004),(-radius,0,-length),(radius,0,-length)]]
  mesh=bpy.data.meshes.new('Brazed carbide chisel insert');mesh.from_pydata(verts,[],[(0,1,5,4),(3,4,5,2),(0,4,3),(1,2,5),(0,3,2,1)]);mesh.update();fix_normals(mesh);o=bpy.data.objects.new('Carbide masonry cutting head',mesh);collection.objects.link(o);mesh.materials.append(STEEL)
 for o in collection.objects:
  if o!=root:o.parent=root;o['toolModelPart']=True
 collection.hide_render=True
 return root,collection
bits=[bit_asset('masonry_6mm',.006,.145),bit_asset('masonry_12mm',.012,.145),bit_asset('impact_ph2',.00635,.070,True)]
# Preserve uncombined object names, modifiers and rigid chuck pivots in the .blend.
bpy.context.scene.unit_settings.system='METRIC';bpy.context.scene.unit_settings.scale_length=1
for image in bpy.data.images:
 if image.source=='FILE':image.pack()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SOURCE,'milwaukee-m18-fid3-fpd3.blend'))
for root,col in bits:
 col.hide_render=False;bpy.ops.object.select_all(action='DESELECT')
 for o in col.objects:o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,root.name+'.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_extras=True)
 col.hide_render=True
for root,col in models:
 # Export evaluated copies, batching by material and rigid parent. The editable
 # source retains separate named manufactured parts and all original modifiers.
 copies=[];batches={};deps=bpy.context.evaluated_depsgraph_get();bpy.context.view_layer.update()
 export_root=bpy.data.objects.new(root.name+'_export',None);scene=bpy.context.scene;scene.collection.objects.link(export_root)
 for key in root.keys():export_root[key]=root[key]
 original_motor=next(o for o in col.objects if o.name.startswith('reference-motor'))
 export_motor=bpy.data.objects.new('reference-motor-export',None);scene.collection.objects.link(export_motor);export_motor.parent=export_root;export_motor.matrix_world=original_motor.matrix_world
 for o in col.objects:
  if o.type not in ('MESH','FONT'):continue
  evaluated=o.evaluated_get(deps);mesh=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=deps);copy=bpy.data.objects.new(o.name+' export',mesh);scene.collection.objects.link(copy);copy.matrix_world=o.matrix_world;copies.append(copy)
  parent=export_motor if o.parent==original_motor else export_root
  matrix=copy.matrix_world.copy();copy.parent=parent;copy.matrix_world=matrix
  mat_name=mesh.materials[0].name if mesh.materials else 'none'
  if o.name.startswith('Index finger trigger'):copy.name='Index finger trigger export';continue
  batches.setdefault((parent,mat_name),[]).append(copy)
 for (parent,material),objects in batches.items():
  bpy.ops.object.select_all(action='DESELECT')
  for o in objects:o.select_set(True)
  bpy.context.view_layer.objects.active=objects[0]
  if len(objects)>1:bpy.ops.object.join()
  objects[0].name=('Rotor ' if parent==export_motor else 'Shell ')+material
 bpy.ops.object.select_all(action='DESELECT')
 for o in scene.objects:
  if o==export_root or o==export_motor or o.parent in (export_root,export_motor):o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,root.name.lower()+'.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_extras=True,export_materials='EXPORT',export_texcoords=True,export_normals=True,export_cameras=False,export_lights=False)
 exported=[o for o in scene.objects if o==export_root or o==export_motor or o.parent in (export_root,export_motor)]
 for o in exported:bpy.data.objects.remove(o,do_unlink=True)
# Neutral studio views of actual meshes, separate from gameplay screenshots.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.render.resolution_x=1400;scene.render.resolution_y=1100;scene.render.resolution_percentage=100;scene.world.color=(.10,.10,.10)
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
for name,pos,power,size in [('Key',(.3,-.4,.55),8,.5),('Fill',(-.4,-.1,.30),4,.4),('Rim',(.1,.4,.4),6,.4)]:
 bpy.ops.object.light_add(type='AREA',location=pos);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,0))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO';camera.data.ortho_scale=.37
for root,col in models:
 for other,oc in models:oc.hide_render=oc!=col
 centre=Vector((0,0,-.025))
 for name,offset in [('side',(.48,0,.025)),('front-quarter',(.40,.36,.20)),('rear-quarter',(.4,-.35,.18))]:
  camera.location=centre+Vector(offset);camera.rotation_euler=(centre-camera.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=os.path.join(REVIEW,root.name.lower()+'-'+name+'.png');bpy.ops.render.render(write_still=True)
for root,col in models:col.hide_render=False
print(json.dumps({'source':SOURCE,'runtime':OUT,'review':REVIEW}))
