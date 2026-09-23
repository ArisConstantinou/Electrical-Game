import * as THREE from 'three';
import type { PlayerObstacle } from '../player/EquipmentCollision';

export interface MasonryAim {
  wall: MansionMasonryDemolition;
  index: number;
  point: THREE.Vector3;
  distance: number;
}

export interface MasonryBrickInstance {
  mesh: THREE.InstancedMesh;
  instance: number;
}

/** A light demolition layer for the authored fired-clay walls. The intact wall
 * keeps its original two draw calls; a hit swaps the solid backing for a
 * matching instanced set of mortar cells, so removed bricks leave a real hole. */
export class MansionMasonryDemolition {
  private readonly brickRefs: readonly (MasonryBrickInstance | null)[];
  private readonly original: THREE.Matrix4[] = [];
  private readonly remaining: Uint8Array;
  private readonly localBox: THREE.Box3;
  private readonly inverse = new THREE.Matrix4();
  private readonly localRay = new THREE.Ray();
  private readonly localHit = new THREE.Vector3();
  private readonly temp = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private mortarCells: THREE.InstancedMesh | null = null;
  private removedCount = 0;
  private collisionDirty = false;
  private readonly collisionMatrix = new THREE.Matrix4();
  private readonly intactBounds: [number, number, number, number];

  constructor(
    readonly group: THREE.Group,
    bricks: THREE.InstancedMesh | readonly (MasonryBrickInstance | null)[],
    private readonly backing: THREE.Mesh,
    readonly obstacle: PlayerObstacle,
    private readonly length: number,
    private readonly alongX: boolean,
    private readonly columns: number,
    private readonly rows: number,
  ) {
    this.intactBounds = [obstacle.minX, obstacle.maxX, obstacle.minZ, obstacle.maxZ];
    this.brickRefs = bricks instanceof THREE.InstancedMesh
      ? Array.from({ length: bricks.count }, (_, instance) => ({ mesh: bricks, instance }))
      : bricks;
    this.remaining = new Uint8Array(this.brickRefs.length);
    for (let index = 0; index < this.brickRefs.length; index++) {
      const ref = this.brickRefs[index];
      if (ref) ref.mesh.getMatrixAt(ref.instance, this.temp);
      else this.temp.makeScale(0, 0, 0);
      this.original.push(this.temp.clone());
      this.temp.decompose(this.position, this.rotation, this.scale);
      if (this.scale.y > .001 && (this.alongX ? this.scale.x : this.scale.z) > .001) this.remaining[index] = 1;
    }
    this.localBox = new THREE.Box3(
      new THREE.Vector3(this.alongX ? -length / 2 : -.12, 0, this.alongX ? -.12 : -length / 2),
      new THREE.Vector3(this.alongX ? length / 2 : .12, 3, this.alongX ? .12 : length / 2),
    );
  }

  get damaged(): boolean { return this.removedCount > 0; }
  removedIndices(): number[] {
    const result: number[] = [];
    for (let index = 0; index < this.remaining.length; index++)
      if (!this.remaining[index] && this.originalHasBrick(index)) result.push(index);
    return result;
  }

  private originalHasBrick(index: number): boolean {
    this.original[index].decompose(this.position, this.rotation, this.scale);
    return this.scale.y > .001 && (this.alongX ? this.scale.x : this.scale.z) > .001;
  }

  /** Test only the visible face. A camera ray through a cut-out does not hit
   * an invisible backing and can reach the next wall behind it. */
  aim(camera: THREE.Camera, maxDistance = 2.4, eye?: THREE.Vector3, view?: THREE.Vector3): MasonryAim | null {
    if (!this.group.visible || this.group.parent?.visible === false) return null;
    const origin = eye ?? camera.getWorldPosition(new THREE.Vector3());
    if (this.obstacle.segments?.length !== 0 &&
        (origin.x < this.obstacle.minX - maxDistance || origin.x > this.obstacle.maxX + maxDistance ||
        origin.z < this.obstacle.minZ - maxDistance || origin.z > this.obstacle.maxZ + maxDistance ||
        origin.y < (this.obstacle.minFloorY ?? 0) - maxDistance ||
        origin.y > (this.obstacle.maxFloorY ?? 3) + maxDistance)) return null;
    this.group.updateWorldMatrix(true, false);
    this.inverse.copy(this.group.matrixWorld).invert();
    const direction = view ?? camera.getWorldDirection(new THREE.Vector3());
    this.localRay.origin.copy(origin).applyMatrix4(this.inverse);
    this.localRay.direction.copy(direction).transformDirection(this.inverse);
    if (!this.localRay.intersectBox(this.localBox, this.localHit)) return null;
    const point = this.localHit.clone().applyMatrix4(this.group.matrixWorld);
    const distance = origin.distanceTo(point);
    if (distance > maxDistance || distance < .15) return null;
    const row = Math.min(this.rows - 1, Math.max(0, Math.floor(this.localHit.y / (3 / this.rows))));
    const coordinate = this.alongX ? this.localHit.x : this.localHit.z;
    let best = -1, bestDistance = .31;
    // Running-bond rows have a half brick at one end; use actual instance
    // transforms rather than assuming a rectangular column index.
    for (let testRow = Math.max(0, row - 1); testRow <= Math.min(this.rows - 1, row + 1); testRow++)
      for (let col = 0; col < this.columns; col++) {
        const index = testRow * this.columns + col;
        if (!this.remaining[index]) continue;
        this.original[index].decompose(this.position, this.rotation, this.scale);
        const mid = this.alongX ? this.position.x : this.position.z;
        const half = (this.alongX ? this.scale.x : this.scale.z) / 2;
        const horizontal = Math.max(0, Math.abs(coordinate - mid) - half);
        const vertical = Math.max(0, Math.abs(this.localHit.y - this.position.y) - this.scale.y / 2);
        const score = horizontal + vertical;
        if (score < bestDistance) { bestDistance = score; best = index; }
      }
    return best < 0 ? null : { wall: this, index: best, point, distance };
  }

