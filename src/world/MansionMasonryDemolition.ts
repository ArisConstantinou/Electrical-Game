import * as THREE from 'three';
import type { PlayerObstacle } from '../player/EquipmentCollision';
import { hollowClayEndMaterial, hollowClayEndShapes } from './HollowClayEnd';
import { MasonryVolume, MaterialId, type MasonrySave, type MasonryRayHit } from './MasonryVolume';
import { damagedMasonryMaterial } from './BrickFaceMaterial';
import { MansionBreakoutRubble } from './MansionBreakoutRubble';
import type { MeshData } from './masonryMesher';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
interface BrokenBrick { volume: MasonryVolume; mesh: THREE.Group; origin: THREE.Vector3; rotation: THREE.Quaternion; originalSolidNodes: number; chunkMeshes: Map<string, THREE.Mesh>; mortarMesh: THREE.Mesh | null; mortarRemoved: Uint8Array }

/** A light demolition layer for the authored fired-clay walls. The intact wall
 * keeps its original two draw calls; a hit swaps the solid backing for a
 * matching instanced set of mortar cells, so removed bricks leave a real hole. */
export class MansionMasonryDemolition {
  private readonly brickRefs: readonly (MasonryBrickInstance | null)[];
  private readonly original: THREE.Matrix4[] = [];
  private readonly remaining: Uint8Array;
  private readonly broken = new Map<number, BrokenBrick>();
  private readonly chippedEnds = new Set<string>();
  private readonly chippedDepths = new Map<string, number>();
  private readonly shortenedBricks = new Set<number>();
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
  private rubble: MansionBreakoutRubble | null = null;
  private firstBreakSide: -1 | 1 | null = null;
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
    for (const mesh of new Set(this.brickRefs.map(ref => ref?.mesh).filter((mesh): mesh is THREE.InstancedMesh => Boolean(mesh))))
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
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
    return [...this.broken].map(([index, entry]) => ({ index,
      save: { ...entry.volume.serialize(), mortarRemoved: [...entry.mortarRemoved] } }));
  }
  get fractureCapCount(): number {
    return this.fractureCaps?.reduce((count, mesh) => count + mesh.count, 0) ?? 0;
  }
  get fracturedEndCount(): number { return this.chippedEnds.size; }
  get fracturedEndDepthMm(): number {
    let depth = 0;
    for (const value of this.chippedDepths.values()) depth += value * 1000;
    return depth;
  }
  get rubbleSide(): -1 | 1 | null { return this.firstBreakSide; }
  get fallingFragmentCount(): number { return this.rubble?.fallingCount ?? 0; }
  update(dt: number): void { this.rubble?.step(dt); }
  private getRubble(): MansionBreakoutRubble {
    if (!this.rubble) {
      this.rubble = new MansionBreakoutRubble(this.alongX);
      this.group.add(this.rubble.group);
    }
    return this.rubble;
  }
  restoreRubbleSide(side: unknown): void {
    if (side === -1 || side === 1) this.firstBreakSide = side;
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
    // The bed joint belongs to the brick above it; the head joint belongs to
    // the brick on its left. Aim at that owner so the struck mortar is updated
    // with its supporting clay instead of chipping an unrelated neighbour.
    this.original[best].decompose(this.position, this.rotation, this.scale);
    const selectedRow = Math.floor(best / this.columns);
    if (selectedRow < this.rows - 1 && this.localHit.y > this.position.y + this.scale.y / 2 - .018) {
      for (let column = 0; column < this.columns; column++) {
        const upper = (selectedRow + 1) * this.columns + column;
        if (!this.remaining[upper]) continue;
        this.original[upper].decompose(this.position, this.rotation, this.scale);
        const middle = this.alongX ? this.position.x : this.position.z;
        const half = (this.alongX ? this.scale.x : this.scale.z) / 2;
        if (Math.abs(coordinate - middle) <= half + .012) { best = upper; break; }
      }
    }
    this.original[best].decompose(this.position, this.rotation, this.scale);
    const leftEdge = (this.alongX ? this.position.x - this.scale.x / 2 : this.position.z - this.scale.z / 2);
    if (coordinate < leftEdge + .018) {
      const owner = best - 1;
      if (owner >= Math.floor(best / this.columns) * this.columns && this.remaining[owner]) {
        this.original[owner].decompose(this.position, this.rotation, this.scale);
        const rightEdge = this.alongX ? this.position.x + this.scale.x / 2 : this.position.z + this.scale.z / 2;
        if (Math.abs(coordinate - rightEdge) < .025) best = owner;
      }
    }
    const broken = this.broken.get(best);
    if (!broken) return { wall: this, index: best, point, distance };
    const rayOrigin = this.localRay.origin.clone().sub(broken.origin).applyQuaternion(broken.rotation.clone().invert());
    const rayDirection = this.localRay.direction.clone().applyQuaternion(broken.rotation.clone().invert());
    const contact = this.jointContact(broken, rayOrigin, rayDirection, maxDistance)?.contact
      ?? broken.volume.raycast(rayOrigin, rayDirection, maxDistance);
    if (!contact) return null;
    const exact = new THREE.Vector3(contact.point.x, contact.point.y, contact.point.z)
      .applyQuaternion(broken.rotation).add(broken.origin).applyMatrix4(this.group.matrixWorld);
    return { wall: this, index: best, point: exact, distance: origin.distanceTo(exact) };
  }

  /** The original work wall's material lattice is allocated only for bricks
   * actually struck. The intact instanced wall stays cheap and unchanged. */
  strikeAt(index: number, camera: THREE.Camera, mode: 'chase' | 'demolish' = 'demolish'): boolean {
    if (!this.remaining[index]) return false;
    let entry = this.broken.get(index);
    if (!entry) entry = this.createBrokenBrick(index);
    this.group.updateWorldMatrix(true, false);
    this.inverse.copy(this.group.matrixWorld).invert();
    const wallCamera = camera.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.inverse);
    const origin = wallCamera.clone().sub(entry.origin).applyQuaternion(entry.rotation.clone().invert());
    const wallDirection = camera.getWorldDirection(new THREE.Vector3()).transformDirection(this.inverse);
    const direction = wallDirection.clone().applyQuaternion(entry.rotation.clone().invert());
    const joint = this.jointContact(entry, origin, direction, 2.4);
    const contact = joint?.contact ?? entry.volume.raycast(origin, direction, 2.4);
    if (!contact) { if (!this.broken.has(index)) this.disposeBrokenBrick(entry); return false; }
    const maxDepthM = mode === 'chase' ? .105 : undefined;
    const result = entry.volume.impact({ point: contact.point, direction,
      chisel: 'flat', widthM: mode === 'chase' ? .045 : .075,
      energyJ: mode === 'chase' ? 6 : 18, maxDepthM });
    if (!joint && (!result.contact || (!result.removedNodes && !result.stats.weakenedNodes))) {
      if (!this.broken.has(index)) this.disposeBrokenBrick(entry);
      return false;
    }
    this.firstBreakSide ??= (this.alongX ? wallCamera.z : wallCamera.x) < 0 ? -1 : 1;
    this.broken.set(index, entry);
    if (joint) {
      entry.mortarRemoved[joint.segment] = 1;
      this.ensureMortarCells();
      this.updateDamagedMortar(index, entry);
      const small = joint.segment < 8 ? entry.volume.width / 8 : .008;
      const height = joint.segment < 8 ? .008 : entry.volume.height / 5;
      this.getRubble().emit([{ position: contact.point, size: { x: small, y: height, z: .025 },
        volume: small * height * .025, material: MaterialId.Mortar, detached: true }],
      entry.origin, entry.rotation, this.firstBreakSide ?? -1, result.seed);
    }
    if (result.fragments.length) this.getRubble().emit(result.fragments, entry.origin, entry.rotation,
      this.firstBreakSide ?? -1, result.seed);
    if (result.removedNodes) this.fractureAcrossJoint(index, new THREE.Vector3(contact.point.x, contact.point.y, contact.point.z)
      .applyQuaternion(entry.rotation).add(entry.origin), wallDirection, maxDepthM);
    if (result.removedNodes) this.showBrokenBrick(index, entry);
    // In breakout mode, the heavily fractured remainder falls as its actual
    // current mesh. Chase cuts retain their backing and do not cross the wall.
    if (mode === 'demolish' && entry.volume.removedNodeCount >= entry.originalSolidNodes * .55)
      return this.strike(index, true, entry);
    if (result.removedNodes) this.refreshRubble();
    return true;
  }

  /** A pointed impact has a finite footprint. Continue that same material
   * fracture into adjacent fired-clay units only where the footprint reaches
   * their real laid edge; no random brick-level damage or whole-unit removal. */
  private fractureAcrossJoint(index: number, wallPoint: THREE.Vector3, wallDirection: THREE.Vector3, maxDepthM?: number): void {
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
        const result = entry.volume.impact({ point, direction, chisel: 'pointed', maxDepthM,
          energyJ: 1.4 + 2.2 * (1 - distance / .038) });
        if (!result.contact || (!result.removedNodes && !result.stats.weakenedNodes)) {
          if (fresh) this.disposeBrokenBrick(entry);
          continue;
        }
        this.broken.set(neighbor, entry);
        if (result.fragments.length) this.getRubble().emit(result.fragments, entry.origin, entry.rotation,
          this.firstBreakSide ?? -1, result.seed);
        if (entry.volume.removedNodeCount >= entry.originalSolidNodes * .94) this.strike(neighbor);
        else if (result.removedNodes) { this.showBrokenBrick(neighbor, entry); this.refreshRubble(); }
        if (++affected === (maxDepthM === undefined ? 3 : 1)) return;
      }
  }

  restoreDamage(entries: readonly MansionBrickDamage[]): void {
    for (const item of entries) {
      if (!Number.isInteger(item.index) || !this.remaining[item.index] || !item.save || item.save.version !== 1) continue;
      const entry = this.broken.get(item.index) ?? this.createBrokenBrick(item.index, item.save.seed);
      entry.volume.restore(item.save);
      for (let part = 0; part < entry.mortarRemoved.length; part++)
        entry.mortarRemoved[part] = item.save.mortarRemoved?.[part] === 1 ? 1 : 0;
      this.broken.set(item.index, entry);
      if (entry.volume.removedNodeCount) this.showBrokenBrick(item.index, entry);
      else if (entry.mortarRemoved.some(Boolean)) { this.ensureMortarCells(); this.updateDamagedMortar(item.index, entry); }
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
    const mesh = new THREE.Group();
    mesh.name = `${this.group.name} locally fractured brick ${index}`;
    mesh.position.copy(origin); mesh.quaternion.copy(rotation);
    mesh.raycast = () => undefined;
    this.group.add(mesh);
    return { volume, mesh, origin, rotation, originalSolidNodes, chunkMeshes: new Map(), mortarMesh: null,
      mortarRemoved: new Uint8Array(13) };
  }

  private showBrokenBrick(index: number, entry: BrokenBrick): void {
    const dirty = new Set(entry.volume.takeDirtyChunks());
    for (const key of entry.volume.chunkKeys) {
      const old = entry.chunkMeshes.get(key);
      if (old && !dirty.has(key)) continue;
      const data = dirty.has(key) ? entry.volume.buildChunkMesh(key) : entry.volume.buildPristineChunkMesh(key);
      const geometry = this.brokenChunkGeometry(data, index, entry);
      if (old) { old.geometry.dispose(); old.geometry = geometry; }
      else {
        const mesh = new THREE.Mesh(geometry, damagedMasonryMaterial);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.raycast = () => undefined;
        entry.mesh.add(mesh);
        entry.chunkMeshes.set(key, mesh);
      }
    }
    this.ensureMortarCells();
    this.updateDamagedMortar(index, entry);
    if (this.chippedEnds.has(`${index}:-1`) || this.chippedEnds.has(`${index}:1`)) this.trimExposedJoint(index);
    this.temp.makeScale(0, 0, 0);
    const ref = this.brickRefs[index];
    ref?.mesh.setMatrixAt(ref.instance, this.temp);
    if (ref) { ref.mesh.instanceMatrix.needsUpdate = true; ref.mesh.computeBoundingSphere(); }
  }

  private jointContact(entry: BrokenBrick, origin: THREE.Vector3, direction: THREE.Vector3,
    maxDistance: number): { contact: MasonryRayHit; segment: number } | null {
    if (Math.abs(direction.z) < .01) return null;
    const faceZ = origin.z >= 0 ? .11 : -.11;
    const distance = (faceZ - origin.z) / direction.z;
    if (distance < 0 || distance > maxDistance) return null;
    const x = origin.x + direction.x * distance;
    const y = origin.y + direction.y * distance;
    const half = entry.volume.width / 2, height = entry.volume.height;
    if (x < -half - .018 || x > half + .018 || y < -.022 || y > height + .022) return null;
    const nearBed = y < .024;
    const nearHead = x > half - .024;
    if (!nearBed && !nearHead) return null;
    const segment = nearBed ? Math.min(7, Math.max(0, Math.floor((x + half) / (2 * half) * 8)))
      : 8 + Math.min(4, Math.max(0, Math.floor(y / height * 5)));
    if (entry.mortarRemoved[segment]) return null;
    const point = { x: THREE.MathUtils.clamp(x, -half + .018, half - .018),
      y: THREE.MathUtils.clamp(y, .018, height - .018), z: faceZ };
    return { segment, contact: { point, normal: { x: 0, y: 0, z: Math.sign(faceZ) }, distance, material: MaterialId.Mortar } };
  }

  /** The intact wall uses two mortar instances per brick. Once chipped, replace
   * only that brick's joints with supported short pieces so a chase can cut
   * through the mortar without leaving continuous grey bars in the opening. */
  private updateDamagedMortar(index: number, entry: BrokenBrick): void {
    const cells = this.mortarCells!;
    this.temp.makeScale(0, 0, 0);
    cells.setMatrixAt(index * 2, this.temp);
    cells.setMatrixAt(index * 2 + 1, this.temp);
    cells.instanceMatrix.needsUpdate = true;
    const geometries: THREE.BufferGeometry[] = [];
    const width = entry.volume.width, height = entry.volume.height;
    const bedHeight = Math.max(.005, Math.min(.016, 3 / this.rows - height));
    const add = (x: number, y: number, sx: number, sy: number) => {
      const box = new THREE.BoxGeometry(sx, sy, .20);
      box.translate(x, y, 0);
      geometries.push(box);
    };
    for (let part = 0; part < 8; part++) {
      if (entry.mortarRemoved[part]) continue;
      const x = -width / 2 + width * (part + .5) / 8;
      const supported = [-.105, .105].some(z => entry.volume.sampleMaterial(x, .009, z) !== MaterialId.Air);
      if (supported) add(x, -bedHeight / 2, width / 8 - .001, bedHeight);
    }
    for (let part = 0; part < 5; part++) {
      if (entry.mortarRemoved[8 + part]) continue;
      const y = height * (part + .5) / 5;
      const supported = [-.105, .105].some(z => entry.volume.sampleMaterial(width / 2 - .009, y, z) !== MaterialId.Air);
      if (supported) add(width / 2 + .004, y, .008, height / 5 - .001);
    }
    const geometry = geometries.length ? mergeGeometries(geometries, false) : null;
    for (const part of geometries) part.dispose();
    if (entry.mortarMesh) {
      entry.mortarMesh.geometry.dispose();
      if (geometry) entry.mortarMesh.geometry = geometry;
      else { entry.mortarMesh.removeFromParent(); entry.mortarMesh = null; }
    } else if (geometry) {
      entry.mortarMesh = new THREE.Mesh(geometry, this.backing.material);
      entry.mortarMesh.receiveShadow = true;
      entry.mortarMesh.raycast = () => undefined;
      entry.mesh.add(entry.mortarMesh);
    }
  }

  private brokenChunkGeometry(data: MeshData, index: number, entry: BrokenBrick): THREE.BufferGeometry {
    const positions = data.positions, normals = data.normals;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
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
    return geometry;
  }

  private disposeBrokenBrick(entry: BrokenBrick): void {
    entry.mesh.removeFromParent();
    for (const chunk of entry.chunkMeshes.values()) chunk.geometry.dispose();
    entry.chunkMeshes.clear();
    entry.mortarMesh?.geometry.dispose();
  }

  strike(index: number, refreshCaps = true, fallingSection?: BrokenBrick): boolean {
    if (!this.remaining[index]) return false;
    const partial = this.broken.get(index);
    if (partial) {
      if (fallingSection === partial) {
        const side = this.firstBreakSide ?? -1;
        this.getRubble().adoptSection(partial.mesh, side, index * 2654435761,
          () => this.disposeBrokenBrick(partial));
      } else this.disposeBrokenBrick(partial);
      this.broken.delete(index);
    }
    this.chippedEnds.delete(`${index}:-1`);
    this.chippedEnds.delete(`${index}:1`);
    this.chippedDepths.delete(`${index}:-1`);
    this.chippedDepths.delete(`${index}:1`);
    this.shortenedBricks.delete(index);
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
    for (const entry of this.broken.values()) this.disposeBrokenBrick(entry);
    this.broken.clear();
    this.chippedEnds.clear();
    this.chippedDepths.clear();
    this.shortenedBricks.clear();
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
    this.rubble?.clear();
    this.firstBreakSide = null;
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

  private trimExposedJoint(index: number, deferBounds = false): void {
    if (!this.mortarCells) return;
    this.original[index].decompose(this.position, this.rotation, this.scale);
    const width = this.alongX ? this.scale.x : this.scale.z;
    const height = this.scale.y;
    const left = Math.min(width * .94, this.chippedDepths.get(`${index}:-1`) ?? 0);
    const right = Math.min(width * .94, this.chippedDepths.get(`${index}:1`) ?? 0);
    const remaining = Math.max(.008, width - left - right);
    const bedHeight = Math.max(.005, Math.min(.016, 3 / this.rows - height));
    const bedPosition = this.position.clone();
    if (this.alongX) bedPosition.x += (left - right) / 2;
    else bedPosition.z += (left - right) / 2;
    bedPosition.y -= height / 2 + bedHeight / 2;
    const bedScale = this.alongX ? new THREE.Vector3(remaining, bedHeight, .20)
      : new THREE.Vector3(.20, bedHeight, remaining);
    this.mortarCells.setMatrixAt(index * 2, this.temp.compose(bedPosition, this.rotation, bedScale));
    this.mortarCells.setMatrixAt(index * 2 + 1, new THREE.Matrix4().makeScale(0, 0, 0));
    this.mortarCells.instanceMatrix.needsUpdate = true;
    if (!deferBounds) this.mortarCells.computeBoundingSphere();
  }

  /** Running-bond courses alternate by half a brick. A projecting intact end
   * must lose more material than the neighboring recessed ends, otherwise a
   * demolished opening becomes a perfectly repeated row of square teeth. */
  private edgeOverhang(index: number, side: -1 | 1): number {
    this.original[index].decompose(this.position, this.rotation, this.scale);
    const at = (this.alongX ? this.position.x + side * this.scale.x / 2
      : this.position.z + side * this.scale.z / 2);
    const row = Math.floor(index / this.columns);
    let overhang = 0;
    for (const adjacentRow of [row - 1, row + 1]) {
      if (adjacentRow < 0 || adjacentRow >= this.rows) continue;
      for (let col = 0; col < this.columns; col++) {
        const candidate = adjacentRow * this.columns + col;
        const neighbor = candidate + side;
        if (!this.remaining[candidate] || col + side < 0 || col + side >= this.columns ||
            !this.originalHasBrick(neighbor) || this.remaining[neighbor]) continue;
        this.original[candidate].decompose(this.position, this.rotation, this.scale);
        const next = this.alongX ? this.position.x + side * this.scale.x / 2
          : this.position.z + side * this.scale.z / 2;
        if (Math.abs(at - next) < .35) overhang = Math.max(overhang, side * (at - next));
      }
    }
    return Math.min(.24, overhang);
  }

  /** Each exposed course breaks independently. The side and laid brick index
   * are part of the seed, so opposite jambs cannot inherit a mirrored cut. */
  private edgeBreakNoise(index: number, side: -1 | 1): number {
    let value = Math.imul(index + 1, 0x7feb352d) ^ Math.imul(side + 3, 0x846ca68b);
    value = Math.imul(value ^ value >>> 16, 0x7feb352d);
    return ((value ^ value >>> 15) >>> 0) / 4294967296;
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
    const removedCenters: number[] = [];
    const position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
    const cutPosition = new THREE.Vector3(), cutRotation = new THREE.Quaternion();
    const cutScale = new THREE.Vector3(), matrix = new THREE.Matrix4(), tint = new THREE.Color();
    let mortarChanged = false;
    for (let index = 0; index < this.remaining.length; index++) {
      if (!this.remaining[index]) {
        if (this.originalHasBrick(index)) {
          this.original[index].decompose(position, rotation, scale);
          removedCenters.push(this.alongX ? position.x : position.z);
        }
        continue;
      }
      const column = index % this.columns;
      for (const side of [-1, 1]) {
        const neighbor = index + side;
        if (column + side < 0 || column + side >= this.columns ||
            !this.originalHasBrick(neighbor) || this.remaining[neighbor]) continue;
        const edgeKey = `${index}:${side}`;
        this.original[index].decompose(position, rotation, scale);
        const width = this.alongX ? scale.x : scale.z;
        const noise = this.edgeBreakNoise(index, side as -1 | 1);
        const depth = THREE.MathUtils.clamp(.025 + this.edgeOverhang(index, side as -1 | 1) * .65 +
          noise * .23, .018, width * .78);
        this.chippedEnds.add(edgeKey);
        this.chippedDepths.set(edgeKey, depth);
        if (this.broken.has(index)) continue;
        this.original[index].decompose(position, rotation, scale);
        cutPosition.copy(position);
        if (this.alongX) cutPosition.x += side * (scale.x / 2 - depth + .004);
        else cutPosition.z += side * (scale.z / 2 - depth + .004);
        cutRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0),
          this.alongX ? side * Math.PI / 2 : side > 0 ? 0 : Math.PI);
        cutScale.set(this.alongX ? scale.z : scale.x, scale.y, 1);
        const variant = ((Math.imul(index + 1, 2246822519) ^ Math.imul(side + 2, 3266489917)) >>> 0) % 3;
        const mesh = this.fractureCaps[variant], slot = counts[variant]++;
        mesh.setMatrixAt(slot, matrix.compose(cutPosition, cutRotation, cutScale));
        const warmth = .88 + ((index * 7 + side * 3 + variant * 5) % 11) * .012;
        mesh.setColorAt(slot, tint.setRGB(warmth, warmth * .98, warmth * .96));
      }
      if (!this.broken.has(index) && (this.chippedDepths.has(`${index}:-1`) || this.chippedDepths.has(`${index}:1`))) {
        this.original[index].decompose(position, rotation, scale);
        const left = this.chippedDepths.get(`${index}:-1`) ?? 0;
        const right = this.chippedDepths.get(`${index}:1`) ?? 0;
        if (this.alongX) { position.x += (left - right) / 2; scale.x = Math.max(.008, scale.x - left - right); }
        else { position.z += (left - right) / 2; scale.z = Math.max(.008, scale.z - left - right); }
        const ref = this.brickRefs[index];
        ref?.mesh.setMatrixAt(ref.instance, matrix.compose(position, rotation, scale));
        if (ref) ref.mesh.instanceMatrix.needsUpdate = true;
        this.shortenedBricks.add(index);
        this.trimExposedJoint(index, true);
        mortarChanged = true;
      }
    }
    if (mortarChanged) this.mortarCells?.computeBoundingSphere();
    const shortenedMeshes = new Set<THREE.InstancedMesh>();
    for (const index of this.shortenedBricks) {
      const ref = this.brickRefs[index];
      if (ref) shortenedMeshes.add(ref.mesh);
    }
    for (const mesh of shortenedMeshes) mesh.computeBoundingSphere();
    for (let variant = 0; variant < this.fractureCaps.length; variant++) {
      const mesh = this.fractureCaps[variant];
      mesh.count = counts[variant];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (mesh.count) mesh.computeBoundingSphere();
    }
    this.refreshRubble(removedCenters);
  }

  private refreshRubble(removedCenters?: number[]): void {
    const centers = removedCenters ?? [];
    if (!removedCenters) for (let index = 0; index < this.remaining.length; index++) {
      if (this.remaining[index] || !this.originalHasBrick(index)) continue;
      this.original[index].decompose(this.position, this.rotation, this.scale);
      centers.push(this.alongX ? this.position.x : this.position.z);
    }
    let volumeUnits = centers.length;
    for (const [index, entry] of this.broken) {
      if (!entry.volume.removedNodeCount) continue;
      this.original[index].decompose(this.position, this.rotation, this.scale);
      const unit = entry.volume.removedNodeCount / entry.originalSolidNodes;
      volumeUnits += unit;
      if (unit > .035) centers.push(this.alongX ? this.position.x : this.position.z);
    }
    if (centers.length) this.getRubble().update(centers, this.firstBreakSide ?? -1, volumeUnits);
    else this.rubble?.update([], this.firstBreakSide ?? -1, 0);
  }

  private ensureMortarCells(): void {
    if (this.mortarCells) return;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const cells = new THREE.InstancedMesh(geometry, this.backing.material, this.brickRefs.length * 2);
    cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
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
