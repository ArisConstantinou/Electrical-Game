import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// A visual reference for two construction states. Circuit ratings, connections
// and protective-device selection are deliberately outside this model.
export type BoardVisualStage = 'first-fix' | 'second-fix';

const plaster = new THREE.MeshStandardMaterial({ color: 0xe9e7e0, roughness: .98 });
const cutPlaster = new THREE.MeshStandardMaterial({ color: 0xb8b5ab, roughness: 1 });
const cabinet = new THREE.MeshStandardMaterial({ color: 0xd9dfe0, metalness: .28, roughness: .52 });
const inner = new THREE.MeshStandardMaterial({ color: 0xbfc8ca, metalness: .2, roughness: .69 });
const steel = new THREE.MeshStandardMaterial({ color: 0x929b9c, metalness: .74, roughness: .39 });
const breaker = new THREE.MeshStandardMaterial({ color: 0xe4e5e1, roughness: .7 });
const breakerShade = new THREE.MeshStandardMaterial({ color: 0xbec3c3, roughness: .8 });
const blueToggle = new THREE.MeshStandardMaterial({ color: 0x326585, roughness: .55 });
const leverRecess = new THREE.MeshStandardMaterial({ color: 0x929a9b, roughness: .86 });
const indicator = new THREE.MeshStandardMaterial({ color: 0xbd773d, roughness: .72 });
const conduit = new THREE.MeshStandardMaterial({ color: 0xe3e2d9, roughness: .82, side: THREE.DoubleSide });
const voidMaterial = new THREE.MeshStandardMaterial({ color: 0x42474b, roughness: 1 });
const copper = new THREE.MeshStandardMaterial({ color: 0xac8153, metalness: .64, roughness: .42 });
const conductor = {
  line: new THREE.MeshStandardMaterial({ color: 0x735344, roughness: .76 }),
  neutral: new THREE.MeshStandardMaterial({ color: 0x315d91, roughness: .76 }),
  earth: new THREE.MeshStandardMaterial({ color: 0x328349, roughness: .76 }),
  earthStripe: new THREE.MeshStandardMaterial({ color: 0xc6bb40, roughness: .76 }),
};

function part(parent: THREE.Group, name: string, geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[], x: number, y: number, z: number): THREE.Mesh {
  const item = new THREE.Mesh(geometry, material);
  item.name = name;
  item.position.set(x, y, z);
  item.castShadow = item.receiveShadow = true;
  parent.add(item);
  return item;
}

function box(parent: THREE.Group, name: string, w: number, h: number, d: number,
  material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  return part(parent, name, new THREE.BoxGeometry(w, h, d), material, x, y, z);
}

function round(parent: THREE.Group, name: string, radius: number, depth: number,
  material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const screw = part(parent, name, new THREE.CylinderGeometry(radius, radius, depth, 12), material, x, y, z);
  screw.rotation.x = Math.PI / 2;
  return screw;
}

function lead(parent: THREE.Group, name: string, material: THREE.Material,
  points: [number, number, number][], radius = .0024): void {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  part(parent, name, new THREE.TubeGeometry(curve, 20, radius, 5, false), material, 0, 0, 0);
}

