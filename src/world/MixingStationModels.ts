import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, mix, texture as sampleTexture, uv, vec3 } from 'three/tsl';
import { createConcreteMixer, createWheelbarrow, type WheelbarrowModel } from './SiteEquipmentModels';
import { SandPileSimulation } from './SandPileSimulation';

type Point = readonly [number, number, number];
const material = (color: number, roughness = .8, metalness = 0): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const steel = (): THREE.MeshStandardMaterial => material(0x9ca5a2, .34, .76);
let sandScan: THREE.Texture | null = null;
function sandAlbedo(): THREE.Texture {
  if (sandScan) return sandScan;
  sandScan = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/site-materials/gravelly_sand-albedo-512.webp`);
  sandScan.colorSpace = THREE.SRGBColorSpace;
  sandScan.wrapS = sandScan.wrapT = THREE.RepeatWrapping;
  sandScan.anisotropy = 4;
  return sandScan;
}

function part(parent: THREE.Object3D, geometry: THREE.BufferGeometry, mat: THREE.Material, at: Point, name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(...at); mesh.name = name; mesh.userData.studioEntityId = `mixing:${name}`;
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}

function rod(parent: THREE.Object3D, from: Point, to: Point, radius: number, mat: THREE.Material, name: string): THREE.Mesh {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), delta = b.clone().sub(a);
  const mesh = part(parent, new THREE.CylinderGeometry(radius, radius, delta.length(), 12), mat, [0, 0, 0], name);
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return mesh;
}

function tube(parent: THREE.Object3D, points: THREE.Vector3[], radius: number, mat: THREE.Material, name: string): THREE.Mesh {
  return part(parent, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.max(24, points.length * 2), radius, 8), mat, [0, 0, 0], name);
}

function label(parent: THREE.Object3D, title: string, subtitle: string, width: number, height: number, at: Point, color = '#244b38'): THREE.Mesh | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 256;
  const context = canvas.getContext('2d'); if (!context) return null;
  context.fillStyle = '#e9e2cc'; context.fillRect(0, 0, 768, 256);
  context.fillStyle = color; context.fillRect(0, 0, 768, 18); context.fillRect(0, 238, 768, 18);
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.font = '900 82px Arial'; context.fillText(title, 384, 100, 730);
  context.font = '600 36px Arial'; context.fillText(subtitle, 384, 188, 730);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return part(parent, new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: texture, roughness: .9 }), at, `${title}-label`);
}

/** Floor origin; real double-walled, open tapered bucket, with a folding wire handle. */
function bucketModel(color: number, name: string): { bucket: THREE.Group; fill: THREE.Mesh } {
  const bucket = new THREE.Group(); bucket.name = name; bucket.userData.studioEntityId = `mixing:${name}`;
  const plastic = material(color, .6), dark = material(0x202b25, .9);
  const profile = [[0, .009], [.138, .009], [.147, .021], [.183, .306], [.184, .318], [.173, .318], [.172, .307], [.138, .025], [0, .025]];
  part(bucket, new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(...p as [number, number])), 48), plastic, [0, 0, 0], `${name}-open-plastic-wall`);
  const rim = part(bucket, new THREE.TorusGeometry(.179, .008, 8, 48), plastic, [0, .313, 0], `${name}-rolled-rim`); rim.rotation.x = Math.PI / 2;
  for (const side of [-1, 1]) {
    part(bucket, new THREE.BoxGeometry(.021, .033, .031), plastic, [side * .179, .276, 0], `${name}-handle-lug-${side}`);
    const rivet = part(bucket, new THREE.CylinderGeometry(.008, .008, .025, 12), steel(), [side * .184, .278, 0], `${name}-handle-pivot-${side}`); rivet.rotation.z = Math.PI / 2;
  }
  // Handle folds toward the front so the mixer has a clear opening.
  const handlePoints = Array.from({ length: 25 }, (_, i) => {
    const angle = i / 24 * Math.PI;
    return new THREE.Vector3(Math.cos(angle) * .188, .278 - Math.sin(angle) * .065, Math.sin(angle) * .20);
  });
  tube(bucket, handlePoints, .003, steel(), `${name}-galvanized-handle`);
  rod(bucket, [-.045, .215, .20], [.045, .215, .20], .010, dark, `${name}-handle-grip`);
  for (let i = 1; i <= 3; i++) {
    part(bucket, new THREE.BoxGeometry(.027, .004, .003), material(0xb5cbb9), [-.051, .065 + i * .06, .148 + i * .007], `${name}-volume-mark-${i}`);
  }
  label(bucket, '20 L', 'GARDEN / MIX', .11, .047, [.025, .157, .167]);
  const fillMaterial = material(0x8b8979, .96);
  if (name === 'mixing-garden-bucket') {
    // Fine aggregate remains visible after blending; no external texture or canvas is needed.
    const size = 128, grains = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const noise = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      const shade = 85 + Math.floor((noise - Math.floor(noise)) * 130);
      grains.set([shade, shade, shade, 255], i * 4);
    }
    const texture = new THREE.DataTexture(grains, size, size);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.needsUpdate = true;
    fillMaterial.bumpMap = texture; fillMaterial.bumpScale = 0;
  }
  const fill = part(bucket, new THREE.RingGeometry(0, 1, 64, 24), fillMaterial, [0, .029, 0], `${name}-contents`);
  fill.rotation.x = -Math.PI / 2; fill.scale.setScalar(.138); fill.visible = false;
  fill.userData.emptyY = .029; fill.userData.fullY = .289;
  (fill.geometry.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
  fill.userData.dryIngredients = false;
  if (name === 'mixing-garden-bucket') {
    const aggregate = new THREE.Group(); aggregate.name = 'mixing-dry-aggregate'; aggregate.visible = false; fill.add(aggregate);
    for (let i = 0; i < 9; i++) {
      const angle = i * 2.39996, radius = .27 + (i % 3) * .19;
      const dry = material(i % 2 ? 0xbca373 : 0xa09d89, 1); dry.transparent = true; dry.depthWrite = false;
      const patch = part(aggregate, new THREE.SphereGeometry(1, 10, 5), dry, [Math.cos(angle) * radius, Math.sin(angle) * radius, .018], `dry-aggregate-patch-${i}`);
      patch.scale.set(.12 + (i % 3) * .028, .09 + (i % 2) * .035, .022); patch.rotation.z = angle;
      patch.userData.baseAngle = angle; patch.userData.baseRadius = radius;
    }
  }
  return { bucket, fill };
}

/** Shaft runs along +Y; blade tip at origin, hand grip near y=1.05. */
export function createShovelModel(): THREE.Group {
  const group = new THREE.Group(); group.name = 'mixing-shovel'; group.userData.studioEntityId = 'mixing:shovel';
  const metal = steel(), black = material(0x222a26), wood = material(0x987048, .74);
  const blade = new THREE.Shape();
  blade.moveTo(-.087, .27); blade.lineTo(.087, .27); blade.quadraticCurveTo(.13, .17, .105, .045);
  blade.quadraticCurveTo(0, -.008, -.105, .045); blade.quadraticCurveTo(-.13, .17, -.087, .27);
  const geometry = new THREE.ExtrudeGeometry(blade, { depth: .004, bevelEnabled: true, bevelSize: .003, bevelThickness: .0015, bevelSegments: 1, steps: 1, curveSegments: 10 });
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) positions.setZ(i, positions.getZ(i) + Math.pow(positions.getX(i) / .12, 2) * .035);
  geometry.computeVertexNormals(); part(group, geometry, metal, [0, 0, 0], 'shovel-dished-steel-blade');
  rod(group, [0, .20, .012], [0, .43, .024], .022, metal, 'shovel-forged-socket');
  rod(group, [0, .34, .022], [0, .98, .022], .018, wood, 'shovel-ash-shaft');
  rod(group, [0, .95, .022], [-.063, 1.08, .022], .014, black, 'shovel-D-left');
  rod(group, [0, .95, .022], [.063, 1.08, .022], .014, black, 'shovel-D-right');
  rod(group, [-.063, 1.08, .022], [.063, 1.08, .022], .020, black, 'shovel-D-grip');
  const loadGeometry = new THREE.SphereGeometry(1, 22, 12);
  const grains = loadGeometry.getAttribute('position');
  for (let i = 0; i < grains.count; i++) {
    const x = grains.getX(i), y = grains.getY(i), z = grains.getZ(i);
    const rough = 1 + .075 * Math.sin(x * 17 + y * 11) * Math.cos(y * 23 - z * 9);
    grains.setXYZ(i, x * rough, y * rough, z * rough);
  }
  loadGeometry.computeVertexNormals();
  const load = part(group, loadGeometry, new THREE.MeshStandardMaterial({ map: sandAlbedo(), roughness: 1 }), [0, .145, .052], 'shovel-sand-load');
  load.scale.set(.103, .107, .040); load.visible = false; load.userData.shovelLoadPart = true;
  group.userData.gripPoint = [0, 1.08, .022]; group.userData.secondaryGripPoint = [0, .60, .022]; group.userData.tipPoint = [0, .055, .022];
  group.userData.gripQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(-1,0,0)).toArray();
  group.userData.secondaryGripQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI).toArray();
  return group;
}

/** Compact cordless stirrer with a protected motor, two load-bearing handles and an axial paddle. */
export function createMixerModel(): THREE.Group {
  const group = new THREE.Group(); group.name = 'mixing-cordless-mixer'; group.userData.studioEntityId = 'mixing:cordless-mixer';
  const caseGreen = material(0x3f685c, .58, .08), rubber = material(0x303735, .92);
  const frame = material(0x899494, .43, .63), darkMetal = material(0x434e4e, .43, .57), metal = steel();
  const profile: [number, number][] = [
    [0, .638], [.047, .638], [.054, .652], [.060, .688], [.065, .706],
    [.067, .747], [.066, .790], [.061, .809], [.055, .822], [0, .822],
  ];
  part(group, new THREE.LatheGeometry(profile.map(([radius, height]) => new THREE.Vector2(radius, height)), 32), caseGreen, [0, 0, 0], 'mixer-sculpted-motor-housing');
  part(group, new THREE.CylinderGeometry(.051, .058, .068, 24), darkMetal, [0, .650, 0], 'mixer-cast-aluminium-gearbox');
  part(group, new THREE.CylinderGeometry(.026, .023, .043, 20), darkMetal, [0, .589, 0], 'mixer-keyed-shaft-coupling');
  for (const y of [.664, .691, .814]) {
    const ring = part(group, new THREE.TorusGeometry(y === .691 ? .065 : .062, .002, 6, 32), darkMetal, [0, y, 0], `mixer-case-seam-${y}`);
    ring.rotation.x = Math.PI / 2;
  }
  for (let i = 0; i < 5; i++) {
    part(group, new THREE.BoxGeometry(.044, .004, .003), rubber, [-.022, .722 + i * .011, -.074], `mixer-motor-vent-${i}`);
  }
  for (const side of [-1, 1] as const) {
    const label = side < 0 ? 'left' : 'right';
    const x = side < 0 ? -.20 : .156, y = side < 0 ? .706 : .780;
    const outer = side < 0 ? -.282 : .266;
    const upper = side < 0 ? .832 : .886, lower = side < 0 ? .650 : .718;
    tube(group, [new THREE.Vector3(side * .063, upper, -.005), new THREE.Vector3(side * .12, upper + .018, -.005), new THREE.Vector3(outer, upper, -.005), new THREE.Vector3(outer + side * .01, y, -.005), new THREE.Vector3(outer, lower, -.005), new THREE.Vector3(side * .071, lower, -.005)], .011, frame, `mixer-${label}-protective-handle-frame`);
    rod(group, [side * .095, y, 0], [outer, y, 0], .025, rubber, `mixer-${label}-rubber-grip`);
    for (let ridge = 0; ridge < 4; ridge++) {
      const gripX = x + side * (ridge - 1.5) * .017;
      const band = part(group, new THREE.TorusGeometry(.0255, .0012, 5, 12), darkMetal, [gripX, y, 0], `mixer-${label}-grip-ridge-${ridge}`);
      band.rotation.y = Math.PI / 2;
    }
  }
  part(group, new THREE.BoxGeometry(.055, .014, .032), rubber, [.115, .751, -.019], 'mixer-variable-speed-trigger');
  part(group, new THREE.CylinderGeometry(.013, .013, .012, 16), darkMetal, [-.074, .791, -.044], 'mixer-speed-dial');
  const batteryRail = part(group, new THREE.BoxGeometry(.094, .022, .082), darkMetal, [0, .837, 0], 'mixer-top-battery-rail');
  batteryRail.geometry.computeVertexNormals();
  part(group, new THREE.BoxGeometry(.112, .059, .090), rubber, [0, .876, 0], 'mixer-protected-18V-battery');
  part(group, new THREE.BoxGeometry(.056, .008, .044), caseGreen, [0, .910, 0], 'mixer-battery-release-slide');
  const batteryLabel = label(group, '18 V', 'CORDLESS', .081, .028, [0, .877, -.046], '#25463e');
  if (batteryLabel) batteryLabel.rotation.y = Math.PI;
  const paddle = new THREE.Group(); paddle.name = 'mixing-paddle'; paddle.userData.studioEntityId = 'mixing:paddle'; group.add(paddle);
  rod(paddle, [0, .064, 0], [0, .579, 0], .008, metal, 'mixer-steel-shaft');
  for (let helix = 0; helix < 2; helix++) {
    const points = Array.from({ length: 45 }, (_, i) => {
      const t = i / 44, angle = t * Math.PI * 2 + helix * Math.PI;
      return new THREE.Vector3(Math.cos(angle) * .065, .031 + t * .145, Math.sin(angle) * .065);
    });
    tube(paddle, points, .008, metal, `mixer-spiral-paddle-${helix}`);
    rod(paddle, [0, .037, 0], [Math.cos(helix * Math.PI) * .065, .037, 0], .006, metal, `mixer-paddle-base-spoke-${helix}`);
    rod(paddle, [0, .175, 0], [Math.cos(helix * Math.PI) * .065, .175, 0], .006, metal, `mixer-paddle-top-spoke-${helix}`);
  }
  const guard = part(paddle, new THREE.TorusGeometry(.066, .005, 6, 32), metal, [0, .029, 0], 'mixer-paddle-bottom-ring'); guard.rotation.x = Math.PI / 2;
  const coating = new THREE.Group(); coating.name = 'mixer-mortar-coating'; coating.visible = false;
  const paste = material(0x8a8877, .92);
  for (const child of paddle.children) if (child instanceof THREE.Mesh && child.name !== 'mixer-steel-shaft') {
    const shell = child.clone(); shell.material = paste; shell.name = `${child.name}-mortar-coating`;
    shell.userData.studioEntityId = `mixing:${shell.name}`; shell.scale.multiplyScalar(1.055); coating.add(shell);
  }
  rod(coating, [0, .063, 0], [0, .255, 0], .010, paste, 'mixer-shaft-mortar-coating'); paddle.add(coating);
  // Keep the motor and hands below the worker's crouched eye line; the axial
  // shaft still enters the gearbox rather than ending in open air.
  for (const child of group.children) if (child !== paddle) child.position.y -= .07;
  group.userData.gripPoint = [.156, .710, 0]; group.userData.secondaryGripPoint = [-.20, .636, 0]; group.userData.tipPoint = [0, .08, 0];
  group.userData.gripQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(-.156,-.026,0).normalize()).toArray();
  group.userData.secondaryGripQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(1,0,0)).toArray();
  return group;
}

function sandMound(): SandPileSimulation {
  const mat = new MeshStandardNodeMaterial({roughness:1,metalness:0});
  mat.name = 'Scanned construction sand and warm fine aggregate';
  const scan = sandAlbedo();
  const fineSand = new THREE.Color(0xe0c393);
  mat.colorNode = mix(vec3(fineSand.r,fineSand.g,fineSand.b),sampleTexture(scan,uv()).rgb,.66).mul(attribute<'vec3'>('color','vec3'));
  return new SandPileSimulation(mat);
}

function cementSack(index: number): THREE.Group {
  const sack = new THREE.Group(); sack.name = `mixing-cement-sack-${index}`; sack.userData.studioEntityId = `mixing:cement-sack-${index}`;
  const paper = material(0xc0ae89, .99), ink = material(0x366350, .95);
  const geometry = new THREE.BoxGeometry(.35, .20, .54, 10, 6, 12), positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const end = Math.pow(Math.abs(z) / .27, 4), side = Math.pow(Math.abs(x) / .175, 4);
    positions.setXYZ(i, x * (1 - end * .15), y * (1 - end * .55 - side * .2) + .005 * Math.sin(z * 60 + x * 35), z);
  }
  geometry.computeVertexNormals(); part(sack, geometry, paper, [0, .11, 0], `cement-sack-${index}-kraft-paper`);
  for (const end of [-1, 1]) part(sack, new THREE.BoxGeometry(.292, .006, .014), paper, [0, .106, end * .266], `cement-sack-${index}-folded-seam-${end}`);
  const branding = label(sack, 'CEMENT', '25 kg · KEEP DRY', .285, .17, [0, .212, -.035]); if (branding) branding.rotation.x = -Math.PI / 2;
  for (const x of [-.14, .14]) part(sack, new THREE.BoxGeometry(.02, .003, .32), ink, [x, .206, -.015], `cement-sack-${index}-print-stripe-${x}`);
  const opening = new THREE.Group(); opening.name = 'cement-sack-opening'; opening.visible = false; sack.add(opening);
  const hole = part(opening, new THREE.CircleGeometry(.072, 20), material(0x565647), [0, .201, .17], `cement-sack-${index}-cut-opening`); hole.rotation.x = -Math.PI / 2; hole.scale.set(1.55, .68, 1);
  const powder = part(opening, new THREE.CircleGeometry(.056, 20), material(0x949382), [0, .204, .17], `cement-sack-${index}-visible-cement`); powder.rotation.x = -Math.PI / 2; powder.scale.set(1.6, .63, 1);
  for (const side of [-1, 1]) {
    const flap = part(opening, new THREE.BoxGeometry(.17, .002, .037), paper, [0, .211, .17 + side * .04], `cement-sack-${index}-torn-flap-${side}`); flap.rotation.x = side * .5;
  }
  return sack;
}

export interface MixingStationModels {
  wheelbarrow: WheelbarrowModel;
  concreteMixer: THREE.Group;
  group: THREE.Group;
  bucket: THREE.Group;
  fill: THREE.Mesh;
  sand: SandPileSimulation;
  sacks: THREE.Group[];
  shovel: THREE.Group;
  mixer: THREE.Group;
  paddle: THREE.Group;
  rinse: THREE.Group;
  water: THREE.Group;
}

export function createMixingStationModels(): MixingStationModels {
  const group = new THREE.Group(); group.name = 'mortar-mixing-station'; group.userData.studioEntityId = 'mixing:station';
  const wheelbarrow=createWheelbarrow();wheelbarrow.group.position.set(-1.15,0,-1.85);group.add(wheelbarrow.group);
  // Open horseshoe: paired mixers at the back, sand left, cement/water right.
  // Keep the middle aisle clear for the worker and a wheelbarrow.
  const concreteMixer=createConcreteMixer();concreteMixer.position.set(-.55,0,.73);concreteMixer.rotation.y=0;concreteMixer.scale.x=-1;group.add(concreteMixer);
  const { bucket, fill } = bucketModel(0x344b37, 'mixing-garden-bucket'); bucket.position.set(.90,0,.08);group.add(bucket);
  const sand = sandMound(); sand.position.set(-2.40, 0, 0); group.add(sand);
  const sacks = Array.from({ length: 3 }, (_, i) => { const sack = cementSack(i); sack.position.set(2.05 + i * .28, i === 1 ? .19 : 0, .65); sack.rotation.y = -.10 + i * .17; group.add(sack); return sack; });
  const shovel = createShovelModel(); shovel.position.set(-1.55, .13, -.25); shovel.rotation.set(-.13, -.3, -.32); group.add(shovel);
  // Park the paddle inside the green mixing bucket, above its base. This is
  // only its resting transform; taking/using it still requires interaction.
  const mixer = createMixerModel(); mixer.position.copy(bucket.position).add(new THREE.Vector3(0,.06,0)); group.add(mixer);
  const paddle = mixer.getObjectByName('mixing-paddle') as THREE.Group;
  const rinseParts = bucketModel(0x548492, 'mixing-rinse-pail'); const rinse = rinseParts.bucket; rinse.position.set(2.20, 0, -.03); rinse.scale.setScalar(.8);
  rinseParts.fill.visible = true; rinseParts.fill.position.y = .23; rinseParts.fill.scale.setScalar(.162);
  const water = rinseParts.fill.material as THREE.MeshStandardMaterial; water.color.setHex(0x81bfc9); water.roughness = .17; water.transparent = true; water.opacity = .82;
  group.add(rinse);
  const jug = new THREE.Group(); jug.name = 'mixing-water-jug'; jug.userData.studioEntityId = 'mixing:water-source'; jug.position.set(2.15, 0, -.65); group.add(jug);
  jug.userData.gripPoint = [.10, .30, 0]; jug.userData.secondaryGripPoint = [-.04, .18, 0]; jug.userData.tipPoint = [-.027, .39, 0];
  const jugPlastic = material(0xb9d4cf, .49), capPlastic = material(0x28798c, .45);
  part(jug, new THREE.BoxGeometry(.205, .30, .14), jugPlastic, [0, .16, 0], 'water-jug-body');
  part(jug, new THREE.CylinderGeometry(.045, .091, .052, 16), jugPlastic, [-.027, .333, 0], 'water-jug-shoulder');
  part(jug, new THREE.CylinderGeometry(.028, .028, .027, 16), capPlastic, [-.027, .372, 0], 'water-jug-screw-cap');
  tube(jug, [new THREE.Vector3(.039, .30, 0), new THREE.Vector3(.077, .358, 0), new THREE.Vector3(.125, .349, 0), new THREE.Vector3(.12, .255, 0), new THREE.Vector3(.097, .235, 0)], .012, jugPlastic, 'water-jug-carry-handle');
  label(jug, 'WATER', '5 L · REFILL', .17, .085, [0, .178, .071], '#28798c');
  return { group, bucket, fill, sand, sacks, shovel, mixer, paddle, rinse, water: jug, wheelbarrow, concreteMixer };
}

/** Contents always remain inside the tapered wall. One disk is reused for water, dry ingredients and mortar. */
export function setMixingStationFill(models: Pick<MixingStationModels, 'fill'>, litres: number, color = 0x8b8979): void {
  const fraction = THREE.MathUtils.clamp(litres / 20, 0, 1), fill = models.fill;
  fill.visible = fraction > .0001; fill.position.y = .029 + fraction * .26;
  fill.scale.setScalar(.138 + fraction * .032);
  (fill.material as THREE.MeshStandardMaterial).color.setHex(color);
}

export function setCementSackOpen(sack: THREE.Group, open: boolean): void {
  const opening = sack.getObjectByName('cement-sack-opening'); if (opening) opening.visible = open;
  sack.userData.open = open;
}

/** Works with station and held copies. The visible sand rests on the concave blade. */
export function setShovelLoaded(shovel: THREE.Group, loaded: boolean): void {
  const load = shovel.getObjectByName('shovel-sand-load'); if (load) load.visible = loaded;
  shovel.userData.loaded = loaded;
}

/** Toggle an actual mortar coating around the paddle and lower shaft, including cloned held models. */
export function setMixerDirty(mixer: THREE.Group, dirty: boolean): void {
  const coating = mixer.getObjectByName('mixer-mortar-coating'); if (coating) coating.visible = dirty;
  mixer.userData.dirty = dirty;
}

/**
 * Call once per rendered frame, progress in [0,1] and time in seconds. Set
 * models.fill.userData.dryIngredients = true after the first dry scoop (false for water only).
 * No per-frame geometry/material allocations. Mixed paste retains folds when the paddle stops.
 */
export function updateMixingSurface(models: Pick<MixingStationModels, 'fill'>, progress: number, spinning: boolean, time: number): void {
  const fill = models.fill; if (!fill.visible) return;
  const mixed = THREE.MathUtils.clamp(progress, 0, 1), scale = Math.max(.01, fill.scale.x);
  const solids = !!fill.userData.dryIngredients;
  const paste = solids ? .35 + mixed * .65 : 0;
  const mat = fill.material as THREE.MeshStandardMaterial;
  mat.roughness = solids ? .97 : .28;
  mat.bumpScale = solids ? .0016 : 0;
  const depth = Math.min(.017, Math.max(0, fill.position.y - .029) * .42);
  const positions = fill.geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), radius = Math.min(1, Math.hypot(x, y)), angle = Math.atan2(y, x);
    // Both depression and crests fade to zero at the rim to preserve containment.
    const envelope = Math.sin(radius * Math.PI);
    // Stiff mortar holds broad paddle furrows and smaller irregular crests at rest.
    // Cartesian detail avoids a singular seam or spikes at the disk centre.
    const folds = paste * (.007 * Math.sin(x * 13 + Math.sin(y * 9) * 1.8) * Math.cos(y * 11 - x * 4) * envelope
      + .0018 * Math.sin(radius * 19 + angle * 2 + Math.sin(x * 12)) * envelope
      + .003 * Math.sin(x * 37 + Math.sin(y * 19)) * Math.cos(y * 29) * (1 - radius)
      + .006 * (1 - radius));
    const depression = spinning ? -depth * (1 - paste * .72) * (1 - radius) ** 2 : 0;
    const ripple = spinning ? Math.sin(angle * 3 + radius * 13 - time * (solids ? 2.8 : 7)) * .0026 * envelope : 0;
    positions.setZ(i, (folds + depression + ripple) / scale);
  }
  positions.needsUpdate = true; fill.geometry.computeVertexNormals();
  const aggregate = fill.getObjectByName('mixing-dry-aggregate');
  if (aggregate) {
    aggregate.visible = !!fill.userData.dryIngredients && mixed < .98;
    const remaining = 1 - mixed;
    for (const child of aggregate.children) if (child instanceof THREE.Mesh) {
      const angle = Number(child.userData.baseAngle) + (spinning ? time * 1.6 : 0), radius = Number(child.userData.baseRadius);
      child.position.x = Math.cos(angle) * radius; child.position.y = Math.sin(angle) * radius;
      child.position.z = .018 + (spinning ? -depth * (1 - radius) ** 2 / scale : 0);
      (child.material as THREE.MeshStandardMaterial).opacity = remaining;
      child.scale.z = .022 * remaining;
    }
  }
}
