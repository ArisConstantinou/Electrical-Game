import * as THREE from 'three';

export type ToolModelKind = 'spray' | 'trowel' | 'spring' | 'level' | 'cutter' | 'hose' | 'fitting' | 'hammer';
type Point = readonly [number, number, number];
const vector = (p: Point): THREE.Vector3 => new THREE.Vector3(...p);
const mat = (color: number, roughness = .55, metalness = 0): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const steel = (): THREE.MeshStandardMaterial => mat(0xb7bfbe, .27, .78);
const rubber = (): THREE.MeshStandardMaterial => mat(0x222725, .93);
function part(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, position: Point, name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); mesh.name = name;
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function rod(parent: THREE.Object3D, a: Point, b: Point, radius: number, material: THREE.Material, name: string, endRadius = radius): THREE.Mesh {
  const start = vector(a), end = vector(b), delta = end.clone().sub(start);
  const mesh = part(parent, new THREE.CylinderGeometry(endRadius, radius, delta.length(), 16), material, [0, 0, 0], name);
  mesh.position.copy(start).add(end).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return mesh;
}
function outline(points: readonly (readonly [number, number])[]): THREE.Shape {
  const shape = new THREE.Shape(); shape.moveTo(...points[0]); for (const p of points.slice(1)) shape.lineTo(...p); shape.closePath(); return shape;
}
function roundedRectangle(width: number, height: number, radius: number): THREE.Shape {
  const x = -width / 2, y = -height / 2, r = Math.min(radius, width / 2, height / 2), s = new THREE.Shape();
  s.moveTo(x + r, y); s.lineTo(x + width - r, y); s.quadraticCurveTo(x + width, y, x + width, y + r);
  s.lineTo(x + width, y + height - r); s.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  s.lineTo(x + r, y + height); s.quadraticCurveTo(x, y + height, x, y + height - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); s.closePath(); return s;
}
function extrude(shape: THREE.Shape, depth: number, bevel = 0): THREE.ExtrudeGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 20, steps: 1 });
  geometry.translate(0, 0, -depth / 2); return geometry;
}
function tube(parent: THREE.Object3D, points: Point[], radius: number, material: THREE.Material, name: string): THREE.Mesh {
  return part(parent, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(vector)), 32, radius, 10, false), material, [0, 0, 0], name);
}
function torus(parent: THREE.Object3D, radius: number, wire: number, material: THREE.Material, position: Point, name: string, axis: 'x' | 'y' | 'z' = 'z'): THREE.Mesh {
  const mesh = part(parent, new THREE.TorusGeometry(radius, wire, 6, 28), material, position, name);
  if (axis === 'x') mesh.rotation.y = Math.PI / 2; if (axis === 'y') mesh.rotation.x = Math.PI / 2; return mesh;
}
function screw(parent: THREE.Object3D, position: Point, radius = .004): void {
  const head = part(parent, new THREE.CylinderGeometry(radius, radius, .002, 10), steel(), position, 'Recessed fastener'); head.rotation.x = Math.PI / 2;
  part(parent, new THREE.BoxGeometry(radius * 1.2, .0008, .0007), mat(0x303534), [position[0], position[1], position[2] + .0014], 'Fastener slot');
}
function label(text: string, subtitle: string, width: number, height: number, foreground = '#f3f1e9', background = '#252925'): THREE.Mesh | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 256;
  const context = canvas.getContext('2d'); if (!context) return null;
  context.fillStyle = background; context.fillRect(0, 0, 768, 256); context.fillStyle = foreground;
  context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = '800 74px Arial'; context.fillText(text, 384, 92, 712);
  context.font = '600 34px Arial'; context.fillText(subtitle, 384, 184, 712);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: texture, roughness: .7, metalness: 0 }));
}
function metadata(group: THREE.Group, grip: Point, tip: Point, secondaryGrip?: Point): THREE.Group {
  group.userData.gripPoint = [...grip]; group.userData.tipPoint = [...tip];
  if (secondaryGrip) group.userData.secondaryGripPoint = [...secondaryGrip];
  group.traverse(object => { if (object instanceof THREE.Mesh) { object.renderOrder = 20; object.userData.toolModelPart = true; } }); return group;
}
function gripFrame(group:THREE.Group,direction:Point,rotation?:THREE.Quaternion):THREE.Group {
  group.userData.gripQuaternion=(rotation??new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),vector(direction).normalize())).toArray();
  group.userData.primaryGripCount=1;
  return group;
}

