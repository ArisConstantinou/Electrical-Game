import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';
import type { InstallationDefinition } from '../data/installationRules';

interface RemovableBrick { mesh: THREE.Mesh; marker: THREE.Group; recessed: boolean }
interface BrickTarget {
  id: string;
  object: THREE.Object3D;
  instanceId?: number;
  center: THREE.Vector3;
  rotationZ: number;
  size: THREE.Vector3;
  damage: number;
  destroyed: boolean;
  originalHidden: boolean;
  carvedCells: Set<number>;
  replacement: THREE.Group | null;
  cracks: THREE.Group | null;
}
interface AimHit { point: THREE.Vector3; target: BrickTarget }

export type SprayMode = 'dots' | 'live';
export type MasonryImpactKind = 'chase-chip' | 'demolish-chip' | 'demolish-crack' | 'demolish-spall' | 'demolish-break';
export interface MasonryImpact {
  points: THREE.Vector3[];
  kind: MasonryImpactKind;
  brickSize: THREE.Vector3;
  seed: number;
  destroyed: boolean;
}

const brickGeometry = new THREE.BoxGeometry(0.286, 0.125, 0.18);
const unitBoxGeometry = new THREE.BoxGeometry(1, 1, 1);
const brickMaterial = new THREE.MeshStandardMaterial({ color: 0xb84b2a, roughness: 0.96, metalness: 0 });
const removableMaterial = new THREE.MeshStandardMaterial({ color: 0xb94d2b, roughness: 0.97, metalness: 0 });
const chasedBrickMaterial = new THREE.MeshStandardMaterial({ color: 0xb24a2a, roughness: 0.99, metalness: 0 });
const chaseBackMaterial = new THREE.MeshStandardMaterial({ color: 0x914126, roughness: 1, metalness: 0, emissive: 0x210904, emissiveIntensity: 0.22 });
const chaseSideMaterial = new THREE.MeshStandardMaterial({ color: 0x3e1812, roughness: 1, metalness: 0 });
const fractureMaterial = new THREE.LineBasicMaterial({ color: 0x4f1c13, transparent: true, opacity: 0.92, depthTest: true });
const CHASE_GRID_X = 20;
const CHASE_GRID_Y = 10;
const CHASE_DEPTH = 0.055;
const DEMOLISH_HITS = 4;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seeded(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

export class BrickWall extends THREE.Group {
  private readonly removableByPoint = new Map<string, RemovableBrick[]>();
  private readonly breakables: THREE.Object3D[] = [];
  private readonly targets: BrickTarget[] = [];
  private readonly targetsById = new Map<string, BrickTarget>();
  private readonly instancedTargets = new WeakMap<THREE.InstancedMesh, Map<number, BrickTarget>>();
  private readonly raycaster = new THREE.Raycaster();
  private heldDemolitionTarget: BrickTarget | null = null;
  private readonly sprayMarks: Array<{ pointId: string; mesh: THREE.Mesh }> = [];
  private readonly spraySamplesByPoint = new Map<string, THREE.Vector3[]>();
  private readonly liveSpraySamplesByPoint = new Map<string, number>();
  private readonly chasedSamplesByPoint = new Map<string, Set<number>>();
  private readonly chasePassByPoint = new Map<string, number>();
  private readonly livePaintCanvas = document.createElement('canvas');
  private readonly livePaintContext: CanvasRenderingContext2D;
  private readonly livePaintTexture: THREE.CanvasTexture;
  private lastLivePoint: THREE.Vector3 | null = null;
  private liveStrokeSamples = 0;
  private chaseRecessedBricks = 0;
  private chaseCarvedCells = 0;
  private damagedBricks = 0;
  private destroyedBricks = 0;

  constructor(definitions: InstallationDefinition[]) {
    super();
    this.name = 'Unplastered hollow clay brick wall';
    this.userData.studioEntityId = 'world:brick-wall';
    this.livePaintCanvas.width = 2048;
    this.livePaintCanvas.height = 1024;
    const context = this.livePaintCanvas.getContext('2d');
    if (!context) throw new Error('2D paint canvas is unavailable');
    this.livePaintContext = context;
    this.livePaintTexture = new THREE.CanvasTexture(this.livePaintCanvas);
    this.livePaintTexture.colorSpace = THREE.SRGBColorSpace;

    const cols = 21;
    const rows = 23;
    const brickW = GAME_CONFIG.room.width / cols;
    const brickH = GAME_CONFIG.room.height / rows;
    const fixedEntries: Array<{ matrix: THREE.Matrix4; center: THREE.Vector3; rotationZ: number; size: THREE.Vector3; id: string }> = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const stagger = row % 2 === 0 ? 0 : brickW / 2;
        const x = -GAME_CONFIG.room.width / 2 + brickW / 2 + col * brickW + stagger;
        if (x > GAME_CONFIG.room.width / 2 - 0.02) continue;
        const y = brickH / 2 + row * brickH;
        const owner = definitions.find(definition => this.inChaseZone(definition, x, y, brickW, brickH));
        const center = new THREE.Vector3(x + Math.sin(row * 4.7 + col) * 0.004, y, -2.5 + Math.sin(col * 2.1 + row) * 0.006);
        const rotationZ = Math.sin(col * 1.9 + row) * 0.007;
        const size = new THREE.Vector3(brickW * 0.985, brickH * 0.965, 0.18);
        const scale = new THREE.Vector3(size.x / 0.286, size.y / 0.125, 1);
        const matrix = new THREE.Matrix4().compose(center, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rotationZ)), scale);
        const id = `brick-${row}-${col}`;
        if (!owner) {
          fixedEntries.push({ matrix, center, rotationZ, size, id });
          continue;
        }
        const brick = new THREE.Mesh(brickGeometry, removableMaterial.clone());
        brick.applyMatrix4(matrix);
        brick.castShadow = true;
        brick.receiveShadow = true;
        brick.name = `Removable brick section ${owner.id}`;
        brick.userData.studioEntityId = `point-${owner.id}:removable-brick-${row}-${col}`;
        const marker = this.createMarker(owner.id);
        marker.visible = false;
        brick.add(marker);
        const list = this.removableByPoint.get(owner.id) ?? [];
        list.push({ mesh: brick, marker, recessed: false });
        this.removableByPoint.set(owner.id, list);
        this.breakables.push(brick);
        this.add(brick);
        this.registerTarget({ id, object: brick, center, rotationZ, size });
      }
    }

    const fixed = new THREE.InstancedMesh(brickGeometry, brickMaterial, fixedEntries.length);
    fixed.name = 'Optimized permanent brick field';
    fixed.userData.studioEntityId = 'world:brick-wall:permanent-field';
    fixed.castShadow = true;
    fixed.receiveShadow = true;
    const fixedMap = new Map<number, BrickTarget>();
    fixedEntries.forEach((entry, index) => {
      fixed.setMatrixAt(index, entry.matrix);
      fixedMap.set(index, this.registerTarget({ ...entry, object: fixed, instanceId: index }));
    });
    this.instancedTargets.set(fixed, fixedMap);
    fixed.instanceMatrix.needsUpdate = true;
    this.breakables.push(fixed);
    this.add(fixed);

    const paintSurface = new THREE.Mesh(
      new THREE.PlaneGeometry(GAME_CONFIG.room.width, GAME_CONFIG.room.height),
      new THREE.MeshBasicMaterial({ map: this.livePaintTexture, transparent: true, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    paintSurface.name = 'Continuous live spray paint surface';
    paintSurface.userData.studioEntityId = 'world:brick-wall:live-paint';
    paintSurface.position.set(0, GAME_CONFIG.room.height / 2, -2.39);
    paintSurface.renderOrder = 2;
    paintSurface.raycast = () => undefined;
    this.add(paintSurface);
  }

  aim(camera: THREE.Camera, maxDistance = GAME_CONFIG.interaction.maxDistance): AimHit | null {
    return this.cast(camera, 0, 0, maxDistance);
  }

  private registerTarget(source: Omit<BrickTarget, 'damage' | 'destroyed' | 'originalHidden' | 'carvedCells' | 'replacement' | 'cracks'>): BrickTarget {
    const target: BrickTarget = { ...source, center: source.center.clone(), size: source.size.clone(), damage: 0, destroyed: false, originalHidden: false, carvedCells: new Set(), replacement: null, cracks: null };
    this.targets.push(target);
    this.targetsById.set(target.id, target);
    return target;
  }

  private resolveTarget(object: THREE.Object3D, instanceId?: number): BrickTarget | null {
    const replacementId = object.userData.brickTargetId;
    if (typeof replacementId === 'string') return this.targetsById.get(replacementId) ?? null;
    if (object instanceof THREE.InstancedMesh && instanceId !== undefined) return this.instancedTargets.get(object)?.get(instanceId) ?? null;
    return this.targets.find(target => target.object === object) ?? null;
  }

  private cast(camera: THREE.Camera, screenX: number, screenY: number, maxDistance: number): AimHit | null {
    this.raycaster.setFromCamera(new THREE.Vector2(screenX, screenY), camera);
    const hit = this.raycaster.intersectObjects(this.breakables, false).find(candidate => {
      if (candidate.distance > maxDistance || !candidate.object.visible) return false;
      const target = this.resolveTarget(candidate.object, candidate.instanceId);
      return Boolean(target && !target.destroyed);
    });
    if (!hit) return null;
    const target = this.resolveTarget(hit.object, hit.instanceId);
    return target ? { point: hit.point.clone(), target } : null;
  }

  spray(camera: THREE.Camera, pointId: string, mode: SprayMode = 'dots', color = 0x087fce): THREE.Vector3 | null {
    const hit = this.aim(camera);
    if (!hit) return null;
    this.recordSpraySample(pointId, hit.point);
    if (mode === 'dots') {
      this.addSprayDab(hit.point, pointId, color, 0.018 + Math.random() * 0.012, 0.82);
      this.lastLivePoint = null;
    } else {
      this.paintLiveStroke(this.lastLivePoint ?? hit.point, hit.point, color);
      this.liveStrokeSamples += 1;
      this.liveSpraySamplesByPoint.set(pointId, (this.liveSpraySamplesByPoint.get(pointId) ?? 0) + 1);
      this.lastLivePoint = hit.point.clone();
    }
    return hit.point;
  }

  endSprayStroke(): void { this.lastLivePoint = null; }

  private paintLiveStroke(from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    const context = this.livePaintContext;
    const start = this.toPaintPixel(from);
    const end = this.toPaintPixel(to);
    const cssColor = `#${color.toString(16).padStart(6, '0')}`;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const [width, alpha] of [[34, 0.1], [27, 0.2], [20, 0.62]] as const) {
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.lineWidth = width;
      context.globalAlpha = alpha;
      context.strokeStyle = cssColor;
      context.stroke();
    }
    const centre = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    context.globalAlpha = 0.22;
    context.fillStyle = cssColor;
    for (let mist = 0; mist < 4; mist += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 15 + Math.random() * 18;
      context.beginPath();
      context.arc(centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius, 1 + Math.random() * 2.2, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    this.livePaintTexture.needsUpdate = true;
  }

  private toPaintPixel(point: THREE.Vector3): { x: number; y: number } {
    return { x: (point.x / GAME_CONFIG.room.width + 0.5) * this.livePaintCanvas.width, y: (1 - point.y / GAME_CONFIG.room.height) * this.livePaintCanvas.height };
  }

  private recordSpraySample(pointId: string, point: THREE.Vector3): void {
    const samples = this.spraySamplesByPoint.get(pointId) ?? [];
    const previous = samples.at(-1);
    if (!previous || previous.distanceToSquared(point) > 0.0025) samples.push(point.clone());
    if (samples.length > 1800) samples.splice(0, samples.length - 1800);
    this.spraySamplesByPoint.set(pointId, samples);
  }

  private hasSprayNear(pointId: string, point: THREE.Vector3, radius = 0.42): boolean {
    const radiusSquared = radius * radius;
    return (this.spraySamplesByPoint.get(pointId) ?? []).some(sample => {
      const dx = sample.x - point.x;
      const dy = sample.y - point.y;
      return dx * dx + dy * dy <= radiusSquared;
    });
  }

  private addSprayDab(position: THREE.Vector3, pointId: string, color: number, radius: number, opacity: number): void {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const dab = new THREE.Mesh(new THREE.CircleGeometry(radius, 10), material);
    dab.name = `Spray mark ${pointId}`;
    dab.userData.studioEntityId = `point-${pointId}:free-mark-${this.sprayMarks.length}`;
    dab.position.copy(position);
    dab.position.z += 0.004 + Math.random() * 0.001;
    dab.scale.y = 0.78 + Math.random() * 0.32;
    dab.rotation.z = Math.random() * Math.PI;
    dab.raycast = () => undefined;
    this.add(dab);
    this.sprayMarks.push({ pointId, mesh: dab });
    if (this.sprayMarks.length > 1400) {
      const oldest = this.sprayMarks.shift();
      if (oldest) { this.remove(oldest.mesh); oldest.mesh.geometry.dispose(); (oldest.mesh.material as THREE.Material).dispose(); }
    }
  }

  removeAtAim(camera: THREE.Camera, continuing = false): MasonryImpact | null {
    let hit: AimHit | null = null;
    if (continuing && this.heldDemolitionTarget && !this.heldDemolitionTarget.destroyed) {
      const target = this.heldDemolitionTarget;
      hit = { target, point: target.center.clone().add(new THREE.Vector3(0, 0, target.size.z / 2)) };
    } else {
      const offsets: number[][] = [[0, 0]];
      for (const y of [-0.12, -0.06, 0, 0.06, 0.12]) for (const x of [-0.16, -0.08, 0, 0.08, 0.16]) if (x !== 0 || y !== 0) offsets.push([x, y]);
      hit = offsets.map(([x, y]) => this.cast(camera, x, y, 4.5)).find(Boolean) ?? null;
      this.heldDemolitionTarget = hit?.target ?? null;
    }
    if (!hit) return null;
    const target = hit.target;
    if (target.damage === 0) this.damagedBricks += 1;
    target.damage = Math.min(DEMOLISH_HITS, target.damage + 1);
    const seed = hashString(`${target.id}:${target.damage}`);
    this.addFractures(target, hit.point, target.damage, seed);
    this.clearPaintAt(hit.point, target.damage === DEMOLISH_HITS ? 0.19 : 0.045);
    let kind: MasonryImpactKind = target.damage === 1 ? 'demolish-chip' : target.damage === 2 ? 'demolish-crack' : 'demolish-spall';
    let destroyed = false;
    const impactPoints = [hit.point];
    if (target.damage >= DEMOLISH_HITS) {
      kind = 'demolish-break';
      destroyed = true;
      target.destroyed = true;
      this.damagedBricks = Math.max(0, this.damagedBricks - 1);
      this.destroyedBricks += 1;
      this.hideOriginal(target);
      this.removeReplacement(target);
      this.removeCracks(target);
      this.heldDemolitionTarget = null;
    }
    return { points: impactPoints, kind, brickSize: target.size.clone(), seed, destroyed };
  }

  recessChaseAtAim(camera: THREE.Camera, pointId: string): MasonryImpact | null {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const aimPoint = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 2.39), new THREE.Vector3());
    if (!aimPoint || aimPoint.distanceTo(camera.position) > 4.5 || !this.hasSprayNear(pointId, aimPoint)) return null;
    const samples = this.spraySamplesByPoint.get(pointId) ?? [];
    if (samples.length === 0) return null;
    const processed = this.chasedSamplesByPoint.get(pointId) ?? new Set<number>();
    const nearestIndex = samples.reduce((best, sample, index) => sample.distanceToSquared(aimPoint) < best.distance ? { index, distance: sample.distanceToSquared(aimPoint) } : best, { index: 0, distance: Number.POSITIVE_INFINITY }).index;
    const batchSize = Math.max(1, Math.ceil(samples.length / 4));
    const selected = samples.map((_, index) => ({ index, distance: Math.min(Math.abs(index - nearestIndex), samples.length - Math.abs(index - nearestIndex)) }))
      .sort((a, b) => a.distance - b.distance).map(item => item.index).filter(index => !processed.has(index)).slice(0, batchSize);
    const pass = this.chasePassByPoint.get(pointId) ?? 0;
    const offsets = [new THREE.Vector2(0, 0), new THREE.Vector2(0.055, 0.015), new THREE.Vector2(-0.055, -0.015), new THREE.Vector2(0, -0.065)];
    const workPoints = selected.length > 0 ? selected.map(index => samples[index]) : [samples[nearestIndex].clone().add(new THREE.Vector3(offsets[pass % 4].x, offsets[pass % 4].y, 0))];
    const impacts: THREE.Vector3[] = [];
    for (const point of workPoints) {
      let carved = false;
      for (const target of this.findTargetsNearPoint(point, 0.045)) {
        const before = target.carvedCells.size;
        this.carveTargetAtPoint(target, point, hashString(`${pointId}:${target.id}:${pass}:${impacts.length}`));
        if (target.carvedCells.size > before) carved = true;
        const removable = (this.removableByPoint.get(pointId) ?? []).find(item => item.mesh === target.object);
        if (removable) removable.recessed = true;
      }
      if (carved) impacts.push(point.clone());
      // The visible spray includes a soft line and scattered mist extending
      // beyond its centreline. Clear the whole worked corridor as it is chased.
      this.clearPaintAt(point, 0.115);
    }
    selected.forEach(index => processed.add(index));
    this.chasedSamplesByPoint.set(pointId, processed);
    this.chasePassByPoint.set(pointId, pass + 1);
    if (processed.size >= samples.length) this.clearCompletedChasePaint(pointId, samples);
    if (impacts.length === 0) return null;
    return { points: impacts.slice(0, 10), kind: 'chase-chip', brickSize: new THREE.Vector3(0.055, 0.045, CHASE_DEPTH), seed: hashString(`${pointId}:chase:${pass}`), destroyed: false };
  }

  get freeMarkCount(): number { return this.sprayMarks.length + this.liveStrokeSamples; }
  get destroyedBrickCount(): number { return this.destroyedBricks; }
  get damagedBrickCount(): number { return this.damagedBricks; }
  get recessedBrickCount(): number { return this.chaseRecessedBricks; }
  get carvedCellCount(): number { return this.chaseCarvedCells; }
  get chaseDepthMm(): number { return CHASE_DEPTH * 1000; }
  get chaseBackSurfaceCount(): number { return this.targets.reduce((count, target) => count + Number(target.replacement?.userData.chaseBackSurfaces ?? 0), 0); }
  get chaseSideWallCount(): number { return this.targets.reduce((count, target) => count + Number(target.replacement?.userData.chaseSideWalls ?? 0), 0); }
  get uniqueFracturePatternCount(): number { return 0; }
  get anchoredRemnantCount(): number { return this.targets.filter(target => target.destroyed && target.replacement !== null).length; }
  get floatingStaticPieceCount(): number {
    return this.targets.filter(target => target.destroyed && target.replacement !== null).length;
  }
  get unsupportedAnchoredRemnantCount(): number {
    return this.floatingStaticPieceCount;
  }
  getChaseCoverage(pointId: string): number {
    const total = this.spraySamplesByPoint.get(pointId)?.length ?? 0;
    return total === 0 ? 0 : THREE.MathUtils.clamp((this.chasedSamplesByPoint.get(pointId)?.size ?? 0) / total, 0, 1);
  }

  showMarks(pointId: string): void { this.removableByPoint.get(pointId)?.forEach(item => { item.marker.visible = true; }); }

  removeFraction(pointId: string, fraction: number): THREE.Vector3[] {
    const bricks = this.removableByPoint.get(pointId) ?? [];
    const target = Math.ceil(bricks.length * THREE.MathUtils.clamp(fraction, 0, 1));
    const debris: THREE.Vector3[] = [];
    bricks.forEach((item, index) => {
      if (index < target && item.mesh.visible) {
        const position = new THREE.Vector3();
        item.mesh.getWorldPosition(position);
        debris.push(position);
        item.mesh.visible = false;
      }
    });
    return debris;
  }

  remaining(pointId: string): number { return (this.removableByPoint.get(pointId) ?? []).filter(item => item.mesh.visible).length; }

  private findTargetsNearPoint(point: THREE.Vector3, margin: number): BrickTarget[] {
    return this.targets.filter(target => {
      if (target.destroyed) return false;
      const dx = point.x - target.center.x;
      const dy = point.y - target.center.y;
      const cosine = Math.cos(-target.rotationZ);
      const sine = Math.sin(-target.rotationZ);
      const localX = dx * cosine - dy * sine;
      const localY = dx * sine + dy * cosine;
      return Math.abs(localX) <= target.size.x / 2 + margin && Math.abs(localY) <= target.size.y / 2 + margin;
    });
  }

  private carveTargetAtPoint(target: BrickTarget, point: THREE.Vector3, seed: number): void {
    const previousCount = target.carvedCells.size;
    const dx = point.x - target.center.x;
    const dy = point.y - target.center.y;
    const cosine = Math.cos(-target.rotationZ);
    const sine = Math.sin(-target.rotationZ);
    const localX = dx * cosine - dy * sine;
    const localY = dx * sine + dy * cosine;
    const cellW = target.size.x / CHASE_GRID_X;
    const cellH = target.size.y / CHASE_GRID_Y;
    const random = seeded(seed);
    let closestCell = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let row = 0; row < CHASE_GRID_Y; row += 1) {
      for (let col = 0; col < CHASE_GRID_X; col += 1) {
        const cellX = -target.size.x / 2 + cellW * (col + 0.5);
        const cellY = -target.size.y / 2 + cellH * (row + 0.5);
        const distance = Math.hypot(cellX - localX, cellY - localY);
        const index = row * CHASE_GRID_X + col;
        if (distance < closestDistance) { closestDistance = distance; closestCell = index; }
        if (distance <= 0.048 * (0.84 + random() * 0.34)) target.carvedCells.add(index);
      }
    }
    target.carvedCells.add(closestCell);
    if (previousCount === 0) this.chaseRecessedBricks += 1;
    this.chaseCarvedCells += target.carvedCells.size - previousCount;
    this.hideOriginal(target);
    this.rebuildChasedBrick(target);
  }

  private rebuildChasedBrick(target: BrickTarget): void {
    this.removeReplacement(target);
    const group = new THREE.Group();
    group.name = `Fractured chase section ${target.id}`;
    group.userData.studioEntityId = `world:brick-wall:chase-${target.id}`;
    group.position.copy(target.center);
    group.rotation.z = target.rotationZ;
    const cellW = target.size.x / CHASE_GRID_X;
    const cellH = target.size.y / CHASE_GRID_Y;
    const intactMatrices: THREE.Matrix4[] = [];
    const backMatrices: THREE.Matrix4[] = [];
    const sideMatrices: THREE.Matrix4[] = [];
    const backThickness = 0.012;
    const frontZ = target.size.z / 2;
    const backSurfaceZ = frontZ - CHASE_DEPTH;
    const cavityCentreZ = frontZ - CHASE_DEPTH / 2;
    const edgeThickness = Math.min(0.006, cellW * 0.25, cellH * 0.25);
    const isCarved = (row: number, col: number): boolean => row >= 0 && row < CHASE_GRID_Y && col >= 0 && col < CHASE_GRID_X && target.carvedCells.has(row * CHASE_GRID_X + col);
    for (let row = 0; row < CHASE_GRID_Y; row += 1) for (let col = 0; col < CHASE_GRID_X; col += 1) {
      const carved = target.carvedCells.has(row * CHASE_GRID_X + col);
      const cellX = -target.size.x / 2 + cellW * (col + 0.5);
      const cellY = -target.size.y / 2 + cellH * (row + 0.5);
      if (!carved) {
        intactMatrices.push(new THREE.Matrix4().compose(
          new THREE.Vector3(cellX, cellY, 0),
          new THREE.Quaternion(),
          new THREE.Vector3(cellW * 1.006, cellH * 1.008, target.size.z),
        ));
        continue;
      }
      backMatrices.push(new THREE.Matrix4().compose(
        new THREE.Vector3(cellX, cellY, backSurfaceZ - backThickness / 2),
        new THREE.Quaternion(),
        new THREE.Vector3(cellW * 1.035, cellH * 1.04, backThickness),
      ));
      const addVerticalSide = (x: number): void => {
        sideMatrices.push(new THREE.Matrix4().compose(
          new THREE.Vector3(x, cellY, cavityCentreZ),
          new THREE.Quaternion(),
          new THREE.Vector3(edgeThickness, cellH * 1.04, CHASE_DEPTH),
        ));
      };
      const addHorizontalSide = (y: number): void => {
        sideMatrices.push(new THREE.Matrix4().compose(
          new THREE.Vector3(cellX, y, cavityCentreZ),
          new THREE.Quaternion(),
          new THREE.Vector3(cellW * 1.04, edgeThickness, CHASE_DEPTH),
        ));
      };
      if (!isCarved(row, col - 1)) addVerticalSide(cellX - cellW / 2);
      if (!isCarved(row, col + 1)) addVerticalSide(cellX + cellW / 2);
      if (!isCarved(row - 1, col)) addHorizontalSide(cellY - cellH / 2);
      if (!isCarved(row + 1, col)) addHorizontalSide(cellY + cellH / 2);
    }
    const addCells = (matrices: THREE.Matrix4[], material: THREE.Material, name: string): void => {
      if (matrices.length === 0) return;
      const mesh = new THREE.InstancedMesh(unitBoxGeometry, material, matrices.length);
      mesh.name = name;
      mesh.userData.brickTargetId = target.id;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      this.breakables.push(mesh);
    };
    addCells(intactMatrices, chasedBrickMaterial, `Jagged intact cells ${target.id}`);
    addCells(backMatrices, chaseBackMaterial, `55 mm recessed back surfaces ${target.id}`);
    addCells(sideMatrices, chaseSideMaterial, `55 mm dark chase side walls ${target.id}`);
    group.userData.chaseBackSurfaces = backMatrices.length;
    group.userData.chaseSideWalls = sideMatrices.length;
    group.userData.chaseDepthMm = CHASE_DEPTH * 1000;
    this.add(group);
    target.replacement = group;
  }

  private hideOriginal(target: BrickTarget): void {
    if (target.originalHidden) return;
    target.originalHidden = true;
    if (target.object instanceof THREE.InstancedMesh && target.instanceId !== undefined) {
      const matrix = new THREE.Matrix4();
      target.object.getMatrixAt(target.instanceId, matrix);
      matrix.scale(new THREE.Vector3(0.0001, 0.0001, 0.0001));
      target.object.setMatrixAt(target.instanceId, matrix);
      target.object.instanceMatrix.needsUpdate = true;
    } else target.object.visible = false;
  }

  private removeReplacement(target: BrickTarget): void {
    if (!target.replacement) return;
    target.replacement.traverse(object => {
      const index = this.breakables.indexOf(object);
      if (index >= 0) this.breakables.splice(index, 1);
    });
    this.remove(target.replacement);
    target.replacement = null;
  }

  private addFractures(target: BrickTarget, impact: THREE.Vector3, damage: number, seed: number): void {
    this.removeCracks(target);
    const random = seeded(seed);
    const group = new THREE.Group();
    group.name = `Progressive masonry fractures ${target.id}`;
    group.position.copy(target.center);
    group.rotation.z = target.rotationZ;
    const inverse = new THREE.Vector2(impact.x - target.center.x, impact.y - target.center.y).rotateAround(new THREE.Vector2(), -target.rotationZ);
    const vertices: number[] = [];
    const branches = 3 + damage * 2;
    for (let branch = 0; branch < branches; branch += 1) {
      const angle = random() * Math.PI * 2;
      const length = (0.025 + random() * 0.035) * (0.65 + damage * 0.28);
      const bend = (random() - 0.5) * 0.75;
      const middleX = inverse.x + Math.cos(angle) * length * 0.48;
      const middleY = inverse.y + Math.sin(angle) * length * 0.48;
      const endX = middleX + Math.cos(angle + bend) * length * 0.52;
      const endY = middleY + Math.sin(angle + bend) * length * 0.52;
      vertices.push(inverse.x, inverse.y, target.size.z / 2 + 0.002, middleX, middleY, target.size.z / 2 + 0.002, middleX, middleY, target.size.z / 2 + 0.002, endX, endY, target.size.z / 2 + 0.002);
      if (damage >= 2 && branch % 2 === 0) vertices.push(middleX, middleY, target.size.z / 2 + 0.002, middleX + Math.cos(angle - bend * 1.4) * length * 0.35, middleY + Math.sin(angle - bend * 1.4) * length * 0.35, target.size.z / 2 + 0.002);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const lines = new THREE.LineSegments(geometry, fractureMaterial);
    lines.raycast = () => undefined;
    group.add(lines);
    this.add(group);
    target.cracks = group;
  }

  private removeCracks(target: BrickTarget): void {
    if (!target.cracks) return;
    target.cracks.traverse(object => { if (object instanceof THREE.LineSegments) object.geometry.dispose(); });
    this.remove(target.cracks);
    target.cracks = null;
  }

  private inChaseZone(definition: InstallationDefinition, x: number, y: number, brickW: number, brickH: number): boolean {
    const boxWidth = definition.boxes.reduce((sum, kind) => sum + (kind === '1G' ? 0.074 : 0.134), 0) + (definition.boxes.length - 1) * 0.008;
    const centerY = definition.bottom + 0.037;
    const opening = Math.abs(x - definition.x) < (boxWidth + 0.18) / 2 + brickW / 2 && Math.abs(y - centerY) < 0.13 + brickH / 2;
    const route = Math.abs(x - definition.x) < 0.12 + brickW / 2 && y < definition.bottom + 0.06;
    return opening || route;
  }

  private createMarker(pointId: string): THREE.Group {
    const group = new THREE.Group();
    group.name = `Blue construction mark ${pointId}`;
    const material = new THREE.MeshBasicMaterial({ color: 0x1687d0, depthTest: true });
    const geometry = new THREE.BoxGeometry(0.14, 0.014, 0.004);
    const a = new THREE.Mesh(geometry, material);
    const b = new THREE.Mesh(geometry, material);
    a.rotation.z = Math.PI / 4;
    b.rotation.z = -Math.PI / 4;
    a.position.z = b.position.z = 0.094;
    group.add(a, b);
    return group;
  }

  private clearPaintAt(point: THREE.Vector3, radius: number): void {
    const paintPoint = this.toPaintPixel(point);
    const pixelRadius = radius / GAME_CONFIG.room.width * this.livePaintCanvas.width;
    this.livePaintContext.save();
    this.livePaintContext.globalCompositeOperation = 'destination-out';
    this.livePaintContext.beginPath();
    this.livePaintContext.arc(paintPoint.x, paintPoint.y, pixelRadius, 0, Math.PI * 2);
    this.livePaintContext.fill();
    this.livePaintContext.restore();
    this.livePaintTexture.needsUpdate = true;
    for (let index = this.sprayMarks.length - 1; index >= 0; index -= 1) {
      const mark = this.sprayMarks[index];
      if (mark.mesh.position.distanceTo(point) < radius) {
        this.remove(mark.mesh);
        mark.mesh.geometry.dispose();
        (mark.mesh.material as THREE.Material).dispose();
        this.sprayMarks.splice(index, 1);
      }
    }
  }

  private clearCompletedChasePaint(pointId: string, samples: THREE.Vector3[]): void {
    // A final corridor pass removes any antialiased edge or randomized mist
    // left between sample points, while preserving paint belonging to other jobs.
    for (const sample of samples) this.clearPaintAt(sample, 0.125);
    const removedLiveSamples = this.liveSpraySamplesByPoint.get(pointId) ?? 0;
    this.liveStrokeSamples = Math.max(0, this.liveStrokeSamples - removedLiveSamples);
    this.liveSpraySamplesByPoint.delete(pointId);
  }
}
