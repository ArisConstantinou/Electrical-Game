import * as THREE from 'three';

export interface StaticInstanceBounds {
  box: THREE.Box3;
  /** Transformed spheres in instance order; union is order-dependent. */
  spheres: Float64Array;
}

/** Cache immutable masonry transforms once, using the uploaded Float32 values.
 * Compaction may change membership, but never these authored transforms. */
export function captureStaticInstanceBounds(geometry: THREE.BufferGeometry, matrices: ArrayLike<number>, start: number, count: number): StaticInstanceBounds {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const box = new THREE.Box3(), transformedBox = new THREE.Box3();
  const matrix = new THREE.Matrix4(), sphere = new THREE.Sphere();
  const spheres = new Float64Array(count * 4);
  for (let index = 0; index < count; index++) {
    matrix.fromArray(matrices, (start + index) * 16);
    box.union(transformedBox.copy(geometry.boundingBox!).applyMatrix4(matrix));
    sphere.copy(geometry.boundingSphere!).applyMatrix4(matrix);
    spheres.set([sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius], index * 4);
  }
  return { box, spheres };
}

/** Preserve Three's exact sphere-union order and its frustum decisions, while
 * avoiding two matrix/geometry scans each time a nearby wall changes batches. */
export function restoreStaticInstanceBounds(mesh: THREE.InstancedMesh, sources: Iterable<StaticInstanceBounds>): void {
  const box = mesh.boundingBox ??= new THREE.Box3();
  const sphere = mesh.boundingSphere ??= new THREE.Sphere();
  box.makeEmpty(); sphere.makeEmpty();
  const instance = new THREE.Sphere();
  for (const source of sources) {
    box.union(source.box);
    for (let offset = 0; offset < source.spheres.length; offset += 4) {
      instance.center.fromArray(source.spheres, offset);
      instance.radius = source.spheres[offset + 3];
      sphere.union(instance);
    }
  }
}
