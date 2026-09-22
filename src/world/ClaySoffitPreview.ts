import * as THREE from 'three';
import { brickFacePatch } from './BrickFacePatch';
import { claySoffitFaceMaterial } from './BrickFaceMaterial';
import { siteMaterial } from './SiteMaterials';

/** Optional construction study: exposed clay infill between flush concrete ribs. */
export function createClaySoffitPreview(width: number, depth: number, height: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Clay and concrete ribbed soffit preview';
  group.userData.studioEntityId = 'world:clay-soffit-preview';
  const ribPitch = .64;
  const bays = Math.ceil(width / ribPitch);
  const tilePitch = .25;
  const rows = Math.ceil(depth / tilePitch);
  const tileWidth = width / bays - .105;
  const tileLength = depth / rows - .004;
  const tileCount = bays * rows;
  const tileGeometry = new THREE.BoxGeometry(1, 1, 1);
  const patches = new Float32Array(tileCount * 4);
  tileGeometry.setAttribute('brickPatch', new THREE.InstancedBufferAttribute(patches, 4));
  const tiles = new THREE.InstancedMesh(tileGeometry, claySoffitFaceMaterial, tileCount);
  tiles.name = 'Individual fired-clay ceiling infill units';
  tiles.receiveShadow = true;
  tiles.raycast = () => undefined;
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3(tileWidth, .18, tileLength);
  const position = new THREE.Vector3();
  for (let bay = 0; bay < bays; bay++) for (let row = 0; row < rows; row++) {
    const index = bay * rows + row;
    patches.set(brickFacePatch(row, bay, 4), index * 4);
    position.set(-width / 2 + (bay + .5) * width / bays, height + .09, -depth / 2 + (row + .5) * depth / rows);
    tiles.setMatrixAt(index, matrix.compose(position, rotation, scale));
  }
  tiles.computeBoundingSphere();
  group.add(tiles);

  // Prefabricated ribs are flush with the clay underside, rather than a
  // decorative beam hung below it. The original roof remains above them.
  const ribMaterial = siteMaterial('concrete', 0xe6e2dc, .25, depth / 2);
  ribMaterial.emissive.set(0x827366);
  ribMaterial.emissiveIntensity = .28;
  const ribGeometry = new THREE.BoxGeometry(.105, .18, depth);
  const ribs = new THREE.InstancedMesh(ribGeometry, ribMaterial, bays + 1);
  ribs.name = 'Flush load-bearing concrete ribs';
  ribs.receiveShadow = true;
  ribs.raycast = () => undefined;
  for (let i = 0; i <= bays; i++) {
    position.set(-width / 2 + i * width / bays, height + .09, 0);
    ribs.setMatrixAt(i, matrix.makeTranslation(position.x, position.y, position.z));
  }
  ribs.computeBoundingSphere();
  group.add(ribs);
  return group;
}
