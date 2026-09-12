import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';
import type { InstallationDefinition } from '../data/installationRules';

interface RemovableBrick {
  mesh: THREE.Mesh;
  marker: THREE.Group;
  recessed: boolean;
}

interface AimHit { point: THREE.Vector3; object: THREE.Object3D; instanceId?: number }
export type SprayMode = 'dots' | 'live';

const brickGeometry = new THREE.BoxGeometry(0.286, 0.125, 0.18);
const brickMaterial = new THREE.MeshStandardMaterial({ color: 0xb84b2a, roughness: 0.96, metalness: 0, vertexColors: false });
const removableMaterial = new THREE.MeshStandardMaterial({ color: 0xb94d2b, roughness: 0.97, metalness: 0 });

export class BrickWall extends THREE.Group {
  private readonly removableByPoint = new Map<string, RemovableBrick[]>();
  private readonly breakables: THREE.Object3D[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly destroyedInstanceIds = new WeakMap<THREE.InstancedMesh, Set<number>>();
  private readonly sprayMarks: Array<{ pointId: string; mesh: THREE.Mesh }> = [];
  private readonly livePaintCanvas = document.createElement('canvas');
  private readonly livePaintContext: CanvasRenderingContext2D;
  private readonly livePaintTexture: THREE.CanvasTexture;
  private lastLivePoint: THREE.Vector3 | null = null;
  private liveStrokeSamples = 0;
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
    const fixedTransforms: THREE.Matrix4[] = [];

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const stagger = row % 2 === 0 ? 0 : brickW / 2;
        const x = -GAME_CONFIG.room.width / 2 + brickW / 2 + col * brickW + stagger;
        if (x > GAME_CONFIG.room.width / 2 - 0.02) continue;
        const y = brickH / 2 + row * brickH;
        const owner = definitions.find(definition => this.inChaseZone(definition, x, y, brickW, brickH));
        const position = new THREE.Vector3(x + Math.sin(row * 4.7 + col) * 0.004, y, -2.5 + Math.sin(col * 2.1 + row) * 0.006);
        const scale = new THREE.Vector3(brickW / 0.286 * 0.985, brickH / 0.125 * 0.965, 1);
        const matrix = new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.sin(col * 1.9 + row) * 0.007)), scale);
        if (!owner) {
          fixedTransforms.push(matrix);
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
      }
    }

    const fixed = new THREE.InstancedMesh(brickGeometry, brickMaterial, fixedTransforms.length);
    fixed.name = 'Optimized permanent brick field';
    fixed.userData.studioEntityId = 'world:brick-wall:permanent-field';
    fixed.castShadow = true;
    fixed.receiveShadow = true;
    fixedTransforms.forEach((matrix, index) => { fixed.setMatrixAt(index, matrix); });
    fixed.instanceMatrix.needsUpdate = true;
    this.breakables.push(fixed);
    this.add(fixed);

    const paintSurface = new THREE.Mesh(
      new THREE.PlaneGeometry(GAME_CONFIG.room.width, GAME_CONFIG.room.height),
      new THREE.MeshBasicMaterial({
        map: this.livePaintTexture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
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

  private cast(camera: THREE.Camera, screenX: number, screenY: number, maxDistance: number): AimHit | null {
    this.raycaster.setFromCamera(new THREE.Vector2(screenX, screenY), camera);
    const hit = this.raycaster.intersectObjects(this.breakables, false).find(candidate => {
      if (candidate.distance > maxDistance) return false;
      if (!(candidate.object instanceof THREE.InstancedMesh) || candidate.instanceId === undefined) return candidate.object.visible;
      return !this.destroyedInstanceIds.get(candidate.object)?.has(candidate.instanceId);
    });
    if (!hit) return null;
    return { point: hit.point.clone(), object: hit.object, instanceId: hit.instanceId };
  }

  spray(camera: THREE.Camera, pointId: string, mode: SprayMode = 'dots', color = 0x087fce): THREE.Vector3 | null {
    const hit = this.aim(camera);
    if (!hit) return null;
    if (mode === 'dots') {
      this.addSprayDab(hit.point, pointId, color, 0.018 + Math.random() * 0.012, 0.82);
      this.lastLivePoint = null;
    } else {
      const from = this.lastLivePoint ?? hit.point;
      this.paintLiveStroke(from, hit.point, color);
      this.liveStrokeSamples += 1;
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
    return {
      x: (point.x / GAME_CONFIG.room.width + 0.5) * this.livePaintCanvas.width,
      y: (1 - point.y / GAME_CONFIG.room.height) * this.livePaintCanvas.height,
    };
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

  removeAtAim(camera: THREE.Camera): THREE.Vector3 | null {
    const offsets: number[][] = [[0, 0]];
    for (const y of [-0.12, -0.06, 0, 0.06, 0.12]) {
      for (const x of [-0.16, -0.08, 0, 0.08, 0.16]) {
        if (x !== 0 || y !== 0) offsets.push([x, y]);
      }
    }
    const hit = offsets.map(([x, y]) => this.cast(camera, x, y, 4.5)).find(Boolean) ?? null;
    if (!hit) return null;
    if (hit.object instanceof THREE.InstancedMesh && hit.instanceId !== undefined) {
      const destroyed = this.destroyedInstanceIds.get(hit.object) ?? new Set<number>();
      destroyed.add(hit.instanceId);
      this.destroyedInstanceIds.set(hit.object, destroyed);
      const matrix = new THREE.Matrix4();
      hit.object.getMatrixAt(hit.instanceId, matrix);
      matrix.scale(new THREE.Vector3(0.0001, 0.0001, 0.0001));
      hit.object.setMatrixAt(hit.instanceId, matrix);
      hit.object.instanceMatrix.needsUpdate = true;
    } else {
      hit.object.visible = false;
    }
    this.destroyedBricks += 1;
    const paintPoint = this.toPaintPixel(hit.point);
    this.livePaintContext.save();
    this.livePaintContext.globalCompositeOperation = 'destination-out';
    this.livePaintContext.beginPath();
    this.livePaintContext.arc(paintPoint.x, paintPoint.y, 78, 0, Math.PI * 2);
    this.livePaintContext.fill();
    this.livePaintContext.restore();
    this.livePaintTexture.needsUpdate = true;
    for (let index = this.sprayMarks.length - 1; index >= 0; index -= 1) {
      const mark = this.sprayMarks[index];
      if (mark.mesh.position.distanceTo(hit.point) < 0.23) {
        this.remove(mark.mesh);
        mark.mesh.geometry.dispose();
        (mark.mesh.material as THREE.Material).dispose();
        this.sprayMarks.splice(index, 1);
      }
    }
    return hit.point;
  }

  recessChaseAtAim(camera: THREE.Camera, pointId: string, fraction: number): THREE.Vector3 | null {
    const bricks = this.removableByPoint.get(pointId) ?? [];
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const impact = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 2.39), new THREE.Vector3());
    if (!impact || impact.distanceTo(camera.position) > 4.5) return null;
    const insideMarkedRoute = bricks.some(brick => Math.abs(brick.mesh.getWorldPosition(new THREE.Vector3()).x - impact.x) < 0.24);
    if (!insideMarkedRoute) return null;
    const target = Math.ceil(bricks.length * THREE.MathUtils.clamp(fraction, 0, 1));
    let changed = false;
    for (let index = 0; index < target; index += 1) {
      const brick = bricks[index];
      if (brick.recessed || !brick.mesh.visible) continue;
      brick.mesh.position.z -= 0.105;
      const material = brick.mesh.material as THREE.MeshStandardMaterial;
      material.color.setHex(0x78351f);
      material.roughness = 1;
      brick.recessed = true;
      changed = true;
    }
    if (!changed) return null;
    this.clearPaintAt(impact, 0.23);
    return impact;
  }

  get freeMarkCount(): number { return this.sprayMarks.length + this.liveStrokeSamples; }
  get destroyedBrickCount(): number { return this.destroyedBricks; }
  get recessedBrickCount(): number {
    let count = 0;
    this.removableByPoint.forEach(bricks => { count += bricks.filter(item => item.recessed).length; });
    return count;
  }

  showMarks(pointId: string): void {
    this.removableByPoint.get(pointId)?.forEach(item => { item.marker.visible = true; });
  }

  removeFraction(pointId: string, fraction: number): THREE.Vector3[] {
    const bricks = this.removableByPoint.get(pointId) ?? [];
    const target = Math.ceil(bricks.length * THREE.MathUtils.clamp(fraction, 0, 1));
    const debris: THREE.Vector3[] = [];
    bricks.forEach((item, index) => {
      if (index < target && item.mesh.visible) {
        item.mesh.getWorldPosition(new THREE.Vector3());
        const position = new THREE.Vector3();
        item.mesh.getWorldPosition(position);
        debris.push(position);
        item.mesh.visible = false;
      }
    });
    return debris;
  }

  remaining(pointId: string): number {
    return (this.removableByPoint.get(pointId) ?? []).filter(item => item.mesh.visible).length;
  }

  private inChaseZone(definition: InstallationDefinition, x: number, y: number, brickW: number, brickH: number): boolean {
    const boxWidth = definition.boxes.reduce((sum, kind) => sum + (kind === '1G' ? 0.074 : 0.134), 0) + (definition.boxes.length - 1) * 0.008;
    const centerY = definition.bottom + 0.037;
    const opening = Math.abs(x - definition.x) < (boxWidth + 0.18) / 2 + brickW / 2
      && Math.abs(y - centerY) < 0.13 + brickH / 2;
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
    this.livePaintContext.save();
    this.livePaintContext.globalCompositeOperation = 'destination-out';
    this.livePaintContext.beginPath();
    this.livePaintContext.arc(paintPoint.x, paintPoint.y, 78, 0, Math.PI * 2);
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
}
