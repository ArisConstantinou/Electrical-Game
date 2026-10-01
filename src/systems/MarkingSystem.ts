import * as THREE from 'three';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import { BrickWall, type SprayMode } from '../world/BrickWall';
import type { MansionMasonryDemolition } from '../world/MansionMasonryDemolition';
import { GAME_CONFIG } from '../data/gameConfig';
import { SurfaceSpray, sprayVisible, type SpraySurface } from './SurfaceSpray';
import { sprayGeometryPieces } from './SprayGeometry';

interface SprayTarget extends SpraySurface { wall?: BrickWall }

export class MarkingSystem {
  mode: SprayMode = 'live';
  color = 0x087fce;
  private readonly paint = new SurfaceSpray();
  private readonly raycaster = new THREE.Raycaster();
  private readonly bounds = new THREE.Box3();
  private readonly proxy = new THREE.Mesh();
  private readonly localRay = new THREE.Ray();
  private readonly worldBounds = new WeakMap<THREE.Mesh, {
    matrix: THREE.Matrix4; box: THREE.Box3; source: THREE.Box3; version: number; instances: string;
  }>();
  private previousWall: BrickWall | null = null;
  private readonly paintedWalls = new Set<BrickWall>();
  constructor(private readonly wall: BrickWall,
    private readonly walls: () => THREE.Object3D[] = () => [],
    private readonly masonry: () => Iterable<MansionMasonryDemolition> = () => [],
    private readonly surfaces: () => THREE.Object3D[] = () => []) {}

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
    const registered = this.walls();
    for (const wall of registered) {
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
    // Preserve the custom volume queries above: their deleted bricks and
    // cavities must not be replaced by hits on hidden backing triangles.
    const excluded = new Set<THREE.Object3D>([...registered, ...brickWalls, ...masonryGroups]);
    const visit = (object: THREE.Object3D): void => {
      if (!object.visible || object.userData.levelEditorDeleted || excluded.has(object) ||
          object.userData.sprayPaint || object.userData.levelEditorPickProxy || object.userData.transient ||
          // Distant masonry render copies are already owned by the volume
          // queries above and contain thousands of unrelated wall instances.
          object instanceof THREE.InstancedMesh && object.userData.editorIgnore) return;
      if (object instanceof THREE.Mesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.some(m => m.visible && m.opacity > 0 && m.depthTest)) {
          // A short-range box check prevents rays through nearby scenery from
          // testing distant houses or every foliage triangle in the level.
          if (object instanceof THREE.InstancedMesh) {
            if (!object.boundingBox) object.computeBoundingBox();
            this.bounds.copy(object.boundingBox!);
          } else {
            if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
            if (!object.geometry.boundingBox) return;
            this.bounds.copy(object.geometry.boundingBox);
          }
          const position = object.geometry.getAttribute('position');
          const version = position instanceof THREE.InterleavedBufferAttribute ? position.data.version : position?.version ?? 0;
          const instances = object instanceof THREE.InstancedMesh ? `${object.count}:${object.instanceMatrix.version}` : '';
          let saved = this.worldBounds.get(object);
          if (!saved || !saved.matrix.equals(object.matrixWorld) || !saved.source.equals(this.bounds) ||
              saved.version !== version || saved.instances !== instances) {
            saved = { matrix: object.matrixWorld.clone(), source: this.bounds.clone(),
              box: this.bounds.clone().applyMatrix4(object.matrixWorld), version, instances };
            this.worldBounds.set(object, saved);
          }
          if (saved.box.distanceToPoint(eye) <= distance && this.raycaster.ray.intersectsBox(saved.box)) {
            const hits: THREE.Intersection[] = [];
            this.raycaster.far = distance;
            // Scenery disables gameplay raycasts for other tools. Spray uses
            // actual triangles, without changing those tools' pick policy.
            if (object instanceof THREE.InstancedMesh) THREE.InstancedMesh.prototype.raycast.call(object, this.raycaster, hits);
            else if (object instanceof THREE.SkinnedMesh) THREE.SkinnedMesh.prototype.raycast.call(object, this.raycaster, hits);
            else {
              this.proxy.material = object.material; this.proxy.matrixWorld.copy(object.matrixWorld);
              this.localRay.copy(this.raycaster.ray).applyMatrix4(object.matrixWorld.clone().invert());
              for (const geometry of sprayGeometryPieces(object.geometry)) {
                if (geometry.boundingBox && !this.localRay.intersectsBox(geometry.boundingBox)) continue;
                this.proxy.geometry = geometry;
                THREE.Mesh.prototype.raycast.call(this.proxy, this.raycaster, hits);
              }
              for (const hit of hits) hit.object = object;
            }
            hits.sort((a, b) => a.distance - b.distance);
            for (const hit of hits) {
              if (hit.distance > distance) break;
              const material = materials[hit.face?.materialIndex ?? 0];
              if (!hit.face || !material?.visible || material.opacity <= 0 || !material.depthTest) continue;
              const matrix = object.matrixWorld.clone();
              if (object instanceof THREE.InstancedMesh && hit.instanceId !== undefined) {
                const instance = new THREE.Matrix4(); object.getMatrixAt(hit.instanceId, instance); matrix.multiply(instance);
              }
              const normal = (hit.normal ?? hit.face.normal).clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(matrix));
              if (normal.dot(direction) > 0) normal.negate();
              consider({ object, point: hit.point, normal, instanceId: hit.instanceId });
              break;
            }
          }
        }
      }
      for (const child of object.children) visit(child);
    };
    for (const root of this.surfaces()) {
      if (!sprayVisible(root)) continue;
      root.updateWorldMatrix(true, true); visit(root);
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