function spray(): THREE.Group {
  const group = new THREE.Group(), can = new THREE.Group(); group.add(can); can.position.set(.16, -.08, -.03); can.rotation.z = -.14;
  const aluminium = steel(), black = mat(0x171a18, .42), white = mat(0xe2e1d8, .38);
  // 400 ml-class rolled steel aerosol can, with a real domed valve shoulder.
  const profile = [[0, -.095], [.029, -.095], [.033, -.090], [.0335, -.082], [.0335, .078], [.032, .085], [.027, .092], [.018, .097], [.012, .097]].map(p => new THREE.Vector2(p[0], p[1]));
  part(can, new THREE.LatheGeometry(profile, 40), aluminium, [0, 0, 0], 'Rolled aerosol can and domed shoulder');
  part(can, new THREE.CylinderGeometry(.0337, .0337, .158, 40, 1, true), black, [0, -.002, 0], 'Black wraparound paint label');
  torus(can, .0314, .0019, aluminium, [0, -.092, 0], 'Rolled bottom seam', 'y');
  torus(can, .018, .0015, aluminium, [0, .094, 0], 'Valve mounting cup', 'y');
  const color = mat(0x168cdb, .42); color.name = 'Spray selected color';
  const band = part(can, new THREE.CylinderGeometry(.03395, .03395, .020, 40, 1, true), color, [0, -.055, 0], 'Spray color band'); band.userData.sprayColor = true;
  const actuator = new THREE.Group(); actuator.name = 'spray-actuator'; actuator.position.y = .104; can.add(actuator);
  part(actuator, extrude(roundedRectangle(.029, .019, .007), .026, .001), white, [0, 0, -.002], 'Broad finger press actuator');
  const aperture = part(actuator, new THREE.CylinderGeometry(.0023, .0023, .003, 14), mat(0x101816), [0, -.001, -.0175], 'Forward spray aperture'); aperture.rotation.x = Math.PI / 2;
  torus(actuator, .0042, .001, white, [0, -.001, -.018], 'Nozzle insert rim');
  const brand = label('SITE MARK', 'SPRAY PAINT', .059, .036, '#ffffff', '#b32927'); if (brand) { brand.position.set(0, .044, .034); can.add(brand); }
  const info = label('COLOR', '400 ml · MASONRY', .058, .044); if (info) { info.position.set(0, -.005, .034); can.add(info); }
  // Raised bead and metal base remain visible below the glove.
  const front = new THREE.Object3D(); front.name = 'spray-tip'; front.position.set(0, .103, -.020); can.add(front);
  return gripFrame(metadata(group, [.16070, -.07505, -.03], [.175, .021, -.050]),[0,1,0],can.quaternion.clone());
}

