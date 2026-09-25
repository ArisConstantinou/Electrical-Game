import * as THREE from 'three';
import type { MansionGroundWing } from './MansionGroundWing';
import type { MansionMasonryDemolition } from './MansionMasonryDemolition';

/** Skip workshop detail only when one unbroken, solid clay wall completely
 * covers its world bounds from the player's eye. Shadow layer 1 remains active
 * so the same geometry still casts into the unchanged sun shadow map. */
export class SiteOcclusion {
  private readonly hidden = new Map<THREE.Mesh, number>();
  private readonly eye = new THREE.Vector3();
  private readonly lastEye = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private readonly bounds = new THREE.Box3();
  private elapsed = 0;
  private dirty = true;
  private readonly geometryVersions = new WeakMap<THREE.BufferGeometry, number>();
  private readonly instanceVersions = new WeakMap<THREE.InstancedMesh, number>();

  constructor(private readonly mansion: MansionGroundWing, private readonly roots: readonly THREE.Object3D[]) {}

  invalidate(): void { this.dirty = true; }

  restore(): void {
    for (const [mesh, mask] of this.hidden) mesh.layers.mask = mask;
    this.hidden.clear();
    this.dirty = true;
  }

  update(camera: THREE.Camera, dt: number): void {
    camera.getWorldPosition(this.eye);
    this.elapsed += dt;
    if (!this.dirty && this.eye.distanceToSquared(this.lastEye) < .01 && this.elapsed < .5) return;
    this.lastEye.copy(this.eye);
    this.elapsed = 0;
    this.dirty = false;
    const occluders = [...this.mansion.masonryDemolition.values()].filter(wall =>
      wall.group.visible && wall.group.parent?.visible !== false && !wall.damaged);
    const visited = new Set<THREE.Mesh>();
    for (const root of this.roots) {
      if (!root.visible) continue;
      root.updateWorldMatrix(true, true);
      root.traverseVisible(object => {
        if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh) return;
        visited.add(object);
        const originalMask = this.hidden.get(object) ?? object.layers.mask;
        if (!(originalMask & 1)) return;
        const geometry = object.geometry;
        if (object instanceof THREE.InstancedMesh) {
          if (!object.boundingBox || this.instanceVersions.get(object) !== object.instanceMatrix.version) {
            object.computeBoundingBox();
            this.instanceVersions.set(object, object.instanceMatrix.version);
          }
          if (!object.boundingBox) return;
          this.bounds.copy(object.boundingBox).applyMatrix4(object.matrixWorld);
        } else {
          const version = geometry.getAttribute('position')?.version ?? 0;
          if (!geometry.boundingBox || this.geometryVersions.get(geometry) !== version) {
            geometry.computeBoundingBox();
            this.geometryVersions.set(geometry, version);
          }
          if (!geometry.boundingBox) return;
          this.bounds.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld);
        }
        // A moving or oddly shaped mesh can extend beyond a tight box. Only
        // cull when every corner lies safely behind the same opaque wall.
        this.bounds.expandByScalar(.025);
        const covered = !this.bounds.containsPoint(this.eye) && occluders.some(wall => this.coversBounds(wall, this.bounds));
        if (covered) {
          if (!this.hidden.has(object)) this.hidden.set(object, originalMask);
          object.layers.set(1);
        } else if (this.hidden.has(object)) {
          object.layers.mask = this.hidden.get(object)!;
          this.hidden.delete(object);
        }
      });
    }
    for (const [mesh, mask] of this.hidden) if (!visited.has(mesh)) {
      mesh.layers.mask = mask;
      this.hidden.delete(mesh);
    }
  }

  private coversBounds(wall: MansionMasonryDemolition, box: THREE.Box3): boolean {
    const { obstacle } = wall;
    const alongX = obstacle.maxX - obstacle.minX > obstacle.maxZ - obstacle.minZ;
    const plane = alongX ? (obstacle.minZ + obstacle.maxZ) / 2 : (obstacle.minX + obstacle.maxX) / 2;
    const eyeAxis = alongX ? this.eye.z : this.eye.x;
    const floor = obstacle.minFloorY ?? wall.group.position.y;
    const ceiling = obstacle.maxFloorY ?? floor + 3;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const pointAxis = alongX ? z : x;
      const distance = pointAxis - eyeAxis;
      if (Math.abs(distance) < 1e-5) return false;
      const t = (plane - eyeAxis) / distance;
      if (t <= .02 || t >= .98) return false;
      const crossX = this.eye.x + (x - this.eye.x) * t;
      const crossY = this.eye.y + (y - this.eye.y) * t;
      const crossZ = this.eye.z + (z - this.eye.z) * t;
      if (crossY <= floor + .03 || crossY >= ceiling - .03 ||
          (alongX ? crossX <= obstacle.minX + .03 || crossX >= obstacle.maxX - .03
                  : crossZ <= obstacle.minZ + .03 || crossZ >= obstacle.maxZ - .03)) return false;
    }
    return true;
  }
}
