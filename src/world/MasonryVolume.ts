import { MeshBuilder, meshVolume, clippedTetra, CORNERS, TETRA, type MeshData, type MasonryMeshJob } from './masonryMesher';

export interface Vec3 { x: number; y: number; z: number }
export enum MaterialId { Air = 0, Clay = 1, Mortar = 2, Render = 3, Concrete = 4 }
export const MATERIAL_NAMES = ['air', 'clay', 'mortar', 'render', 'concrete'] as const;
export interface MasonryFragment {
  position: Vec3; size: Vec3; material: MaterialId; volume: number; detached: boolean;
  /** Exact removed-material triangles relative to position, including crushed chips and detached islands. */
  positions?: Float32Array;
}
/** Diagnostics of physically opened material paths; never a decal or an overlay. */
export interface MasonryCrack { points: Vec3[]; width: number; material: MaterialId }
export interface MasonryVolumeOptions {
  width?: number; height?: number; depth?: number; frontZ?: number; cellSize?: number;
  tileSize?: number; seed?: number; renderThickness?: number; material?: 'hollow-clay' | 'concrete';
  solidMaterial?: MaterialId;
  /** Explicit profile keeps older saved damage aligned with its original solids. */
  hollowProfile?: 'rounded-five' | 'legacy-rectangular';
  maxConnectivityNodes?: number;
}
export interface MasonryImpactInput { point: Vec3; direction: Vec3; edge?: Vec3; energyJ?: number; chisel: 'pointed' | 'flat'; /** Flat cutting-edge width in metres, 10–50 mm. Pointed chisels ignore it. */ widthM?: number; seed?: number; /** Upward finishing stroke: preserve the locally established cavity backing. */ trim?: boolean }
export interface MasonryRayHit { point: Vec3; normal: Vec3; distance: number; material: MaterialId }
export interface MasonryImpactResult {
  contact: MasonryRayHit | null; removedNodes: number; removedVolume: number;
  removedByMaterial: Record<string, number>; fragments: MasonryFragment[]; cracks: MasonryCrack[];
  changedChunks: string[]; seed: number; bounds: { min: Vec3; max: Vec3 } | null;
  stats: { milliseconds: number; affectedNodes: number; weakenedNodes: number; connectivityVisited: number; detachedNodes: number; activeChunks: number; openedFissureNodes?: number; trimMode?: boolean; trimFloorZ?: number | null };
}
interface Chunk { damage: Uint8Array; removed: Uint8Array; changes: number }
export interface MasonrySave {
  version: 1; seed: number; sequence: number; options: MasonryVolumeOptions; removedVolume?: number;
  chunks: Array<{ key: string; edits: Array<[number, number, number]> }>;
  pendingSupport?: Array<{ starts: Vec3[]; x0: number; x1: number; y0: number; y1: number; trimFloorZ?: number }>;
}
interface Node { x: number; y: number; z: number; id: number; material: MaterialId }
interface SupportJob {
  starts: Vec3[]; startIndex: number; visited: Set<number>; anchors: Set<number>;
  queue: Node[]; head: number; x0: number; x1: number; y0: number; y1: number; trimFloorZ?: number;
}
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const unit = (v: Vec3): Vec3 => { const n = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / n, y: v.y / n, z: v.z / n }; };
function hash(a: number, b: number, c: number, seed: number): number {
  let h = Math.imul(a ^ seed, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0;
}
// Exactly the edge directions of the six-tetra lattice, including its shared diagonals.
const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, -1], [0, 1, 1], [0, -1, -1], [1, 1, 1], [-1, -1, -1]];

/** Persistent material lattice. Brick layout initializes solids; impact ownership is exclusively world-space. */
export class MasonryVolume {
  readonly width: number; readonly height: number; readonly depth: number; readonly frontZ: number;
  readonly cellSize: number; readonly tileSize: number; readonly nx: number; readonly ny: number; readonly nz: number;
  readonly hx: number; readonly hy: number; readonly hz: number; readonly chunkKeys: string[] = [];
  readonly seed: number; readonly options: MasonryVolumeOptions;
  private readonly chunks = new Map<string, Chunk>();
  private readonly dirty = new Set<string>();
  private readonly exposedAir = new Set<number>();
  private readonly pendingSupport: SupportJob[] = [];
  private trimPatch: { anchor: Vec3; floorZ: number } | null = null;
  get trimmingState(): { anchor: Vec3; floorZ: number } | null { return this.trimPatch ? { anchor: { ...this.trimPatch.anchor }, floorZ: this.trimPatch.floorZ } : null; }
  private sequence = 0;
  private totalRemoved = 0;
  private totalDetached = 0;
  private totalRemovedVolume = 0;
  private readonly maxConnectivityNodes: number;