function trowel(): THREE.Group {
  const group = new THREE.Group(), metal = steel(), darkSteel = mat(0x727a79, .35, .7);
  const blade = outline([[-.070, .155], [-.010, -.021], [.050, -.043], [.085, -.013], [.071, .044]]);
  const plate = part(group, extrude(blade, .0018), metal, [.01, .018, -.09], 'Triangular polished steel pointing blade'); plate.rotation.x = -.12;
  // A narrow contrasting bevel is geometry, not a thick wedge/putty knife blade.
  rod(group, [-.060, .172, -.112], [.081, .062, -.097], .0007, mat(0xe6e8e5, .2, .85), 'Ground cutting edge');
  tube(group, [[.049, -.002, -.086], [.097, -.029, -.059], [.109, -.020, -.014], [.131, -.049, .030]], .006, darkSteel, 'Bent forged swan-neck tang');
  const handleStart: Point = [.141, -.058, .039], handleEnd: Point = [.224, -.155, .077];
  rod(group, handleStart, handleEnd, .0148, mat(0xb98443, .68), 'Shaped varnished hardwood handle', .0128);
  rod(group, [.130, -.046, .027], [.149, -.067, .043], .0152, metal, 'Steel handle ferrule');
  const grain = mat(0x8c6031, .9);
  for (let i = 0; i < 4; i++) rod(group, [.149 + i * .002, -.064, .051], [.215 + i * .0015, -.144, .085], .00045, grain, 'Fine longitudinal wood grain');
  const end = part(group, new THREE.SphereGeometry(.0128, 16, 10), mat(0xb98443, .68), handleEnd, 'Rounded handle end'); end.scale.set(1, .7, 1);
  return gripFrame(metadata(group, [.183, -.108, .059], [-.060, .172, -.112]),[-.083,.097,-.038]);
}

function spring(): THREE.Group {
  const group = new THREE.Group(), metal = mat(0x9fa5a1, .24, .84);
  const centerPoints: Point[] = [[.058, -.150, -.025], [.030, .036, -.043], [.057, .141, -.054], [.139, .162, -.050], [.203, .112, -.034], [.187, -.012, -.015], [.151, -.157, .005]];
  const center = new THREE.CatmullRomCurve3(centerPoints.map(vector));
  const turns = Math.round(center.getLength() / .00265), coilRadius = .0069, wireRadius = .0013;
  class DenseHelix extends THREE.Curve<THREE.Vector3> {
    constructor() { super(); }
    override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
      const p = center.getPointAt(t), tangent = center.getTangentAt(t), normal = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();
      const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize(), a = t * turns * Math.PI * 2;
      return target.copy(p).addScaledVector(normal, Math.cos(a) * coilRadius).addScaledVector(binormal, Math.sin(a) * coilRadius);
    }
  }
  const helix = new DenseHelix(); helix.arcLengthDivisions = turns * 20;
  const coil = part(group, new THREE.TubeGeometry(helix, turns * 10, wireRadius, 6, false), metal, [0, 0, 0], 'Dense close-wound internal bending spring');
  coil.userData.turns = turns; coil.userData.nominalOuterDiameterMm = 16.4; coil.userData.internalSpring = true;
  const finishRing = torus(group, coilRadius, wireRadius, metal, [.058, -.150, -.025], 'Open spring insertion end'); finishRing.rotation.x = Math.PI / 2;
  tube(group, [[.151, -.157, .005], [.151, -.174, .005], [.158, -.184, .006]], .0018, metal, 'Retrieval eye stem');
  const eye = torus(group, .009, .002, metal, [.158, -.185, .006], 'Closed retrieval eye'); eye.scale.y = 1.35;
  const grip=center.getPointAt(.935),tangent=center.getTangentAt(.935).negate();
  return gripFrame(metadata(group,grip.toArray() as [number,number,number], [.058, -.150, -.025]),tangent.toArray() as [number,number,number]);
}

