import * as THREE from 'three';
import type { PlayerObstacle } from '../player/EquipmentCollision';
import { hollowClayEndMaterial, hollowClayEndShapes } from './HollowClayEnd';
import { MasonryVolume, MaterialId, type MasonrySave } from './MasonryVolume';
import { damagedMasonryMaterial } from './BrickFaceMaterial';

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
export interface MansionBrickDamage { index: number; save: MasonrySave }
interface BrokenBrick { volume: MasonryVolume; mesh: THREE.Mesh; origin: THREE.Vector3; rotation: THREE.Quaternion; originalSolidNodes: number }

/** A light demolition layer for the authored fired-clay walls. The intact wall
 * keeps its original two draw calls; a hit swaps the solid backing for a
 * matching instanced set of mortar cells, so removed bricks leave a real hole. */
export class MansionMasonryDemolition {
  private readonly brickRefs: readonly (MasonryBrickInstance | null)[];
  private readonly original: THREE.Matrix4[] = [];
  private readonly remaining: Uint8Array;
  private readonly broken = new Map<number, BrokenBrick>();
  private readonly localBox: THREE.Box3;
  private readonly inverse = new THREE.Matrix4();
  private readonly localRay = new THREE.Ray();
  private readonly localHit = new THREE.Vector3();
  private readonly temp = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private mortarCells: THREE.InstancedMesh | null = null;
  private fractureCaps: THREE.InstancedMesh[] | null = null;
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

