import * as THREE from 'three';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { MortarSystem } from './MortarSystem';
import { GAME_CONFIG } from '../data/gameConfig';

/** Local visible work surfaces. Cache geometry bounds, never scan mortar nodes per frame. */
export class WorkSurfaceClearance {
  private readonly geometryBounds = new WeakMap<THREE.BufferGeometry, THREE.Box3>();
  private readonly boxBounds = new WeakMap<THREE.Object3D, { local: THREE.Box3; world: THREE.Box3; matrix: THREE.Matrix4 }>();
  private readonly scratch = new THREE.Box3();
  private snapshot: THREE.Box3[] | null = null;

  constructor(private readonly mortar: MortarSystem, private readonly points: InstallationPoint[]) {}

  /** The installed surfaces do not move while a rigid hand/tool pose is
   * solved. Snapshot their bounds once for its many candidate evaluations;
   * all ordinary queries remain live after the callback returns. */
  withSnapshot<T>(run: () => T): T {
    const previous = this.snapshot;
    const bounds: THREE.Box3[] = [];
    this.forEachObstacle(box => bounds.push(box.clone()));
    this.snapshot = bounds;
    try { return run(); } finally { this.snapshot = previous; }
  }

  readonly frontForBounds = (held: THREE.Box3): number | null => {
    if (held.isEmpty()) return null;
    let front: number | null = held.max.x >= -GAME_CONFIG.room.width / 2 && held.min.x <= GAME_CONFIG.room.width / 2
      && held.max.y >= 0 && held.min.y <= GAME_CONFIG.room.height ? GAME_CONFIG.room.wallFrontZ : null;
    const include = (bounds: THREE.Box3): void => {
      if (held.max.x < bounds.min.x || held.min.x > bounds.max.x || held.max.y < bounds.min.y || held.min.y > bounds.max.y) return;
      front = Math.max(front ?? -Infinity, bounds.max.z);
    };
    if (this.snapshot) for (const bounds of this.snapshot) include(bounds);
    else this.forEachObstacle(include);
    return front;
  };

  private forEachObstacle(include: (bounds: THREE.Box3) => void): void {
    for (const deposit of this.mortar.deposits) {
      const mesh = deposit.mesh;
      if (!mesh.visible) continue;
      let local = this.geometryBounds.get(mesh.geometry);
      if (!local) {
        mesh.geometry.computeBoundingBox();
        local = mesh.geometry.boundingBox!.clone();
        this.geometryBounds.set(mesh.geometry, local);
      }
      mesh.updateWorldMatrix(true, false);
      include(this.scratch.copy(local).applyMatrix4(mesh.matrixWorld));
    }
    for (const point of this.points) {
      if (!point.visible || !point.boxGroup.visible) continue;
      for (const box of point.boxGroup.boxes) {
        if (!box.visible) continue;
        box.updateWorldMatrix(true, false);
        let cached = this.boxBounds.get(box);
        if (!cached) {
          box.updateWorldMatrix(true, true);
          const local = new THREE.Box3(), inverse = box.matrixWorld.clone().invert();
          box.traverseVisible(child => {
            if (child instanceof THREE.Mesh) {
              child.geometry.computeBoundingBox();
              local.union(this.scratch.copy(child.geometry.boundingBox!).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, child.matrixWorld)));
            }
          });
          cached = { local, world: local.clone().applyMatrix4(box.matrixWorld), matrix: box.matrixWorld.clone() };
          this.boxBounds.set(box, cached);
        } else if (!cached.matrix.equals(box.matrixWorld)) {
          cached.world.copy(cached.local).applyMatrix4(box.matrixWorld);
          cached.matrix.copy(box.matrixWorld);
        }
        // Only the actual casing: hidden seated levels and selection helpers are not obstacles.
        include(cached.world);
      }
    }
  }
}