function level(): THREE.Group {
  const group = new THREE.Group(), frame = new THREE.Group(); frame.position.set(.005, -.02, -.075); group.add(frame);
  const red = mat(0xc6282c, .38, .23), dark = rubber(), profile = roundedRectangle(.52, .052, .004);
  const hole = (x: number, width: number, height: number): void => {
    const shape = roundedRectangle(width, height, .006); const path = new THREE.Path(shape.getPoints(12).map(p => new THREE.Vector2(p.x + x, p.y))); profile.holes.push(path);
  };
  hole(-.094, .082, .025); hole(.094, .082, .025); hole(-.19, .030, .039); hole(.19, .030, .039); hole(0, .050, .028);
  part(frame, extrude(profile, .027), red, [0, 0, 0], 'Red aluminium box profile with open grips and vial windows');
  for (const y of [-.025, .025]) part(frame, new THREE.BoxGeometry(.493, .003, .031), steel(), [0, y, 0], 'Machined aluminium measuring edge');
  for (const x of [-.26, .26]) part(frame, extrude(roundedRectangle(.014, .056, .005), .032, .001), dark, [x, 0, 0], 'Shock absorbing level end cap');
  function vial(x: number, horizontal: boolean): void {
    const housing = new THREE.Group(); housing.position.set(x, 0, .002); housing.name = horizontal ? 'level-horizontal-vial' : `level-plumb-vial-${x < 0 ? 'left' : 'right'}`; frame.add(housing);
    if (horizontal) housing.rotation.z = Math.PI / 2;
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xc6e9ba, roughness: .1, metalness: 0, transparent: true, opacity: .36, transmission: 0, depthWrite: false });
    part(housing, new THREE.CapsuleGeometry(.0075, .024, 4, 16), glass, [0, 0, .006], 'Clear acrylic vial shell');
    part(housing, new THREE.CylinderGeometry(.0059, .0059, .033, 14), mat(0xb9da35, .24), [0, 0, .006], 'Fluorescent vial liquid');
    const bubble = part(housing, new THREE.SphereGeometry(.0054, 16, 10), mat(0xecf0dc, .18), [0, 0, .010], 'level-bubble'); bubble.scale.y = 1.35; bubble.userData.vialBubble = true;
    for (const y of [-.009, .009]) torus(housing, .0065, .00065, mat(0x293429), [0, y, .006], 'Vial calibration line', 'y');
  }
  vial(0, true); vial(-.19, false); vial(.19, false);
  const badge = label('LEVEL', '3 VIALS', .052, .020, '#ffffff', '#c6282c'); if (badge) { badge.position.set(.142, 0, .014); frame.add(badge); }
  return gripFrame(metadata(group, [.10, -.02, -.075], [-.255, -.02, -.075]),[-1,0,0]);
}

function cutter(): THREE.Group {
  const group = new THREE.Group(), metal = steel(), red = mat(0xb92028, .44), dark = rubber();
  const assembly = new THREE.Group(); assembly.position.set(.043, .003, -.060); assembly.rotation.z = -.20; group.add(assembly);
  const head = new THREE.Shape(); head.moveTo(-.077, .055);
  for (const [x, y] of [[-.008, .063], [.054, .019], [.049, -.035], [-.008, -.059], [-.070, -.048], [-.080, -.015], [-.057, -.015]]) head.lineTo(x, y);
  // Open C-shaped support, made from a plate with a round pipe cradle cut into its side.
  head.absarc(-.036, .008, .029, Math.PI * 1.30, Math.PI * .73, false); head.lineTo(-.079, .031); head.closePath();
  part(assembly, extrude(head, .012, .0015), metal, [0, 0, 0], 'Corrosion resistant open pipe support and metal core');
  const fixedA: Point = [.025, -.012, 0], fixedB: Point = [.159, -.136, 0];
  rod(assembly, fixedA, fixedB, .0125, metal, 'Fixed handle metal core');
  rod(assembly, [.060, -.044, .001], [.165, -.143, .001], .014, red, 'Fixed red moulded handle', .0108);
  const moving = new THREE.Group(); moving.name = 'cutter-moving-handle'; moving.position.set(.019, .016, .010); moving.rotation.z = .13; assembly.add(moving);
  const blade = outline([[-.086, .028], [-.037, .022], [-.023, -.022], [-.051, -.010], [-.066, .005], [-.086, -.006]]);
  part(moving, extrude(blade, .0022), mat(0xd5dbd7, .18, .87), [0, 0, 0], 'Replaceable double ground V-shaped cutter blade');
  rod(moving, [0, 0, -.004], [.179, -.089, -.004], .011, metal, 'Moving handle continuous metal core');
  rod(moving, [.038, -.022, -.003], [.183, -.094, -.003], .014, red, 'Moving red moulded handle', .0105);
  torus(moving, .0085, .0028, red, [.180, -.093, -.003], 'Handle transport lock eye');
  const lock = part(assembly, new THREE.BoxGeometry(.022, .009, .004), dark, [.023, -.027, .009], 'One-handed transport locking slider'); lock.rotation.z = .45;
  screw(assembly, [.019, .016, .020], .008); screw(assembly, [-.016, .041, .009], .003); screw(assembly, [-.062, .046, .009], .003);
  const springPoints: Point[] = [];
  for (let i = 0; i <= 40; i++) { const t = i / 40; springPoints.push([.074 + t * .015, -.053 + t * .021, .003 + Math.sin(t * Math.PI * 10) * .004]); }
  tube(assembly, springPoints, .0011, metal, 'Small opening spring between shear handles');
  const badge = label('PVC', 'Ø 25', .027, .014, '#ffffff', '#b92028'); if (badge) { badge.position.set(.122, -.065, .012); badge.rotation.z = -.45; assembly.add(badge); }
  group.userData.ratcheting = false;
  // The hand spans the two levers, instead of perching on the end of one.
  const grip=vector([.125,-.067,.005]).applyQuaternion(assembly.quaternion).add(assembly.position);
  const axis=vector([-.8,.6,0]).applyQuaternion(assembly.quaternion);
  return gripFrame(metadata(group,grip.toArray() as [number,number,number],[-.001,.014,-.059]),axis.toArray() as [number,number,number]);
}

