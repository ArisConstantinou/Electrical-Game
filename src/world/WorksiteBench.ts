import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const textureLoader = new THREE.TextureLoader();
const asset = (name: string) => `${import.meta.env.BASE_URL}assets/site-materials/${name}`;

/** A weathered temporary electrician's bench. All parts are grouped for Studio. */
export function createWorksiteBench(): THREE.Group {
  const bench = new THREE.Group();
  bench.name = 'Temporary timber electrician workbench';
  bench.userData.studioEntityId = 'world:temporary-electrician-bench';

  const grain = textureLoader.load(asset('wooden_planks-albedo-512.webp'));
  grain.colorSpace = THREE.SRGBColorSpace;
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.anisotropy = 4;
  const relief = textureLoader.load(asset('wooden_planks-normal-512.webp'));
  relief.wrapS = relief.wrapT = THREE.RepeatWrapping;
  relief.anisotropy = 4;
  const wood = new THREE.MeshStandardMaterial({
    name: 'Weathered CC0 site timber', map: grain, normalMap: relief,
    normalScale: new THREE.Vector2(.28, .28), color: 0xe1d3bd,
    roughness: .93, metalness: 0,
  });
  const endGrain = new THREE.MeshStandardMaterial({
    name: 'Exposed cut timber ends', color: 0x8a755b, roughness: .99,
  });
  const steel = new THREE.MeshStandardMaterial({ color: 0x575a58, roughness: .66, metalness: .68 });
  const darkCase = new THREE.MeshStandardMaterial({ color: 0x242b2e, roughness: .72, metalness: .03 });
  const caseRib = new THREE.MeshStandardMaterial({ color: 0x151a1c, roughness: .86, metalness: .04 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe7ad20, roughness: .54, metalness: .08 });

  const part = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material,
    x: number, y: number, z: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.raycast = () => undefined;
    mesh.userData.levelEditorPickThrough = true;
    bench.add(mesh);
    return mesh;
  };
  const board = (name: string, length: number, height: number, depth: number,
    x: number, y: number, z: number, material = wood): THREE.Mesh =>
    part(name, new RoundedBoxGeometry(length, height, depth, 2, .004), material, x, y, z);

  // True separate boards, squared sawn ends, paired trestles and an open lower
  // shelf give the bench a construction-site silhouette at first-person range.
  for (let index = 0; index < 4; index++) {
    const x = (index - 1.5) * .326;
    board(`Scuffed top plank ${index + 1}`, .316, .046, .60, x, .815, 0);
    for (const end of [-1, 1]) board('Visible timber end grain', .012, .045, .598,
      x + end * .154, .815, 0, endGrain);
  }
  for (const x of [-.53, .53]) for (const z of [-.225, .225]) {
    board('Rough timber leg', .075, .78, .075, x, .39, z);
    board('Galvanized leg foot', .082, .018, .082, x, .013, z, steel);
  }
  for (const z of [-.225, .225]) {
    board('Longitudinal timber stretcher', 1.20, .072, .055, 0, .53, z);
    board('Low shelf edge', 1.20, .044, .055, 0, .21, z);
  }
  for (let index = 0; index < 3; index++) {
    board(`Lower storage plank ${index + 1}`, 1.17, .027, .138, 0, .225, (index - 1) * .145);
  }
  for (const x of [-.53, .53]) {
    board('Trestle cross brace', .062, .37, .045, x, .44, 0).rotation.x = x < 0 ? .48 : -.48;
  }

  // The tool case has a raised lid, continuous handle, pressed ribs and
  // separate metal latches; the level can be read as a tool even at a glance.
  board('Black site tool case', .43, .205, .245, -.32, .941, .015, darkCase);
  board('Case raised lid', .45, .045, .262, -.32, 1.061, .015, caseRib);
  for (const x of [-.49, -.15]) {
    board('Steel case latch', .031, .048, .01, x, 1.025, .15, steel);
    board('Case side rib', .013, .146, .26, x, .945, .015, caseRib);
  }
  const handle = part('Moulded carry handle', new THREE.TorusGeometry(.066, .009, 7, 18, Math.PI),
    darkCase, -.32, 1.127, .015);
  handle.rotation.z = Math.PI;

  board('Aluminium spirit level body', .37, .026, .046, .29, .857, -.12, steel);
  board('Spirit level yellow end cap', .023, .031, .051, .104, .857, -.12, yellow);
  board('Spirit level yellow end cap', .023, .031, .051, .476, .857, -.12, yellow);
  part('Spirit level vial window', new THREE.CylinderGeometry(.018, .018, .065, 14),
    new THREE.MeshStandardMaterial({ color: 0xbacb8b, roughness: .22, metalness: .04 }),
    .29, .877, -.12).rotation.z = Math.PI / 2;

  const fasteners = new THREE.InstancedMesh(new THREE.CylinderGeometry(.005, .005, .0025, 8), steel, 16);
  fasteners.name = 'Countersunk timber fasteners';
  const matrix = new THREE.Matrix4();
  let instance = 0;
  for (const x of [-.53, -.20, .13, .46]) for (const z of [-.235, .235])
    for (const offset of [-.018, .018]) fasteners.setMatrixAt(instance++, matrix.makeTranslation(x + offset, .84, z));
  fasteners.raycast = () => undefined;
  fasteners.userData.levelEditorPickThrough = true;
  fasteners.computeBoundingSphere();
  bench.add(fasteners);

  // Keep the bench as one movable/editable Studio asset, while batching each
  // static material family so the close-up detail costs only a few draw calls.
  for (const material of [wood, endGrain, steel, darkCase, caseRib, yellow]) {
    const pieces = bench.children.filter((child): child is THREE.Mesh =>
      child instanceof THREE.Mesh && !(child instanceof THREE.InstancedMesh) && child.material === material);
    if (pieces.length < 2) continue;
    const transformed = pieces.map(piece => {
      piece.updateMatrix();
      const original = piece.geometry.clone().applyMatrix4(piece.matrix);
      if (!original.index) return original;
      const triangles = original.toNonIndexed();
      original.dispose();
      return triangles;
    });
    const geometry = mergeGeometries(transformed, false);
    transformed.forEach(part => part.dispose());
    if (!geometry) continue;
    pieces.forEach(piece => { bench.remove(piece); piece.geometry.dispose(); });
    const combined = new THREE.Mesh(geometry, material);
    combined.name = `Workbench ${material.name || 'construction detail'}`;
    combined.castShadow = combined.receiveShadow = true;
    combined.raycast = () => undefined;
    combined.userData.levelEditorPickThrough = true;
    bench.add(combined);
  }

  bench.position.set(-3.28, 0, 1.77);
  bench.rotation.y = Math.PI / 2;
  return bench;
}