  constructor(options: MasonryVolumeOptions = {}) {
    this.options = { ...options, hollowProfile: options.hollowProfile ?? 'rounded-five' }; this.width = options.width ?? 6; this.height = options.height ?? 3;
    this.depth = options.depth ?? .18; this.frontZ = options.frontZ ?? -2.41;
    this.cellSize = options.cellSize ?? .008; this.tileSize = options.tileSize ?? 24;
    this.seed = (options.seed ?? (globalThis.crypto?.getRandomValues(new Uint32Array(1))[0] ?? Math.floor(Math.random() * 0xffffffff))) >>> 0;
    this.nx = Math.ceil(this.width / this.cellSize); this.ny = Math.ceil(this.height / this.cellSize);
    this.nz = Math.ceil(this.depth / this.cellSize);
    this.hx = this.width / this.nx; this.hy = this.height / this.ny; this.hz = this.depth / this.nz;
    this.maxConnectivityNodes = options.maxConnectivityNodes ?? 12000;
    for (let y = 0; y <= this.ny; y += this.tileSize) for (let x = 0; x <= this.nx; x += this.tileSize) this.chunkKeys.push(`${Math.floor(x / this.tileSize)},${Math.floor(y / this.tileSize)}`);
  }
  get nodeVolume(): number { return this.hx * this.hy * this.hz; }
  get activeChunkCount(): number { return this.chunks.size; }
  get removedNodeCount(): number { return this.totalRemoved; }
  get removedVolume(): number { return this.totalRemovedVolume; }
  get detachedNodeCount(): number { return this.totalDetached; }
  get impactCount(): number { return this.sequence; }
  get pendingSupportCount(): number { return this.pendingSupport.length; }
  get memoryBytes(): number { return this.chunks.size * this.tileSize * this.tileSize * (this.nz + 2) * 2; }
  nodePosition(x: number, y: number, z: number): Vec3 {
    return { x: -this.width / 2 + (x - .5) * this.hx, y: (y - .5) * this.hy, z: this.frontZ + (.5 - z) * this.hz };
  }
  private coordinates(point: Vec3): Vec3 {
    return { x: Math.round((point.x + this.width / 2) / this.hx + .5), y: Math.round(point.y / this.hy + .5), z: Math.round((this.frontZ - point.z) / this.hz + .5) };
  }
  private index(x: number, y: number, z: number): number { return x + (this.nx + 2) * (y + (this.ny + 2) * z); }
  private chunkAddress(x: number, y: number, z: number): { key: string; offset: number } {
    const tx = Math.floor(x / this.tileSize), ty = Math.floor(y / this.tileSize);
    return { key: `${tx},${ty}`, offset: ((y - ty * this.tileSize) * this.tileSize + x - tx * this.tileSize) * (this.nz + 2) + z };
  }
  private mutable(x: number, y: number, z: number): { chunk: Chunk; offset: number } {
    const address = this.chunkAddress(x, y, z);
    let chunk = this.chunks.get(address.key);
    if (!chunk) {
      const count = this.tileSize * this.tileSize * (this.nz + 2);
      chunk = { damage: new Uint8Array(count), removed: new Uint8Array(count), changes: 0 }; this.chunks.set(address.key, chunk);
    }
    return { chunk, offset: address.offset };
  }
  private markDirty(x: number, y: number): void {
    for (const dx of [-1, 0]) for (const dy of [-1, 0]) {
      if (x + dx < 0 || y + dy < 0 || x + dx > this.nx || y + dy > this.ny) continue;
      this.dirty.add(`${Math.floor((x + dx) / this.tileSize)},${Math.floor((y + dy) / this.tileSize)}`);
    }
  }
  /** Original material, independent of all accumulated damage. */
  baseMaterial(x: number, y: number, z: number): MaterialId {
    if (x < 1 || y < 1 || z < 1 || x > this.nx || y > this.ny || z > this.nz) return MaterialId.Air;
    const p = this.nodePosition(x, y, z), renderThickness = this.options.renderThickness ?? 0;
    if (this.frontZ - p.z < renderThickness) return MaterialId.Render;
    if (this.options.solidMaterial !== undefined) return this.options.solidMaterial;
    if (this.options.material === 'concrete') return MaterialId.Concrete;
    const d = this.frontZ - p.z - renderThickness, clayDepth = this.depth - renderThickness;
    const pitchY = this.height / 23, pitchX = this.width / 21;
    const row = Math.floor(p.y / pitchY), localY = p.y - row * pitchY;
    const wallX = p.x + this.width / 2 - (row % 2 ? pitchX * .5 : 0);
    const localX = ((wallX % pitchX) + pitchX) % pitchX;
    if (localY < .006 || localY > pitchY - .006 || localX < .006 || localX > pitchX - .006) return MaterialId.Mortar;
    const shell = .015;
    if (d < shell || d > clayDepth - shell || localX < .018 || localX > pitchX - .018 || localY < .016 || localY > pitchY - .016) return MaterialId.Clay;
    // Five bores along the brick length, two through its depth. The solid side
    // faces the room; the perforated end section is only revealed by fracture.
    // Rounded bores retain curved shell fragments rather than rectangular slots.
    const innerWidth = pitchX - .036;
    const ribPitch = innerWidth / 5;
    if (this.options.hollowProfile === 'legacy-rectangular') {
      const ribX = ((localX - .018) % ribPitch + ribPitch) % ribPitch;
      return ribX < .006 || ribX > ribPitch - .006 || Math.abs(d - clayDepth / 3) < .006 || Math.abs(d - 2 * clayDepth / 3) < .006 ? MaterialId.Clay : MaterialId.Air;
    }
    const boreX = ((localX - .018) % ribPitch + ribPitch) % ribPitch - ribPitch * .5;
    const depthPitch = (clayDepth - shell * 2) / 2;
    const boreZ = ((d - shell) % depthPitch + depthPitch) % depthPitch - depthPitch * .5;
    return (boreX / (ribPitch * .42)) ** 2 + (boreZ / (depthPitch * .5 - .006)) ** 2 < 1 ? MaterialId.Air : MaterialId.Clay;
  }
  nodeMaterial(x: number, y: number, z: number): MaterialId {
    const material = this.baseMaterial(x, y, z);
    if (material === MaterialId.Air) return material;
    const { key, offset } = this.chunkAddress(x, y, z);
    return this.chunks.get(key)?.removed[offset] ? MaterialId.Air : material;
  }
  sampleMaterial(x: number, y: number, z: number): MaterialId {
    // Barycentric interpolation in the identical six tetrahedra used by the visible mesh.
    // A hit on a sloping fracture face therefore cannot strike an invisible voxel box.
    const grid = [(x + this.width / 2) / this.hx + .5, y / this.hy + .5, (this.frontZ - z) / this.hz + .5];
    const base = grid.map(Math.floor), f = grid.map((v, i) => v - base[i]);
    const axes = [0, 1, 2].sort((a, b) => f[b] - f[a]);
    const weights = [1 - f[axes[0]], f[axes[0]] - f[axes[1]], f[axes[1]] - f[axes[2]], f[axes[2]]];
    const offset = [0, 0, 0], amounts = [0, 0, 0, 0, 0]; let density = 0;
    for (let i = 0; i < 4; i++) {
      if (i > 0) offset[axes[i - 1]] = 1;
      const material = this.nodeMaterial(base[0] + offset[0], base[1] + offset[1], base[2] + offset[2]);
      if (material) { density += weights[i]; amounts[material] += weights[i]; }
    }
    if (density < .5) return MaterialId.Air;
    let strongest = MaterialId.Clay;
    for (let material = 2; material < amounts.length; material++) if (amounts[material] > amounts[strongest]) strongest = material;
    return strongest;
  }
  nodeAirExposed(x: number, y: number, z: number): boolean {
    return x < 1 || y < 1 || z < 1 || x > this.nx || y > this.ny || z > this.nz || this.exposedAir.has(this.index(x, y, z));
  }
  private exposeCavities(removed: readonly Node[]): void {
    const queue = removed.map(n => ({ x: n.x, y: n.y, z: n.z }));
    for (const n of queue) this.exposedAir.add(this.index(n.x, n.y, n.z));
    for (let head = 0; head < queue.length; head++) {
      const n = queue[head];
      for (const d of NEIGHBORS) {
        const x = n.x + d[0], y = n.y + d[1], z = n.z + d[2];
        if (x < 1 || y < 1 || z < 1 || x > this.nx || y > this.ny || z > this.nz) continue;
        const id = this.index(x, y, z);
        if (this.exposedAir.has(id) || this.nodeMaterial(x, y, z)) continue;
        this.exposedAir.add(id); this.markDirty(x, y); queue.push({ x, y, z });
      }
    }
  }
  isOccupied(x: number, y: number, z: number): boolean { return this.sampleMaterial(x, y, z) !== MaterialId.Air; }
  materialColor(material: number, x: number, y: number, z: number): readonly number[] {
    const p = this.nodePosition(x, y, 1), row = Math.floor(p.y / (this.height / 23));
    const col = Math.floor((p.x + this.width / 2) / (this.width / 21) - (row % 2 ? .5 : 0));
    let variation = .88 + (hash(col, row, 0, this.seed) % 1000) / 5000;
    if (z > 2 && z < this.nz - 1) {
      let open = 0;
      for (const offset of [[2, 0, 0], [-2, 0, 0], [0, 2, 0], [0, -2, 0], [0, 0, 2], [0, 0, -2]]) if (this.nodeAirExposed(x + offset[0], y + offset[1], z + offset[2])) open++;
      variation *= .52 + open * .07;
    }
    if (material === MaterialId.Mortar) return [.30 * variation, .28 * variation, .23 * variation];
    if (material === MaterialId.Render) return [.46 * variation, .44 * variation, .37 * variation];
    if (material === MaterialId.Concrete) return [.33 * variation, .34 * variation, .33 * variation];
    return [.49 * variation, .145 * variation, .065 * variation];
  }
  takeDirtyChunks(): string[] { const keys = [...this.dirty]; this.dirty.clear(); return keys; }
  chunkBounds(key: string): { min: Vec3; max: Vec3; x0: number; x1: number; y0: number; y1: number } {
    const [tx, ty] = key.split(',').map(Number), x0 = tx * this.tileSize, y0 = ty * this.tileSize;
    const x1 = Math.min(this.nx + 1, x0 + this.tileSize), y1 = Math.min(this.ny + 1, y0 + this.tileSize);
    const a = this.nodePosition(x0, y0, this.nz + 1), b = this.nodePosition(x1, y1, 0);
    return { min: a, max: b, x0, x1, y0, y1 };
  }
  buildChunkMesh(key: string): MeshData {
    const b = this.chunkBounds(key); return meshVolume(this, b.x0, b.x1, b.y0, b.y1);
  }
  exportMeshJob(key: string): MasonryMeshJob {
    const b = this.chunkBounds(key), sx = b.x1 - b.x0 + 1, sy = b.y1 - b.y0 + 1, sz = this.nz + 2;
    const materials = new Uint8Array(sx * sy * sz), exposed = new Uint8Array(materials.length), nodeColors = new Float32Array(materials.length * 3);
    const xCoordinates = new Float32Array(sx), yCoordinates = new Float32Array(sy), zCoordinates = new Float32Array(sz);
    for (let x = 0; x < sx; x++) xCoordinates[x] = this.nodePosition(x + b.x0, 0, 0).x;
    for (let y = 0; y < sy; y++) yCoordinates[y] = this.nodePosition(0, y + b.y0, 0).y;
    for (let z = 0; z < sz; z++) zCoordinates[z] = this.nodePosition(0, 0, z).z;
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) for (let z = 0; z < sz; z++) {
      const i = ((y - b.y0) * sx + x - b.x0) * sz + z, material = this.nodeMaterial(x, y, z);
      materials[i] = material; exposed[i] = Number(this.nodeAirExposed(x, y, z));
      if (material) { const color = this.materialColor(material, x, y, z); nodeColors.set(color, i * 3); }
    }
    return { key, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, nx: this.nx, ny: this.ny, nz: this.nz, materials, exposed, nodeColors, xCoordinates, yCoordinates, zCoordinates };
  }
  /** Hidden pristine chambers need no triangles until their tile is exposed by damage. */
  buildPristineChunkMesh(key: string): MeshData {
    const b = this.chunkBounds(key), mesh = new MeshBuilder();
    type Rectangle = { xa: number; xb: number; ya: number; yb: number; color: readonly number[] };
    for (const face of [0, 1]) {
      const rectangles: Rectangle[] = [], previous = new Map<string, Rectangle>(), nodeZ = face ? this.nz : 1;
      for (let y = b.y0; y < b.y1; y++) {
        const ya = Math.max(0, this.nodePosition(0, y, 0).y), yb = Math.min(this.height, this.nodePosition(0, y + 1, 0).y);
        if (yb <= ya) continue;
        let x = b.x0;
        while (x < b.x1) {
          const material = this.baseMaterial(clamp(x, 1, this.nx), clamp(y, 1, this.ny), nodeZ);
          const color = this.materialColor(material, clamp(x, 1, this.nx), clamp(y, 1, this.ny), nodeZ);
          let end = x + 1;
          while (end < b.x1) {
            const nextMaterial = this.baseMaterial(clamp(end, 1, this.nx), clamp(y, 1, this.ny), nodeZ);
            const next = this.materialColor(nextMaterial, clamp(end, 1, this.nx), clamp(y, 1, this.ny), nodeZ);
            if (next[0] !== color[0] || next[1] !== color[1] || next[2] !== color[2]) break;
            end++;
          }
          const xa = Math.max(-this.width / 2, this.nodePosition(x, 0, 0).x), xb = Math.min(this.width / 2, this.nodePosition(end, 0, 0).x);
          const key = `${x}:${end}:${color[0]}:${color[1]}:${color[2]}`, prior = previous.get(key);
          if (prior && prior.yb === ya) prior.yb = yb;
          else { const rectangle = { xa, xb, ya, yb, color }; rectangles.push(rectangle); previous.set(key, rectangle); }
          x = end;
        }
      }
      const z = this.frontZ - face * this.depth;
      for (const r of rectangles) mesh.quad({ x: r.xa, y: r.ya, z }, { x: r.xb, y: r.ya, z }, { x: r.xb, y: r.yb, z }, { x: r.xa, y: r.yb, z }, r.color, { x: 0, y: 0, z: face ? -1 : 1 });
    }
    return mesh.finish();
  }

  raycast(origin: Vec3, direction: Vec3, maxDistance: number): MasonryRayHit | null {
    const dir = unit(direction);
    let enter = 0, leave = maxDistance;
    const minimum = { x: -this.width / 2, y: 0, z: this.frontZ - this.depth };
    const maximum = { x: this.width / 2, y: this.height, z: this.frontZ };
    for (const axis of ['x', 'y', 'z'] as const) {
      if (Math.abs(dir[axis]) < 1e-10) { if (origin[axis] < minimum[axis] || origin[axis] > maximum[axis]) return null; continue; }
      const a = (minimum[axis] - origin[axis]) / dir[axis], b = (maximum[axis] - origin[axis]) / dir[axis];
      enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
    }
    if (enter > leave) return null;
    const step = Math.min(this.hx, this.hy, this.hz) * .35;
    let previous = Math.max(0, enter - step);
    for (let distance = enter + 1e-7; distance <= leave + 1e-7; distance += step) {
      const point = { x: origin.x + dir.x * distance, y: origin.y + dir.y * distance, z: origin.z + dir.z * distance };
      const material = this.sampleMaterial(point.x, point.y, point.z);
      if (material !== MaterialId.Air) {
        let lo = previous, hi = distance;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) * .5;
          if (this.isOccupied(origin.x + dir.x * mid, origin.y + dir.y * mid, origin.z + dir.z * mid)) hi = mid; else lo = mid;
        }
        const t = (lo + hi) * .5, p = { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t };
        const normal = unit({
          x: Number(this.isOccupied(p.x - step, p.y, p.z)) - Number(this.isOccupied(p.x + step, p.y, p.z)),
          y: Number(this.isOccupied(p.x, p.y - step, p.z)) - Number(this.isOccupied(p.x, p.y + step, p.z)),
          z: Number(this.isOccupied(p.x, p.y, p.z - step)) - Number(this.isOccupied(p.x, p.y, p.z + step)),
        });
        if (Math.hypot(normal.x, normal.y, normal.z) < .1) { normal.x = -dir.x; normal.y = -dir.y; normal.z = -dir.z; }
        return { point: p, normal, distance: t, material };
      }
      previous = distance;
    }
    return null;
  }
  cavityBox(min: Vec3, max: Vec3): { clear: boolean; occupiedSamples: number; totalSamples: number } {
    const box = { min: { x: Math.min(min.x, max.x), y: Math.min(min.y, max.y), z: Math.min(min.z, max.z) }, max: { x: Math.max(min.x, max.x), y: Math.max(min.y, max.y), z: Math.max(min.z, max.z) } };
    if (Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) < 1e-10) {
      const occupiedSamples = Number(this.isOccupied(min.x, min.y, min.z)); return { clear: !occupiedSamples, occupiedSamples, totalSamples: 1 };
    }
    const grid = (p: Vec3): Vec3 => ({ x: (p.x + this.width / 2) / this.hx + .5, y: p.y / this.hy + .5, z: (this.frontZ - p.z) / this.hz + .5 });
    const a = grid(box.min), b = grid(box.max); let totalSamples = 0;
    for (let y = Math.max(0, Math.floor(a.y)); y <= Math.min(this.ny, Math.floor(b.y)); y++) for (let x = Math.max(0, Math.floor(a.x)); x <= Math.min(this.nx, Math.floor(b.x)); x++) for (let z = Math.max(0, Math.floor(b.z)); z <= Math.min(this.nz, Math.floor(a.z)); z++) {
      const materials = CORNERS.map(c => Number(this.nodeMaterial(x + c[0], y + c[1], z + c[2]) !== MaterialId.Air));
      totalSamples++;
      if (!materials.some(Boolean)) continue;
      if (materials.every(Boolean)) return { clear: false, occupiedSamples: 1, totalSamples };
      const points = CORNERS.map(c => this.nodePosition(x + c[0], y + c[1], z + c[2]));
      for (const tetra of TETRA) {
        if (!tetra.some(i => materials[i])) continue;
        const clipped = clippedTetra(tetra.map(i => points[i]), tetra.map(i => materials[i]), undefined, box);
        if (clipped.volume > 1e-14) return { clear: false, occupiedSamples: 1, totalSamples };
      }
    }
    return { clear: true, occupiedSamples: 0, totalSamples };
  }
  private strength(x: number, y: number, z: number, material: MaterialId): number {
    const nominal = [0, 128, 160, 75, 250][material];
    return Math.min(245, nominal * (.78 + (hash(x, y, z, this.seed) % 1000) / 2200));
  }
  private remove(node: Node, removed: Node[]): void {
    const { chunk, offset } = this.mutable(node.x, node.y, node.z);
    if (chunk.removed[offset]) return;
    chunk.removed[offset] = 1; chunk.changes++; this.totalRemoved++; removed.push(node); this.markDirty(node.x, node.y);
  }
  /** Only columns whose exterior clay has actually been removed can establish a
   * finishing plane. Unopened factory cavities and remote deep holes do not count.
   * Keep the backing nodes plus one lattice layer: tetrahedral faces cannot recede
   * behind that plane when a neighbouring protrusion is clipped away. */
  private hasLocalExteriorOpening(point: Vec3): boolean {
    const c = this.coordinates(point), rx = Math.ceil(.048 / this.hx), ry = Math.ceil(.048 / this.hy);
    for (let y = Math.max(1, c.y - ry); y <= Math.min(this.ny, c.y + ry); y++) for (let x = Math.max(1, c.x - rx); x <= Math.min(this.nx, c.x + rx); x++) {
      const p = this.nodePosition(x, y, 1);
      if (Math.hypot(p.x - point.x, p.y - point.y) <= .048 && this.baseMaterial(x, y, 1) && !this.nodeMaterial(x, y, 1) && !this.nodeMaterial(x, y, 2)) return true;
    }
    return false;
  }
  private establishTrimPlane(point: Vec3): number | null {
    const center = this.coordinates(point), radius = .048;
    const depths: number[] = [];
    const rx = Math.ceil(radius / this.hx), ry = Math.ceil(radius / this.hy);
    for (let y = Math.max(1, center.y - ry); y <= Math.min(this.ny, center.y + ry); y++) {
      for (let x = Math.max(1, center.x - rx); x <= Math.min(this.nx, center.x + rx); x++) {
        const p = this.nodePosition(x, y, 1);
        if (Math.hypot(p.x - point.x, p.y - point.y) > radius) continue;
        // A surviving outer shell still blocks access to its manufactured void.
        if (this.nodeMaterial(x, y, 1) || this.nodeMaterial(x, y, 2)) continue;
        let removedExterior = false;
        for (let z = 1; z <= 2; z++) if (this.baseMaterial(x, y, z)) removedExterior = true;
        if (!removedExterior) continue;
        for (let z = 3; z <= this.nz; z++) {
          if (!this.nodeMaterial(x, y, z)) continue;
          if (z >= 4 && this.nodeAirExposed(x, y, z - 1)) depths.push(this.nodePosition(x, y, z).z);
          break;
        }
      }
    }
    if (depths.length < 3) return null;
    // Deeper local faces define the floor, with isolated bore holes rejected.
    depths.sort((a, b) => a - b);
    return depths[Math.floor(depths.length * .25)];
  }

  impact(input: MasonryImpactInput): MasonryImpactResult {
    const started = performance.now(); this.sequence++;
    if (!input.trim) this.trimPatch = null;
    // A new impact may sever a previously discovered anchor path; deferred searches restart
    // against the new topology rather than retaining stale support claims.
    for (const job of this.pendingSupport) { job.startIndex = 0; job.visited.clear(); job.anchors.clear(); job.queue = []; job.head = 0; }
    const seed = input.seed ?? hash(this.sequence, 0, 0, this.seed);
    const direction = unit(input.direction), energy = clamp(input.energyJ ?? 4, .1, 25);
    // Re-establish actual tip contact against remaining material, never a cached intact facade.
    const origin = { x: input.point.x - direction.x * .012, y: input.point.y - direction.y * .012, z: input.point.z - direction.z * .012 };
    const contact = this.raycast(origin, direction, .028);
    const result: MasonryImpactResult = {
      contact, removedNodes: 0, removedVolume: 0, removedByMaterial: {}, fragments: [], cracks: [], changedChunks: [], seed, bounds: null,
      stats: { milliseconds: 0, affectedNodes: 0, weakenedNodes: 0, connectivityVisited: 0, detachedNodes: 0, activeChunks: this.chunks.size },
    };
    if (!contact) { result.stats.milliseconds = performance.now() - started; return result; }
    let trimFloorZ: number | undefined;
    if (input.trim) {
      if (this.trimPatch && Math.hypot(contact.point.x - this.trimPatch.anchor.x, contact.point.y - this.trimPatch.anchor.y) > .065) this.trimPatch = null;
      if (!this.trimPatch) {
        const floorZ = this.establishTrimPlane(contact.point);
        if (floorZ !== null) this.trimPatch = { anchor: { ...contact.point }, floorZ };
      }
      result.stats.trimMode = Boolean(this.trimPatch); result.stats.trimFloorZ = this.trimPatch?.floorZ ?? null;
      if (!this.trimPatch && this.hasLocalExteriorOpening(contact.point)) {
        // A pinhole in a rounded shell may not yet expose a reliable backing.
        // Continue peeling its shallow lip instead of permanently refusing every
        // subsequent upward blow. This temporary guard cannot reach the rear bay.
        trimFloorZ = this.frontZ - .045;
        result.stats.trimMode = true;
      }
      trimFloorZ ??= this.trimPatch?.floorZ;
      // Searches queued by the preceding excavation must not later bypass the guard.
      if (trimFloorZ !== undefined) for (const job of this.pendingSupport) job.trimFloorZ = Math.max(job.trimFloorZ ?? -Infinity, trimFloorZ);
    }
    let edge = input.edge ? unit(input.edge) : unit({ x: 1 - direction.x * direction.x, y: -direction.x * direction.y, z: -direction.x * direction.z });
    const edgeDot = edge.x * direction.x + edge.y * direction.y + edge.z * direction.z;
    edge = unit({ x: edge.x - direction.x * edgeDot, y: edge.y - direction.y * edgeDot, z: edge.z - direction.z * edgeDot });
    if (Math.hypot(edge.x, edge.y, edge.z) < .5) edge = unit({ x: -direction.y, y: direction.x, z: 0 });
    const across = unit({ x: direction.y * edge.z - direction.z * edge.y, y: direction.z * edge.x - direction.x * edge.z, z: direction.x * edge.y - direction.y * edge.x });
    const incidence = clamp(-(direction.x * contact.normal.x + direction.y * contact.normal.y + direction.z * contact.normal.z), .05, 1);
    const shear = 1 - incidence;
    // A slanted flat blade wedges the brittle facing sideways. Couple this to
    // the wall plane so newly jagged triangle normals cannot flip its behaviour.
    // Very shallow grazing still has to retain some inward purchase.
    const tangentLength = Math.hypot(direction.x, direction.y);
    const pry = input.chisel === 'flat' ? clamp((tangentLength - .12) / .65, 0, 1) * clamp(Math.abs(direction.z) / .25, 0, 1) : 0;
    const tangent = tangentLength > 1e-6 ? { x: direction.x / tangentLength, y: direction.y / tangentLength } : { x: 0, y: 1 };
    const radius = input.chisel === 'flat' ? .046 : .038;
    const crackRadius = radius * 1.75 + pry * .035;
    const width = clamp(Number.isFinite(input.widthM) ? input.widthM! : .025, .01, .05);
    // Extend the finite cutting edge only along its own axis. The 25 mm reference
    // retains its established stress field; a wider blade shares that field over
    // a longer edge, without extending the penetration slab or adding blow energy.
    const edgeExtension = input.chisel === 'flat' ? (width - .025) * .5 : 0;
    const depthLimit = input.chisel === 'flat' ? .013 : .019;
    const c = this.coordinates(contact.point), r = Math.ceil((crackRadius + Math.max(0, edgeExtension)) / Math.min(this.hx, this.hy, this.hz)) + 1;
    const candidates: Array<{ node: Node; gain: number; crushing: boolean; fissure: boolean; distance: number }> = [];
    const removed: Node[] = [];
    // Persistent grain directions are tied to the material region, not a newly drawn
    // random line per hit. Narrow tensile corridors concentrate damage outside the
    // crushed core. Their material remains fully present until its strength fails.
    const grainSeed = hash(Math.floor(c.x / 5), Math.floor(c.y / 5), Math.floor(c.z / 5), this.seed);
    const grainAngle = (grainSeed % 6283) / 1000;
    // Local contact-facing slab: even a large energy setting cannot jump a chamber to its rear wall.
    for (let y = Math.max(1, c.y - r); y <= Math.min(this.ny, c.y + r); y++) for (let x = Math.max(1, c.x - r); x <= Math.min(this.nx, c.x + r); x++) for (let z = Math.max(1, c.z - r); z <= Math.min(this.nz, c.z + r); z++) {
      const material = this.nodeMaterial(x, y, z); if (!material) continue;
      const p = this.nodePosition(x, y, z), delta = { x: p.x - contact.point.x, y: p.y - contact.point.y, z: p.z - contact.point.z };
      if (trimFloorZ !== undefined) {
        // The exposed front lip is part of the flake being pried off. Protect
        // the backing, not that lip, or upward contact gets stuck on it forever.
        if (p.z <= trimFloorZ + this.hz + 1e-9) continue;
        if (!NEIGHBORS.some(d => this.nodeAirExposed(x + d[0], y + d[1], z + d[2]) && !this.nodeMaterial(x + d[0], y + d[1], z + d[2]))) continue;
      }
      const along = delta.x * direction.x + delta.y * direction.y + delta.z * direction.z;
      const wallDepth = -delta.z;
      const lateral = delta.x * tangent.x + delta.y * tangent.y;
      const sideways = delta.x * -tangent.y + delta.y * tangent.x;
      // Asymmetric shallow flake ahead of the blade, with a rough perimeter.
      // It cannot reach the next chamber wall just because the shaft is tilted.
      const plateLength = .025 + pry * .040;
      const plateWidth = .022 + width * .42;
      const plateRadius = Math.hypot((lateral - pry * .018) / plateLength, sideways / plateWidth);
      const plateEdge = 1 + .12 * Math.sin(Math.atan2(sideways, lateral) * 5 + grainAngle);
      const plate = pry > 0 && material === MaterialId.Clay && wallDepth >= -.010 && wallDepth <= .024 && plateRadius < plateEdge;
      if (!plate && (along < -.045 || along > depthLimit)) continue;
      const u = delta.x * edge.x + delta.y * edge.y + delta.z * edge.z;
      const v = delta.x * across.x + delta.y * across.y + delta.z * across.z;
      const stretch = input.chisel === 'flat' ? 1.55 : 1;
      const edgeDistance = Math.sign(u) * Math.max(0, Math.abs(u) - edgeExtension);
      const radial = Math.hypot(edgeDistance / stretch, v);
      if (radial > crackRadius) continue;
      const angular = Math.atan2(v, u), anisotropy = 1 + .18 * Math.sin(angular * 3 + (seed % 97)) + .12 * Math.cos(angular * 5 - (seed % 71));
      const effectiveRadius = radius * anisotropy;
      const core = radial < effectiveRadius;
      let corridor = false;
      for (let branch = 0; branch < 3; branch++) {
        const angle = grainAngle + branch * 2.094 + .22 * Math.sin(radial * 85 + branch);
        const forward = edgeDistance / stretch * Math.cos(angle) + v * Math.sin(angle);
        const sideways = Math.abs(edgeDistance / stretch * Math.sin(angle) - v * Math.cos(angle));
        if (forward > 0 && sideways < this.cellSize * .62) corridor = true;
      }
      const fissure = !core && corridor;
      const falloff = core ? Math.pow(Math.max(0, 1 - radial / effectiveRadius), .72) : (fissure ? .8 : .12) * Math.max(0, 1 - radial / crackRadius);
      const materialScale = material === MaterialId.Render ? 1.4 : material === MaterialId.Concrete ? .26 : material === MaterialId.Mortar ? .72 : 1;
      const backwardCoupling = along < -.008 ? .65 * Math.max(.1, 1 + along / .055) : 1;
      const address = this.chunkAddress(x, y, z), weakness = (this.chunks.get(address.key)?.damage[address.offset] ?? 0) / this.strength(x, y, z, material);
      // Grazing contact couples less crushing energy to intact clay, but a flat blade can
      // shear/pry an already weakened connected shell. Blade rotation remains independent.
      const angleCoupling = .45 + .55 * incidence + (input.chisel === 'flat' ? shear * Math.min(1, weakness) * .95 : 0);
      const crushingGain = energy * 25 * falloff * materialScale * backwardCoupling * angleCoupling * (.75 + (hash(x, y, z, seed) % 1000) / 2000) * Math.max(0, 1 - Math.max(0, along) / (depthLimit * 1.7));
      // Weakening accumulates across blows; existing cracks improve purchase.
      // Wedge efficiency releases a larger area at the same input blow energy.
      const plateGain = plate ? energy * 43 * pry * Math.pow(Math.max(0, 1 - plateRadius / plateEdge), .38) * (1 + Math.min(1, weakness) * .35) : 0;
      const gain = Math.max(crushingGain, plateGain);
      if (gain < 1) continue;
      candidates.push({ node: { x, y, z, id: this.index(x, y, z), material }, gain, crushing: core || plate, fissure, distance: plate ? plateRadius * radius : radial + Math.max(0, along) * 1.5 });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    // The stress field follows real material edges rather than line of sight. A cavity blocks
    // transmission through air while its connected shell/ribs can carry lateral fracture.
    const byId = new Map(candidates.map(candidate => [candidate.node.id, candidate]));
    const reached = new Set<number>(), frontier: Node[] = [];
    for (const candidate of candidates) {
      const p = this.nodePosition(candidate.node.x, candidate.node.y, candidate.node.z);
      if (Math.hypot(p.x - contact.point.x, p.y - contact.point.y, p.z - contact.point.z) <= this.cellSize * 1.65) {
        reached.add(candidate.node.id); frontier.push(candidate.node);
      }
    }
    for (let head = 0; head < frontier.length; head++) {
      const n = frontier[head];
      for (const d of NEIGHBORS) {
        const id = this.index(n.x + d[0], n.y + d[1], n.z + d[2]);
        if (reached.has(id)) continue;
        const candidate = byId.get(id); if (!candidate) continue;
        reached.add(id); frontier.push(candidate.node);
      }
    }
    let fractureBudget = energy * 16 * (1 + pry * 2.2);
    for (const candidate of candidates) {
      if (!reached.has(candidate.node.id)) continue;
      const n = candidate.node, { chunk, offset } = this.mutable(n.x, n.y, n.z);
      chunk.damage[offset] = clamp(chunk.damage[offset] + Math.max(1, Math.round(candidate.gain)), 0, 255);
      result.stats.affectedNodes++;
      // A tensile opening must advance from an existing broken face. It cannot
      // punch a disconnected decorative trench or jump across a hollow chamber.
      const brokenNeighbor = candidate.fissure ? NEIGHBORS.find(d => {
        const x = n.x + d[0], y = n.y + d[1], z = n.z + d[2];
        return this.baseMaterial(x, y, z) !== MaterialId.Air && this.nodeMaterial(x, y, z) === MaterialId.Air;
      }) : undefined;
      if (chunk.damage[offset] >= this.strength(n.x, n.y, n.z, n.material) && (candidate.crushing || brokenNeighbor) && fractureBudget > 0) {
        this.remove(n, removed); fractureBudget -= n.material === MaterialId.Concrete ? 5 : n.material === MaterialId.Mortar ? 1.6 : 1;
        if (candidate.fissure && brokenNeighbor) {
          result.stats.openedFissureNodes = (result.stats.openedFissureNodes ?? 0) + 1;
          result.cracks.push({ points: [this.nodePosition(n.x + brokenNeighbor[0], n.y + brokenNeighbor[1], n.z + brokenNeighbor[2]), this.nodePosition(n.x, n.y, n.z)], width: this.cellSize, material: n.material });
        }
      } else result.stats.weakenedNodes++;
    }
    if (removed.length) this.detachIslands(removed, result, c, r + 2, trimFloorZ);
    if (removed.length) this.exposeCavities(removed);
    // A broad flat edge releases connected shell flakes as well as fines. Keep
    // those flakes together instead of pulverising every strike into 10–20 nodes.
    // This only partitions material already removed by the same energy budget.
    this.aggregateFragments(removed, result, input.chisel === 'flat' ? Math.round(64 * width / .025 * (1 + pry * 2)) : 32);
    result.removedNodes = removed.length;
    result.removedVolume = result.fragments.reduce((sum, fragment) => sum + fragment.volume, 0);
    this.totalRemovedVolume += result.removedVolume;
    for (const n of removed) result.removedByMaterial[MATERIAL_NAMES[n.material]] = (result.removedByMaterial[MATERIAL_NAMES[n.material]] ?? 0) + 1;
    if (removed.length) {
      const points = removed.map(n => this.nodePosition(n.x, n.y, n.z));
      result.bounds = { min: { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)), z: Math.min(...points.map(p => p.z)) }, max: { x: Math.max(...points.map(p => p.x)), y: Math.max(...points.map(p => p.y)), z: Math.max(...points.map(p => p.z)) } };
    }
    result.changedChunks = [...this.dirty]; result.stats.activeChunks = this.chunks.size;
    result.stats.milliseconds = performance.now() - started; return result;
  }
  private detachIslands(removed: Node[], result: MasonryImpactResult, center: Vec3, radius: number, trimFloorZ?: number): void {
    const x0 = Math.max(1, center.x - radius), x1 = Math.min(this.nx, center.x + radius);
    const y0 = Math.max(1, center.y - radius), y1 = Math.min(this.ny, center.y + radius);
    const starts: Vec3[] = [];
    for (const n of removed) for (const d of NEIGHBORS) starts.push({ x: n.x + d[0], y: n.y + d[1], z: n.z + d[2] });
    const job: SupportJob = { starts, startIndex: 0, visited: new Set(), anchors: new Set(), queue: [], head: 0, x0, x1, y0, y1, trimFloorZ };
    if (!this.advanceSupport(job, this.maxConnectivityNodes, removed, result)) this.pendingSupport.push(job);
  }
  private advanceSupport(job: SupportJob, budget: number, removed: Node[], result: MasonryImpactResult): boolean {
    let steps = 0;
    while (steps < budget) {
      if (!job.queue.length) {
        let start: Vec3 | undefined;
        while (job.startIndex < job.starts.length) {
          const candidate = job.starts[job.startIndex++];
          if (!job.visited.has(this.index(candidate.x, candidate.y, candidate.z)) && this.nodeMaterial(candidate.x, candidate.y, candidate.z)) { start = candidate; break; }
        }
        if (!start) { result.stats.connectivityVisited += steps; return true; }
        const id = this.index(start.x, start.y, start.z);
        job.queue.push({ ...start, id, material: this.nodeMaterial(start.x, start.y, start.z) }); job.head = 0; job.visited.add(id);
      }
      let anchored = false;
      while (job.head < job.queue.length && steps < budget) {
        const n = job.queue[job.head++]; steps++;
        if ((job.trimFloorZ !== undefined && this.nodePosition(n.x, n.y, n.z).z <= job.trimFloorZ + this.hz + 1e-9) || n.x <= job.x0 || n.x >= job.x1 || n.y <= job.y0 || n.y >= job.y1 || n.z === this.nz || n.y <= 1 || n.x <= 1 || n.x >= this.nx) { anchored = true; break; }
        for (const d of NEIGHBORS) {
          const x = n.x + d[0], y = n.y + d[1], z = n.z + d[2], id = this.index(x, y, z);
          if (job.anchors.has(id)) { anchored = true; break; }
          if (job.visited.has(id)) continue;
          const material = this.nodeMaterial(x, y, z); if (!material) continue;
          job.visited.add(id); job.queue.push({ x, y, z, id, material });
        }
        if (anchored) break;
      }
      if (anchored) {
        // Every discovered vertex has a path to the same anchor; no need to scan the entire wall.
        for (const n of job.queue) job.anchors.add(n.id);
        job.queue = []; job.head = 0;
      } else if (job.head === job.queue.length) {
        const before = removed.length;
        for (const n of job.queue) if (this.nodeMaterial(n.x, n.y, n.z) && (job.trimFloorZ === undefined || this.nodePosition(n.x, n.y, n.z).z > job.trimFloorZ + this.hz + 1e-9)) this.remove(n, removed);
        const detached = removed.length - before; result.stats.detachedNodes += detached; this.totalDetached += detached;
        job.queue = []; job.head = 0;
      }
    }
    result.stats.connectivityVisited += steps; return false;
  }
  /** Continue a bounded connectivity search next frame instead of treating budget exhaustion as support. */
  processPendingSupport(maxNodes = this.maxConnectivityNodes): MasonryImpactResult | null {
    const job = this.pendingSupport[0]; if (!job) return null;
    const started = performance.now(), result: MasonryImpactResult = { contact: null, removedNodes: 0, removedVolume: 0, removedByMaterial: {}, fragments: [], cracks: [], changedChunks: [], seed: hash(this.sequence, this.totalDetached, 1, this.seed), bounds: null,
      stats: { milliseconds: 0, affectedNodes: 0, weakenedNodes: 0, connectivityVisited: 0, detachedNodes: 0, activeChunks: this.chunks.size } };
    const removed: Node[] = [];
    if (this.advanceSupport(job, maxNodes, removed, result)) this.pendingSupport.shift();
    if (removed.length) {
      this.exposeCavities(removed); this.aggregateFragments(removed, result);
      result.removedNodes = removed.length; result.removedVolume = result.fragments.reduce((sum, f) => sum + f.volume, 0); this.totalRemovedVolume += result.removedVolume;
      for (const n of removed) result.removedByMaterial[MATERIAL_NAMES[n.material]] = (result.removedByMaterial[MATERIAL_NAMES[n.material]] ?? 0) + 1;
      result.changedChunks = [...this.dirty];
      for (const pending of this.pendingSupport) if (pending !== job) { pending.startIndex = 0; pending.visited.clear(); pending.anchors.clear(); pending.queue = []; pending.head = 0; }
    }
    result.stats.activeChunks = this.chunks.size; result.stats.milliseconds = performance.now() - started; return result;
  }
  private fragmentDescriptor(nodes: Node[], detached: boolean): MasonryFragment {
    const points = nodes.map(n => this.nodePosition(n.x, n.y, n.z));
    const min = { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)), z: Math.min(...points.map(p => p.z)) };
    const max = { x: Math.max(...points.map(p => p.x)), y: Math.max(...points.map(p => p.y)), z: Math.max(...points.map(p => p.z)) };
    return { position: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 }, size: { x: max.x - min.x + this.hx, y: max.y - min.y + this.hy, z: max.z - min.z + this.hz }, material: nodes[0].material, volume: nodes.length * this.nodeVolume, detached };
  }
  private aggregateFragments(removed: Node[], result: MasonryImpactResult, crushedGroupLimit = 64): void {
    // Clip the exact before-solid minus after-solid in every affected tetrahedron. Meshing only
    // the removed nodes would shrink isolated chips and invent a mismatch between geometry and mass.
    const crushedCount = removed.length - result.stats.detachedNodes;
    const detached = new Set(removed.slice(crushedCount).map(n => n.id));
    const removedMap = new Map(removed.map(n => [n.id, n]));
    const remaining = new Map(removedMap), owners = new Map<number, number>();
    const groups: Array<{ descriptor: MasonryFragment; mesh: MeshBuilder }> = [];
    while (remaining.size) {
      const start = remaining.values().next().value as Node;
      const group = [start]; remaining.delete(start.id);
      // A large connected flake, then a small edge chip: neither spans air or
      // crosses a material boundary. Detached islands remain whole as before.
      const isDetached = detached.has(start.id);
      const fine = groups.length % 3 === 1;
      const limit = isDetached ? 500 : fine ? Math.min(6, crushedGroupLimit) : crushedGroupLimit;
      for (let head = 0; head < group.length && group.length < limit; head++) {
        const n = group[head];
        for (const d of NEIGHBORS) {
          const id = this.index(n.x + d[0], n.y + d[1], n.z + d[2]), neighbor = remaining.get(id);
          if (!neighbor || neighbor.material !== start.material || group.length >= limit || detached.has(id) !== isDetached) continue;
          group.push(neighbor); remaining.delete(id);
        }
      }
      const descriptor = this.fragmentDescriptor(group, isDetached); descriptor.volume = 0;
      for (const node of group) owners.set(node.id, groups.length);
      groups.push({ descriptor, mesh: new MeshBuilder() });
    }
    const cubes = new Map<number, Vec3>();
    for (const n of removed) for (const dx of [-1, 0]) for (const dy of [-1, 0]) for (const dz of [-1, 0]) {
      const x = n.x + dx, y = n.y + dy, z = n.z + dz;
      if (x >= 0 && y >= 0 && z >= 0 && x <= this.nx && y <= this.ny && z <= this.nz) cubes.set(this.index(x, y, z), { x, y, z });
    }
    for (const c of cubes.values()) {
      const ids = CORNERS.map(offset => this.index(c.x + offset[0], c.y + offset[1], c.z + offset[2]));
      const after = CORNERS.map(offset => Number(this.nodeMaterial(c.x + offset[0], c.y + offset[1], c.z + offset[2]) !== MaterialId.Air));
      const before = after.map((material, i) => removedMap.has(ids[i]) ? 1 : material);
      const points = CORNERS.map(offset => this.nodePosition(c.x + offset[0], c.y + offset[1], c.z + offset[2]));
      for (const tetra of TETRA) {
        const ownerCorner = tetra.find(i => owners.has(ids[i])); if (ownerCorner === undefined) continue;
        const group = groups[owners.get(ids[ownerCorner])!];
        const poly = clippedTetra(tetra.map(i => points[i]), tetra.map(i => before[i]), tetra.map(i => after[i]));
        if (poly.volume < 1e-15) continue;
        group.descriptor.volume += poly.volume;
        const all = poly.faces.flat(), center = { x: 0, y: 0, z: 0 };
        for (const p of all) { center.x += p.x / all.length; center.y += p.y / all.length; center.z += p.z / all.length; }
        const color = this.materialColor(group.descriptor.material, c.x, c.y, c.z);
        for (const face of poly.faces) for (let i = 1; i < face.length - 1; i++) group.mesh.triangle(face[0], face[i], face[i + 1], color, { x: face[0].x - center.x, y: face[0].y - center.y, z: face[0].z - center.z });
      }
    }
    for (const group of groups) {
      if (group.descriptor.volume < 1e-15) continue;
      const positions = new Float32Array(group.mesh.positions), min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
      for (let i = 0; i < positions.length; i += 3) { min.x = Math.min(min.x, positions[i]); min.y = Math.min(min.y, positions[i + 1]); min.z = Math.min(min.z, positions[i + 2]); max.x = Math.max(max.x, positions[i]); max.y = Math.max(max.y, positions[i + 1]); max.z = Math.max(max.z, positions[i + 2]); }
      const position = { x: (min.x + max.x) * .5, y: (min.y + max.y) * .5, z: (min.z + max.z) * .5 };
      for (let i = 0; i < positions.length; i += 3) { positions[i] -= position.x; positions[i + 1] -= position.y; positions[i + 2] -= position.z; }
      result.fragments.push({ ...group.descriptor, position, size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z }, positions });
    }
  }
  serialize(): MasonrySave {
    return { version: 1, seed: this.seed, sequence: this.sequence, removedVolume: this.totalRemovedVolume, options: { ...this.options, seed: this.seed }, pendingSupport: this.pendingSupport.map(job => ({ starts: job.starts, x0: job.x0, x1: job.x1, y0: job.y0, y1: job.y1, ...(job.trimFloorZ !== undefined ? { trimFloorZ: job.trimFloorZ } : {}) })), chunks: [...this.chunks].map(([key, chunk]) => {
      const edits: Array<[number, number, number]> = [];
      for (let i = 0; i < chunk.damage.length; i++) if (chunk.damage[i] || chunk.removed[i]) edits.push([i, chunk.damage[i], chunk.removed[i]]);
      return { key, edits };
    }) };
  }
  restore(save: MasonrySave): void {
    if (save.version !== 1 || save.seed !== this.seed) throw new Error('Masonry save version or seed mismatch');
    const profile = save.options.hollowProfile ?? 'legacy-rectangular';
    if (profile !== this.options.hollowProfile) {
      this.options.hollowProfile = profile;
      for (const key of this.chunkKeys) this.dirty.add(key);
    }
    for (const key of this.chunks.keys()) this.dirty.add(key);
    this.trimPatch = null; this.chunks.clear(); this.exposedAir.clear(); this.pendingSupport.length = 0; this.totalRemoved = 0; this.totalDetached = 0; this.totalRemovedVolume = save.removedVolume ?? 0; this.sequence = save.sequence;
    for (const job of save.pendingSupport ?? []) this.pendingSupport.push({ ...job, startIndex: 0, visited: new Set(), anchors: new Set(), queue: [], head: 0 });
    const count = this.tileSize * this.tileSize * (this.nz + 2);
    for (const entry of save.chunks) {
      const chunk: Chunk = { damage: new Uint8Array(count), removed: new Uint8Array(count), changes: 0 };
      for (const [i, damage, removed] of entry.edits) {
        if (i < 0 || i >= count) throw new Error('Masonry save node out of bounds');
        chunk.damage[i] = damage; chunk.removed[i] = removed; this.totalRemoved += Number(!!removed); chunk.changes += Number(!!removed);
      }
      this.chunks.set(entry.key, chunk); this.dirty.add(entry.key);
    }
    const removed: Node[] = [];
    for (const [key, chunk] of this.chunks) {
      const [tx, ty] = key.split(',').map(Number);
      for (let i = 0; i < chunk.removed.length; i++) if (chunk.removed[i]) {
        const z = i % (this.nz + 2), xy = Math.floor(i / (this.nz + 2));
        const x = tx * this.tileSize + xy % this.tileSize, y = ty * this.tileSize + Math.floor(xy / this.tileSize);
        removed.push({ x, y, z, id: this.index(x, y, z), material: this.baseMaterial(x, y, z) }); this.markDirty(x, y);
      }
    }
    this.exposeCavities(removed);
  }
}