function hose(): THREE.Group {
  const group = new THREE.Group(), orange = mat(0xdf6f1d, .48), dark = rubber(), metal = steel();
  rod(group, [.14, -.033, -.033], [.10, .008, -.158], .025, dark, 'Angled cleaning nozzle barrel', .020);
  rod(group, [.098, .010, -.162], [.084, .024, -.204], .0235, orange, 'Adjustable orange nozzle collar', .020);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6, ridge = part(group, new THREE.BoxGeometry(.003, .006, .031), mat(0xb85716, .61), [.091 + Math.cos(a) * .021, .017 + Math.sin(a) * .021, -.184], 'Nozzle collar grip rib'); ridge.rotation.z = a;
  }
  const mouth = part(group, new THREE.CylinderGeometry(.016, .016, .005, 24), mat(0x222926), [.082, .026, -.209], 'Nozzle outlet'); mouth.rotation.x = Math.PI / 2;
  torus(group, .007, .002, metal, [.082, .026, -.213], 'Water jet orifice');
  rod(group, [.145, -.025, -.015], [.193, -.143, .018], .022, dark, 'Ergonomic rubber pistol grip', .019);
  rod(group, [.161, -.020, -.009], [.197, -.107, .013], .008, orange, 'hose-trigger', .008);
  part(group, extrude(roundedRectangle(.025, .013, .004), .025), orange, [.154, -.017, .009], 'Trigger lock rocker');
  rod(group, [.195, -.149, .020], [.206, -.181, .026], .018, orange, 'Quick connector coupling', .016);
  torus(group, .016, .002, metal, [.205, -.176, .025], 'Connector locking collar', 'y');
  tube(group, [[.207, -.181, .026], [.216, -.237, .046], [.190, -.305, .063], [.245, -.435, .091]], .009, mat(0x3b6170, .83), 'Flexible water supply hose');
  return gripFrame(metadata(group, [.177, -.101, .010], [.082, .026, -.215]),[-.048,.118,-.033]);
}

