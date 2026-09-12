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
  carvedDepths: Map<number, number>;
  breachCells: Set<number>;
  replacement: THREE.Group | null;
  cracks: THREE.Group | null;
  demolitionOrigin: THREE.Vector3 | null;
  demolitionSeed: number;
}
interface AimHit { point: THREE.Vector3; target: BrickTarget }
interface DemolitionSite {
  ownerId: string;
  point: THREE.Vector2;
  radiusX: number;
  radiusY: number;
  spallRadiusX: number;
  spallRadiusY: number;
  rotation: number;
  lobeFrequencyA: number;
  lobeFrequencyB: number;
  lobeAmplitudeA: number;
  lobeAmplitudeB: number;
  phaseA: number;
  phaseB: number;
  directionalBias: number;
  biasAngle: number;
  excavationDepth: number;
  deformationFrequencyX: number;
  deformationFrequencyY: number;
  deformationPhase: number;
  seed: number;
  severity: number;
}
interface BreachSupportAudit { supportedComponents: number; unsupportedComponents: number; prunedComponents: number }

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
const chaseBackMaterial = new THREE.MeshStandardMaterial({ color: 0x8f3c25, roughness: 1, metalness: 0, emissive: 0x1d0804, emissiveIntensity: 0.12 });
const chaseSideMaterial = new THREE.MeshStandardMaterial({ color: 0x74301f, roughness: 1, metalness: 0 });
const chaseVoidMaterial = new THREE.MeshStandardMaterial({ color: 0x35120d, roughness: 1, metalness: 0 });
const fractureMaterial = new THREE.MeshStandardMaterial({ color: 0x592016, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4 });
const CHASE_GRID_X = 20;
const CHASE_GRID_Y = 10;
const CHASE_DEPTH = 0.055;
const DEMOLISH_GRID_X = 24;
const DEMOLISH_GRID_Y = 12;
const DEMOLISH_RADIUS_X = 0.245;
const DEMOLISH_RADIUS_Y = 0.165;
const DEMOLISH_SPALL_RADIUS_X = 0.39;
const DEMOLISH_SPALL_RADIUS_Y = 0.28;
const DEMOLISH_HITS = 4;
const DEMOLISH_THROUGH_DEPTH = 0.165;
const WALL_COLUMNS = 21;
const WALL_ROWS = 23;
const WALL_BRICK_WIDTH = GAME_CONFIG.room.width / WALL_COLUMNS;
const WALL_COURSE_HEIGHT = GAME_CONFIG.room.height / WALL_ROWS;

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
  private heldDemolitionPoint: THREE.Vector3 | null = null;
  private demolitionImpactSequence = 0;
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
  private readonly demolitionSites: DemolitionSite[] = [];
  private readonly wallFractures: THREE.Group[] = [];

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

    const cols = WALL_COLUMNS;
    const rows = WALL_ROWS;
    const brickW = WALL_BRICK_WIDTH;
    const brickH = WALL_COURSE_HEIGHT;
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

  private registerTarget(source: Omit<BrickTarget, 'damage' | 'destroyed' | 'originalHidden' | 'carvedCells' | 'carvedDepths' | 'breachCells' | 'replacement' | 'cracks' | 'demolitionOrigin' | 'demolitionSeed'>): BrickTarget {
    const target: BrickTarget = { ...source, center: source.center.clone(), size: source.size.clone(), damage: 0, destroyed: false, originalHidden: false, carvedCells: new Set(), carvedDepths: new Map(), breachCells: new Set(), replacement: null, cracks: null, demolitionOrigin: null, demolitionSeed: 0 };
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
      return Boolean(target && (!target.destroyed || Number(target.replacement?.userData.wallRemnantCells ?? 0) > 0));
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

  private nextDemolitionSeed(label: string): number {
    this.demolitionImpactSequence += 1;
    return hashString(`${label}:${this.demolitionImpactSequence}:${performance.now().toFixed(3)}:${Math.random()}`);
  }

  removeAtAim(camera: THREE.Camera, continuing = false): MasonryImpact | null {
    let hit: AimHit | null = null;
    let heldAimStillAligned = false;
    if (this.heldDemolitionPoint) {
      this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const wallAim = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 2.39), new THREE.Vector3());
      heldAimStillAligned = Boolean(wallAim && wallAim.distanceToSquared(this.heldDemolitionPoint) <= 0.15 * 0.15);
    }
    if ((continuing || heldAimStillAligned) && this.heldDemolitionTarget && !this.heldDemolitionTarget.destroyed && this.heldDemolitionPoint) {
      const target = this.heldDemolitionTarget;
      hit = { target, point: this.heldDemolitionPoint.clone() };
    } else {
      const offsets: number[][] = [[0, 0]];
      for (const y of [-0.12, -0.06, 0, 0.06, 0.12]) for (const x of [-0.16, -0.08, 0, 0.08, 0.16]) if (x !== 0 || y !== 0) offsets.push([x, y]);
      hit = offsets.map(([x, y]) => this.cast(camera, x, y, 4.5)).find(Boolean) ?? null;
      this.heldDemolitionTarget = hit?.target ?? null;
      this.heldDemolitionPoint = hit?.point.clone() ?? null;
    }
    if (!hit) {
      this.heldDemolitionTarget = null;
      this.heldDemolitionPoint = null;
      return null;
    }
    const target = hit.target;
    if (target.destroyed) {
      const seed = this.nextDemolitionSeed(`${target.id}:remnant`);
      this.clearPaintAt(hit.point, 0.11);
      const impactPoints = this.applyWallScaleImpact(target, hit.point, seed, true);
      this.addFractures(target, hit.point, DEMOLISH_HITS, seed);
      this.heldDemolitionTarget = null;
      this.heldDemolitionPoint = null;
      return { points: impactPoints, kind: 'demolish-break', brickSize: target.size.clone(), seed, destroyed: true };
    }
    if (!target.demolitionOrigin) {
      target.demolitionOrigin = hit.point.clone();
      target.demolitionSeed = this.nextDemolitionSeed(`${target.id}:initial`);
    }
    hit.point.copy(target.demolitionOrigin);
    if (target.damage === 0) this.damagedBricks += 1;
    target.damage = Math.min(DEMOLISH_HITS, target.damage + 1);
    let debrisSeed = hashString(`${target.demolitionSeed}:stage:${target.damage}`);
    this.clearPaintAt(hit.point, target.damage === DEMOLISH_HITS ? 0.11 : 0.045);
    let kind: MasonryImpactKind = target.damage === 1 ? 'demolish-chip' : target.damage === 2 ? 'demolish-crack' : 'demolish-spall';
    let destroyed = false;
    let impactPoints = [hit.point];
    if (target.damage >= DEMOLISH_HITS) {
      const firstDeepStrike = !this.demolitionSites.some(site => site.ownerId.startsWith(`${target.id}:impact:`));
      const impactSeed = firstDeepStrike ? target.demolitionSeed : this.nextDemolitionSeed(`${target.id}:repeat`);
      debrisSeed = impactSeed;
      impactPoints = this.applyWallScaleImpact(target, hit.point, impactSeed, !firstDeepStrike);
      destroyed = target.destroyed;
      kind = destroyed ? 'demolish-break' : 'demolish-spall';
      if (destroyed) {
        this.heldDemolitionTarget = null;
        this.heldDemolitionPoint = null;
      }
      this.addFractures(target, hit.point, DEMOLISH_HITS, impactSeed);
    } else {
      this.applyWallScaleVibration(target, hit.point, target.demolitionSeed, target.damage / DEMOLISH_HITS);
      this.addFractures(target, hit.point, target.damage, target.demolitionSeed);
    }
    return { points: impactPoints, kind, brickSize: target.size.clone(), seed: debrisSeed, destroyed };
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
    const targetsToRebuild = new Set<BrickTarget>();
    for (const point of workPoints) {
      let carved = false;
      for (const target of this.findTargetsNearPoint(point, 0.045)) {
        const before = target.carvedCells.size;
        this.carveTargetAtPoint(target, point, hashString(`${pointId}:${target.id}:${pass}:${impacts.length}`));
        targetsToRebuild.add(target);
        if (target.carvedCells.size > before) carved = true;
        const removable = (this.removableByPoint.get(pointId) ?? []).find(item => item.mesh === target.object);
        if (removable) removable.recessed = true;
      }
      if (carved) impacts.push(point.clone());
      // The visible spray includes a soft line and scattered mist extending
      // beyond its centreline. Clear the whole worked corridor as it is chased.
      this.clearPaintAt(point, 0.115);
      for (const neighbour of this.findTargetsNearPoint(point, 0.1)) if (neighbour.carvedCells.size > 0) targetsToRebuild.add(neighbour);
    }
    targetsToRebuild.forEach(target => this.rebuildChasedBrick(target));
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
  get chaseMinimumDepthMm(): number {
    const depths = this.targets.flatMap(target => [...target.carvedDepths.values()]);
    return depths.length === 0 ? 0 : Math.min(...depths) * 1000;
  }
  get chaseMaximumDepthMm(): number {
    const depths = this.targets.flatMap(target => [...target.carvedDepths.values()]);
    return depths.length === 0 ? 0 : Math.max(...depths) * 1000;
  }
  get chaseBackSurfaceCount(): number { return this.targets.reduce((count, target) => count + Number(target.replacement?.userData.chaseBackSurfaces ?? 0), 0); }
  get chaseSideWallCount(): number { return this.targets.reduce((count, target) => count + Number(target.replacement?.userData.chaseSideWalls ?? 0), 0); }
  get uniqueFracturePatternCount(): number { return this.wallFractures.length; }
  get fractureSegmentCount(): number { return this.wallFractures.reduce((count, group) => count + Number(group.userData.segmentCount ?? 0), 0); }
  get maximumFractureSpan(): number { return this.wallFractures.reduce((span, group) => Math.max(span, Number(group.userData.span ?? 0)), 0); }
  get partialBreachBrickCount(): number { return this.targets.filter(target => target.breachCells.size > 0 && target.breachCells.size < DEMOLISH_GRID_X * DEMOLISH_GRID_Y).length; }
  get breachedWallCellCount(): number { return this.targets.reduce((count, target) => count + target.breachCells.size, 0); }
  get deformedWallCellCount(): number { return this.targets.reduce((count, target) => count + Number(target.replacement?.userData.deformedCells ?? 0), 0); }
  get maximumDemolitionDepthMm(): number { return this.targets.reduce((depth, target) => Math.max(depth, Number(target.replacement?.userData.maximumExcavationDepthMm ?? 0)), 0); }
  get demolitionSiteCount(): number { return this.demolitionSites.length; }
  get prunedUnsupportedComponentCount(): number { return this.targets.reduce((count, target) => count + Number(target.replacement?.userData.prunedUnsupportedComponents ?? 0), 0); }
  get openCrossBrickChaseConnectionCount(): number { return this.targets.reduce((count, target) => count + Number(target.replacement?.userData.openCrossBrickChaseConnections ?? 0), 0); }
  get anchoredRemnantCount(): number { return this.targets.filter(target => target.destroyed && Number(target.replacement?.userData.supportedComponents ?? 0) > 0).length; }
  get floatingStaticPieceCount(): number {
    return this.targets.reduce((count, target) => count + Number(target.replacement?.userData.unsupportedComponents ?? 0), 0);
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

  private wallLocalPoint(target: BrickTarget, point: THREE.Vector2): THREE.Vector2 {
    const dx = point.x - target.center.x;
    const dy = point.y - target.center.y;
    const cosine = Math.cos(-target.rotationZ);
    const sine = Math.sin(-target.rotationZ);
    return new THREE.Vector2(dx * cosine - dy * sine, dx * sine + dy * cosine);
  }

  private findTargetAtWallPoint(point: THREE.Vector2, exclude: BrickTarget | null = null, margin = 0.014): BrickTarget | null {
    let match: BrickTarget | null = null;
    let closest = Number.POSITIVE_INFINITY;
    for (const candidate of this.targets) {
      if (candidate === exclude) continue;
      const local = this.wallLocalPoint(candidate, point);
      if (Math.abs(local.x) > candidate.size.x / 2 + margin || Math.abs(local.y) > candidate.size.y / 2 + margin) continue;
      const normalizedDistance = Math.abs(local.x) / candidate.size.x + Math.abs(local.y) / candidate.size.y;
      if (normalizedDistance < closest) { closest = normalizedDistance; match = candidate; }
    }
    return match;
  }

  private chaseStateAtWallPoint(point: THREE.Vector2, exclude: BrickTarget): { carved: boolean; depth: number } {
    const target = this.findTargetAtWallPoint(point, exclude, 0.02);
    if (!target || target.destroyed) return { carved: false, depth: CHASE_DEPTH };
    const local = this.wallLocalPoint(target, point);
    const col = THREE.MathUtils.clamp(Math.floor((local.x + target.size.x / 2) / (target.size.x / CHASE_GRID_X)), 0, CHASE_GRID_X - 1);
    const row = THREE.MathUtils.clamp(Math.floor((local.y + target.size.y / 2) / (target.size.y / CHASE_GRID_Y)), 0, CHASE_GRID_Y - 1);
    const index = row * CHASE_GRID_X + col;
    return { carved: target.carvedCells.has(index), depth: target.carvedDepths.get(index) ?? CHASE_DEPTH };
  }

  private wallFrontZAt(point: THREE.Vector2, fallback: BrickTarget): number {
    const target = this.findTargetAtWallPoint(point, null, 0.025) ?? fallback;
    const response = this.demolitionResponse(point);
    const inset = THREE.MathUtils.clamp(response.excavationDepth + response.deformation, -0.012, target.size.z - 0.012);
    return target.center.z + target.size.z / 2 - inset + 0.006;
  }

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
    const phase = random() * Math.PI * 2;
    const routeWidthVariation = Math.sin(point.x * 18 + point.y * 23 + phase) * 0.013 + Math.sin(point.y * 41 - phase) * 0.006;
    let closestCell = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let row = 0; row < CHASE_GRID_Y; row += 1) {
      for (let col = 0; col < CHASE_GRID_X; col += 1) {
        const cellX = -target.size.x / 2 + cellW * (col + 0.5);
        const cellY = -target.size.y / 2 + cellH * (row + 0.5);
        const distance = Math.hypot(cellX - localX, cellY - localY);
        const index = row * CHASE_GRID_X + col;
        if (distance < closestDistance) { closestDistance = distance; closestCell = index; }
        const direction = Math.atan2(cellY - localY, cellX - localX);
        const unevenRadius = 0.045 + routeWidthVariation + Math.sin(direction * 3 + phase) * 0.009 + (random() - 0.5) * 0.016;
        if (distance <= unevenRadius) {
          target.carvedCells.add(index);
          const radialImpulse = THREE.MathUtils.clamp(1 - distance / Math.max(0.02, unevenRadius), 0, 1);
          const depth = THREE.MathUtils.clamp(0.03 + random() * 0.035 + radialImpulse * 0.022, 0.028, 0.086);
          target.carvedDepths.set(index, Math.max(target.carvedDepths.get(index) ?? 0, depth));
        }
      }
    }
    target.carvedCells.add(closestCell);
    if (!target.carvedDepths.has(closestCell)) target.carvedDepths.set(closestCell, 0.045 + random() * 0.025);
    if (previousCount === 0) this.chaseRecessedBricks += 1;
    this.chaseCarvedCells += target.carvedCells.size - previousCount;
    this.hideOriginal(target);
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
    const voidMatrices: THREE.Matrix4[] = [];
    const backThickness = 0.012;
    const frontZ = target.size.z / 2;
    const edgeThickness = Math.min(0.006, cellW * 0.25, cellH * 0.25);
    const chaseState = (row: number, col: number): { carved: boolean; depth: number } => {
      if (row >= 0 && row < CHASE_GRID_Y && col >= 0 && col < CHASE_GRID_X) {
        const index = row * CHASE_GRID_X + col;
        return { carved: target.carvedCells.has(index), depth: target.carvedDepths.get(index) ?? CHASE_DEPTH };
      }
      const localX = -target.size.x / 2 + cellW * (col + 0.5);
      const localY = -target.size.y / 2 + cellH * (row + 0.5);
      const cosine = Math.cos(target.rotationZ);
      const sine = Math.sin(target.rotationZ);
      return this.chaseStateAtWallPoint(new THREE.Vector2(
        target.center.x + localX * cosine - localY * sine,
        target.center.y + localX * sine + localY * cosine,
      ), target);
    };
    const isCarved = (row: number, col: number): boolean => chaseState(row, col).carved;
    const depthAt = (row: number, col: number): number => chaseState(row, col).depth;
    let minimumDepth = Number.POSITIVE_INFINITY;
    let maximumDepth = 0;
    let deformedCells = 0;
    let openCrossBrickChaseConnections = 0;
    for (let row = 0; row < CHASE_GRID_Y; row += 1) for (let col = 0; col < CHASE_GRID_X; col += 1) {
      const carved = target.carvedCells.has(row * CHASE_GRID_X + col);
      const cellX = -target.size.x / 2 + cellW * (col + 0.5);
      const cellY = -target.size.y / 2 + cellH * (row + 0.5);
      if (!carved) {
        const adjacent = isCarved(row, col - 1) || isCarved(row, col + 1) || isCarved(row - 1, col) || isCarved(row + 1, col);
        const deformationSeed = hashString(`${target.id}:chase-edge:${row}:${col}`);
        const deformation = adjacent ? -0.009 + (deformationSeed % 2900) / 100000 : 0;
        const retainedDepth = target.size.z - deformation;
        if (adjacent) deformedCells += 1;
        intactMatrices.push(new THREE.Matrix4().compose(
          new THREE.Vector3(cellX, cellY, -deformation / 2),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, adjacent ? ((deformationSeed >>> 8) % 101 - 50) / 5000 : 0)),
          new THREE.Vector3(cellW * 1.065, cellH * 1.07, retainedDepth),
        ));
        continue;
      }
      const depth = depthAt(row, col);
      minimumDepth = Math.min(minimumDepth, depth);
      maximumDepth = Math.max(maximumDepth, depth);
      const backSurfaceZ = frontZ - depth;
      const cavityCentreZ = frontZ - depth / 2;
      backMatrices.push(new THREE.Matrix4().compose(
        new THREE.Vector3(cellX, cellY, backSurfaceZ - backThickness / 2),
        new THREE.Quaternion(),
        new THREE.Vector3(cellW * 1.09, cellH * 1.1, backThickness),
      ));
      const voidSeed = hashString(`${target.id}:hollow:${row}:${col}`);
      if (depth >= 0.059 && voidSeed % 5 <= 1) {
        voidMatrices.push(new THREE.Matrix4().compose(
          new THREE.Vector3(cellX + (((voidSeed >>> 8) % 21) - 10) / 10000, cellY, backSurfaceZ + 0.0065),
          new THREE.Quaternion(),
          new THREE.Vector3(cellW * 0.38, cellH * 0.68, 0.0025),
        ));
      }
      const addVerticalSide = (x: number, sideDepth = depth, centreZ = cavityCentreZ): void => {
        sideMatrices.push(new THREE.Matrix4().compose(
          new THREE.Vector3(x, cellY, centreZ),
          new THREE.Quaternion(),
          new THREE.Vector3(edgeThickness, cellH * 1.08, sideDepth),
        ));
      };
      const addHorizontalSide = (y: number, sideDepth = depth, centreZ = cavityCentreZ): void => {
        sideMatrices.push(new THREE.Matrix4().compose(
          new THREE.Vector3(cellX, y, centreZ),
          new THREE.Quaternion(),
          new THREE.Vector3(cellW * 1.08, edgeThickness, sideDepth),
        ));
      };
      if (col === 0 && isCarved(row, col - 1)) openCrossBrickChaseConnections += 1;
      if (col === CHASE_GRID_X - 1 && isCarved(row, col + 1)) openCrossBrickChaseConnections += 1;
      if (row === 0 && isCarved(row - 1, col)) openCrossBrickChaseConnections += 1;
      if (row === CHASE_GRID_Y - 1 && isCarved(row + 1, col)) openCrossBrickChaseConnections += 1;
      if (!isCarved(row, col - 1)) addVerticalSide(cellX - cellW / 2);
      if (!isCarved(row, col + 1)) addVerticalSide(cellX + cellW / 2);
      if (!isCarved(row - 1, col)) addHorizontalSide(cellY - cellH / 2);
      if (!isCarved(row + 1, col)) addHorizontalSide(cellY + cellH / 2);
      if (isCarved(row, col + 1)) {
        const neighbourDepth = depthAt(row, col + 1);
        if (depth > neighbourDepth + 0.004) addVerticalSide(cellX + cellW / 2, depth - neighbourDepth, frontZ - neighbourDepth - (depth - neighbourDepth) / 2);
      }
      if (isCarved(row + 1, col)) {
        const neighbourDepth = depthAt(row + 1, col);
        if (depth > neighbourDepth + 0.004) addHorizontalSide(cellY + cellH / 2, depth - neighbourDepth, frontZ - neighbourDepth - (depth - neighbourDepth) / 2);
      }
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
    addCells(backMatrices, chaseBackMaterial, `Uneven recessed back surfaces ${target.id}`);
    addCells(sideMatrices, chaseSideMaterial, `Variable-depth dark chase side walls ${target.id}`);
    addCells(voidMatrices, chaseVoidMaterial, `Exposed hollow-clay cells ${target.id}`);
    group.userData.chaseBackSurfaces = backMatrices.length;
    group.userData.chaseSideWalls = sideMatrices.length;
    group.userData.chaseDepthMm = maximumDepth * 1000;
    group.userData.minimumChaseDepthMm = Number.isFinite(minimumDepth) ? minimumDepth * 1000 : 0;
    group.userData.maximumChaseDepthMm = maximumDepth * 1000;
    group.userData.deformedCells = deformedCells;
    group.userData.openCrossBrickChaseConnections = openCrossBrickChaseConnections;
    this.add(group);
    target.replacement = group;
  }

  private createDemolitionSite(ownerId: string, impact: THREE.Vector3, seed: number, severity: number): DemolitionSite {
    const random = seeded(seed);
    const radiusX = DEMOLISH_RADIUS_X * (0.62 + random() * 0.72);
    const radiusY = DEMOLISH_RADIUS_Y * (0.58 + random() * 0.82);
    return {
      ownerId,
      point: new THREE.Vector2(impact.x + (random() - 0.5) * 0.045, impact.y + (random() - 0.5) * 0.04),
      radiusX,
      radiusY,
      spallRadiusX: Math.max(radiusX * (1.22 + random() * 0.62), DEMOLISH_SPALL_RADIUS_X * (0.62 + random() * 0.52)),
      spallRadiusY: Math.max(radiusY * (1.25 + random() * 0.68), DEMOLISH_SPALL_RADIUS_Y * (0.58 + random() * 0.58)),
      rotation: random() * Math.PI,
      lobeFrequencyA: 2 + Math.floor(random() * 5),
      lobeFrequencyB: 7 + Math.floor(random() * 7),
      lobeAmplitudeA: 0.08 + random() * 0.23,
      lobeAmplitudeB: 0.025 + random() * 0.14,
      phaseA: random() * Math.PI * 2,
      phaseB: random() * Math.PI * 2,
      directionalBias: (random() - 0.5) * 0.34,
      biasAngle: random() * Math.PI * 2,
      excavationDepth: 0.018 + random() * 0.026,
      deformationFrequencyX: 11 + random() * 31,
      deformationFrequencyY: 13 + random() * 35,
      deformationPhase: random() * Math.PI * 2,
      seed,
      severity,
    };
  }

  private siteCoordinates(site: DemolitionSite, point: THREE.Vector2): { x: number; y: number; angle: number } {
    const dx = point.x - site.point.x;
    const dy = point.y - site.point.y;
    const cosine = Math.cos(site.rotation);
    const sine = Math.sin(site.rotation);
    const x = dx * cosine + dy * sine;
    const y = -dx * sine + dy * cosine;
    return { x, y, angle: Math.atan2(y / site.radiusY, x / site.radiusX) };
  }

  private siteIrregularity(site: DemolitionSite, angle: number): number {
    const lobes = Math.sin(angle * site.lobeFrequencyA + site.phaseA) * site.lobeAmplitudeA
      + Math.sin(angle * site.lobeFrequencyB + site.phaseB) * site.lobeAmplitudeB
      + Math.cos(angle - site.biasAngle) * site.directionalBias;
    return THREE.MathUtils.clamp(1 + lobes, 0.54, 1.48);
  }

  private applyWallScaleImpact(primary: BrickTarget, impact: THREE.Vector3, seed: number, appendSite = false): THREE.Vector3[] {
    const site = this.createDemolitionSite(`${primary.id}:impact:${seed}`, impact, seed, 1);
    if (appendSite) site.excavationDepth *= 0.22 + seeded(seed ^ 0x7f4a7c15)() * 0.1;
    if (!appendSite) {
      const progressiveOwner = `${primary.id}:progressive`;
      for (let index = this.demolitionSites.length - 1; index >= 0; index -= 1) if (this.demolitionSites[index].ownerId === progressiveOwner) this.demolitionSites.splice(index, 1);
    }
    this.demolitionSites.push(site);
    this.removeFracturesInside(site);
    const impactPoints: THREE.Vector3[] = [impact.clone()];
    const effectRadius = Math.max(site.spallRadiusX, site.spallRadiusY) * 1.18;
    const affected = this.targets.filter(target => (
      Math.abs(target.center.x - site.point.x) <= effectRadius + target.size.x / 2
      && Math.abs(target.center.y - site.point.y) <= effectRadius + target.size.y / 2
    ));
    const previousBreaches = new Map(affected.map(target => [target, new Set(target.breachCells)]));
    affected.forEach(target => this.updateAnalyticBreachCells(target));
    const supportByTarget = new Map(affected.map(target => [target, this.pruneUnsupportedBreachCells(target)]));
    for (const target of affected) {
      const previousBreach = previousBreaches.get(target) ?? new Set<number>();
      const support = supportByTarget.get(target)!;
      const totalCells = DEMOLISH_GRID_X * DEMOLISH_GRID_Y;
      if (target.breachCells.size >= totalCells || support.supportedComponents === 0 && target.breachCells.size > 0) {
        if (!target.destroyed) {
          target.destroyed = true;
          if (target.damage > 0) this.damagedBricks = Math.max(0, this.damagedBricks - 1);
          this.destroyedBricks += 1;
        }
        this.hideOriginal(target);
        this.removeReplacement(target);
        this.removeCracks(target);
      } else if (target.breachCells.size > 0 || this.targetTouchesSpallField(target)) {
        this.hideOriginal(target);
        this.rebuildWallDamagedBrick(target, support);
      }
      for (const index of target.breachCells) {
        if (previousBreach.has(index) || impactPoints.length >= 18) continue;
        const point = this.demolitionCellWorldPoint(target, Math.floor(index / DEMOLISH_GRID_X), index % DEMOLISH_GRID_X);
        point.z = target.center.z + target.size.z / 2;
        impactPoints.push(point);
      }
    }
    if (primary.replacement) primary.replacement.userData.primaryImpact = true;
    return impactPoints;
  }

  private applyWallScaleVibration(primary: BrickTarget, impact: THREE.Vector3, seed: number, severity: number): void {
    const progressiveOwner = `${primary.id}:progressive`;
    for (let index = this.demolitionSites.length - 1; index >= 0; index -= 1) if (this.demolitionSites[index].ownerId === progressiveOwner) this.demolitionSites.splice(index, 1);
    const site = this.createDemolitionSite(progressiveOwner, impact, seed, severity);
    this.demolitionSites.push(site);
    const effectRadius = Math.max(site.spallRadiusX, site.spallRadiusY) * (0.58 + severity * 0.42);
    const affected = this.targets.filter(target => Math.abs(target.center.x - site.point.x) <= effectRadius + target.size.x / 2 && Math.abs(target.center.y - site.point.y) <= effectRadius + target.size.y / 2);
    affected.forEach(target => this.updateAnalyticBreachCells(target));
    const supportByTarget = new Map(affected.map(target => [target, this.pruneUnsupportedBreachCells(target)]));
    for (const target of affected) {
      if (!this.targetTouchesSpallField(target)) continue;
      const support = supportByTarget.get(target)!;
      this.hideOriginal(target);
      if (target.breachCells.size >= DEMOLISH_GRID_X * DEMOLISH_GRID_Y || support.supportedComponents === 0 && target.breachCells.size > 0) {
        if (!target.destroyed) {
          target.destroyed = true;
          if (target.damage > 0) this.damagedBricks = Math.max(0, this.damagedBricks - 1);
          this.destroyedBricks += 1;
        }
        this.removeReplacement(target);
        this.removeCracks(target);
      } else this.rebuildWallDamagedBrick(target, support);
    }
  }

  private targetTouchesSpallField(target: BrickTarget): boolean {
    return this.demolitionSites.some(site => {
      const local = this.siteCoordinates(site, new THREE.Vector2(target.center.x, target.center.y));
      const angle = Math.atan2(local.y / site.spallRadiusY, local.x / site.spallRadiusX);
      const extent = Math.hypot(target.size.x / (2 * site.spallRadiusX), target.size.y / (2 * site.spallRadiusY));
      return Math.hypot(local.x / site.spallRadiusX, local.y / site.spallRadiusY) <= this.siteIrregularity(site, angle) * (0.58 + site.severity * 0.42) + extent;
    });
  }

  private demolitionCellWorldPoint(target: BrickTarget, row: number, col: number): THREE.Vector3 {
    const cellW = target.size.x / DEMOLISH_GRID_X;
    const cellH = target.size.y / DEMOLISH_GRID_Y;
    const localX = -target.size.x / 2 + cellW * (col + 0.5);
    const localY = -target.size.y / 2 + cellH * (row + 0.5);
    const cosine = Math.cos(target.rotationZ);
    const sine = Math.sin(target.rotationZ);
    return new THREE.Vector3(
      target.center.x + localX * cosine - localY * sine,
      target.center.y + localX * sine + localY * cosine,
      target.center.z,
    );
  }

  private siteBreachesPoint(site: DemolitionSite, point: THREE.Vector2, bondFactor = 1): boolean {
    const local = this.siteCoordinates(site, point);
    const irregularity = this.siteIrregularity(site, local.angle);
    const coreDistance = Math.hypot(local.x / site.radiusX, local.y / site.radiusY);
    return site.excavationDepth * site.severity >= 0.012 && coreDistance <= irregularity * bondFactor;
  }

  private demolitionResponse(point: THREE.Vector2, bondFactor = 1): { breached: boolean; deformation: number; excavationDepth: number } {
    let deformation = 0;
    let excavationDepth = 0;
    for (const site of this.demolitionSites) {
      const local = this.siteCoordinates(site, point);
      if (Math.abs(local.x) > site.spallRadiusX * 1.5 || Math.abs(local.y) > site.spallRadiusY * 1.5) continue;
      const irregularity = this.siteIrregularity(site, local.angle);
      const coreDistance = Math.hypot(local.x / site.radiusX, local.y / site.radiusY);
      if (coreDistance <= irregularity * bondFactor) {
        const penetration = THREE.MathUtils.clamp(1 - coreDistance / Math.max(0.001, irregularity * bondFactor), 0, 1);
        const localRoughness = 0.76 + Math.sin(local.x * site.deformationFrequencyX + local.y * site.deformationFrequencyY + site.deformationPhase) * 0.18;
        excavationDepth += site.excavationDepth * site.severity * bondFactor * (0.58 + penetration * 0.42) * localRoughness;
      }
      const spallDistance = Math.hypot(local.x / site.spallRadiusX, local.y / site.spallRadiusY);
      if (spallDistance > irregularity) continue;
      const impulse = THREE.MathUtils.clamp(1 - spallDistance, 0, 1);
      const smoothNoise = (Math.sin(local.x * site.deformationFrequencyX + site.phaseA) + Math.sin(local.y * site.deformationFrequencyY - site.phaseB)) * 0.25 + 0.5;
      const outwardPocket = Math.sin(local.x * (site.deformationFrequencyY * 0.72) - local.y * (site.deformationFrequencyX * 0.81) + site.deformationPhase) < -0.48 + site.directionalBias * 0.35;
      const signed = (outwardPocket
        ? -(0.003 + impulse * 0.011 + smoothNoise * 0.004)
        : 0.002 + impulse * 0.026 + smoothNoise * 0.009) * site.severity;
      if (Math.abs(signed) > Math.abs(deformation)) deformation = signed;
    }
    excavationDepth = THREE.MathUtils.clamp(excavationDepth, 0, 0.18);
    return { breached: excavationDepth >= DEMOLISH_THROUGH_DEPTH, deformation: THREE.MathUtils.clamp(deformation, -0.016, 0.052), excavationDepth };
  }

  private updateAnalyticBreachCells(target: BrickTarget): void {
    const cellW = target.size.x / DEMOLISH_GRID_X;
    const cellH = target.size.y / DEMOLISH_GRID_Y;
    target.breachCells.clear();
    for (let row = 0; row < DEMOLISH_GRID_Y; row += 1) for (let col = 0; col < DEMOLISH_GRID_X; col += 1) {
      const point = this.demolitionCellWorldPoint(target, row, col);
      const edgeDistance = Math.min(col + 0.5, DEMOLISH_GRID_X - col - 0.5) * cellW;
      const verticalEdgeDistance = Math.min(row + 0.5, DEMOLISH_GRID_Y - row - 0.5) * cellH;
      const bondedAtMortar = Math.min(edgeDistance, verticalEdgeDistance) <= Math.max(cellW, cellH) * 1.15;
      if (this.demolitionResponse(new THREE.Vector2(point.x, point.y), bondedAtMortar ? 0.78 : 1).breached) {
        target.breachCells.add(row * DEMOLISH_GRID_X + col);
      }
    }

  }

  private classifyRemainingComponents(target: BrickTarget): { supported: number; unsupported: number[][] } {
    const remaining = new Set<number>();
    for (let index = 0; index < DEMOLISH_GRID_X * DEMOLISH_GRID_Y; index += 1) if (!target.breachCells.has(index)) remaining.add(index);
    const visited = new Set<number>();
    let supportedComponents = 0;
    const unsupported: number[][] = [];
    for (const start of remaining) {
      if (visited.has(start)) continue;
      const component: number[] = [];
      const queue = [start];
      visited.add(start);
      let supported = false;
      while (queue.length > 0) {
        const index = queue.pop()!;
        component.push(index);
        const row = Math.floor(index / DEMOLISH_GRID_X);
        const col = index % DEMOLISH_GRID_X;
        if (this.cellHasBondedSupport(target, row, col)) supported = true;
        for (const [nextRow, nextCol] of [[row, col - 1], [row, col + 1], [row - 1, col], [row + 1, col]]) {
          if (nextRow < 0 || nextRow >= DEMOLISH_GRID_Y || nextCol < 0 || nextCol >= DEMOLISH_GRID_X) continue;
          const next = nextRow * DEMOLISH_GRID_X + nextCol;
          if (!remaining.has(next) || visited.has(next)) continue;
          visited.add(next);
          queue.push(next);
        }
      }
      if (supported) supportedComponents += 1;
      else unsupported.push(component);
    }
    return { supported: supportedComponents, unsupported };
  }

  private pruneUnsupportedBreachCells(target: BrickTarget): BreachSupportAudit {
    const initial = this.classifyRemainingComponents(target);
    initial.unsupported.flat().forEach(index => target.breachCells.add(index));
    const audited = this.classifyRemainingComponents(target);
    return {
      supportedComponents: audited.supported,
      unsupportedComponents: audited.unsupported.length,
      prunedComponents: initial.unsupported.length,
    };
  }

  private cellHasBondedSupport(target: BrickTarget, row: number, col: number): boolean {
    if (row > 0 && row < DEMOLISH_GRID_Y - 1 && col > 0 && col < DEMOLISH_GRID_X - 1) return false;
    const cellW = target.size.x / DEMOLISH_GRID_X;
    const cellH = target.size.y / DEMOLISH_GRID_Y;
    const directions: Array<[number, number]> = [];
    if (col === 0) directions.push([-cellW * 1.3, 0]);
    if (col === DEMOLISH_GRID_X - 1) directions.push([cellW * 1.3, 0]);
    if (row === 0) directions.push([0, -cellH * 1.3]);
    if (row === DEMOLISH_GRID_Y - 1) directions.push([0, cellH * 1.3]);
    const cosine = Math.cos(target.rotationZ);
    const sine = Math.sin(target.rotationZ);
    return directions.some(([localX, localY]) => {
      const point = this.demolitionCellWorldPoint(target, row, col);
      point.x += localX * cosine - localY * sine;
      point.y += localX * sine + localY * cosine;
      if (point.x <= -GAME_CONFIG.room.width / 2 || point.x >= GAME_CONFIG.room.width / 2 || point.y <= 0 || point.y >= GAME_CONFIG.room.height) return false;
      const wallPoint = new THREE.Vector2(point.x, point.y);
      const neighbour = this.findTargetAtWallPoint(wallPoint, target, 0.022);
      if (!neighbour || neighbour.destroyed || neighbour.breachCells.size > 0) return false;
      return !this.demolitionResponse(wallPoint, 0.84).breached;
    });
  }

  private rebuildWallDamagedBrick(target: BrickTarget, support: BreachSupportAudit): void {
    this.removeReplacement(target);
    const group = new THREE.Group();
    group.name = `Mortar-bonded wall damage ${target.id}`;
    group.userData.studioEntityId = `world:brick-wall:bonded-damage-${target.id}`;
    group.position.copy(target.center);
    group.rotation.z = target.rotationZ;
    const cellW = target.size.x / DEMOLISH_GRID_X;
    const cellH = target.size.y / DEMOLISH_GRID_Y;
    const intactMatrices: THREE.Matrix4[] = [];
    const sideMatrices: THREE.Matrix4[] = [];
    const voidMatrices: THREE.Matrix4[] = [];
    const edgeThickness = Math.min(0.007, cellW * 0.35, cellH * 0.35);
    let deformedCells = 0;
    let maximumExcavationDepth = 0;
    const isBreached = (row: number, col: number): boolean => {
      if (row >= 0 && row < DEMOLISH_GRID_Y && col >= 0 && col < DEMOLISH_GRID_X) return target.breachCells.has(row * DEMOLISH_GRID_X + col);
      const edgeRow = THREE.MathUtils.clamp(row, 0, DEMOLISH_GRID_Y - 1);
      const edgeCol = THREE.MathUtils.clamp(col, 0, DEMOLISH_GRID_X - 1);
      const outside = this.demolitionCellWorldPoint(target, edgeRow, edgeCol);
      const localOffsetX = col < 0 ? -cellW * 1.3 : col >= DEMOLISH_GRID_X ? cellW * 1.3 : 0;
      const localOffsetY = row < 0 ? -cellH * 1.3 : row >= DEMOLISH_GRID_Y ? cellH * 1.3 : 0;
      const cosine = Math.cos(target.rotationZ);
      const sine = Math.sin(target.rotationZ);
      outside.x += localOffsetX * cosine - localOffsetY * sine;
      outside.y += localOffsetX * sine + localOffsetY * cosine;
      if (outside.x <= -GAME_CONFIG.room.width / 2 || outside.x >= GAME_CONFIG.room.width / 2 || outside.y <= 0 || outside.y >= GAME_CONFIG.room.height) return true;
      return this.demolitionResponse(new THREE.Vector2(outside.x, outside.y), 0.84).breached;
    };
    const responseAt = (row: number, col: number): { breached: boolean; deformation: number; excavationDepth: number } => {
      const edgeRow = THREE.MathUtils.clamp(row, 0, DEMOLISH_GRID_Y - 1);
      const edgeCol = THREE.MathUtils.clamp(col, 0, DEMOLISH_GRID_X - 1);
      const point = this.demolitionCellWorldPoint(target, edgeRow, edgeCol);
      const localOffsetX = col < 0 ? -cellW * 1.3 : col >= DEMOLISH_GRID_X ? cellW * 1.3 : 0;
      const localOffsetY = row < 0 ? -cellH * 1.3 : row >= DEMOLISH_GRID_Y ? cellH * 1.3 : 0;
      const cosine = Math.cos(target.rotationZ);
      const sine = Math.sin(target.rotationZ);
      point.x += localOffsetX * cosine - localOffsetY * sine;
      point.y += localOffsetX * sine + localOffsetY * cosine;
      return this.demolitionResponse(new THREE.Vector2(point.x, point.y));
    };
    for (let row = 0; row < DEMOLISH_GRID_Y; row += 1) for (let col = 0; col < DEMOLISH_GRID_X; col += 1) {
      const index = row * DEMOLISH_GRID_X + col;
      if (target.breachCells.has(index)) continue;
      const worldPoint = this.demolitionCellWorldPoint(target, row, col);
      const response = this.demolitionResponse(new THREE.Vector2(worldPoint.x, worldPoint.y));
      const boundary = isBreached(row, col - 1) || isBreached(row, col + 1) || isBreached(row - 1, col) || isBreached(row + 1, col);
      const roughSeed = hashString(`${target.id}:wall-edge:${row}:${col}`);
      const worked = response.excavationDepth > 0.001;
      const roughInset = worked ? (roughSeed % 900) / 100000 : boundary ? (roughSeed % 1500) / 100000 : 0;
      const frontInset = THREE.MathUtils.clamp(response.excavationDepth + response.deformation + roughInset, -0.016, target.size.z - 0.012);
      const retainedDepth = target.size.z - frontInset;
      const jitterX = worked || boundary ? (((roughSeed >>> 6) % 101) - 50) / 14000 : 0;
      const jitterY = worked || boundary ? (((roughSeed >>> 13) % 101) - 50) / 14000 : 0;
      maximumExcavationDepth = Math.max(maximumExcavationDepth, response.excavationDepth);
      if (worked || Math.abs(response.deformation) > 0.002 || boundary) deformedCells += 1;
      const localX = -target.size.x / 2 + cellW * (col + 0.5) + jitterX;
      const localY = -target.size.y / 2 + cellH * (row + 0.5) + jitterY;
      intactMatrices.push(new THREE.Matrix4().compose(
        new THREE.Vector3(localX, localY, -frontInset / 2),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, worked || boundary ? (((roughSeed >>> 20) % 101) - 50) / 1500 : 0)),
        new THREE.Vector3(cellW * 1.08, cellH * 1.1, retainedDepth),
      ));
      const fullSideZ = -frontInset / 2;
      const addVerticalSide = (x: number, depth = retainedDepth, centreZ = fullSideZ): void => { sideMatrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, localY, centreZ), new THREE.Quaternion(), new THREE.Vector3(edgeThickness, cellH * 1.1, depth))); };
      const addHorizontalSide = (y: number, depth = retainedDepth, centreZ = fullSideZ): void => { sideMatrices.push(new THREE.Matrix4().compose(new THREE.Vector3(localX, y, centreZ), new THREE.Quaternion(), new THREE.Vector3(cellW * 1.08, edgeThickness, depth))); };
      const addDepthStep = (nextRow: number, nextCol: number, vertical: boolean, coordinate: number): void => {
        if (isBreached(nextRow, nextCol)) { if (vertical) addVerticalSide(coordinate); else addHorizontalSide(coordinate); return; }
        const neighbour = responseAt(nextRow, nextCol);
        const neighbourInset = THREE.MathUtils.clamp(neighbour.excavationDepth + neighbour.deformation, -0.016, target.size.z - 0.012);
        const difference = frontInset - neighbourInset;
        if (difference <= 0.004) return;
        const centreZ = target.size.z / 2 - neighbourInset - difference / 2;
        if (vertical) addVerticalSide(coordinate, difference, centreZ); else addHorizontalSide(coordinate, difference, centreZ);
      };
      addDepthStep(row, col - 1, true, localX - cellW / 2);
      addDepthStep(row, col + 1, true, localX + cellW / 2);
      addDepthStep(row - 1, col, false, localY - cellH / 2);
      addDepthStep(row + 1, col, false, localY + cellH / 2);
      if (response.excavationDepth >= 0.045 && roughSeed % 7 <= 1) {
        voidMatrices.push(new THREE.Matrix4().compose(
          new THREE.Vector3(localX, localY, target.size.z / 2 - frontInset + 0.0015),
          new THREE.Quaternion(),
          new THREE.Vector3(cellW * (0.3 + (roughSeed % 23) / 100), cellH * 0.58, 0.002),
        ));
      }
    }
    const addCells = (matrices: THREE.Matrix4[], material: THREE.Material, name: string, breakable: boolean): void => {
      if (matrices.length === 0) return;
      const mesh = new THREE.InstancedMesh(unitBoxGeometry, material, matrices.length);
      mesh.name = name;
      mesh.userData.brickTargetId = target.id;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      if (breakable) this.breakables.push(mesh);
    };
    addCells(intactMatrices, chasedBrickMaterial, `Bonded deformed wall cells ${target.id}`, intactMatrices.length > 0);
    addCells(sideMatrices, chaseSideMaterial, `Deep irregular fracture faces ${target.id}`, false);
    addCells(voidMatrices, chaseVoidMaterial, `Exposed demolition hollow-clay cells ${target.id}`, false);
    group.userData.supportedComponents = support.supportedComponents;
    group.userData.unsupportedComponents = support.unsupportedComponents;
    group.userData.prunedUnsupportedComponents = support.prunedComponents;
    group.userData.wallRemnantCells = intactMatrices.length;
    group.userData.breachedCells = target.breachCells.size;
    group.userData.deformedCells = deformedCells;
    group.userData.maximumExcavationDepthMm = maximumExcavationDepth * 1000;
    this.add(group);
    target.replacement = group;
  }

  private removeFracturesInside(site: DemolitionSite): void {
    for (let index = this.wallFractures.length - 1; index >= 0; index -= 1) {
      const group = this.wallFractures[index];
      const origin = group.userData.origin as { x: number; y: number } | undefined;
      const samples = (group.userData.samples as Array<{ x: number; y: number }> | undefined) ?? [];
      const crossesOpening = (origin && this.siteBreachesPoint(site, new THREE.Vector2(origin.x, origin.y), 1.08))
        || samples.some(sample => this.siteBreachesPoint(site, new THREE.Vector2(sample.x, sample.y), 1.04));
      if (!crossesOpening) continue;
      const owner = typeof group.userData.ownerId === 'string' ? this.targetsById.get(group.userData.ownerId) : null;
      if (owner?.cracks === group) owner.cracks = null;
      group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
      this.remove(group);
      this.wallFractures.splice(index, 1);
    }
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
    group.name = `Wall-scale bonded masonry fractures ${target.id}`;
    group.userData.ownerId = target.id;
    group.userData.origin = { x: impact.x, y: impact.y };
    const vertices: number[] = [];
    const indices: number[] = [];
    const pathPoints: THREE.Vector2[] = [];
    let segmentCount = 0;
    const addRibbonSegment = (from: THREE.Vector2, to: THREE.Vector2, width: number): void => {
      const direction = to.clone().sub(from);
      if (direction.lengthSq() < 0.000001) return;
      const midpoint = from.clone().add(to).multiplyScalar(0.5);
      if (damage >= DEMOLISH_HITS && this.demolitionResponse(midpoint, 0.94).breached) return;
      const normal = new THREE.Vector2(-direction.y, direction.x).normalize().multiplyScalar(width / 2);
      const offset = vertices.length / 3;
      const fromZ = this.wallFrontZAt(from, target);
      const toZ = this.wallFrontZAt(to, target);
      vertices.push(
        from.x + normal.x, from.y + normal.y, fromZ,
        from.x - normal.x, from.y - normal.y, fromZ,
        to.x - normal.x, to.y - normal.y, toZ,
        to.x + normal.x, to.y + normal.y, toZ,
      );
      indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
      pathPoints.push(from.clone(), to.clone());
      segmentCount += 1;
    };
    const buildPath = (start: THREE.Vector2, heading: number, length: number, initialWidth: number, jointAffinity: number, curveBias: number): THREE.Vector2[] => {
      const points = [start.clone()];
      let current = start.clone();
      let travelled = 0;
      while (travelled < length) {
        const segment = Math.min(length - travelled, 0.022 + random() * 0.064);
        const mortarStep = random() < jointAffinity;
        const direction = heading + (random() - 0.5) * (0.18 + random() * 0.42);
        const next = current.clone().add(new THREE.Vector2(Math.cos(direction), Math.sin(direction)).multiplyScalar(segment));
        if (mortarStep) {
          if (Math.abs(Math.cos(heading)) >= Math.abs(Math.sin(heading))) {
            const jointY = Math.round(next.y / WALL_COURSE_HEIGHT) * WALL_COURSE_HEIGHT;
            if (Math.abs(jointY - next.y) <= 0.028) next.y = jointY;
          } else {
            const course = THREE.MathUtils.clamp(Math.floor(next.y / WALL_COURSE_HEIGHT), 0, WALL_ROWS - 1);
            const stagger = course % 2 === 0 ? 0 : WALL_BRICK_WIDTH / 2;
            const wallLeft = -GAME_CONFIG.room.width / 2;
            const jointX = wallLeft + stagger + Math.round((next.x - wallLeft - stagger) / WALL_BRICK_WIDTH) * WALL_BRICK_WIDTH;
            if (Math.abs(jointX - next.x) <= 0.03) next.x = jointX;
          }
        }
        addRibbonSegment(current, next, initialWidth * (0.95 - 0.52 * travelled / Math.max(length, 0.001)));
        points.push(next);
        current = next;
        travelled += segment;
        heading += curveBias + (random() - 0.5) * 0.34;
      }
      return points;
    };

    const origin = new THREE.Vector2(impact.x, impact.y);
    const baseHeading = random() * Math.PI * 2;
    const trunkCount = THREE.MathUtils.clamp(1 + Math.floor(random() * 4) + Math.floor((damage - 1) / 2), 1, 5);
    const width = 0.00125 + damage * (0.00032 + random() * 0.00018);
    const trunks: THREE.Vector2[][] = [];
    for (let trunkIndex = 0; trunkIndex < trunkCount; trunkIndex += 1) {
      const heading = trunkIndex === 0 ? baseHeading : baseHeading + (random() - 0.5) * Math.PI * 1.75;
      const length = (0.065 + damage * 0.045) * (0.48 + random() * 1.08);
      const startOffset = random() < 0.35 ? random() * 0.025 : 0;
      const start = origin.clone().add(new THREE.Vector2(Math.cos(heading), Math.sin(heading)).multiplyScalar(startOffset));
      trunks.push(buildPath(start, heading, length, width * (0.72 + random() * 0.45), random() * 0.58, (random() - 0.5) * 0.08));
    }
    const branchCount = Math.floor(random() * (damage + 1));
    for (let branch = 0; branch < branchCount; branch += 1) {
      const trunk = trunks[Math.floor(random() * trunks.length)];
      if (trunk.length < 2) continue;
      const branchStart = trunk[1 + Math.floor(random() * (trunk.length - 1))];
      const heading = Math.atan2(branchStart.y - origin.y, branchStart.x - origin.x) + (random() < 0.5 ? -1 : 1) * (0.38 + random() * 1.04);
      buildPath(branchStart, heading, 0.035 + random() * (0.055 + damage * 0.026), width * (0.38 + random() * 0.42), random() * 0.42, (random() - 0.5) * 0.12);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const seam = new THREE.Mesh(geometry, fractureMaterial);
    seam.name = `Continuous mortar-and-brick crack network ${target.id}`;
    seam.raycast = () => undefined;
    seam.renderOrder = 3;
    group.add(seam);
    let span = 0;
    for (let first = 0; first < pathPoints.length; first += 1) for (let second = first + 1; second < pathPoints.length; second += 1) span = Math.max(span, pathPoints[first].distanceTo(pathPoints[second]));
    group.userData.segmentCount = segmentCount;
    group.userData.span = span;
    group.userData.samples = pathPoints.map(point => ({ x: point.x, y: point.y }));
    this.add(group);
    target.cracks = group;
    this.wallFractures.push(group);
    while (this.wallFractures.length > 72) {
      const oldest = this.wallFractures.shift();
      if (!oldest) break;
      const owner = typeof oldest.userData.ownerId === 'string' ? this.targetsById.get(oldest.userData.ownerId) : null;
      if (owner?.cracks === oldest) owner.cracks = null;
      oldest.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
      this.remove(oldest);
    }
  }

  private removeCracks(target: BrickTarget): void {
    if (!target.cracks) return;
    target.cracks.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    const index = this.wallFractures.indexOf(target.cracks);
    if (index >= 0) this.wallFractures.splice(index, 1);
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
