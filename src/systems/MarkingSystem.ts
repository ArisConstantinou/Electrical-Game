import * as THREE from 'three';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import { BrickWall, type SprayMode } from '../world/BrickWall';
import type { MansionMasonryDemolition } from '../world/MansionMasonryDemolition';
import { GAME_CONFIG } from '../data/gameConfig';
import { SurfaceSpray, sprayVisible, type SpraySurface } from './SurfaceSpray';

interface SprayTarget extends SpraySurface { wall?: BrickWall }

export class MarkingSystem {
  mode: SprayMode = 'live';
  color = 0x087fce;
  private readonly paint = new SurfaceSpray();
  private readonly raycaster = new THREE.Raycaster();
  private previousWall: BrickWall | null = null;
  private readonly paintedWalls = new Set<BrickWall>();
  constructor(private readonly wall: BrickWall,
    private readonly walls: () => THREE.Object3D[] = () => [],
    private readonly masonry: () => Iterable<MansionMasonryDemolition> = () => []) {}

  aim(camera: THREE.Camera): SprayTarget | null {
    camera.updateWorldMatrix(true, false);
    this.raycaster.setFromCamera(new THREE.Vector2(), camera);
    this.raycaster.near = 0; this.raycaster.far = GAME_CONFIG.interaction.maxDistance;
    const eye = this.raycaster.ray.origin, direction = this.raycaster.ray.direction;
    let distance = this.raycaster.far, target: SprayTarget | null = null;
    const consider = (candidate: SprayTarget): void => {
      const range = candidate.point.distanceTo(eye);
      if (range <= distance) { target = candidate; distance = range; }
    };
    const brickWalls = new Set([this.wall]);
    const masonryGroups = new Set<THREE.Object3D>();
    for (const wall of this.masonry()) {
      masonryGroups.add(wall.group);
      const hit = wall.aim(camera, this.raycaster.far, eye, direction);
      if (hit) consider({ object: wall.group, point: hit.point, normal: wall.workPlane(eye).normal });
    }
    for (const wall of this.walls()) {
      if (wall instanceof BrickWall) { brickWalls.add(wall); continue; }
      if (masonryGroups.has(wall) || !sprayVisible(wall)) continue;
      wall.updateWorldMatrix(true, true);
      for (const hit of this.raycaster.intersectObject(wall, true)) {
        if (hit.distance > distance) break;
        if (!hit.face || !sprayVisible(hit.object) || hit.object.userData.levelEditorPickProxy) continue;
        const mesh = hit.object as THREE.Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (!materials?.some(material => material?.visible)) continue;
        const matrix = hit.object.matrixWorld.clone();
        if (mesh instanceof THREE.InstancedMesh && hit.instanceId !== undefined) {
          const instance = new THREE.Matrix4(); mesh.getMatrixAt(hit.instanceId, instance); matrix.multiply(instance);
        }
        const normal = hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(matrix));
        if (Math.abs(normal.y) > .1) continue;
        if (normal.dot(direction) > 0) normal.negate();
        consider({ object: wall, point: hit.point, normal });
        break;
      }
    }
    for (const wall of brickWalls) {
      if (!sprayVisible(wall)) continue;
      const hit = wall.aim(camera);
      if (hit) consider({ object: wall, wall, point: hit.point,
        normal: new THREE.Vector3(0, 0, 1).transformDirection(wall.matrixWorld) });
    }
    return target;
  }

  spray(camera: THREE.Camera, point?: InstallationPoint): boolean {
    const target = this.aim(camera);
    if (!target) { this.endStroke(); return false; }
    if (this.previousWall !== (target.wall ?? null)) this.endStroke();
    this.previousWall = target.wall ?? null;
    if (target.wall) {
      if (!target.wall.spray(camera, point?.definition.id ?? 'free-spray', this.mode, this.color)) return false;
      this.paintedWalls.add(target.wall);
    } else if (!this.paint.spray(target, this.mode, this.color)) return false;
    // Other walls are free marking surfaces, not new positions for the
    // original electrical installation or its chase-progress samples.
    if (target.wall === this.wall && point?.stage === 'inspect') {
      point.placeAt(target.point.x, target.point.y);
      point.setStage('marked');
    }
    return true;
  }
  endStroke(): void { this.previousWall?.endSprayStroke(); this.previousWall = null; this.paint.endStroke(); }
  get freeMarkCount(): number {
    let count = this.paint.count;
    for (const wall of this.paintedWalls) count += wall.freeMarkCount;
    return count;
  }
  get materialRevision(): number { return this.paint.materialRevision; }
}
