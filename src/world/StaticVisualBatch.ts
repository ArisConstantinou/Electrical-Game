import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Collapse rigid pieces with one shared material into a single visible mesh.
 * The original parts stay in the hierarchy for named anchors and tooling. */
export function batchStaticVisuals(root: THREE.Group, parts: readonly THREE.Object3D[], exclude: (mesh: THREE.Mesh) => boolean = () => false): number {
  root.updateWorldMatrix(true, true);
  const toRoot = root.matrixWorld.clone().invert();
  const grouped = new Map<string, { material: THREE.Material; sources: THREE.Mesh[]; geometries: THREE.BufferGeometry[] }>();
  for (const part of parts) part.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || object instanceof THREE.SkinnedMesh ||
        !object.visible || !(object.layers.mask & 1) || object.userData.editorIgnore ||
        Array.isArray(object.material) || exclude(object) || Object.keys(object.geometry.morphAttributes).length) return;
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    if (geometry.groups.length) geometry.clearGroups();
    const attributes = Object.keys(geometry.attributes).sort().join(',');
    const key = `${object.material.id}:${attributes}:${object.renderOrder}:${object.castShadow}:${object.receiveShadow}`;
    const entry = grouped.get(key) ?? { material: object.material, sources: [] as THREE.Mesh[], geometries: [] as THREE.BufferGeometry[] };
    entry.sources.push(object);
    geometry.applyMatrix4(toRoot.clone().multiply(object.matrixWorld));
    entry.geometries.push(geometry);
    grouped.set(key, entry);
  });
  let saved = 0;
  for (const entry of grouped.values()) {
    if (entry.sources.length < 2) { entry.geometries.forEach(geometry => geometry.dispose()); continue; }
    const geometry = mergeGeometries(entry.geometries, false);
    entry.geometries.forEach(item => item.dispose());
    if (!geometry) continue;
    const combined = new THREE.Mesh(geometry, entry.material);
    combined.name = `${root.name} visible detail batch`;
    combined.castShadow = entry.sources[0].castShadow;
    combined.receiveShadow = entry.sources[0].receiveShadow;
    combined.renderOrder = entry.sources[0].renderOrder;
    combined.raycast = () => undefined;
    combined.userData.editorIgnore = true;
    root.add(combined);
    for (const source of entry.sources) {
      source.visible = false;
    }
    saved += entry.sources.length - 1;
  }
  return saved;
}
