"""Create an editable SDS Max model based on the selected M18 FHACO745 gallery.

Run from the repository root with Blender 5.1 in background mode. All authored
dimensions are metres in the game's X-right/Y-up/-Z-forward tool frame.
"""
import bpy
import bmesh
import json
import math
import pathlib
from mathutils import Vector

ROOT = pathlib.Path.cwd()
SOURCE = ROOT / 'assets' / 'source' / 'sds-max-reference.blend'
RUNTIME = ROOT / 'public' / 'assets' / 'tools' / 'sds-max-reference.glb'
REVIEW = ROOT / 'output' / 'forge-hammer-wrists' / 'reference-model-side.png'
for folder in [SOURCE.parent, RUNTIME.parent, REVIEW.parent]:
    folder.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = 1

def game(p):
    """A game point to Blender Z-up; the glTF exporter restores game axes."""
    return Vector((p[0], -p[2], p[1]))

def material(name, rgb, rough=.65, metal=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    return mat

RED = material('FORGE • brick red powder coat', (.48,.012,.022), .68, .12)
RED_EDGE = material('FORGE • dark red cast seam', (.12,.023,.018), .78, .1)
CAST = material('FORGE • brushed aluminium gearbox', (.32,.34,.35), .54, .58)
CAST_EDGE = material('FORGE • worn raised aluminium', (.34,.34,.31), .48, .64)
GRAPHITE = material('FORGE • graphite armour', (.034,.043,.047), .79, .12)
RUBBER = material('FORGE • textured elastomer', (.012,.016,.018), .97)
STEEL = material('FORGE • forged chisel steel', (.48,.52,.51), .42, .68)
BLACK = material('FORGE • vent shadow', (.013,.019,.020), .94)
ORANGE = material('FORGE • safety orange trim', (.78,.26,.14), .66, .1)

def empty(name, parent=None, at=(0,0,0)):
    node = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(node)
    node.parent = parent
    node.location = game(at)
    return node

ROOT_NODE = empty('FORGE SDS MAX')
BODY = empty('Hammer body', ROOT_NODE)
REAR = empty('Longitudinal rear handle and battery', ROOT_NODE)
AUX = empty('Rotatable auxiliary handle', ROOT_NODE, (.02,.005,-.278))
AUX.rotation_euler[1] = -math.pi/4
CLEARANCE_SOLIDS = []

def link(obj, name, mat, parent):
    obj.name = name
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    obj.parent = parent
    return obj

def bevel(obj, amount=.003, segments=2):
    mod = obj.modifiers.new('Machined softened edge', 'BEVEL')
    mod.width = amount
    mod.segments = segments
    mod.affect = 'EDGES'
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(30)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    weighted = obj.modifiers.new('Weighted face normals', 'WEIGHTED_NORMAL')
    weighted.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=weighted.name)

def prism(name, outline, width, mat, parent=BODY, centre_x=.02, edge=.003):
    # Outline entries are (-game Z, game Y), read left-to-right toward the bit.
    n = len(outline)
    vertices = [game((centre_x + x, y, -u)) for x in (-width/2,width/2) for u,y in outline]
    faces = [tuple(reversed(tuple(range(n)))), tuple(range(n,2*n))]
    faces.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
    if name.split()[0] in ('A1','A2','A3','A4','D3'):
        CLEARANCE_SOLIDS.append({'name':name,'outline':outline,'width':width,'centerX':centre_x,'bevel':edge})
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    link(obj, name, mat, parent)
    if edge: bevel(obj, edge)
    return obj

def box(name, centre, size, mat, parent=BODY, edge=.002):
    bpy.ops.mesh.primitive_cube_add(size=1, location=game(centre))
    obj = bpy.context.object
    obj.dimensions = (size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    link(obj, name, mat, parent)
    if edge: bevel(obj,edge)
    return obj

def rod(name, a, b, radius, mat, parent=BODY, verts=20):
    va,vb=game(a),game(b)
    axis=vb-va
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=axis.length, location=(va+vb)/2)
    obj=bpy.context.object
    obj.rotation_euler=Vector((0,0,1)).rotation_difference(axis).to_euler()
    link(obj,name,mat,parent)
    bevel(obj,min(.0025,radius*.18))
    return obj

