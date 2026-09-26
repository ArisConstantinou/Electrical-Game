import * as THREE from 'three';

/** Cache only authored, stationary construction. Editor entry restores the
 * original update policy before any transform is changed. Geometry/instance
 * edits such as masonry damage do not change an object's world transform. */
export class StaticConstructionTransforms {
  private readonly saved = new Map<THREE.Object3D, [boolean, boolean]>();

  freeze(root: THREE.Object3D): void {
    root.updateWorldMatrix(true, true);
    root.traverse(object => {
      if (this.saved.has(object)) return;
      this.saved.set(object, [object.matrixAutoUpdate, object.matrixWorldAutoUpdate]);
      object.matrixAutoUpdate = false;
      object.matrixWorldAutoUpdate = false;
    });
  }

  restore(): void {
    for (const [object, [local, world]] of this.saved) {
      object.matrixAutoUpdate = local;
      object.matrixWorldAutoUpdate = world;
      object.matrixWorldNeedsUpdate = true;
    }
    this.saved.clear();
  }
}
