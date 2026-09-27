import * as THREE from 'three';
import { CONSTRUCTION_DEFAULTS } from '../data/constructionDefaults';

/** Use the same ordinary transforms as the editor; preserve a face/centre anchor. */
export function fitBrickDepth(object: THREE.Object3D, axis: 'x' | 'z', baseDepth: number, anchor: number): void {
  const point = new THREE.Vector3(); point[axis] = anchor;
  const before = object.localToWorld(point.clone());
  object.scale[axis] *= CONSTRUCTION_DEFAULTS.brickDepth / baseDepth;
  object.updateWorldMatrix(true, false);
  const after = object.localToWorld(point);
  if (object.parent) object.position.add(object.parent.worldToLocal(before).sub(object.parent.worldToLocal(after)));
  else object.position.add(before.sub(after));
  object.updateWorldMatrix(true, true);
}

/** Preserve height and along-wall width; set the normal depth, including both
 * normals at a corner. Opening supports can explicitly request both normals. */
export function fitColumns(root: THREE.Object3D, walls: readonly THREE.Group[] = []): void {
  const columns: THREE.Mesh[] = [];
  root.traverse(object => {
    if (object instanceof THREE.Mesh && !(object instanceof THREE.InstancedMesh) &&
        /\b(column|jamb|pier|support|supporting|reveal)\b/i.test(object.name) && !/masonry|clay|mortar|lintel/i.test(object.name)) columns.push(object);
  });
  for (const mesh of columns) {
    mesh.geometry.computeBoundingBox(); const box = mesh.geometry.boundingBox!;
    const size = box.getSize(new THREE.Vector3()); if (size.y < 1) continue;
    const oldBounds = new THREE.Box3().setFromObject(mesh),oldSize = oldBounds.getSize(new THREE.Vector3());
    const centre = oldBounds.getCenter(new THREE.Vector3());
    const matches = new Map<'x'|'z', { distance: number; centre: number }>();
    for (const wall of walls) {
      if (oldBounds.max.y <= wall.position.y + .01 ||
          oldBounds.min.y >= wall.position.y + (wall.userData.height ?? 3) - .01) continue;
      const normal = wall.userData.alongX ? 'z' : 'x', along = normal === 'z' ? 'x' : 'z';
      const distance = Math.abs(centre[normal] - wall.position[normal]);
      if (distance > .18 || Math.abs(centre[along] - wall.position[along]) > wall.userData.length / 2 + .18) continue;
      if (!matches.has(normal) || matches.get(normal)!.distance > distance) matches.set(normal, { distance, centre: wall.position[normal] });
    }
    const axes: ('x'|'z')[] = mesh.userData.constructionColumnAxes ?? (matches.size ? [...matches.keys()] : ['z']);
    mesh.userData.constructionColumnAxes = axes;
    mesh.userData.constructionLegacySize = oldSize.toArray();
    mesh.userData.constructionLegacyPosition = mesh.userData.constructionOriginalPosition ?? centre.toArray();
    for (const axis of axes) {
      mesh.scale[axis] *= CONSTRUCTION_DEFAULTS.columnDepth / oldSize[axis];
      if (matches.has(axis)) centre[axis] = matches.get(axis)!.centre;
    }
    if (mesh.parent) mesh.position.copy(mesh.parent.worldToLocal(centre)); else mesh.position.copy(centre);
    mesh.userData.constructionDefaultPosition = centre.toArray();
    mesh.updateWorldMatrix(true, false);
  }
}