  strike(index: number): boolean {
    if (!this.remaining[index]) return false;
    this.ensureMortarCells();
    this.remaining[index] = 0;
    this.removedCount++;
    this.collisionDirty = true;
    this.temp.makeScale(0, 0, 0);
    const ref = this.brickRefs[index];
    if (ref) ref.mesh.setMatrixAt(ref.instance, this.temp);
    this.mortarCells!.setMatrixAt(index, this.temp);
    if (ref) {
      ref.mesh.instanceMatrix.needsUpdate = true;
      ref.mesh.computeBoundingSphere();
    }
    this.mortarCells!.instanceMatrix.needsUpdate = true;
    this.mortarCells!.computeBoundingSphere();
    return true;
  }

  restoreRemoved(indices: readonly number[]): void {
    for (const index of indices)
      if (Number.isInteger(index) && index >= 0 && index < this.remaining.length) this.strike(index);
  }

  reset(): void {
    if (!this.damaged) return;
    const changed = new Set<THREE.InstancedMesh>();
    for (let index = 0; index < this.remaining.length; index++) {
      this.remaining[index] = this.originalHasBrick(index) ? 1 : 0;
      const ref = this.brickRefs[index];
      if (ref) {
        ref.mesh.setMatrixAt(ref.instance, this.original[index]);
        changed.add(ref.mesh);
      }
    }
    for (const mesh of changed) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    this.mortarCells?.removeFromParent();
    this.mortarCells?.geometry.dispose();
    this.mortarCells = null;
    this.backing.visible = true;
    this.removedCount = 0;
    this.collisionDirty = false;
    this.obstacle.segments = undefined;
    [this.obstacle.minX, this.obstacle.maxX, this.obstacle.minZ, this.obstacle.maxZ] = this.intactBounds;
  }

  /** Player collision only opens after the full standing-height course has
   * been removed. A head-high nick in a wall cannot become a walk-through. */
  updateGroundCollision(): void {
    if (!this.damaged) return;
    this.group.updateWorldMatrix(true, false);
    if (!this.collisionDirty && this.collisionMatrix.equals(this.group.matrixWorld)) return;
    this.collisionMatrix.copy(this.group.matrixWorld);
    this.collisionDirty = false;
    const cells = Math.ceil(this.length / .12);
    const solid = new Uint8Array(cells);
    for (let row = 0; row < Math.min(this.rows, 16); row++) for (let col = 0; col < this.columns; col++) {
      const index = row * this.columns + col;
      if (!this.remaining[index]) continue;
      this.original[index].decompose(this.position, this.rotation, this.scale);
      const middle = this.alongX ? this.position.x : this.position.z;
      const half = (this.alongX ? this.scale.x : this.scale.z) / 2;
      const from = Math.max(0, Math.floor((middle - half + this.length / 2) / .12));
      const to = Math.min(cells - 1, Math.ceil((middle + half + this.length / 2) / .12));
      for (let cell = from; cell <= to; cell++) solid[cell] = 1;
    }
    const segments: NonNullable<PlayerObstacle['segments']>[number][] = [];
    for (let start = 0; start < cells;) {
      if (!solid[start]) { start++; continue; }
      let end = start + 1;
      while (end < cells && solid[end]) end++;
      const a = this.pointOnWall(-this.length / 2 + start * .12);
      const b = this.pointOnWall(Math.min(this.length / 2, -this.length / 2 + end * .12));
      segments.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, halfWidth: .13 });
      start = end;
    }
    this.obstacle.segments = segments;
    if (!segments.length) {
      this.obstacle.minX = this.obstacle.minZ = Infinity;
      this.obstacle.maxX = this.obstacle.maxZ = -Infinity;
    } else {
      this.obstacle.minX = Math.min(...segments.map(segment => Math.min(segment.ax, segment.bx) - segment.halfWidth));
      this.obstacle.maxX = Math.max(...segments.map(segment => Math.max(segment.ax, segment.bx) + segment.halfWidth));
      this.obstacle.minZ = Math.min(...segments.map(segment => Math.min(segment.az, segment.bz) - segment.halfWidth));
      this.obstacle.maxZ = Math.max(...segments.map(segment => Math.max(segment.az, segment.bz) + segment.halfWidth));
    }
  }

  private pointOnWall(coordinate: number): THREE.Vector3 {
    return new THREE.Vector3(this.alongX ? coordinate : 0, 0, this.alongX ? 0 : coordinate)
      .applyMatrix4(this.group.matrixWorld);
  }

  private ensureMortarCells(): void {
    if (this.mortarCells) return;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const cells = new THREE.InstancedMesh(geometry, this.backing.material, this.brickRefs.length);
    cells.name = `${this.group.name} remaining mortar cells`;
    cells.castShadow = cells.receiveShadow = true;
    for (let index = 0; index < this.brickRefs.length; index++) {
      this.original[index].decompose(this.position, this.rotation, this.scale);
      if (this.originalHasBrick(index)) {
        if (this.alongX) this.scale.set(this.scale.x + .006, 3 / this.rows + .002, .20);
        else this.scale.set(.20, 3 / this.rows + .002, this.scale.z + .006);
        cells.setMatrixAt(index, this.temp.compose(this.position, this.rotation, this.scale));
      } else cells.setMatrixAt(index, this.temp.makeScale(0, 0, 0));
    }
    cells.computeBoundingSphere();
    this.group.add(cells);
    this.backing.visible = false;
    this.mortarCells = cells;
  }
}