function bottomWithRealEntries(parent: THREE.Group): void {
  // The cable mouths go through the bottom return, as in the site photo.
  // They are holes in the panel geometry, never dark discs laid on its face.
  const shape = new THREE.Shape();
  shape.moveTo(-.305, -.0415);
  shape.lineTo(.305, -.0415);
  shape.lineTo(.305, .0415);
  shape.lineTo(-.305, .0415);
  shape.closePath();
  for (let i = 0; i < 7; i++) {
    const hole = new THREE.Path();
    hole.absarc(-.225 + i * .075, 0, .017, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const returnPanel = part(parent, 'Perforated cabinet bottom return',
    new THREE.ExtrudeGeometry(shape, { depth: .009, bevelEnabled: false, curveSegments: 20 }),
    cabinet, 0, -.3865, -.039);
  returnPanel.rotation.x = -Math.PI / 2;
  for (let i = 0; i < 7; i++) {
    const x = -.225 + i * .075;
    const rim = part(parent, 'Pressed cable-entry lip',
      new THREE.TorusGeometry(.017, .0015, 6, 20), steel, x, -.376, -.039);
    rim.rotation.x = -Math.PI / 2;
    if (![0, 2, 5].includes(i)) continue;
    const sleeve = part(parent, 'Open first-fix conduit sleeve',
      new THREE.CylinderGeometry(.0118, .0118, .051, 20, 1, true), conduit,
      x, -.383, -.039);
    sleeve.castShadow = false;
    const mouth = part(parent, 'Conduit mouth with hollow centre',
      new THREE.TorusGeometry(.0115, .0023, 6, 20), conduit, x, -.356, -.039);
    mouth.rotation.x = -Math.PI / 2;
  }
}

function pressedBackDetails(parent: THREE.Group): void {
  // Shallow manufacturing features remain behind the rails and fit the empty
  // first-fix enclosure too: folded stiffeners, standoffs and scored knockouts.
  for (const x of [-.245, .245]) {
    box(parent, 'Cabinet back pressed stiffener', .012, .68, .003, cabinet, x, 0, -.075);
    for (const y of [-.30, .30]) {
      round(parent, 'DIN support standoff', .0075, .005, steel, x, y, -.071);
      round(parent, 'Support screw head', .003, .001, voidMaterial, x, y, -.067);
    }
  }
  for (const y of [-.315, .315])
    box(parent, 'Cabinet back folded stiffener', .50, .008, .003, cabinet, 0, y, -.075);
  for (const x of [-.17, .0, .17]) {
    const score = part(parent, 'Unpunched rear knockout score',
      new THREE.TorusGeometry(.018, .0008, 5, 20), steel, x, .335, -.075);
    score.castShadow = false;
  }
}

function plasterReveal(parent: THREE.Group): void {
  const frame = new THREE.Shape();
  frame.moveTo(-.43, -.51);
  frame.lineTo(.43, -.51);
  frame.lineTo(.43, .51);
  frame.lineTo(-.43, .51);
  frame.closePath();
  // The cut is hand made, with shallow chips concentrated at corners rather
  // than a uniform noise border around the entire cabinet.
  const cut = new THREE.Path();
  const corners: [number, number][] = [
    [-.318, -.387], [-.299, -.389], [-.298, -.405], [-.278, -.394],
    [-.106, -.392], [.10, -.394], [.286, -.397], [.311, -.380],
    [.309, -.20], [.309, .02], [.307, .23], [.314, .38],
    [.287, .399], [.266, .391], [.12, .392], [-.11, .395],
    [-.285, .393], [-.311, .380], [-.308, .20], [-.309, -.12],
  ];
  cut.moveTo(...corners[0]);
  for (const point of corners.slice(1)) cut.lineTo(...point);
  cut.closePath();
  frame.holes.push(cut);
  const edge = part(parent, 'Uneven hand-cut plaster opening',
    new THREE.ExtrudeGeometry(frame, { depth: .012, bevelEnabled: false }),
    [plaster, cutPlaster], 0, 0, -.085);
  edge.receiveShadow = true;
  for (const [x, y] of [[-.322, .389], [.315, .388], [-.314, -.392], [.316, -.395]]) {
    box(parent, 'Small exposed plaster chip', .019, .008, .003, cutPlaster, x, y, -.071);
  }
}

function terminalBar(parent: THREE.Group, side: -1 | 1, count: number): void {
  const x = side * .267;
  box(parent, side < 0 ? 'Neutral terminal bar' : 'Earth terminal bar', .021, .31, .011,
    copper, x, -.137, .041);
  for (let i = 0; i < count; i++) {
    const y = -.275 + i * .027;
    round(parent, 'Terminal clamp screw', .0038, .002, steel, x, y, .048);
    round(parent, 'Terminal bore', .0025, .001, voidMaterial, x, y - .009, .048);
  }
}

function deviceFaceStrip(parent: THREE.Group, y: number, count: number, startX: number): void {
  const canvas = document.createElement('canvas');
  canvas.width = count * 72;
  canvas.height = 112;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = '#e9ebe8';
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < count; i++) {
    const left = i * 72;
    context.fillStyle = '#a4abac';
    context.fillRect(left, 0, 2, 112);
    context.fillStyle = '#31596e';
    context.fillRect(left + 10, 10, 28, 5);
    context.fillStyle = '#656b69';
    context.fillRect(left + 10, 25, 42, 3);
    context.fillRect(left + 10, 33, 33, 3);
    context.fillStyle = '#b1b6b5';
    context.fillRect(left + 10, 45, 48, 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const strip = part(parent, 'Unrated device markings and casing seams',
    new THREE.PlaneGeometry(count * .033, .023),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    startX + (count - 1) * .033 / 2, y + .012, .0385);
  strip.castShadow = false;
}

function breakerRow(parent: THREE.Group, y: number, count: number, startX: number): number[] {
  const xValues: number[] = [];
  const moduleWidth = .033;
  for (let i = 0; i < count; i++) {
    const x = startX + i * moduleWidth;
    xValues.push(x);
    part(parent, 'DIN mounted protective device casing',
      new RoundedBoxGeometry(.0315, .073, .061, 2, .0016), breaker, x, y, .006);
    box(parent, 'Lower terminal moulding', .030, .014, .004, breakerShade, x, y - .025, .039);
    box(parent, 'Recessed lever well', .020, .019, .001, leverRecess, x, y - .008, .038);
    box(parent, 'Blue device lever', .017, .013, .009, blueToggle, x, y - .008, .043);
    box(parent, 'Lever hinge shadow', .020, .002, .001, voidMaterial, x, y - .015, .048);
    box(parent, 'Warm lever status strip', .018, .0018, .001, indicator, x, y - .018, .047);
    round(parent, 'Upper terminal screw', .003, .002, steel, x, y + .028, .040);
    round(parent, 'Lower terminal screw', .003, .002, steel, x, y - .031, .040);
    box(parent, 'Unmarked device legend field', .024, .012, .0006, plaster, x, y + .010, .037);
    if (i === 0 && count > 10) {
      box(parent, 'Wider main-device surround', .049, .075, .002, inner, x - .008, y, -.026);
    }
  }
  deviceFaceStrip(parent, y, count, startX);
  return xValues;
}

function batchStaticVisual(root: THREE.Group): void {
  root.userData.sourcePartCount = root.children.length;
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const child of [...root.children]) {
    if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue;
    child.updateMatrix();
    const transformed = child.geometry.clone().applyMatrix4(child.matrix);
    const geometry = transformed.index ? transformed.toNonIndexed() : transformed;
    if (geometry !== transformed) transformed.dispose();
    const parts = buckets.get(child.material) ?? [];
    parts.push(geometry);
    buckets.set(child.material, parts);
    root.remove(child);
    child.geometry.dispose();
  }
  for (const [material, parts] of buckets) {
    const geometry = mergeGeometries(parts, false);
    parts.forEach(part => part.dispose());
    if (!geometry) throw new Error('Distribution board visual geometry could not be batched');
    const combined = new THREE.Mesh(geometry, material);
    combined.name = 'Batched distribution board visual details';
    combined.castShadow = combined.receiveShadow = true;
    root.add(combined);
  }
}

export function createDistributionBoardVisual(stage: BoardVisualStage): THREE.Group {
  const root = new THREE.Group();
  root.name = stage === 'first-fix' ? 'Distribution board · first-fix empty enclosure'
    : 'Distribution board · second-fix visual reference';
  root.userData.visualReferenceOnly = true;
  root.userData.stage = stage;
  plasterReveal(root);

  // Recessed enclosure and rail supports: the open front shows actual depth.
  box(root, 'Recessed cabinet back', .604, .764, .009, inner, 0, 0, -.082);
  pressedBackDetails(root);
  for (const x of [-.302, .302]) box(root, 'Cabinet side return', .009, .764, .083, cabinet, x, 0, -.039);
  box(root, 'Cabinet top return', .61, .009, .083, cabinet, 0, .382, -.039);
  bottomWithRealEntries(root);
  for (const x of [-.30, .30]) box(root, 'Cabinet front lip', .014, .778, .004, cabinet, x, 0, .004);
  for (const y of [-.388, .388]) box(root, 'Cabinet front lip', .612, .014, .004, cabinet, 0, y, .004);
  for (const x of [-.275, .275]) for (const y of [-.35, .35]) {
    round(root, 'Cabinet fixing screw', .004, .002, steel, x, y, -.073);
  }
  if (stage === 'first-fix') {
    root.userData.circuitDesignAssigned = false;
    batchStaticVisual(root);
    return root;
  }

  for (const y of [.163, -.122, -.317]) {
    box(root, 'Galvanized DIN rail', .486, .025, .008, steel, -.012, y, -.039);
    box(root, 'DIN rail upper lip', .486, .003, .014, steel, -.012, y + .011, -.031);
    for (let i = 0; i < 12; i++)
      box(root, 'DIN rail perforation', .012, .004, .001, voidMaterial, -.226 + i * .039, y, -.033);
  }
  terminalBar(root, -1, 11);
  terminalBar(root, 1, 11);
  const upper = breakerRow(root, .188, 14, -.227);
  const lower = breakerRow(root, -.10, 8, -.21);

  // Loose visible conductor runs reproduce the photo's visual language. They
  // carry no simulated voltage, rating or invented circuit topology.
  for (let i = 0; i < upper.length; i++) {
    const x = upper[i];
    const start = -.23 + (i % 7) * .075;
    lead(root, 'Unterminated visible conductor', i % 3 === 0 ? conductor.neutral : conductor.line,
      [[start, -.35, -.015], [start + .008, -.275, -.006], [x + .012, -.02, .002], [x, .145, .039]], .0018);
  }
  for (let i = 0; i < lower.length; i++) {
    const x = lower[i];
    lead(root, 'Lower row conductor', i % 3 === 1 ? conductor.neutral : conductor.line,
      [[-.19 + i * .056, -.35, -.012], [-.18 + i * .05, -.28, -.002], [x, -.15, .040]], .0018);
  }
  for (let i = 0; i < 8; i++) {
    const x = -.19 + i * .055;
    const y = -.266 + i * .027;
    const points: [number, number, number][] = [
      [x, -.35, -.019], [x + .014, -.305, -.012], [.222, -.30 + i * .002, .002],
      [.238, y, .024], [.267, y, .049],
    ];
    lead(root, 'Green earth conductor to side terminal bar', conductor.earth, points, .0018);
    lead(root, 'Yellow marking along earth conductor', conductor.earthStripe,
      points.map(([px, py, pz]) => [px, py, pz + .0015]), .0007);
  }
  root.userData.circuitDesignAssigned = false;
  batchStaticVisual(root);
  return root;
}