function fitting(): THREE.Group {
  const group = new THREE.Group(), white = mat(0xe3e0d6, .69), inner = mat(0xbabbb2, .8), metal = steel();
  const body = new THREE.Group(); body.position.set(.095, -.025, -.065); body.rotation.y = -.2; group.add(body);
  const shell = roundedRectangle(.079, .079, .004), opening = roundedRectangle(.069, .069, .003); shell.holes.push(new THREE.Path(opening.getPoints(12)));
  part(body, extrude(shell, .043), white, [0, 0, 0], 'Flush gang box open plastic walls');
  part(body, new THREE.BoxGeometry(.073, .073, .0025), inner, [0, 0, -.020], 'Gang box back wall');
  for (const x of [-.027, .027]) { part(body, new THREE.BoxGeometry(.008, .015, .038), white, [x, 0, 0], 'Integral fixing screw lug'); screw(body, [x, 0, .021], .0027); }
  for (const y of [-.018, .018]) for (const x of [-.018, .018]) {
    torus(body, .0085, .0008, white, [x, y, -.0175], 'Conduit knockout score ring');
  }
  const screwBar = rod(body, [-.033, .032, .019], [.033, .032, .019], .0011, metal, 'Thin fixing ear'); screwBar.visible = true;
  const grip=vector([.039,-.001,.004]).applyQuaternion(body.quaternion).add(body.position);
  return gripFrame(metadata(group,grip.toArray() as [number,number,number],[.095,-.025,-.085]),[0,1,0],body.quaternion.clone());
}

/** Cordless SDS-max silhouette, based on the M18 FHACO745 manufacturer's reference.
 * The rig supplies the interchangeable steel shaft and chisel beyond the chuck.
 * The rear grip sits behind the motor in its longitudinal plane.
 * https://www.milwaukeetool.eu/en-eu/m18-fuel-45-mm-sds-max-drilling-and-breaking-hammer-with-one-key/m18-fhaco745/
 */
