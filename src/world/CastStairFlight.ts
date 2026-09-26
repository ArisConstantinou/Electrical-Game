import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { siteMaterial } from './SiteMaterials';

/** Closed cast stair with eleven real risers and a continuous 22 cm waist. */
export function castStairFlight(name: string, x: number, base: number, reverse: boolean, rise = 1.65): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  const shape = new THREE.Shape();
  const step = rise / 11, run = 3.08;
  shape.moveTo(0, -.22);
  shape.lineTo(0, step);
  for (let i = 1; i <= 11; i++) {
    shape.lineTo(i * .28, i * step);
    if (i < 11) shape.lineTo(i * .28, (i + 1) * step);
  }
  shape.lineTo(run, rise - .22);
  shape.lineTo(0, -.22);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1.38, bevelEnabled: false, curveSegments: 1, steps: 1 });
  const vertices = geometry.getAttribute('position');
  for (let i = 0; i < vertices.count; i++) {
    const horizontal = vertices.getX(i), height = vertices.getY(i), width = vertices.getZ(i);
    vertices.setXYZ(i, x + width - .69, base + height, reverse ? 11.08 - horizontal : 8 + horizontal);
  }
  // Reflection in the reverse flight requires winding correction.
  if (!reverse) for (let i = 0; i < vertices.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(vertices, i);
    const c = new THREE.Vector3().fromBufferAttribute(vertices, i + 2);
    vertices.setXYZ(i, c.x, c.y, c.z); vertices.setXYZ(i + 2, a.x, a.y, a.z);
  }
  geometry.computeVertexNormals();
  const concrete = siteMaterial('floor', 0xd7d1c7);
  const flight = new THREE.Mesh(geometry, concrete);
  flight.name = `${name} continuous structural concrete`;
  flight.castShadow = flight.receiveShadow = true;
  group.add(flight);

  // Two sloping rails and vertical posts follow the actual riser profile.
  // Batched into one mesh per flight, without an invisible gate at either end.
  const pieces: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const bar = (a: THREE.Vector3, b: THREE.Vector3, radius: number): void => {
    const direction = b.clone().sub(a);
    const part = new THREE.CylinderGeometry(radius, radius, direction.length(), 8);
    part.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()));
    part.translate(...a.clone().add(b).multiplyScalar(.5).toArray());
    pieces.push(part);
  };
  for (const edge of [-.74, .74]) {
    const z0 = reverse ? 11.08 : 8, z1 = reverse ? 8 : 11.08;
    for (const height of [.55, 1.05]) bar(new THREE.Vector3(x + edge, base + step + height, z0), new THREE.Vector3(x + edge, base + rise + height, z1), .019);
    for (const t of [0, .5, 1]) {
      const y = base + step + t * (rise - step), z = z0 + t * (z1 - z0);
      bar(new THREE.Vector3(x + edge, y, z), new THREE.Vector3(x + edge, y + 1.06, z), .023);
    }
  }
  const rails = new THREE.Mesh(mergeGeometries(pieces), new THREE.MeshStandardMaterial({color:0xb69b44,roughness:.67,metalness:.28}));
  pieces.forEach(part => part.dispose());
  rails.name = `${name} sloping temporary edge protection`;
  rails.castShadow = true;
  group.add(rails);
  return group;
}
