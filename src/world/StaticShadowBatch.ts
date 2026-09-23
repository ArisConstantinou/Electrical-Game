import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Combine only rigid, opaque shadow casters beneath one movable root.
 * Source meshes remain separate for materials, selection and gameplay; their
 * single-depth copy follows the root without entering the visible camera. */
export function batchStaticShadows(root: THREE.Group, parts: readonly THREE.Object3D[]): number {
  root.updateWorldMatrix(true, true);
  const toRoot = root.matrixWorld.clone().invert();
  const sources: THREE.Mesh[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  for (const part of parts) part.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || object instanceof THREE.SkinnedMesh ||
      !object.castShadow || !object.visible || Object.keys(object.geometry.morphAttributes).length) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some(material => material.transparent || material.alphaTest > 0 || material.side !== THREE.FrontSide)) return;
    let geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    for (const name of Object.keys(geometry.attributes)) if (name !== 'position') geometry.deleteAttribute(name);
    geometry.clearGroups();
    geometry.applyMatrix4(toRoot.clone().multiply(object.matrixWorld));
    geometries.push(geometry);
    sources.push(object);
  });
  if (sources.length < 2) { geometries.forEach(geometry => geometry.dispose()); return 0; }
  const geometry = mergeGeometries(geometries);
  geometries.forEach(item => item.dispose());
  if (!geometry) return 0;
  const caster = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  caster.name = `${root.name} static shadow batch`;
  caster.layers.set(1); // Sun's shadow camera sees this; game/editor cameras stay on layer 0.
  caster.castShadow = true;
  caster.raycast = () => undefined;
  caster.userData.editorIgnore = true;
  root.add(caster);
  for (const source of sources) source.castShadow = false;
  return sources.length - 1;
}