function hammer(): THREE.Group {
  const group = new THREE.Group();
  const red = mat(0xbf2428, .38, .08), redEdge = mat(0x8a1c22, .53), dark = rubber();
  const graphite = mat(0x343b3d, .56, .18), alloy = mat(0x727d80, .34, .72), metal = steel();
  const seam = mat(0x141b1e, .82), inset = mat(0x454e50, .64), light = mat(0xd1d5ca, .34);
  // The motor is a moulded, bevelled shell, with a raised spine and separate
  // front cast gearbox. It replaces the old rectangular red placeholder.
  const shellProfile = outline([[-.052,.035],[-.033,.053],[.029,.051],[.049,.028],[.053,-.053],[.031,-.124],[-.017,-.132],[-.046,-.101],[-.055,-.039]]);
  part(group, extrude(shellProfile, .223, .010), red, [.020,-.014,-.116], 'Cordless contoured brushless motor housing');
  const spine = part(group, extrude(roundedRectangle(.095,.031,.014), .216, .005), graphite, [.020,.040,-.135], 'Impact resistant upper spine'); spine.rotation.x=-.11;
  const lowerBumper=part(group,extrude(roundedRectangle(.104,.046,.011),.140,.004),dark,[.016,-.162,-.098],'Motor base rubber bumper'); lowerBumper.rotation.x=.13;
  // Split-shell seam follows the rear silhouette and makes the housing feel assembled.
  const split = part(group, extrude(shellProfile,.003,.0105), redEdge,[.020,-.014,-.116],'Motor casing mould split'); split.position.z=-.116;
  const gearboxProfile = [[.042,-.090],[.051,-.076],[.060,-.040],[.059,.008],[.050,.044],[.039,.076]].map(p=>new THREE.Vector2(p[0],p[1]));
  const gearbox=part(group,new THREE.LatheGeometry(gearboxProfile,32),graphite,[.020,.009,-.232],'Cast tapered SDS max impact gearbox'); gearbox.rotation.x=Math.PI/2;
  torus(group,.052,.004,alloy,[.020,.009,-.215],'Gearbox bolted joint');
  for(const x of [-.034,.074]) rod(group,[x,-.029,-.213],[x,-.021,-.268],.0055,inset,'Gearbox strengthening rib');
  // Rubber quick-change sleeve, clamp and steel dust seal at the shaft entry.
  rod(group,[.020,.005,-.280],[.020,.005,-.343],.036,dark,'SDS max quick change chuck sleeve',.039);
  for(const z of [-.285,-.300,-.316,-.332]) torus(group,.038,.0025,seam,[.020,.005,z],'Chuck sleeve circumferential grip');
  for(let i=0;i<10;i++) {
    const a=i*Math.PI/5;
    rod(group,[.020+Math.cos(a)*.038,.005+Math.sin(a)*.038,-.292],[.020+Math.cos(a)*.038,.005+Math.sin(a)*.038,-.327],.0025,graphite,'Chuck longitudinal grip flute');
  }
  torus(group,.022,.005,alloy,[.020,.005,-.345],'Steel SDS max collar');
  torus(group,.016,.003,dark,[.020,.005,-.349],'Chisel dust seal');
  // The D handle is behind the motor, in the longitudinal Y/Z plane.
  // The earlier broadside X/Y handle made the complete tool artificially wide.
  const rear = new THREE.Group(); rear.name = 'Longitudinal rear handle and battery';
  rear.rotation.y = -Math.PI / 2; rear.position.set(-.013, 0, -.09); group.add(rear);
  // Open rear D-frame. Both bridges connect the grip to the shell; the hand
  // wraps the rubber member at the published grip point, not through a box.
  tube(rear,[[.075,.031,-.033],[.147,.040,-.002],[.190,.005,.015],[.190,-.065,.015],[.190,-.173,.015],[.165,-.198,.002],[.070,-.159,-.035]],.017,red,'Open rear D handle structural frame');
  rod(rear,[.190,-.046,.015],[.190,-.180,.015],.022,dark,'Rear D handle rubber grip',.0235);
  const trigger=part(rear,extrude(roundedRectangle(.022,.051,.005),.012,.002),graphite,[.167,-.068,.024],'hammer-trigger'); trigger.rotation.z=-.06;
  for(let i=0;i<7;i++) torus(rear,.0228,.0012,graphite,[.19,-.066-i*.014,.015],'Rear handle textured rubber ring','y');
  part(rear,extrude(roundedRectangle(.045,.027,.005),.058,.002),graphite,[.123,.021,-.005],'Upper handle vibration isolation joint');
  const auxiliary = new THREE.Group(); auxiliary.name = 'Rotatable auxiliary handle'; group.add(auxiliary);
  // Front clamp holds an actual perpendicular support grip with end flange.
  torus(auxiliary,.046,.006,alloy,[.020,.005,-.275],'Adjustable auxiliary handle clamp');
  rod(auxiliary,[.018,-.005,-.30],[-.060,-.005,-.30],.014,alloy,'Auxiliary handle clamp spindle');
  rod(auxiliary,[-.066,-.005,-.30],[-.190,-.005,-.30],.022,dark,'Auxiliary rubber hand grip',.024);
  for(let i=0;i<8;i++) torus(auxiliary,.023,.0012,graphite,[-.073-i*.015,-.005,-.30],'Auxiliary hand grip texture','x');
  torus(auxiliary,.027,.0035,dark,[-.192,-.005,-.30],'Auxiliary handle end stop','x');
  auxiliary.position.set(.020,.005,-.275);
  auxiliary.children.forEach(child=>child.position.sub(auxiliary.position));
  auxiliary.userData.gripPoint=[-.150,-.010,-.025];
  // A removable high-output pack makes cordless power visible from the player
  // view as well as from the side. No cable or strain relief exists on this model.
  part(rear,extrude(roundedRectangle(.143,.029,.006),.100,.003),red,[.143,-.219,.006],'Battery slide rail shoe');
  part(rear,extrude(roundedRectangle(.170,.078,.010),.115,.006),dark,[.136,-.268,.006],'Removable high output battery pack');
  part(rear,extrude(roundedRectangle(.171,.015,.004),.115,.003),graphite,[.136,-.302,.006],'Battery impact bumper');
  part(rear,extrude(roundedRectangle(.157,.013,.004),.108,.002),redEdge,[.136,-.235,.006],'Battery casing red upper seam');
  for(const x of [.054,.218]) {
    part(rear,extrude(roundedRectangle(.008,.026,.003),.036,.001),red,[x,-.25,.010],'Battery release latch');
    for(let i=0;i<3;i++) part(rear,new THREE.BoxGeometry(.002,.002,.026),graphite,[x,-.243-i*.006,.010],'Battery release latch ribs');
  }
  for(let i=0;i<4;i++) part(rear,new THREE.BoxGeometry(.022,.012,.002),inset,[.078+i*.039,-.279,.073],'Battery protective cell ribs');
  const powerBadge=label('18V / 12.0 Ah','HIGH OUTPUT',.127,.034,'#f1f2ec','#252b2c');
  if(powerBadge){powerBadge.position.set(.136,-.262,.0735);rear.add(powerBadge);}
  part(rear,new THREE.BoxGeometry(.012,.007,.002),graphite,[.186,-.290,.074],'Battery charge check button');
  for(let i=0;i<4;i++) part(rear,new THREE.BoxGeometry(.007,.004,.002),mat(i<3?0x72b369:0x283a30,.4),[.087+i*.012,-.290,.074],'Battery charge indicator');
  // Cooling louvres, fasteners and selector are individually readable when close.
  for(const side of [-1,1]) {
    const x=.020+side*.056;
    part(group,new THREE.BoxGeometry(.004,.066,.113),graphite,[x,-.032,-.093],'Inset motor ventilation panel');
    for(let i=0;i<7;i++) part(group,new THREE.BoxGeometry(.005,.0035,.093),seam,[x+side*.002,-.008-i*.008,-.092],'Recessed motor cooling slot');
    for(const z of [-.041,-.186]) {
      const bolt=part(group,new THREE.CylinderGeometry(.004,.004,.003,10),metal,[x+side*.003,-.091,z],'Torx motor housing screw'); bolt.rotation.z=Math.PI/2;
    }
    const sideBadge=label('SDS MAX','BRUSHLESS',.081,.027,'#f7f1e7','#ae2025');
    if(sideBadge){sideBadge.position.set(.020+side*.064,-.111,-.105);sideBadge.rotation.y=side*Math.PI/2;group.add(sideBadge);}
  }
  const selector=part(group,new THREE.CylinderGeometry(.021,.021,.009,24),graphite,[.020,.053,-.167],'Hammer and rotary mode selector');
  part(group,extrude(roundedRectangle(.025,.007,.003),.008),red,[.020,.060,-.166],'Mode selector raised lever').rotation.x=Math.PI/2;
  part(group,new THREE.BoxGeometry(.004,.002,.009),light,[.020,.061,-.186],'Mode selector index');
  selector.userData.rotaryHammerMode=true;
  const rearBadge=label('SDS MAX','CORDLESS',.068,.027,'#fff8ed','#b32127');
  if(rearBadge){rearBadge.position.set(.011,-.044,.007);group.add(rearBadge);}
  group.userData.housingOnly=true;
  group.userData.cordless=true;
  group.userData.referenceModel='M18 FHACO745 silhouette';
  return metadata(group,[-.028,-.12,.100],[.02,.005,-.60],[-.13,-.005,-.30]);
}

/** Backwards-compatible caller: attach the complete replacement housing once. */
export function addHammerDetails(group: THREE.Group): THREE.Group {
  if(group.getObjectByName('Cordless SDS max housing')) return group;
  const housing=hammer(); housing.name='Cordless SDS max housing'; group.add(housing); return group;
}

export function buildToolModel(kind: ToolModelKind): THREE.Group {
  let group: THREE.Group;
  switch (kind) {
    case 'spray': group = spray(); break;
    case 'trowel': group = trowel(); break;
    case 'spring': group = spring(); break;
    case 'level': group = level(); break;
    case 'cutter': group = cutter(); break;
    case 'hose': group = hose(); break;
    case 'fitting': group = fitting(); break;
    case 'hammer': group = hammer(); break;
  }
  group.name = `Reference model: ${kind}`; group.userData.modelKind = kind;
  return group;
}