def torus(name, centre, major, minor, mat, parent=BODY, axis='z'):
    bpy.ops.mesh.primitive_torus_add(major_segments=32, minor_segments=8, location=game(centre),
        major_radius=major, minor_radius=minor)
    obj=bpy.context.object
    # Blender torus normal +Z. Barrel points in game -Z = Blender +Y.
    if axis=='z': obj.rotation_euler[0] = -math.pi/2
    if axis=='x': obj.rotation_euler[1] = math.pi/2
    link(obj,name,mat,parent)
    return obj

def rail(name, points, radius, mat, parent=BODY, straight_spans=()):
    curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D'
    curve.resolution_u=12;curve.bevel_depth=radius;curve.bevel_resolution=4;curve.use_fill_caps=True
    spline=curve.splines.new('BEZIER');spline.bezier_points.add(len(points)-1)
    for point, value in zip(spline.bezier_points, points):
        point.co=game(value);point.handle_left_type='AUTO';point.handle_right_type='AUTO'
    for start, end in straight_spans:
        spline.bezier_points[start].handle_right_type='VECTOR'
        spline.bezier_points[end].handle_left_type='VECTOR'
    obj=bpy.data.objects.new(name,curve);bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    bpy.ops.object.convert(target='MESH');obj=bpy.context.object;obj.select_set(False)
    return link(obj,name,mat,parent)

# Independently authored SDS Max based on the user-selected M18 FHACO745
# product gallery. Preserve the previous concept asset as a separate source.
# Metre dimensions below are modelling dimensions, not a manufacturer CAD claim.
# The nose/handle layout is crucial: the front fist stays ahead of the casing.
prism('A1 cast horizontal impact housing',[(.248,.037),(.230,.066),(.177,.075),(.065,.076),(-.059,.080),(-.072,.053),(.076,-.093),(.212,-.056),(.248,-.029)],.124,CAST,edge=.009)
prism('A2 red vertical motor shell',[(.118,-.061),(-.065,.074),(-.092,.067),(-.096,-.179),(-.018,-.213),(.096,-.244),(.117,-.207)],.130,RED,edge=.010)
prism('A3 deep motor impact boot',[(.095,-.211),(-.020,-.185),(-.039,-.222),(-.042,-.280),(.082,-.284),(.109,-.255)],.133,RUBBER,edge=.007)
prism('A4 rear motor spine',[(-.076,.068),(-.099,.043),(-.107,-.165),(-.085,-.187),(-.066,-.165)],.132,RED_EDGE,edge=.003)
for side in (-1,1):
    x=.02+side*.067
    prism(f'A5 raised alloy diagonal seam {side}',[(.125,-.069),(-.058,.082),(-.074,.078),(.122,-.091)],.003,CAST_EDGE,centre_x=x,edge=.001)
    prism(f'A6 inset curved motor cheek {side}',[(.082,-.086),(-.047,.023),(-.059,.006),(-.060,-.177),(.067,-.212),(.088,-.184)],.003,RED,centre_x=x,edge=.004)
    for y,z,span in ((.018,-.151,.085),(-.025,-.114,.055)):
        box(f'A7 gearbox cooling recess {side} {y}',(x,y,z),(.003,.004,span),BLACK,edge=.001)
        for j in range(4):
            box(f'A8 vent fin {side} {y} {j}',(x+side*.001,y,z-span*.38+j*span*.25),(.003,.005,.002),CAST_EDGE,edge=0)
    for y,z in ((.047,-.218),(.048,.064),(-.161,.076),(-.249,-.014)):
        rod(f'A9 recessed torx fastener {side} {y}',(x,y,z),(x+side*.003,y,z),.003,GRAPHITE,verts=12)
    box(f'A10 motor seam {side}',(x,-.182,-.012),(.003,.003,.084),RED_EDGE,edge=.001)
    for j in range(5):
        box(f'A11 boot relief {side} {j}',(x,-.247,-.04+j*.018),(.002,.023,.003),GRAPHITE,edge=.001)

