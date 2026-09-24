import * as THREE from 'three';
import { siteMaterial } from './SiteMaterials';

type Cluster = { x: number; z: number; spreadX: number; spreadZ: number; clay: number; mortar: number };

// Dust and broken masonry collect where people cut the wall, work at the bench,
// and mix material. The clear middle of the room remains a usable walk route.
const clusters: Cluster[] = [
  { x: -2.05, z: -2.03, spreadX: .64, spreadZ: .32, clay: 36, mortar: 13 },
  { x: .15, z: -2.05, spreadX: .72, spreadZ: .33, clay: 32, mortar: 14 },
  { x: -2.72, z: 1.73, spreadX: .40, spreadZ: .52, clay: 15, mortar: 9 },
  { x: .85, z: 2.35, spreadX: .80, spreadZ: .52, clay: 5, mortar: 30 },
];

const random = (index: number, salt: number): number => {
  let value = Math.imul(index + 1, 0x7feb352d) ^ Math.imul(salt + 3, 0x846ca68b);
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
};

/** One angular shell fragment, with a raised broken edge and true thickness. */
const shardGeometry = (): THREE.BufferGeometry => {
  const outline: Array<[number, number]> = [
    [-.55, -.30], [-.23, -.47], [.31, -.40], [.57, -.12], [.45, .29], [.04, .46], [-.38, .33],
  ];
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (const [x, z] of outline) {
    positions.push(x, .14, z);
    uvs.push(x + .55, z + .5);
  }
  for (const [x, z] of outline) {
    positions.push(x * .86, -.14, z * .86);
    uvs.push(x + .55, z + .5);
  }
  const count = outline.length;
  for (let i = 1; i < count - 1; i++) indices.push(0, i + 1, i, count, count + i, count + i + 1);
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    indices.push(i, next, count + i, next, count + next, count + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  flat.computeVertexNormals();
  return flat;
};

export function createSiteFloorDebris(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Brick rubble';
  group.userData.studioEntityId = 'world:site-clay-rubble';
  group.userData.siteFloorDebris = true;
  const geometry = shardGeometry();
  const placement = new THREE.Matrix4(), position = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), size = new THREE.Vector3();
  const color = new THREE.Color(), vertex = new THREE.Vector3();
  const points = geometry.getAttribute('position');
  const clayPhoto = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/masonry/human-laid-brick-face-atlas-v3.png`);
  clayPhoto.colorSpace = THREE.SRGBColorSpace;
  clayPhoto.wrapS = clayPhoto.wrapT = THREE.ClampToEdgeWrapping;
  clayPhoto.repeat.set(.48, .23);
  clayPhoto.offset.set(.01, .01);
  clayPhoto.anisotropy = 4;
  const clay = new THREE.MeshStandardMaterial({ name: 'Photographed fractured fired clay',
    map: clayPhoto, color: 0xdec7b7, roughness: .96, metalness: 0, flatShading: true });
  for (const [kind, material, total] of [
    ['clay', clay, 88],
    ['mortar', siteMaterial('concrete', 0xb4aa9d), 66],
  ] as const) {
    const mesh = new THREE.InstancedMesh(geometry, material, total);
    mesh.name = kind === 'clay' ? 'Angular fired-clay shell offcuts' : 'Broken mortar and concrete crumbs';
    mesh.userData.levelEditorPickThrough = true;
    mesh.raycast = () => undefined;
    mesh.castShadow = mesh.receiveShadow = true;
    let index = 0;
    for (const [clusterIndex, cluster] of clusters.entries()) {
      const count = kind === 'clay' ? cluster.clay : cluster.mortar;
      for (let item = 0; item < count; item++, index++) {
        const seed = index + clusterIndex * 431 + (kind === 'mortar' ? 8237 : 0);
        const x = cluster.x + (random(seed, 0) - random(seed, 1)) * cluster.spreadX;
        const z = cluster.z + (random(seed, 2) - random(seed, 3)) * cluster.spreadZ;
        const long = kind === 'clay' ? .042 + random(seed, 4) * .092 : .012 + random(seed, 4) * .038;
        const narrow = kind === 'clay' ? .022 + random(seed, 5) * .051 : .011 + random(seed, 5) * .032;
        const height = kind === 'clay' ? .022 + random(seed, 6) * .034 : .008 + random(seed, 6) * .022;
        position.set(0, 0, 0);
        const tipped = random(seed, 11) < .17;
        rotation.setFromEuler(new THREE.Euler(
          (random(seed, 7) - .5) * (tipped ? .95 : .14), random(seed, 8) * Math.PI * 2,
          (random(seed, 9) - .5) * (tipped ? .95 : .14),
        ));
        size.set(long, height, narrow);
        placement.compose(position, rotation, size);
        let lowest = Infinity;
        for (let vertexIndex = 0; vertexIndex < points.count; vertexIndex++)
          lowest = Math.min(lowest, vertex.fromBufferAttribute(points, vertexIndex).applyMatrix4(placement).y);
        position.set(x, -lowest + .001, z);
        mesh.setMatrixAt(index, placement.compose(position, rotation, size));
        const tone = .68 + random(seed, 10) * .30;
        const dust = random(seed, 12);
        color.setRGB(tone, tone * (kind === 'clay' ? .86 + dust * .20 : .99),
          tone * (kind === 'clay' ? .80 + dust * .22 : .96));
        mesh.setColorAt(index, color);
      }
    }
    if (index !== total) throw new Error(`Floor debris count mismatch for ${kind}: ${index}/${total}`);
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  // A few larger offcuts expose the same four longitudinal chambers as the
  // laid units. Their holes are real geometry, visible at the broken ends.
  const section = new THREE.Shape();
  section.moveTo(-.5, -.5);
  section.lineTo(.5, -.5);
  section.lineTo(.5, .5);
  section.lineTo(-.5, .5);
  section.closePath();
  for (const x of [-.23, .23]) for (const y of [-.23, .23]) {
    const chamber = new THREE.Path();
    chamber.absarc(x, y, .17, 0, Math.PI * 2, true);
    section.holes.push(chamber);
  }
  const offcutGeometry = new THREE.ExtrudeGeometry(section, {
    depth: 1, steps: 1, bevelEnabled: false, curveSegments: 10,
  });
  offcutGeometry.translate(0, 0, -.5);
  const offcuts = new THREE.InstancedMesh(offcutGeometry, clay, 6);
  offcuts.name = 'Four-chamber broken clay block offcuts';
  offcuts.userData.levelEditorPickThrough = true;
  offcuts.raycast = () => undefined;
  offcuts.castShadow = offcuts.receiveShadow = true;
  const places: Array<[number, number]> = [
    [-2.25, -2.13], [-1.96, -1.96], [-1.77, -2.21],
    [-.15, -2.10], [.19, -1.98], [.43, -2.20],
  ];
  for (const [index, [x, z]] of places.entries()) {
    position.set(x, .039 + index % 3 * .003, z);
    rotation.setFromEuler(new THREE.Euler((index % 2 ? 1 : -1) * .10,
      (index - 2.5) * .16, (index % 3 - 1) * .09));
    size.set(.084 + index % 3 * .006, .074, .092 + index % 2 * .020);
    offcuts.setMatrixAt(index, placement.compose(position, rotation, size));
    const tone = .85 + index % 3 * .045;
    offcuts.setColorAt(index, color.setRGB(tone, tone * .97, tone * .94));
  }
  offcuts.computeBoundingSphere();
  group.add(offcuts);
  return group;
}