  get damaged(): boolean { return this.removedCount > 0 || this.broken.size > 0; }
  get partialDamageCount(): number { return this.broken.size; }
  get removedClayNodes(): number { let count = 0; for (const entry of this.broken.values()) count += entry.volume.removedNodeCount; return count; }
  damageSnapshot(): MansionBrickDamage[] {
    return [...this.broken].map(([index, entry]) => ({ index, save: entry.volume.serialize() }));
  }
  get fractureCapCount(): number {
    return this.fractureCaps?.reduce((count, mesh) => count + mesh.count, 0) ?? 0;
  }
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
    if (best < 0) return null;
    const broken = this.broken.get(best);
    if (!broken) return { wall: this, index: best, point, distance };
    const rayOrigin = this.localRay.origin.clone().sub(broken.origin).applyQuaternion(broken.rotation.clone().invert());
    const rayDirection = this.localRay.direction.clone().applyQuaternion(broken.rotation.clone().invert());
    const contact = broken.volume.raycast(rayOrigin, rayDirection, maxDistance);
    if (!contact) return null;
    const exact = new THREE.Vector3(contact.point.x, contact.point.y, contact.point.z)
      .applyQuaternion(broken.rotation).add(broken.origin).applyMatrix4(this.group.matrixWorld);
    return { wall: this, index: best, point: exact, distance: origin.distanceTo(exact) };
  }

  /** The original work wall's material lattice is allocated only for bricks
   * actually struck. The intact instanced wall stays cheap and unchanged. */
  strikeAt(index: number, camera: THREE.Camera): boolean {
    if (!this.remaining[index]) return false;
    let entry = this.broken.get(index);
    if (!entry) entry = this.createBrokenBrick(index);
    this.group.updateWorldMatrix(true, false);
    this.inverse.copy(this.group.matrixWorld).invert();
    const origin = camera.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.inverse)
      .sub(entry.origin).applyQuaternion(entry.rotation.clone().invert());
    const wallDirection = camera.getWorldDirection(new THREE.Vector3()).transformDirection(this.inverse);
    const direction = wallDirection.clone().applyQuaternion(entry.rotation.clone().invert());
    const contact = entry.volume.raycast(origin, direction, 2.4);
    if (!contact) { if (!this.broken.has(index)) { entry.mesh.removeFromParent(); entry.mesh.geometry.dispose(); } return false; }
    const result = entry.volume.impact({ point: contact.point, direction, chisel: 'pointed', energyJ: 5 });
    if (!result.contact || (!result.removedNodes && !result.stats.weakenedNodes)) {
      if (!this.broken.has(index)) { entry.mesh.removeFromParent(); entry.mesh.geometry.dispose(); }
      return false;
    }
    this.broken.set(index, entry);
    this.fractureAcrossJoint(index, new THREE.Vector3(contact.point.x, contact.point.y, contact.point.z)
      .applyQuaternion(entry.rotation).add(entry.origin), wallDirection);
    // The four hollow bores are air from the start. A threshold based on the
    // bounding box discarded a visibly substantial clay shell at 48% of that
    // box, making a struck brick suddenly disappear. Retire it only when its
    // actual original clay lattice is almost completely gone.
    if (entry.volume.removedNodeCount >= entry.originalSolidNodes * .94)
      return this.strike(index);
    if (entry.volume.removedNodeCount) this.showBrokenBrick(index, entry);
    return true;
  }

  /** A pointed impact has a finite footprint. Continue that same material
   * fracture into adjacent fired-clay units only where the footprint reaches
   * their real laid edge; no random brick-level damage or whole-unit removal. */
  private fractureAcrossJoint(index: number, wallPoint: THREE.Vector3, wallDirection: THREE.Vector3): void {
    const row = Math.floor(index / this.columns), col = index % this.columns;
    const coordinate = this.alongX ? wallPoint.x : wallPoint.z;
    let affected = 0;
    for (let r = Math.max(0, row - 1); r <= Math.min(this.rows - 1, row + 1); r++)
      for (let c = Math.max(0, col - 2); c <= Math.min(this.columns - 1, col + 2); c++) {
        const neighbor = r * this.columns + c;
        if (neighbor === index || !this.remaining[neighbor]) continue;
        this.original[neighbor].decompose(this.position, this.rotation, this.scale);
        const width = this.alongX ? this.scale.x : this.scale.z;
        const dx = Math.max(0, Math.abs(coordinate - (this.alongX ? this.position.x : this.position.z)) - width / 2);
        const dy = Math.max(0, Math.abs(wallPoint.y - this.position.y) - this.scale.y / 2);
        const distance = Math.hypot(dx, dy);
        if (distance >= .038) continue;
        const fresh = !this.broken.has(neighbor);
        const entry = this.broken.get(neighbor) ?? this.createBrokenBrick(neighbor);
        const inverseRotation = entry.rotation.clone().invert();
        const point = wallPoint.clone().sub(entry.origin).applyQuaternion(inverseRotation);
        point.x = THREE.MathUtils.clamp(point.x, -entry.volume.width / 2 + .009, entry.volume.width / 2 - .009);
        point.y = THREE.MathUtils.clamp(point.y, .009, entry.volume.height - .009);
        const direction = wallDirection.clone().applyQuaternion(inverseRotation);
        const result = entry.volume.impact({ point, direction, chisel: 'pointed',
          energyJ: 1.4 + 2.2 * (1 - distance / .038) });
        if (!result.contact || (!result.removedNodes && !result.stats.weakenedNodes)) {
          if (fresh) { entry.mesh.removeFromParent(); entry.mesh.geometry.dispose(); }
          continue;
        }
        this.broken.set(neighbor, entry);
        if (entry.volume.removedNodeCount >= entry.originalSolidNodes * .94) this.strike(neighbor);
        else if (entry.volume.removedNodeCount) this.showBrokenBrick(neighbor, entry);
        if (++affected === 3) return;
      }
  }

  restoreDamage(entries: readonly MansionBrickDamage[]): void {
    for (const item of entries) {
      if (!Number.isInteger(item.index) || !this.remaining[item.index] || !item.save || item.save.version !== 1) continue;
      const entry = this.createBrokenBrick(item.index, item.save.seed);
      entry.volume.restore(item.save);
      this.broken.set(item.index, entry);
      if (entry.volume.removedNodeCount) this.showBrokenBrick(item.index, entry);
    }
  }

  private createBrokenBrick(index: number, seed?: number): BrokenBrick {
    this.original[index].decompose(this.position, this.rotation, this.scale);
    const width = this.alongX ? this.scale.x : this.scale.z;
    const height = this.scale.y;
    const origin = this.position.clone(); origin.y -= height / 2;
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.alongX ? 0 : -Math.PI / 2);
    const volume = new MasonryVolume({ width, height, depth: .24, frontZ: .12, cellSize: .012,
      seed: seed ?? (Math.imul(index + 1, 2654435761) ^ Math.imul(this.columns, 2246822519)) >>> 0,
      hollowProfile: 'single-horizontal-four-bore', maxConnectivityNodes: 1800 });
    let originalSolidNodes = 0;
    for (let y = 1; y <= volume.ny; y++) for (let x = 1; x <= volume.nx; x++)
      for (let z = 1; z <= volume.nz; z++)
        if (volume.baseMaterial(x, y, z) !== MaterialId.Air) originalSolidNodes++;
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), damagedMasonryMaterial);
    mesh.name = `${this.group.name} locally fractured brick ${index}`;
    mesh.position.copy(origin); mesh.quaternion.copy(rotation);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.raycast = () => undefined;
    this.group.add(mesh);
    return { volume, mesh, origin, rotation, originalSolidNodes };
  }

  private showBrokenBrick(index: number, entry: BrokenBrick): void {
    const positions: number[] = [], normals: number[] = [], colors: number[] = [];
    for (const key of entry.volume.chunkKeys) {
      const data = entry.volume.buildChunkMesh(key);
      for (let i = 0; i < data.positions.length; i++) positions.push(data.positions[i]);
      for (let i = 0; i < data.normals.length; i++) normals.push(data.normals[i]);
      for (let i = 0; i < data.colors.length; i++) colors.push(data.colors[i]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const face = new Float32Array(positions.length / 3), uv = new Float32Array(face.length * 2);
    const brickLocalUv = new Float32Array(face.length * 2);
    const tint = new Float32Array(face.length * 3);
    const ref = this.brickRefs[index];
    const patchAttribute = ref?.mesh.geometry.getAttribute('brickPatch');
    const slot = ref?.instance ?? 0;
    const color = ref?.mesh.instanceColor;
    const tone = [color?.getX(slot) ?? 1, color?.getY(slot) ?? 1, color?.getZ(slot) ?? 1];
    const px = patchAttribute?.getX(slot) ?? 0, py = patchAttribute?.getY(slot) ?? 0;
    const pw = patchAttribute?.getZ(slot) ?? 1, ph = patchAttribute?.getW(slot) ?? 1;
    for (let i = 0; i < face.length; i += 3) {
      const front = [0, 1, 2].every(j => Math.abs(Math.abs(positions[(i + j) * 3 + 2]) - .12) < .006 && Math.abs(normals[(i + j) * 3 + 2]) > .7);
      for (let j = 0; j < 3; j++) {
        const k = i + j;
        face[k] = front ? 1 : 0;
        const localU = positions[k * 3] / entry.volume.width + .5;
        const localV = positions[k * 3 + 1] / entry.volume.height;
        uv[k * 2] = px + localU * pw;
        uv[k * 2 + 1] = py + localV * ph;
        brickLocalUv[k * 2] = localU;
        brickLocalUv[k * 2 + 1] = localV;
        tint.set(tone, k * 3);
      }
    }
    geometry.setAttribute('brickFace', new THREE.BufferAttribute(face, 1));
    geometry.setAttribute('brickTint', new THREE.BufferAttribute(tint, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setAttribute('brickLocalUv', new THREE.BufferAttribute(brickLocalUv, 2));
    geometry.computeBoundingSphere();
    entry.mesh.geometry.dispose(); entry.mesh.geometry = geometry;
    this.ensureMortarCells();
    this.temp.makeScale(0, 0, 0);
    ref?.mesh.setMatrixAt(ref.instance, this.temp);
    if (ref) { ref.mesh.instanceMatrix.needsUpdate = true; ref.mesh.computeBoundingSphere(); }
    // Bed and head joints remain around a partly chipped unit; they are not
    // a solid grey replacement brick behind its open chambers.
  }

  strike(index: number, refreshCaps = true): boolean {
    if (!this.remaining[index]) return false;
    const partial = this.broken.get(index);
    if (partial) { partial.mesh.removeFromParent(); partial.mesh.geometry.dispose(); this.broken.delete(index); }
    this.ensureMortarCells();
    this.remaining[index] = 0;
    this.removedCount++;
    this.collisionDirty = true;
    this.temp.makeScale(0, 0, 0);
    const ref = this.brickRefs[index];
    if (ref) ref.mesh.setMatrixAt(ref.instance, this.temp);
    this.mortarCells!.setMatrixAt(index * 2, this.temp);
    this.mortarCells!.setMatrixAt(index * 2 + 1, this.temp);
    if (ref) {
      ref.mesh.instanceMatrix.needsUpdate = true;
      ref.mesh.computeBoundingSphere();
    }
    this.mortarCells!.instanceMatrix.needsUpdate = true;
    this.mortarCells!.computeBoundingSphere();
    if (refreshCaps) this.updateFractureCaps();
    return true;
  }

  restoreRemoved(indices: readonly number[]): void {
    for (const index of indices)
      if (Number.isInteger(index) && index >= 0 && index < this.remaining.length) this.strike(index, false);
    if (this.damaged) this.updateFractureCaps();
  }

  reset(): void {
    if (!this.damaged) return;
    for (const entry of this.broken.values()) { entry.mesh.removeFromParent(); entry.mesh.geometry.dispose(); }
    this.broken.clear();
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
    for (const mesh of this.fractureCaps ?? []) mesh.removeFromParent();
    this.fractureCaps = null;
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

  /** Expose the four longitudinal chambers only where a neighboring brick was
   * actually removed. Static wall ends use the same clay cut geometry. */
  private updateFractureCaps(): void {
    if (!this.fractureCaps) {
      this.fractureCaps = hollowClayEndShapes.map((shape, variant) => {
        const mesh = new THREE.InstancedMesh(shape, hollowClayEndMaterial, this.remaining.length * 2);
        mesh.name = `${this.group.name} broken four-chamber ends ${variant}`;
        mesh.count = 0;
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.raycast = () => undefined;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(mesh);
        return mesh;
      });
    }
    const counts = [0, 0, 0];
    const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
    const cutPosition = new THREE.Vector3(), cutRotation = new THREE.Quaternion();
    const cutScale = new THREE.Vector3(), matrix = new THREE.Matrix4(), tint = new THREE.Color();
    for (let index = 0; index < this.remaining.length; index++) {
      if (!this.remaining[index]) continue;
      const column = index % this.columns;
      for (const side of [-1, 1]) {
        const neighbor = index + side;
        if (column + side < 0 || column + side >= this.columns ||
            !this.originalHasBrick(neighbor) || this.remaining[neighbor]) continue;
        this.original[index].decompose(position, rotation, scale);
        cutPosition.copy(position);
        if (this.alongX) cutPosition.x += side * (scale.x / 2 + .004);
        else cutPosition.z += side * (scale.z / 2 + .004);
        cutRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0),
          this.alongX ? side * Math.PI / 2 : side > 0 ? 0 : Math.PI);
        cutScale.set(this.alongX ? scale.z : scale.x, scale.y, 1);
        const variant = ((Math.imul(index + 1, 2246822519) ^ Math.imul(side + 2, 3266489917)) >>> 0) % 3;
        const mesh = this.fractureCaps[variant], slot = counts[variant]++;
        mesh.setMatrixAt(slot, matrix.compose(cutPosition, cutRotation, cutScale));
        const warmth = .88 + ((index * 7 + side * 3 + variant * 5) % 11) * .012;
        mesh.setColorAt(slot, tint.setRGB(warmth, warmth * .98, warmth * .96));
      }
    }
    for (let variant = 0; variant < this.fractureCaps.length; variant++) {
      const mesh = this.fractureCaps[variant];
      mesh.count = counts[variant];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (mesh.count) mesh.computeBoundingSphere();
    }
  }

  private ensureMortarCells(): void {
    if (this.mortarCells) return;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const cells = new THREE.InstancedMesh(geometry, this.backing.material, this.brickRefs.length * 2);
    cells.name = `${this.group.name} real bed and head mortar joints`;
    cells.castShadow = cells.receiveShadow = true;
    for (let index = 0; index < this.brickRefs.length; index++) {
      this.original[index].decompose(this.position, this.rotation, this.scale);
      if (this.originalHasBrick(index) && this.remaining[index]) {
        const width = this.alongX ? this.scale.x : this.scale.z;
        const height = this.scale.y;
        const bedHeight = Math.max(.005, Math.min(.016, 3 / this.rows - height));
        const bedPosition = this.position.clone();
        bedPosition.y -= height / 2 + bedHeight / 2;
        const bedScale = this.alongX ? new THREE.Vector3(width + .006, bedHeight, .20)
          : new THREE.Vector3(.20, bedHeight, width + .006);
        cells.setMatrixAt(index * 2, this.temp.compose(bedPosition, this.rotation, bedScale));
        const headPosition = this.position.clone();
        if (this.alongX) headPosition.x += width / 2 + .004;
        else headPosition.z += width / 2 + .004;
        const headScale = this.alongX ? new THREE.Vector3(.008, height, .20)
          : new THREE.Vector3(.20, height, .008);
        cells.setMatrixAt(index * 2 + 1, this.temp.compose(headPosition, this.rotation, headScale));
      } else {
        this.temp.makeScale(0, 0, 0);
        cells.setMatrixAt(index * 2, this.temp);
        cells.setMatrixAt(index * 2 + 1, this.temp);
      }
    }
    cells.computeBoundingSphere();
    this.group.add(cells);
    this.backing.visible = false;
    this.mortarCells = cells;
  }
}