rod('B1 cast nose neck',(.02,.005,-.241),(.02,.005,-.294),.039,CAST,verts=32)
rod('B2 black SDS Max locking sleeve',(.02,.005,-.292),(.02,.005,-.333),.042,GRAPHITE,verts=40)
rod('B3 reduced dust nose',(.02,.005,-.329),(.02,.005,-.349),.026,RUBBER,verts=32)
for z,r in ((-.295,.042),(-.305,.042),(-.326,.033),(-.344,.026)):
    torus(f'B4 chuck moulding {z}',(.02,.005,z),r,.0018,RUBBER)
torus('B5 bit entry seal',(.02,.005,-.349),.012,.003,RUBBER)
rod('B6 top mode selector',(.02,.076,-.052),(.02,.082,-.052),.021,GRAPHITE)
box('B7 selector rib',(.02,.085,-.052),(.024,.004,.004),RUBBER)

# Open D handle with a straight, slightly raked grip, 108 mm clear opening.
# The full rubber grip is 142 mm long; keep its hand datum inside that span.
rail('C1 upper reinforced handle bridge',[(.02,.057,.065),(.02,.066,.106),(.02,.060,.175),(.02,.034,.195)],.019,RED,REAR)
rail('C2 lower reinforced handle bridge',[(.02,-.171,.082),(.02,-.183,.135),(.02,-.165,.192),(.02,-.140,.195)],.018,RED,REAR)
rod('C3 rigid grip core',(.02,.034,.195),(.02,-.147,.195),.018,GRAPHITE,REAR)
rod('C4 full rear rubber grip',(.02,.021,.195),(.02,-.121,.195),.024,RUBBER,REAR,verts=32)
for side in (-1,1):
    for j in range(7):
        y=.008-j*.018
        rail(f'C5 diagonal grip tread {side} {j}',[(.02+side*.016,y+.005,.212),(.02+side*.023,y,.195),(.02+side*.016,y-.005,.178)],.0014,GRAPHITE,REAR)
box('C6 index trigger paddle',(.02,-.034,.166),(.024,.070,.009),GRAPHITE,REAR,edge=.004)
box('C7 upper trigger safety',(.045,.024,.181),(.011,.012,.018),RED,REAR)
for y in (.058,-.173):
    rod(f'C8 vibration isolation guide {y}',(.02,y,.068),(.02,y,.106),.009,GRAPHITE,REAR)

# Battery slides beneath the rear chassis, as on the selected reference.
# Its rails overlap the red foot and upper pack so there is no floating gap.
prism('D1 sloping rear battery foot',[(-.063,-.167),(-.182,-.171),(-.188,-.207),(-.077,-.217)],.111,RED,REAR,edge=.004)
box('D2 battery sliding rails',(.02,-.218,.124),(.110,.018,.149),GRAPHITE,REAR)
prism('D3 removable battery shell',[(-.042,-.218),(-.173,-.218),(-.203,-.242),(-.203,-.280),(-.186,-.291),(-.063,-.291),(-.044,-.267)],.125,RUBBER,REAR,edge=.005)
box('D4 battery sole',(.02,-.290,.129),(.127,.010,.141),GRAPHITE,REAR,edge=.004)
for side in (-1,1):
    x=.02+side*.064
    box(f'D5 battery release paddle {side}',(x,-.222,.177),(.007,.019,.025),RED,REAR)
    box(f'D6 battery inset panel {side}',(x,-.253,.125),(.003,.037,.115),GRAPHITE,REAR)
    for j in range(5):
        rod(f'D7 pack cooling port {side} {j}',(x,-.280,.08+j*.019),(x+side*.002,-.280,.08+j*.019),.002,BLACK,REAR,verts=10)
for j in range(4):box(f'D8 charge LED {j}',(.000+j*.012,-.253,.203),(.006,.003,.002),CAST_EDGE,REAR,edge=.0005)

