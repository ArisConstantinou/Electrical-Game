import * as THREE from 'three';
import type { MansionGroundWing } from './MansionGroundWing';

interface WallSource { wall: THREE.Group; original: THREE.InstancedMesh; batch: THREE.InstancedMesh; start: number; matrices: THREE.Matrix4[]; batched: boolean }
interface Bucket { geometry: THREE.BufferGeometry; material: THREE.Material; total: number; patches: number[]; hasPatch: boolean; sources: Array<{ wall: THREE.Group; original: THREE.InstancedMesh }> }

/** The authored wall remains editable and keeps its own demolition matrices.
 * At a distance its intact brick instances share a small number of draw calls
 * with other walls in the same site sector. The original meshes return at
 * working distance, for fractured walls and throughout Level Editor use. */
export class MansionMasonryBatch {
  readonly ready: Promise<void>;
  private readonly sources: WallSource[] = [];
  private readonly batches: THREE.InstancedMesh[] = [];
  private readonly temp = new THREE.Matrix4();
  private readonly combined = new THREE.Matrix4();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly color = new THREE.Color();
  private enabled = true;

  constructor(private readonly mansion: MansionGroundWing, private readonly onRebuilt: () => void) { this.ready = this.build(true); }

  private async build(yieldBetweenBuckets = false): Promise<void> {
    const buckets = new Map<string, Bucket>();
    this.mansion.updateWorldMatrix(true, true);
    for (const wall of this.mansion.editableWalls.values()) {
      if (wall.parent !== this.mansion) continue;
      wall.traverse(object => {
        const child = object as THREE.InstancedMesh;
        const cutEnd = child.name.startsWith('Cut clay ends with mortar, variant ');
        if (!(child instanceof THREE.InstancedMesh) ||
            !cutEnd && !child.name.includes(' clay units') && !child.name.includes('chipped units') && !child.name.includes('broken corners')) return;
        const variant = cutEnd ? 4 + Number(child.name.at(-1)) : child.name.includes('sound clay units') ? 0
          : child.name.includes('chipped units A') ? 1 : child.name.includes('chipped units B') ? 2 : 3;
        const key = cutEnd ? `${Math.round(wall.position.y / 3.3)}:ends:${variant}`
          : `${Math.round(wall.position.y / 3.3)}:${wall.userData.alongX ? 1 : 0}:${variant}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = { geometry: child.geometry.clone(), material: child.material as THREE.Material, total: 0, patches: [], hasPatch: !cutEnd, sources: [] };
          buckets.set(key, bucket);
        }
        bucket.total += child.count;
        bucket.sources.push({ wall, original: child });
        if (!cutEnd) {
          const patches = child.geometry.getAttribute('brickPatch');
          for (let index = 0; index < child.count; index++)
            for (let component = 0; component < 4; component++) bucket.patches.push(patches.array[index * 4 + component]);
        }
      });
    }
    const toMansion = this.mansion.matrixWorld.clone().invert();
    for (const [key, bucket] of buckets) {
      if (bucket.sources.length < 2) { bucket.geometry.dispose(); continue; }
      if (bucket.hasPatch) bucket.geometry.setAttribute('brickPatch', new THREE.InstancedBufferAttribute(new Float32Array(bucket.patches), 4));
      const batch = new THREE.InstancedMesh(bucket.geometry, bucket.material, bucket.total);
      batch.name = `Shared untouched masonry ${key}`;
      batch.castShadow = batch.receiveShadow = true;
      batch.userData.editorIgnore = true;
      batch.raycast = () => undefined;
      this.mansion.add(batch);
      this.batches.push(batch);
      let next = 0;
      for (const { wall, original } of bucket.sources) {
        const matrices: THREE.Matrix4[] = [];
        for (let index = 0; index < original.count; index++) {
          original.getMatrixAt(index, this.temp);
          this.combined.multiplyMatrices(toMansion, original.matrixWorld).multiply(this.temp);
          matrices.push(this.combined.clone());
          batch.setMatrixAt(next + index, this.combined);
          original.getColorAt(index, this.color);
          batch.setColorAt(next + index, this.color);
        }
        this.sources.push({ wall, original, batch, start: next, matrices, batched: true });
        original.visible = false;
        next += original.count;
      }
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingSphere();
      if (yieldBetweenBuckets) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    this.onRebuilt();
  }

  private clear(): void {
    for (const source of this.sources) source.original.visible = true;
    this.sources.length = 0;
    for (const batch of this.batches) {
      batch.removeFromParent();
      batch.geometry.dispose();
      batch.dispose();
    }
    this.batches.length = 0;
  }

  disableForEditor(): void {
    if (!this.enabled) return;
    this.enabled = false;
    for (const source of this.sources) source.original.visible = true;
    for (const batch of this.batches) batch.visible = false;
  }

  update(camera: THREE.Camera): void {
    if (!this.enabled) {
      this.clear();
      this.enabled = true;
      void this.build();
    }
    const eye = camera.position;
    const altered = new Set<THREE.InstancedMesh>();
    for (const source of this.sources) {
      const demolition = this.mansion.masonryDemolition.get(source.wall.name);
      const obstacle = demolition?.obstacle;
      const horizontal = obstacle ? Math.hypot(Math.max(obstacle.minX - eye.x, 0, eye.x - obstacle.maxX),
        Math.max(obstacle.minZ - eye.z, 0, eye.z - obstacle.maxZ)) : 0;
      const vertical = obstacle ? Math.max((obstacle.minFloorY ?? 0) - eye.y, 0, eye.y - (obstacle.maxFloorY ?? 3)) : 0;
      const useBatch = source.wall.visible && !demolition?.damaged && Math.hypot(horizontal, vertical) > 3.2;
      if (useBatch === source.batched) continue;
      source.batched = useBatch;
      source.original.visible = !useBatch;
      for (let index = 0; index < source.matrices.length; index++)
        source.batch.setMatrixAt(source.start + index, useBatch ? source.matrices[index] : this.zero);
      altered.add(source.batch);
    }
    for (const batch of altered) batch.instanceMatrix.needsUpdate = true;
  }
}