# Front collar is ahead of the casing; the long shaft and guard keep knuckles
# away from the gearbox at every user-selected collar angle.
torus('E1 rotating clamping collar',(0,0,0),.041,.006,GRAPHITE,AUX)
rod('E2 auxiliary spindle',(-.035,0,0),(-.110,0,0),.014,GRAPHITE,AUX)
rod('E3 flared palm guard',(-.095,0,0),(-.107,0,0),.029,RUBBER,AUX,verts=32)
rod('E4 full auxiliary rubber grip',(-.107,0,0),(-.235,0,0),.022,RUBBER,AUX,verts=32)
for x in (-.113,-.132,-.151,-.170,-.189,-.208,-.227):
    torus(f'E5 moulded grip rib {x}',(x,0,0),.0222,.0012,GRAPHITE,AUX,axis='x')
rod('E6 end cap',(-.232,0,0),(-.243,0,0),.026,GRAPHITE,AUX,verts=32)

ROOT_NODE['gripPoint']=[.02,-.052,.195]
ROOT_NODE['gripRadiusM']=.024
ROOT_NODE['tipPoint']=[.02,.005,-.749]
ROOT_NODE['reference']='M18 FHACO745 official product gallery; independently authored reference model'
AUX['gripPoint']=[-.171,0,0]
AUX['gripRadiusM']=.022
AUX['pivotGame']=[.02,.005,-.278]

ROOT_NODE['handClearanceSolids']=json.dumps(CLEARANCE_SOLIDS)
bpy.ops.object.select_all(action='DESELECT')
runtime=[]
for obj in list(bpy.data.objects):
    if obj in (ROOT_NODE,BODY,REAR,AUX) or obj.parent in (BODY,REAR,AUX):
        obj.select_set(True);runtime.append(obj)
bpy.context.view_layer.objects.active=ROOT_NODE
bpy.ops.export_scene.gltf(filepath=str(RUNTIME),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_yup=True)

PREVIEW=empty('SOURCE PREVIEW ONLY 400 mm chisel')
rod('F1 chisel shaft',(.02,.005,-.349),(.02,.005,-.659),.009,STEEL,PREVIEW)
prism('F2 flat blade',[(.650,-.003),(.686,-.003),(.749,-.0005),(.749,.0005),(.686,.003),(.650,.003)],.050,STEEL,PREVIEW,edge=.0005)
notes=bpy.data.texts.new('READ ME')
notes.write('Independent SDS Max model based on the user-selected Milwaukee M18 FHACO745 gallery. Not manufacturer CAD.\nMetres, X right, Y up, -Z forward. No presentation scaling. Grip and pivot metadata exported.\nSource-only chisel excluded from GLB because the game owns blade contact.\nReference URL: https://www.milwaukeetool.eu/en-eu/m18-fuel-45-mm-sds-max-drilling-and-breaking-hammer-with-one-key/m18-fhaco745/\n')
world=bpy.data.worlds.new('Neutral studio');bpy.context.scene.world=world;world.use_nodes=True
world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.45,.47,.49,1)
world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.65
for name,loc,power,size in [('Key',(1.2,.7,1.6),100,2),('Fill',(-1,-.8,.8),60,2)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.size=size
    obj=bpy.data.objects.new(name,data);bpy.context.scene.collection.objects.link(obj);obj.location=loc
    obj.rotation_euler=(Vector((0,0,0))-obj.location).to_track_quat('-Z','Y').to_euler()
data=bpy.data.cameras.new('Reference side');cam=bpy.data.objects.new('Reference side',data);bpy.context.scene.collection.objects.link(cam)
cam.location=(1.8,0,0);cam.rotation_euler=(Vector((0,0,-.09))-cam.location).to_track_quat('-Z','Y').to_euler()
data.type='ORTHO';data.ortho_scale=1.12
scene=bpy.context.scene;scene.camera=cam;scene.render.engine='BLENDER_EEVEE';scene.view_settings.view_transform='Standard'
scene.render.resolution_x=1400;scene.render.resolution_y=850;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(REVIEW)
bpy.ops.render.render(write_still=True)
bpy.context.preferences.filepaths.save_version=0;bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE),compress=True)
report={'source':str(SOURCE),'runtime':str(RUNTIME),'meshes':sum(o.type=='MESH' for o in runtime),'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in runtime if o.type=='MESH')}
(REVIEW.parent/'reference-model.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
