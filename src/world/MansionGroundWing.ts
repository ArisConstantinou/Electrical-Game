import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PlayerObstacle } from '../player/EquipmentCollision';
import { brickFacePatch } from './BrickFacePatch';
import { masonryFaceMaterial } from './BrickFaceMaterial';
import { siteMaterial, siteSmoothConcreteMaterial } from './SiteMaterials';
import { curvedWallGeometry, type CurvedWallShape } from './CurvedWallGeometry';
import { createClaySoffitPreview } from './ClaySoffitPreview';
import { MansionCourtyard } from './MansionCourtyard';
import { MansionSurroundings } from './MansionSurroundings';
import { BrickWall } from './BrickWall';

/** First traversable part of the approved ground plan, kept out of the released room. */
export class MansionGroundWing extends THREE.Group {
  readonly obstacles: PlayerObstacle[] = [];
  readonly editableWalls = new Map<string, THREE.Group>();
  readonly editableSurfaces = new Map<string, THREE.Group>();
  readonly editableAssets = new Map<string, THREE.Group>();
  private originalRoomFloor: THREE.Group | null = null;
  private readonly editableWallColliders = new Map<THREE.Group, { obstacle: PlayerObstacle; matrix: THREE.Matrix4 }>();
  private readonly editableAssetColliders = new Map<THREE.Group, { obstacle: PlayerObstacle; matrix: THREE.Matrix4 }>();
  private readonly corner = new THREE.Vector3();
  private readonly inverseSurfaceMatrix = new THREE.Matrix4();
  private emptyTemplate = false;
  readonly courtyard: MansionCourtyard;
  readonly surroundings: MansionSurroundings;

  constructor(oliveSource: THREE.Object3D | null, neighbourSource: THREE.Object3D | null) {
    super();
    this.name = 'Mansion ground circulation construction slice';
    this.userData.studioEntityId = 'world:mansion-ground-wing';
    this.slab('Rough supported passage slab', 2.7, 4.1, 0, 5.65);
    this.slab('Ground foyer slab', 10.35, 5.0, 3.825, 10.1, true);
    this.slab('Shaded north circulation return', 10.35, 2.9, 3.825, 14.05);
    this.wall('Passage west fired-clay partition', -1.35, 3.62, -1.35, 7.65);
    this.wall('Passage east fired-clay partition', 1.35, 3.62, 1.35, 7.65);
    this.wall('Foyer west fired-clay partition', -1.35, 7.65, -1.35, 15.5);
    this.wall('Foyer north fired-clay perimeter', -1.35, 15.5, 9, 15.5);
    // The 2.4 m opening is a true route into the open courtyard. Structural
    // piers and lintel are visible; there is no glazing or fitted door.
    this.wall('Courtyard west masonry pier before aperture', 9, 6, 9, 13);
    this.wall('Courtyard west masonry pier after aperture', 9, 15, 9, 16);
    this.addCourtyardOpeningFrame();
    this.wall('Courtyard east solid pier A', 18, 6, 18, 8);
    this.wall('Courtyard east solid pier B', 18, 10, 18, 12);
    this.wall('Courtyard east solid pier C', 18, 14, 18, 16);
    this.addCourtyardWindowBand(8, 10);
    this.addCourtyardWindowBand(12, 14);
    this.wall('Courtyard north fired-clay enclosure', 9, 16, 18, 16);
    this.wall('Courtyard south fired-clay enclosure', 9, 6, 18, 6);
    // The isolated garage-off view retains the original foyer wall for a
    // same-camera construction comparison; ordinary preview keeps the route.
    if (new URLSearchParams(location.search).get('garage') === 'off') {
      this.wall('Foyer south fired-clay partition', 1.35, 7.65, 9, 7.65);
    } else {
      this.wall('Foyer south masonry west of garage passage', 1.35, 7.65, 6.55, 7.65);
      this.wall('Foyer south masonry east of garage passage', 8.45, 7.65, 9, 7.65);
      this.addGroundGarage();
    }
    this.courtyard = new MansionCourtyard(oliveSource);
    this.add(this.courtyard);
    this.obstacles.push(...this.courtyard.obstacles);
    this.surroundings = new MansionSurroundings(oliveSource, neighbourSource);
    this.add(this.surroundings);
    this.addStairCore();
    this.addFirstFloorLanding();
    this.addFirstFloorRoom();
    this.addUpperStairCore(1);
    this.addSecondFloorShell();
    this.addUpperStairCore(2);
    this.addSetbackFloorShell(3);
    this.addUpperStairCore(3);
    this.addSetbackFloorShell(4);
    // Existing room boundaries remain physically closed except for the new aperture.
    this.obstacles.push(
      { id: 'mansion-room-east', minX: 3.76, maxX: 4.05, minZ: -2.41, maxZ: 3.62 },
      { id: 'mansion-rear-west', minX: -3.8, maxX: -1.35, minZ: 3.52, maxZ: 3.78 },
      { id: 'mansion-rear-east', minX: 1.35, maxX: 3.8, minZ: 3.52, maxZ: 3.78 },
    );
    this.castFrame(-1.35, 7.65);
    this.castFrame(1.35, 7.65);
    this.castFrame(-1.35, 12.6);
    this.castFrame(9, 12.6);
    this.castFrame(9, 7.65);
    this.castFrame(-1.35, 15.5);
    this.castFrame(9, 15.5);
    this.addTemporarySafety();
    this.registerAuthoredAssets();
  }

  /** Give authored site parts stable edit pivots without detaching the
   * courtyard/terrain systems from their animation and LOD owners. */
  private registerAuthoredAssets(): void {
    const occurrences = new Map<string, number>();
    const pickGeometry = new THREE.BoxGeometry(1, 1, 1);
    const pickMaterial = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    const bounds = new THREE.Box3();
    const centre = new THREE.Vector3();
    const size = new THREE.Vector3();
    const authored = [
      ...[...this.children].map(object => ({ parent: this as THREE.Group, object })),
      ...[...this.courtyard.children].map(object => ({ parent: this.courtyard as THREE.Group, object })),
      ...[...this.surroundings.children].map(object => ({ parent: this.surroundings as THREE.Group, object })),
    ];
    for (const { parent, object } of authored) {
      if (object === this.courtyard || object === this.surroundings ||
        this.editableWalls.get(object.name) === object || this.editableSurfaces.get(object.name) === object) continue;
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Group || object instanceof THREE.LOD)) continue;
      bounds.setFromObject(object);
      if (bounds.isEmpty() || !Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.max.y)) continue;
      const count = (occurrences.get(object.name) ?? 0) + 1;
      occurrences.set(object.name, count);
      const slug = object.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '') || 'unnamed';
      const id = `site-asset:${slug}:${count}`;
      const pivot = new THREE.Group();
      pivot.name = id;
      pivot.userData.levelEditorKind = 'asset';
      pivot.userData.levelEditorGround = /\b(?:ground|terrain|soil)\b/i.test(object.name);
      pivot.userData.levelEditorLabel = `${object.name}${count > 1 ? ` · ${count}` : ''}`;
      bounds.getSize(size);
      pivot.userData.baseSize = [Math.max(size.x, .01), Math.max(size.y, .01), Math.max(size.z, .01)];
      pivot.userData.studioEntityId = `mansion:${id}`;
      bounds.getCenter(centre);
      parent.add(pivot);
      pivot.position.copy(parent.worldToLocal(centre.clone()));
      pivot.attach(object);
      // A single box around a spread-out beam network would intercept taps
      // on every item inside it. Use a proxy only for compact parts whose
      // render meshes deliberately disable raycasts (e.g. instanced bricks).
      if (object instanceof THREE.InstancedMesh &&
        Math.max(size.x, size.y, size.z) <= 5.5 && size.x * size.y * size.z <= 50) {
        const pickProxy = new THREE.Mesh(pickGeometry, pickMaterial);
        pickProxy.name = 'Editor asset selection volume';
        pickProxy.scale.set(Math.max(size.x, .05), Math.max(size.y, .05), Math.max(size.z, .05));
        pickProxy.userData.levelEditorPickProxy = true;
        pivot.add(pickProxy);
      }
      this.editableAssets.set(id, pivot);
      if (object.name === 'Raised pallet under staged unfitted masonry supplies' ||
        object.name === 'Separate stacked clay units awaiting garage partition work') {
        const obstacle: PlayerObstacle = { id, minX: bounds.min.x, maxX: bounds.max.x,
          minZ: bounds.min.z, maxZ: bounds.max.z, minFloorY: bounds.min.y - .2, maxFloorY: bounds.max.y };
        this.obstacles.push(obstacle);
        this.editableAssetColliders.set(pivot, { obstacle, matrix: new THREE.Matrix4().makeScale(0, 0, 0) });
      }
    }
  }

  /** The original work room belongs to Room rather than this wing, but its
   * floor and ceiling are still construction surfaces in the same level. */
  registerOriginalRoomSurfaces(floor: THREE.Mesh, ceiling: THREE.Mesh): void {
    for (const object of [floor, ceiling]) {
      const bounds = new THREE.Box3().setFromObject(object);
      const centre = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const parent = object.parent!;
      const pivot = new THREE.Group();
      const id = `room-asset:${object === floor ? 'floor' : 'ceiling'}:1`;
      pivot.name = id;
      pivot.userData.levelEditorKind = 'asset';
      pivot.userData.levelEditorGround = object === floor;
      pivot.userData.levelEditorLabel = object.name;
      pivot.userData.baseSize = [size.x, size.y, size.z];
      pivot.userData.studioEntityId = `mansion:${id}`;
      parent.add(pivot);
      pivot.position.copy(parent.worldToLocal(centre.clone()));
      pivot.attach(object);
      this.editableAssets.set(id, pivot);
      if (object === floor) this.originalRoomFloor = pivot;
    }
  }

  /** Expose the remaining visible room and exterior geometry in the same
   * selection registry. Live construction walls remain locked until their
   * gameplay/physics coordinates can move with their render geometry. */
  registerOriginalRoomAssets(room: THREE.Group, exterior: THREE.Group, lockedObjects: THREE.Object3D[]): void {
    const locked = new Set(lockedObjects);
    const occurrences = new Map<string, number>();
    const residenceRoof = exterior.getObjectByName('Residence roof slab and parapet');
    const sources = [
      ...[...room.children].filter(object => object !== this && object !== exterior)
        .map(object => ({ object, parent: room, prefix: 'room-part' })),
      ...[...exterior.children].filter(object => !/sky gradient/i.test(object.name))
        .map(object => ({ object, parent: exterior, prefix: 'outside-part' })),
      ...(residenceRoof instanceof THREE.Group && residenceRoof.parent instanceof THREE.Group
        ? [{ object: residenceRoof, parent: residenceRoof.parent, prefix: 'outside-part' }] : []),
    ];
    for (const { object, parent, prefix } of sources) {
      if (this.editableAssets.get(object.name) === object ||
        !(object instanceof THREE.Mesh || object instanceof THREE.Group || object instanceof THREE.LOD)) continue;
      const bounds = new THREE.Box3();
      if (object instanceof BrickWall) {
        const { width, height, depth, frontZ } = object.volume;
        object.updateWorldMatrix(true, false);
        bounds.set(
          new THREE.Vector3(-width / 2, 0, frontZ - depth),
          new THREE.Vector3(width / 2, height, frontZ),
        ).applyMatrix4(object.matrixWorld);
      } else {
        try { bounds.setFromObject(object); }
        catch { continue; } // Some live meshes are not BufferGeometry.
      }
      if (bounds.isEmpty() || !Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.max.y)) continue;
      const count = (occurrences.get(`${prefix}:${object.name}`) ?? 0) + 1;
      occurrences.set(`${prefix}:${object.name}`, count);
      const slug = object.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '') || 'unnamed';
      const id = `${prefix}:${slug}:${count}`;
      const centre = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const pivot = new THREE.Group();
      pivot.name = id;
      pivot.userData.levelEditorKind = 'asset';
      pivot.userData.levelEditorLabel = `${object.name || 'Site part'}${count > 1 ? ` · ${count}` : ''}`;
      pivot.userData.levelEditorLocked = locked.has(object) || /first-fix supplies at the site perimeter/i.test(object.name);
      pivot.userData.levelEditorGround = /\b(?:ground|terrain|soil)\b/i.test(object.name);
      pivot.userData.baseSize = [Math.max(size.x, .01), Math.max(size.y, .01), Math.max(size.z, .01)];
      pivot.userData.studioEntityId = `mansion:${id}`;
      parent.add(pivot);
      pivot.position.copy(parent.worldToLocal(centre.clone()));
      pivot.attach(object);
      this.editableAssets.set(id, pivot);
    }
  }

  update(dt: number): void { this.courtyard.update(dt); this.surroundings.update(dt); }

  setEmptyTemplate(enabled: boolean): void { this.emptyTemplate = enabled; }

  surfaceHeight(x: number, z: number, currentFloor = 0): number {
    const placed = this.editorSurfaceHeight(x, z, currentFloor);
    if (placed !== null) return placed;
    if (this.emptyTemplate) return 0;
    if (this.originalRoomFloor && Math.abs(currentFloor) < .5) {
      const floor = this.originalRoomFloor;
      floor.updateWorldMatrix(true, false);
      this.corner.set(x, 0, z).applyMatrix4(this.inverseSurfaceMatrix.copy(floor.matrixWorld).invert());
      const [width, thickness, depth] = floor.userData.baseSize as number[];
      if (Math.abs(this.corner.x) <= width / 2 && Math.abs(this.corner.z) <= depth / 2)
        return floor.localToWorld(this.corner.set(0, thickness / 2, 0)).y;
    }
    const closest = (heights: number[]): number => heights.reduce((best, height) =>
      Math.abs(height - currentFloor) < Math.abs(best - currentFloor) ? height : best);
    const onFirst = x >= 4.8 && x <= 6.2 && z >= 8 && z < 11.08;
    if (onFirst) {
      const step = Math.min(11, Math.floor((z - 8) / .28) + 1) * .15;
      return closest([0, 3.3, 6.6, 9.9].map(base => base + step));
    }
    const onLanding = x >= 4.8 && x <= 8.2 && z >= 11.08 && z <= 12.2;
    if (onLanding) return closest([0, 3.3, 6.6, 9.9].map(base => base + 1.65));
    const onSecond = x >= 6.8 && x <= 8.2 && z >= 8 && z < 11.08;
    if (onSecond) {
      const step = 1.65 + Math.min(11, Math.floor((11.08 - z) / .28) + 1) * .15;
      return closest([0, 3.3, 6.6, 9.9].map(base => base + step));
    }
    if (x >= 4.48 && x <= 6.6 && z >= 6.5 && z < 8) return closest([0, 3.3, 6.6, 9.9]);
    if (x >= 6.5 && x <= 8.5 && z >= 4.5 && z < 8) return closest([0, 3.3, 6.6, 9.9, 13.2]);
    if (x >= 6.5 && x <= 12.5 && z >= 0 && z < 4.5) {
      const heights = [3.3, 6.6, 9.9];
      if (x >= 9) heights.unshift(0);
      if (x >= 7 && x <= 11.14 && z >= .5) heights.push(13.2);
      return closest(heights);
    }
    return 0;
  }

  private editorSurfaceHeight(x: number, z: number, currentFloor: number): number | null {
    let best: number | null = null;
    let difference = Infinity;
    for (const surface of this.editableSurfaces.values()) {
      surface.updateWorldMatrix(true, false);
      this.corner.set(x, 0, z).applyMatrix4(this.inverseSurfaceMatrix.copy(surface.matrixWorld).invert());
      const width = surface.userData.length as number;
      const depth = surface.userData.depth as number;
      if (Math.abs(this.corner.x) > width / 2 || Math.abs(this.corner.z) > depth / 2) continue;
      const kind = surface.userData.levelEditorKind as 'floor' | 'stair';
      const candidate = kind === 'stair'
        ? surface.position.y + Math.min(11, Math.floor((this.corner.z + depth / 2) / (depth / 11)) + 1) * .15 * surface.scale.y
        : surface.position.y;
      const gap = Math.abs(candidate - currentFloor);
      if (gap < (kind === 'stair' ? 1.8 : .45) && gap < difference) { best = candidate; difference = gap; }
    }
    return best;
  }

  obstaclesAt(floorY: number): PlayerObstacle[] {
    for (const [asset, entry] of this.editableAssetColliders) {
      asset.updateWorldMatrix(true, true);
      if (entry.matrix.equals(asset.matrixWorld)) continue;
      entry.matrix.copy(asset.matrixWorld);
      const bounds = new THREE.Box3().setFromObject(asset, true);
      const obstacle = entry.obstacle;
      obstacle.minX = bounds.min.x - .01; obstacle.maxX = bounds.max.x + .01;
      obstacle.minZ = bounds.min.z - .01; obstacle.maxZ = bounds.max.z + .01;
      obstacle.minFloorY = bounds.min.y - .2; obstacle.maxFloorY = bounds.max.y;
    }
    for (const [wall, entry] of this.editableWallColliders) {
      const obstacle = entry.obstacle;
      wall.updateWorldMatrix(true, false);
      if (entry.matrix.equals(wall.matrixWorld)) continue;
      entry.matrix.copy(wall.matrixWorld);
      const curve=wall.userData.levelEditorKind==='concrete-wall'
        ? wall.userData.curveShape as CurvedWallShape|undefined : undefined;
      if(curve){
        const scale=new THREE.Vector3().setFromMatrixScale(wall.matrixWorld);
        const count=Math.max(1,Math.ceil(Math.abs(curve.radius*curve.sweep)*Math.max(scale.x,scale.z)/.15));
        const point=(angle:number,radius:number)=>this.corner.set(
          curve.center[0]+Math.cos(angle)*radius,0,
          curve.center[1]+Math.sin(angle)*radius).applyMatrix4(wall.matrixWorld).clone();
        const segments:NonNullable<PlayerObstacle['segments']>[number][]=[];
        obstacle.minX=obstacle.minZ=Infinity;
        obstacle.maxX=obstacle.maxZ=-Infinity;
        for(let index=0;index<count;index++){
          const a=curve.startAngle+curve.sweep*index/count;
          const b=curve.startAngle+curve.sweep*(index+1)/count;
          const mid=(a+b)/2,center=point(mid,curve.radius);
          const halfWidth=Math.max(center.distanceTo(point(mid,curve.radius-.12)),
            center.distanceTo(point(mid,curve.radius+.12)))+.005;
          const start=point(a,curve.radius),end=point(b,curve.radius);
          segments.push({ax:start.x,az:start.z,bx:end.x,bz:end.z,halfWidth});
          obstacle.minX=Math.min(obstacle.minX,start.x-halfWidth,end.x-halfWidth);
          obstacle.maxX=Math.max(obstacle.maxX,start.x+halfWidth,end.x+halfWidth);
          obstacle.minZ=Math.min(obstacle.minZ,start.z-halfWidth,end.z-halfWidth);
          obstacle.maxZ=Math.max(obstacle.maxZ,start.z+halfWidth,end.z+halfWidth);
        }
        obstacle.segments=segments;
        const floor=point(curve.startAngle,curve.radius).y;
        obstacle.minFloorY=floor;
        this.corner.set(0,3,0).applyMatrix4(wall.matrixWorld);
        obstacle.maxFloorY=this.corner.y;
        continue;
      }
      obstacle.segments=undefined;
      const length = wall.userData.length as number;
      const alongX = wall.userData.alongX as boolean;
      const halfX = (alongX ? length : .24) / 2;
      const halfZ = (alongX ? .24 : length) / 2;
      obstacle.minX = obstacle.minZ = Infinity;
      obstacle.maxX = obstacle.maxZ = -Infinity;
      for (const x of [-halfX, halfX]) for (const z of [-halfZ, halfZ]) {
        this.corner.set(x, 0, z).applyMatrix4(wall.matrixWorld);
        obstacle.minX = Math.min(obstacle.minX, this.corner.x);
        obstacle.maxX = Math.max(obstacle.maxX, this.corner.x);
        obstacle.minZ = Math.min(obstacle.minZ, this.corner.z);
        obstacle.maxZ = Math.max(obstacle.maxZ, this.corner.z);
      }
      obstacle.minX -= .01; obstacle.maxX += .01;
      obstacle.minZ -= .01; obstacle.maxZ += .01;
      this.corner.set(0, 0, 0).applyMatrix4(wall.matrixWorld);
      obstacle.minFloorY = this.corner.y;
      this.corner.set(0, 3, 0).applyMatrix4(wall.matrixWorld);
      obstacle.maxFloorY = this.corner.y;
    }
    return this.obstacles.filter(obstacle =>
      (!this.emptyTemplate || obstacle.id.startsWith('Editor ')) &&
      floorY >= (obstacle.minFloorY ?? -Infinity) - .16 && floorY <= (obstacle.maxFloorY ?? Infinity) + .16);
  }

  addEditorWall(id: string, kind: 'brick-wall' | 'concrete-wall', length = 3): THREE.Group {
    const name = `Editor ${kind} ${id}`;
    if (this.editableWalls.has(name)) throw new Error(`Duplicate level wall ${id}`);
    if (kind === 'brick-wall') {
      this.wall(name, -length / 2, 0, length / 2, 0);
      return this.editableWalls.get(name)!;
    }
    const group = new THREE.Group();
    group.name = name;
    group.userData.studioEntityId = `mansion:wall:${id}`;
    group.userData.levelEditorKind = kind;
    group.userData.length = length;
    group.userData.alongX = true;
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(length, 3, .24, 2, .01), siteMaterial('concrete', 0xc2b9ad, length / 2, 1.5));
    mesh.name = `${name} cast face`;
    mesh.position.y = 1.5;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    this.add(group);
    this.editableWalls.set(name, group);
    const obstacle = { id: name, minX: -length / 2, maxX: length / 2, minZ: -.12, maxZ: .12, minFloorY: 0, maxFloorY: 3 };
    this.obstacles.push(obstacle);
    this.editableWallColliders.set(group, { obstacle, matrix: new THREE.Matrix4().makeScale(0, 0, 0) });
    return group;
  }

  applyEditorConcreteCurve(group: THREE.Group, shape: CurvedWallShape): void {
    if (group.userData.levelEditorKind !== 'concrete-wall') return;
    const mesh = group.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    if (!mesh) return;
    mesh.geometry.dispose();
    mesh.geometry = curvedWallGeometry(shape);
    if (mesh.material instanceof THREE.Material) mesh.material.dispose();
    mesh.material = siteSmoothConcreteMaterial();
    mesh.position.y = 0;
    group.userData.curveShape = shape;
    this.editableWallColliders.get(group)?.matrix.makeScale(0,0,0);
    group.updateMatrixWorld(true);
    this.obstaclesAt(group.position.y);
  }

  removeEditorWall(group: THREE.Group): void {
    this.editableWalls.delete(group.name);
    this.editableWallColliders.delete(group);
    const index = this.obstacles.findIndex(item => item.id === group.name);
    if (index >= 0) this.obstacles.splice(index, 1);
    group.removeFromParent();
  }

  addEditorSurface(id: string, kind: 'floor' | 'stair', width = 3, depth = 3.08): THREE.Group {
    const name = `Editor ${kind} ${id}`;
    if (this.editableSurfaces.has(name)) throw new Error(`Duplicate level surface ${id}`);
    const group = new THREE.Group();
    group.name = name;
    group.userData.studioEntityId = `mansion:surface:${id}`;
    group.userData.levelEditorKind = kind;
    group.userData.length = width;
    group.userData.depth = depth;
    const concrete = siteMaterial('concrete', 0xc5bdb1, width / 2, depth / 2);
    if (kind === 'floor') {
      const slab = new THREE.Mesh(new RoundedBoxGeometry(width, .18, depth, 2, .01), concrete);
      slab.name = `${name} supported concrete slab`;
      slab.position.y = -.09;
      slab.castShadow = slab.receiveShadow = true;
      group.add(slab);
    } else {
      for (let step = 0; step < 11; step++) {
        const tread = new THREE.Mesh(new RoundedBoxGeometry(width, .16, depth / 11, 2, .008), concrete);
        tread.name = `${name} cast step ${step + 1}`;
        tread.position.set(0, (step + 1) * .15 - .08, -depth / 2 + (step + .5) * depth / 11);
        tread.castShadow = tread.receiveShadow = true;
        group.add(tread);
      }
      for (const side of [-1, 1]) {
        const stringer = new THREE.Mesh(new RoundedBoxGeometry(.12, 1.65, depth, 2, .008), concrete);
        stringer.name = `${name} cast side support`;
        stringer.position.set(side * (width / 2 + .04), .825, 0);
        stringer.rotation.x = Math.atan2(1.65, depth);
        stringer.castShadow = stringer.receiveShadow = true;
        group.add(stringer);
      }
    }
    this.add(group);
    this.editableSurfaces.set(name, group);
    return group;
  }

  removeEditorSurface(group: THREE.Group): void {
    this.editableSurfaces.delete(group.name);
    group.removeFromParent();
  }

  private addGroundGarage(): void {
    const concrete = siteMaterial('floor', 0xcac2b6, 2.5, 2.5);
    const slab = (name: string, x: number, y: number, z: number, w: number, d: number): void => {
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, .18, d, 2, .01), concrete);
      mesh.name = name;
      mesh.position.set(x, y, z);
      mesh.castShadow = y > 0;
      mesh.receiveShadow = true;
      this.add(mesh);
    };
    // The corridor leaves the foyer through a framed rough opening. The L1
    // corridor slab already roofs most of this connection, so only its east
    // strip and the exposed garage bays need new overhead concrete.
    slab('Garage passage unfinished ground slab', 7.75, -.09, 6.075, 2.5, 3.15);
    slab('Garage passage east roof strip', 8.75, 3.21, 6.075, .5, 3.15);
    slab('Ground private garage and client workshop concrete slab', 13.5, -.09, 1.25, 9, 9.5);
    for (const [x, z, w, d] of [
      [10.75, -1.75, 3.5, 3.5], [10.75, 5.25, 3.5, 1.5], [15.25, 1.25, 5.5, 9.5],
    ]) {
      slab('Continuous cast garage roof panel around existing L1 floor', x, 3.21, z, w, d);
      const soffit = createClaySoffitPreview(w, d, 2.94);
      soffit.name = 'Clay infill and flush joists bearing into garage roof slab';
      soffit.position.set(x, 0, z);
      this.add(soffit);
    }
    const sharedSoffit = createClaySoffitPreview(3.5, 4.5, 2.91);
    sharedSoffit.name = 'Clay infill under existing L1 structural floor above garage';
    sharedSoffit.position.set(10.75, 0, 2.25);
    this.add(sharedSoffit);
    this.wall('Garage passage west fired-clay partition', 6.5, 4.5, 6.5, 7.65);
    this.wall('Garage passage south fired-clay return', 6.5, 4.5, 9, 4.5);
    this.wall('Garage passage east fired-clay return', 9, 5.75, 9, 7.65);
    this.wall('Garage west fired-clay perimeter before passage', 9, -3.5, 9, 4.25);
    this.wall('Garage east fired-clay perimeter', 18, -3.5, 18, 6);
    this.wall('Street-facing garage masonry west pier', 9, -3.5, 11, -3.5);
    this.wall('Street-facing garage masonry east pier', 16, -3.5, 18, -3.5);
    this.wall('Garage workshop rough partition south pier', 15.5, -3.5, 15.5, -.75);
    this.wall('Garage workshop rough partition north pier', 15.5, 1.25, 15.5, 6);
    const frame = siteMaterial('concrete', 0xc9c1b4, .3, .5);
    const column = new RoundedBoxGeometry(.3, 3.12, .3, 2, .008);
    for (const [x, z, label] of [
      [6.55, 7.65, 'foyer-to-garage west jamb'], [8.45, 7.65, 'foyer-to-garage east jamb'],
      [9, 4.25, 'garage passage lower jamb'], [9, 5.75, 'garage passage upper jamb'],
      [11, -3.5, 'garage street aperture west pier'], [16, -3.5, 'garage street aperture east pier'],
    ] as const) {
      const pier = new THREE.Mesh(column, frame);
      pier.name = `Cast ${label}, ready for a later door but currently open`;
      pier.position.set(x, 1.56, z);
      pier.castShadow = pier.receiveShadow = true;
      this.add(pier);
    }
    for (const [x, z, w, d, label] of [
      [7.5, 7.65, 2.2, .32, 'foyer-to-garage doorless passage'],
      [9, 5, .32, 1.8, 'garage passage'],
      [13.5, -3.5, 5.2, .36, 'unfitted vehicle bay'],
      [15.5, .25, .32, 2.2, 'workshop passage'],
    ] as const) {
      const head = new THREE.Mesh(new RoundedBoxGeometry(w, .29, d, 2, .008), frame);
      head.name = `Structural lintel above ${label}; no installed door or shutter`;
      head.position.set(x, 2.95, z);
      head.castShadow = head.receiveShadow = true;
      this.add(head);
    }
    this.addGarageStructuralJunctions();
    // Staged materials make the construction use legible while leaving the
    // whole vehicle bay empty. Each pile has a matching body obstacle.
    const pallet = new THREE.Mesh(new RoundedBoxGeometry(1.35, .13, .9, 2, .006),
      siteMaterial('concrete', 0x9c8970, .5, .5));
    pallet.name = 'Raised pallet under staged unfitted masonry supplies';
    pallet.position.set(11.1, .08, -1.85);
    pallet.castShadow = pallet.receiveShadow = true;
    this.add(pallet);
    const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      siteMaterial('clay', 0xb56843, .5, .5), 24);
    blocks.name = 'Separate stacked clay units awaiting garage partition work';
    const matrix = new THREE.Matrix4();
    for (let row = 0; row < 3; row++) for (let col = 0; col < 8; col++) {
      const index = row * 8 + col;
      blocks.setMatrixAt(index, matrix.compose(new THREE.Vector3(10.58 + (col % 4) * .32, .24 + row * .13,
        -2.12 + Math.floor(col / 4) * .37), new THREE.Quaternion(), new THREE.Vector3(.3, .12, .35)));
    }
    blocks.castShadow = blocks.receiveShadow = true;
    blocks.computeBoundingSphere();
    this.add(blocks);
  }

  private addGarageStructuralJunctions(): void {
    // The fired-clay walls are infill inside a cast frame. A continuous
    // concrete beam meets the real roof slab at each wall head; columns close
    // its corners. None of these parts is a decorative skirting or doorway.
    const cast = siteMaterial('concrete', 0xe6e0d5, 1.3, .5);
    cast.emissive.set(0x777169);
    cast.emissiveIntensity = .24;
    const runs: [number, number, number, number][] = [
      [6.5, 4.5, 6.5, 7.65], [6.5, 4.5, 9, 4.5], [9, 5.75, 9, 7.65],
      [9, -3.5, 9, 4.25], [18, -3.5, 18, 6], [9, 6, 18, 6],
      [9, -3.5, 11, -3.5], [16, -3.5, 18, -3.5],
      [15.5, -3.5, 15.5, -.75], [15.5, 1.25, 15.5, 6],
      [1.35, 7.65, 6.55, 7.65], [8.45, 7.65, 9, 7.65],
    ];
    const corners: [number, number][] = [[9, -3.5], [9, 6], [18, -3.5], [18, 6], [15.5, -3.5], [15.5, 6]];
    const frame = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 2, .006), cast,
      runs.length + corners.length);
    frame.name = 'Cast garage frame: continuous ring beams and slab-to-beam columns';
    const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
    runs.forEach(([x0, z0, x1, z1], index) => {
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      frame.setMatrixAt(index, matrix.compose(new THREE.Vector3((x0 + x1) / 2, 2.94, (z0 + z1) / 2),
        quaternion, new THREE.Vector3(alongX ? Math.abs(x1 - x0) : .36, .36,
          alongX ? .36 : Math.abs(z1 - z0))));
    });
    corners.forEach(([x, z], index) => frame.setMatrixAt(runs.length + index,
      matrix.compose(new THREE.Vector3(x, 1.54, z), quaternion, new THREE.Vector3(.34, 3.08, .34))));
    frame.castShadow = frame.receiveShadow = true;
    frame.computeBoundingSphere();
    this.add(frame);
    this.addGarageWallFootContact();
  }

  private addGarageWallFootContact(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) return;
    const pixels = context.createImageData(128, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
      const distance = y / 63;
      const ragged = .07 * Math.sin(x * .28) + .035 * Math.sin(x * .79 + 1.2);
      const grain = Math.sin(x * 14.7 + y * 8.3) * Math.sin(x * 4.1 - y * 17.1);
      const coverage = 1 - THREE.MathUtils.smoothstep(distance + ragged, .08, .96);
      const index = (y * 128 + x) * 4;
      pixels.data[index] = 113;
      pixels.data[index + 1] = 105;
      pixels.data[index + 2] = 94;
      pixels.data[index + 3] = Math.round(255 * coverage * (.18 + .065 * Math.max(0, grain)));
    }
    context.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    const material = new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, roughness: 1 });
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
      const start = positions.length / 3, length = a.distanceTo(b) / 1.2;
      positions.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...d.toArray());
      uvs.push(0, 0, length, 0, 0, 1, length, 1);
      indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
    };
    const wallAndFloor = (a: THREE.Vector3, b: THREE.Vector3, inward: THREE.Vector3) => {
      quad(a, b, a.clone().add(new THREE.Vector3(0, .16, 0)), b.clone().add(new THREE.Vector3(0, .16, 0)));
      const floorA = a.clone().setY(.004), floorB = b.clone().setY(.004);
      quad(floorA, floorB, floorA.clone().add(inward), floorB.clone().add(inward));
    };
    wallAndFloor(new THREE.Vector3(9.126, 0, -3.36), new THREE.Vector3(9.126, 0, 4.23), new THREE.Vector3(.19, 0, 0));
    wallAndFloor(new THREE.Vector3(9.14, 0, -3.374), new THREE.Vector3(10.98, 0, -3.374), new THREE.Vector3(0, 0, .19));
    wallAndFloor(new THREE.Vector3(16.02, 0, -3.374), new THREE.Vector3(17.86, 0, -3.374), new THREE.Vector3(0, 0, .19));
    wallAndFloor(new THREE.Vector3(17.874, 0, -3.36), new THREE.Vector3(17.874, 0, 5.86), new THREE.Vector3(-.19, 0, 0));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const contact = new THREE.Mesh(geometry, material);
    contact.name = 'Feathered construction dust shared by garage slab and brick foot';
    contact.raycast = () => undefined;
    this.add(contact);
  }

  private slab(name: string, width: number, depth: number, x: number, z: number, stairVoid = false): void {
    const concrete = siteMaterial('floor', 0xd1cbc1, width / 2.5, depth / 2.5);
    const floor = new THREE.Mesh(new RoundedBoxGeometry(width, .18, depth, 2, .012), concrete);
    floor.name = name;
    floor.position.set(x, -.09, z);
    floor.receiveShadow = true;
    this.add(floor);
    const panels = stairVoid ? [
      { w: 6.05, d: 5, x: 1.675, z: 10.1 },
      { w: .6, d: 5, x: 8.7, z: 10.1 },
      { w: 3.7, d: .4, x: 6.55, z: 7.8 },
      { w: 3.7, d: .4, x: 6.55, z: 12.4 },
    ] : [{ w: width, d: depth, x, z }];
    for (const panel of panels) {
      const roof = new THREE.Mesh(new RoundedBoxGeometry(panel.w, .18, panel.d, 2, .012), siteMaterial('concrete', 0xc9c3b8, panel.w / 2.2, panel.d / 2.2));
      roof.name = `${name} load-bearing ceiling slab`;
      roof.position.set(panel.x, 3.19, panel.z);
      roof.castShadow = roof.receiveShadow = true;
      this.add(roof);
      // Individual fired-clay soffit cells stop at the stair well edge.
      const pitch = .32, nx = Math.ceil(panel.w / pitch), nz = Math.ceil(panel.d / pitch);
      const cells = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), siteMaterial('clay', 0xbb7954, 1, 1), nx * nz);
      cells.name = `${name} exposed clay soffit cells`;
      const matrix = new THREE.Matrix4();
      for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
        const cx = panel.x - panel.w / 2 + (ix + .5) * panel.w / nx;
        const cz = panel.z - panel.d / 2 + (iz + .5) * panel.d / nz;
        cells.setMatrixAt(ix * nz + iz, matrix.compose(new THREE.Vector3(cx, 3.045, cz), new THREE.Quaternion(), new THREE.Vector3(panel.w / nx - .015, .11, panel.d / nz - .015)));
      }
      cells.receiveShadow = true;
      cells.raycast = () => undefined;
      cells.computeBoundingSphere();
      this.add(cells);
    }
  }

  private wall(name: string, x0: number, z0: number, x1: number, z1: number, baseY = 0): void {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const length = Math.hypot(x1 - x0, z1 - z0);
    const centreX = (x0 + x1) / 2, centreZ = (z0 + z1) / 2;
    const editable = new THREE.Group();
    editable.name = name;
    editable.userData.studioEntityId = `mansion:wall:${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;
    editable.userData.levelEditorKind = 'brick-wall';
    editable.userData.length = length;
    editable.userData.alongX = alongX;
    editable.position.set(centreX, baseY, centreZ);
    this.add(editable);
    this.editableWalls.set(name, editable);
    const backing = new THREE.Mesh(new THREE.BoxGeometry(alongX ? length : .20, 3, alongX ? .20 : length), siteMaterial('concrete', 0x8b8176, length / 2, 1.5));
    backing.name = `${name} mortar backing`;
    backing.position.set(0, 1.5, 0);
    backing.castShadow = backing.receiveShadow = true;
    editable.add(backing);
    const pitch = .38, course = 3 / 23, gap = .006;
    const columns = Math.ceil(length / pitch) + 1, rows = 23;
    const patches = new Float32Array(columns * rows * 4);
    // At corridor viewing distance the photographed crop and actual mortar gap
    // carry the edge; rounded subdivisions multiply shadow triangles per unit.
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.setAttribute('brickPatch', new THREE.InstancedBufferAttribute(patches, 4));
    const bricks = new THREE.InstancedMesh(geometry, masonryFaceMaterial, columns * rows);
    bricks.name = name;
    bricks.castShadow = bricks.receiveShadow = true;
    const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const index = row * columns + col;
      // Running bond needs a half unit at the start of alternate courses.
      // Omitting it left a 19 cm dark slot at every other wall corner.
      const halfStart = row % 2 === 1 && col === 0;
      const origin = row % 2 === 1 ? (col - 1) * pitch + pitch / 2 : col * pitch;
      const start = halfStart ? gap / 2 : origin + gap / 2;
      const end = Math.min(length - gap / 2, halfStart ? pitch / 2 - gap / 2 : origin + pitch - gap / 2);
      const span = Math.max(0, end - start);
      patches.set(brickFacePatch(row, col, alongX ? 6 : 7), index * 4);
      const coordinate = -length / 2 + (start + end) / 2;
      const position = new THREE.Vector3(alongX ? coordinate : 0, (row + .5) * course, alongX ? 0 : coordinate);
      const size = new THREE.Vector3(alongX ? span : .24, span ? course - gap : 0, alongX ? .24 : span);
      bricks.setMatrixAt(index, matrix.compose(position, quaternion, size));
    }
    bricks.computeBoundingSphere();
    editable.add(bricks);
    const obstacle: PlayerObstacle = { id: name, minX: Math.min(x0, x1) - .12, maxX: Math.max(x0, x1) + .12,
      minZ: Math.min(z0, z1) - .12, maxZ: Math.max(z0, z1) + .12,
      minFloorY: baseY, maxFloorY: baseY + 3 };
    this.obstacles.push(obstacle);
    this.editableWallColliders.set(editable, { obstacle, matrix: new THREE.Matrix4().makeScale(0, 0, 0) });
  }

  private castFrame(x: number, z: number): void {
    const column = new THREE.Mesh(new RoundedBoxGeometry(.30, 3.16, .30, 2, .008), siteMaterial('concrete', 0xd1cac0, .2, 1.4));
    column.name = 'Exposed cast concrete structural column';
    column.position.set(x, 1.58, z);
    column.castShadow = column.receiveShadow = true;
    this.add(column);
  }

  private addCourtyardOpeningFrame(): void {
    const concrete = siteMaterial('floor', 0xd7d0c4, .24, .55);
    for (const z of [12.91, 15.09]) {
      const jamb = new THREE.Mesh(new RoundedBoxGeometry(.29, 3.0, .22, 2, .009), concrete);
      jamb.name = 'Raw courtyard aperture concrete jamb';
      jamb.position.set(9, 1.5, z);
      jamb.castShadow = jamb.receiveShadow = true;
      this.add(jamb);
    }
    const lintel = new THREE.Mesh(new RoundedBoxGeometry(.34, .3, 2.76, 2, .009), concrete);
    lintel.name = 'Structural lintel over doorless courtyard passage';
    lintel.position.set(9, 2.61, 14.0);
    lintel.castShadow = lintel.receiveShadow = true;
    this.add(lintel);
    const geometry = new THREE.BoxGeometry(1, 1, 1), patches = new Float32Array(16 * 4);
    geometry.setAttribute('brickPatch', new THREE.InstancedBufferAttribute(patches, 4));
    const clay = new THREE.InstancedMesh(geometry, masonryFaceMaterial, 16);
    clay.name = 'Fired-clay masonry bearing above courtyard lintel';
    const matrix = new THREE.Matrix4();
    for (let row = 0; row < 2; row++) for (let col = 0; col < 8; col++) {
      const index = row * 8 + col;
      patches.set(brickFacePatch(row, col, 14), index * 4);
      clay.setMatrixAt(index, matrix.compose(new THREE.Vector3(9, 2.82 + row * .12, 12.84 + (col + .5) * .29),
        new THREE.Quaternion(), new THREE.Vector3(.23, .113, .283)));
    }
    clay.castShadow = clay.receiveShadow = true;
    clay.computeBoundingSphere(); this.add(clay);
  }

  private addCourtyardWindowBand(z0: number, z1: number): void {
    const mortar = siteMaterial('floor', 0x938b7f, .5, .5);
    for (const [name, y0, y1] of [
      ['sill masonry', 0, 1.04], ['head masonry', 2.43, 3],
    ] as const) {
      const backing = new THREE.Mesh(new THREE.BoxGeometry(.20, y1 - y0, z1 - z0), mortar);
      backing.name = `Courtyard east window ${name}`;
      backing.position.set(18, (y0 + y1) / 2, (z0 + z1) / 2);
      backing.castShadow = backing.receiveShadow = true;
      this.add(backing);
      const course = 3 / 23, rows = Math.ceil((y1 - y0) / course), cols = 6;
      const geometry = new THREE.BoxGeometry(1, 1, 1), patches = new Float32Array(rows * cols * 4);
      geometry.setAttribute('brickPatch', new THREE.InstancedBufferAttribute(patches, 4));
      const bricks = new THREE.InstancedMesh(geometry, masonryFaceMaterial, rows * cols);
      bricks.name = `Individual fired-clay units in ${name}`;
      const matrix = new THREE.Matrix4();
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const index = row * cols + col, y = y0 + (row + .5) * (y1 - y0) / rows;
        const z = z0 + (col + .5) * (z1 - z0) / cols;
        patches.set(brickFacePatch(row, col, 17), index * 4);
        bricks.setMatrixAt(index, matrix.compose(new THREE.Vector3(18, y, z), new THREE.Quaternion(),
          new THREE.Vector3(.24, (y1 - y0) / rows - .006, (z1 - z0) / cols - .006)));
      }
      bricks.castShadow = bricks.receiveShadow = true;
      bricks.computeBoundingSphere(); this.add(bricks);
    }
    const concrete = siteMaterial('floor', 0xd6cfc4, .22, .25);
    for (const [label, y] of [['raw sill', 1.04], ['supported lintel', 2.43]] as const) {
      const edge = new THREE.Mesh(new RoundedBoxGeometry(.36, .13, z1 - z0 + .24, 2, .009), concrete);
      edge.name = `Courtyard ${label} at window ${z0}`;
      edge.position.set(18, y, (z0 + z1) / 2);
      edge.castShadow = edge.receiveShadow = true;
      this.add(edge);
    }
    this.obstacles.push({ id: `court-open-window-sill-${z0}`, minX: 17.86, maxX: 18.14, minZ: z0, maxZ: z1 });
  }

  private addStairCore(): void {
    const concrete = siteMaterial('floor', 0xe4dfd7, .35, .35);
    const formwork = siteMaterial('concrete', 0xb4aca2, .2, .8);
    const box = (name: string, width: number, height: number, depth: number, x: number, y: number, z: number, material = concrete): THREE.Mesh => {
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 2, .006), material);
      mesh.name = name;
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.add(mesh);
      return mesh;
    };
    // Two eleven-riser flights, each 0.15 m high and 0.28 m deep, make the
    // selected 3.3 m floor-to-floor rise without a teleport or a visual ramp.
    for (let step = 1; step <= 11; step++) {
      const firstTop = step * .15;
      const firstZ = 8 + (step - .5) * .28;
      box(`Ground stair flight A tread ${step}`, 1.38, .13, .28, 5.5, firstTop - .065, firstZ);
      box(`Ground stair flight A riser ${step}`, 1.38, .15, .045, 5.5, firstTop - .075, firstZ - .14, formwork);
      const secondTop = 1.65 + step * .15;
      const secondZ = 11.08 - (step - .5) * .28;
      box(`Ground stair flight B tread ${step}`, 1.38, .13, .28, 7.5, secondTop - .065, secondZ);
      box(`Ground stair flight B riser ${step}`, 1.38, .15, .045, 7.5, secondTop - .075, secondZ + .14, formwork);
    }
    box('Cast concrete mid-flight landing', 3.4, .19, 1.12, 6.5, 1.555, 11.64);
    box('First-floor receiving corridor slab', 2, .21, 3.5, 7.5, 3.195, 6.25);
    // The landing is a real first-floor surface; temporary edge rails mark
    // its unfinished extension until the rest of L1 is constructed.
    const support = siteMaterial('concrete', 0xb9b0a4, .2, 1.4);
    for (const x of [6.55, 8.45]) for (const z of [4.62, 6.35]) {
      const column = new THREE.Mesh(new RoundedBoxGeometry(.24, 3.3, .24, 2, .008), support);
      column.name = 'First-floor landing support column';
      column.position.set(x, 1.65, z);
      column.castShadow = column.receiveShadow = true;
      this.add(column);
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0xc2a731, roughness: .64, metalness: .2 });
    for (const [x0, z0, x1, z1, y] of [
      [4.72, 8, 4.72, 12.22, 1.0], [6.5, 8, 6.5, 11.08, 1.8],
      [8.3, 8, 8.3, 12.22, 2.7],
    ]) {
      const length = Math.hypot(x1 - x0, z1 - z0);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, length, 8), steel);
      rail.name = 'Temporary stair-edge protection rail';
      rail.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      rail.rotation.z = Math.abs(x1 - x0) > Math.abs(z1 - z0) ? Math.PI / 2 : 0;
      if (Math.abs(x1 - x0) <= Math.abs(z1 - z0)) rail.rotation.x = Math.PI / 2;
      this.add(rail);
    }
    this.obstacles.push(
      { id: 'stair-first-flight-west-guard', minX: 4.55, maxX: 4.7, minZ: 8, maxZ: 11.08 },
      { id: 'stair-flight-well-guard', minX: 6.25, maxX: 6.72, minZ: 8, maxZ: 11.08 },
      { id: 'stair-second-flight-east-guard', minX: 8.3, maxX: 8.5, minZ: 8, maxZ: 11.08 },
    );
  }

  private addFirstFloorLanding(): void {
    // A short, supported L1 corridor makes the stair exit usable. Its rough
    // entry is framed but remains doorless until later construction stages.
    // The west return ends before the upper-stair access deck, leaving a
    // structural side passage rather than trapping the worker in the corridor.
    this.wall('L1 west fired-clay corridor wall', 6.5, 4.5, 6.5, 6.65, 3.3);
    this.wall('L1 east fired-clay corridor wall', 8.5, 4.5, 8.5, 7.95, 3.3);
    const roof = new THREE.Mesh(new RoundedBoxGeometry(2.24, .2, 3.68, 2, .012), siteMaterial('concrete', 0xcac3b8, .8, 1.5));
    roof.name = 'L1 corridor structural roof slab';
    roof.position.set(7.5, 6.5, 6.25);
    roof.castShadow = roof.receiveShadow = true;
    this.add(roof);
    const clay = createClaySoffitPreview(2, 3.5, 6.22);
    clay.name = 'L1 fired-clay structural soffit';
    clay.position.set(7.5, 0, 6.25);
    this.add(clay);
    const jambMaterial = siteMaterial('concrete', 0xd1cac0, .18, 1);
    for (const x of [6.52, 8.48]) {
      const jamb = new THREE.Mesh(new RoundedBoxGeometry(.18, 3, .24, 2, .009), jambMaterial);
      jamb.name = 'Door-ready cast jamb without door';
      jamb.position.set(x, 4.8, 8.0);
      jamb.castShadow = jamb.receiveShadow = true;
      this.add(jamb);
    }
    const head = new THREE.Mesh(new RoundedBoxGeometry(2.08, .24, .26, 2, .009), jambMaterial);
    head.name = 'Structural lintel over unfinished L1 passage';
    head.position.set(7.5, 6.33, 8.0);
    head.castShadow = head.receiveShadow = true;
    this.add(head);
  }

  private addFirstFloorRoom(): void {
    const floor = new THREE.Mesh(new RoundedBoxGeometry(6, .21, 4.5, 2, .012), siteMaterial('floor', 0xd0cbc3, 2, 1.5));
    floor.name = 'L1 unfinished first room structural floor';
    floor.position.set(9.5, 3.195, 2.25);
    floor.receiveShadow = true;
    this.add(floor);
    const roof = new THREE.Mesh(new RoundedBoxGeometry(6.28, .2, 4.72, 2, .012), siteMaterial('concrete', 0xcac3b8, 2, 1.5));
    roof.name = 'L1 room slab prepared for L2';
    roof.position.set(9.5, 6.5, 2.25);
    roof.castShadow = roof.receiveShadow = true;
    this.add(roof);
    const infill = createClaySoffitPreview(6, 4.5, 6.22);
    infill.name = 'L1 room clay and concrete roof construction';
    infill.position.set(9.5, 0, 2.25);
    this.add(infill);
    this.wall('L1 unfinished north perimeter', 6.5, 0, 12.5, 0, 3.3);
    this.wall('L1 unfinished west perimeter', 6.5, 0, 6.5, 4.5, 3.3);
    this.wall('L1 unfinished east perimeter', 12.5, 0, 12.5, 4.5, 3.3);
    this.wall('L1 unfinished south partition', 8.2, 4.5, 12.5, 4.5, 3.3);
    this.wall('L1 entrance left masonry pier', 6.5, 4.5, 6.8, 4.5, 3.3);
    const concrete = siteMaterial('floor', 0xe3ddd3, .35, .35);
    for (const x of [6.8, 8.2]) {
      const jamb = new THREE.Mesh(new RoundedBoxGeometry(.16, 2.42, .28, 2, .008), concrete);
      jamb.name = 'Unfinished door-ready L1 opening jamb';
      jamb.position.set(x, 4.51, 4.5);
      jamb.castShadow = jamb.receiveShadow = true;
      this.add(jamb);
    }
    const lintel = new THREE.Mesh(new RoundedBoxGeometry(1.56, .28, .32, 2, .008), concrete);
    lintel.name = 'Supported L1 door opening lintel without fitted door';
    lintel.position.set(7.5, 5.86, 4.5);
    lintel.castShadow = lintel.receiveShadow = true;
    this.add(lintel);
    const upperGeometry = new THREE.BoxGeometry(1, 1, 1);
    const upperPatches = new Float32Array(8 * 4);
    upperGeometry.setAttribute('brickPatch', new THREE.InstancedBufferAttribute(upperPatches, 4));
    const upperFill = new THREE.InstancedMesh(upperGeometry, masonryFaceMaterial, 8);
    upperFill.name = 'Two fired-clay courses above L1 rough opening';
    const matrix = new THREE.Matrix4();
    for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
      const index = row * 4 + col;
      upperPatches.set(brickFacePatch(row, col, 12), index * 4);
      upperFill.setMatrixAt(index, matrix.compose(new THREE.Vector3(6.8 + (col + .5) * .35, 6.075 + row * .15, 4.5),
        new THREE.Quaternion(), new THREE.Vector3(.345, .145, .2)));
    }
    upperFill.castShadow = upperFill.receiveShadow = true;
    upperFill.computeBoundingSphere();
    this.add(upperFill);
    const pier = new THREE.Mesh(new RoundedBoxGeometry(.3, 3.3, .3, 2, .008), concrete);
    for (const [index, x] of [6.5, 12.5].entries()) for (const [offset, z] of [0, 4.5].entries()) {
      const column = pier.clone();
      column.name = `L1 room support column ${index}-${offset}`;
      column.position.set(x, 1.65, z);
      column.castShadow = column.receiveShadow = true;
      this.add(column);
    }
  }

  private addUpperStairCore(fromFloor: number): void {
    const base = fromFloor * 3.3;
    const label = `L${fromFloor} to L${fromFloor + 1}`;
    const concrete = siteMaterial('floor', 0xd7d1c7, .35, .35);
    const formwork = siteMaterial('concrete', 0xb5ada2, .2, .8);
    const deck = new THREE.Mesh(new RoundedBoxGeometry(2.15, .18, 1.48, 2, .01), concrete);
    deck.name = `Supported L${fromFloor} side deck leading to upper stair`;
    deck.position.set(5.55, base - .09, 7.24);
    deck.castShadow = deck.receiveShadow = true;
    this.add(deck);
    const deckColumn = new THREE.Mesh(new RoundedBoxGeometry(.27, 3.21, .27, 2, .008), formwork);
    for (const z of [6.6, 7.85]) {
      const support = deckColumn.clone();
      support.name = `Cast support under L${fromFloor} side deck`;
      support.position.set(4.52, base - 1.7, z);
      support.castShadow = support.receiveShadow = true;
      this.add(support);
    }
    const edgeSteel = new THREE.MeshStandardMaterial({ color: 0xc2a731, roughness: .62, metalness: .25 });
    for (const z of [6.56, 7.24, 7.9]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.028, .028, 1.05, 8), edgeSteel);
      post.name = `Temporary L${fromFloor} side-deck edge-protection post`;
      post.position.set(4.48, base + .525, z);
      post.castShadow = true;
      this.add(post);
    }
    const deckRail = new THREE.Mesh(new THREE.CylinderGeometry(.023, .023, 1.46, 8), edgeSteel);
    deckRail.name = `Visible guard at open L${fromFloor} side deck`;
    deckRail.position.set(4.48, base + 1, 7.23);
    deckRail.rotation.x = Math.PI / 2;
    this.add(deckRail);
    this.obstacles.push({ id: `L${fromFloor} side-deck edge guard`, minX: 4.42, maxX: 4.53, minZ: 6.51, maxZ: 7.97,
      minFloorY: base, maxFloorY: base });
    const geometry = new RoundedBoxGeometry(1, 1, 1, 2, .006);
    const treads = new THREE.InstancedMesh(geometry, concrete, 22);
    const risers = new THREE.InstancedMesh(geometry, formwork, 22);
    treads.name = `${label} cast stair treads`;
    risers.name = `${label} cast stair risers`;
    const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
    for (let step = 1; step <= 11; step++) {
      const firstTop = base + step * .15;
      const firstZ = 8 + (step - .5) * .28;
      treads.setMatrixAt(step - 1, matrix.compose(new THREE.Vector3(5.5, firstTop - .065, firstZ), quaternion,
        new THREE.Vector3(1.38, .13, .28)));
      risers.setMatrixAt(step - 1, matrix.compose(new THREE.Vector3(5.5, firstTop - .075, firstZ - .14), quaternion,
        new THREE.Vector3(1.38, .15, .045)));
      const secondTop = base + 1.65 + step * .15;
      const secondZ = 11.08 - (step - .5) * .28;
      treads.setMatrixAt(step + 10, matrix.compose(new THREE.Vector3(7.5, secondTop - .065, secondZ), quaternion,
        new THREE.Vector3(1.38, .13, .28)));
      risers.setMatrixAt(step + 10, matrix.compose(new THREE.Vector3(7.5, secondTop - .075, secondZ + .14), quaternion,
        new THREE.Vector3(1.38, .15, .045)));
    }
    for (const mesh of [treads, risers]) {
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.add(mesh);
    }
    const landing = new THREE.Mesh(new RoundedBoxGeometry(3.4, .19, 1.12, 2, .009), concrete);
    landing.name = `${label} mid-flight structural landing`;
    landing.position.set(6.5, base + 1.555, 11.64);
    landing.castShadow = landing.receiveShadow = true;
    this.add(landing);
    // The lower corridor and room roofs serve as the next level's real floor;
    // a second overlapping slab would cause visible fighting and bad contact.
    const steel = new THREE.MeshStandardMaterial({ color: 0xc2a731, roughness: .64, metalness: .2 });
    for (const [x, z0, z1, y] of [[4.72, 8, 12.22, base + 1], [6.5, 8, 11.08, base + 1.8], [8.3, 8, 12.22, base + 2.7]]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, z1 - z0, 8), steel);
      rail.name = 'Temporary upper stair-edge protection rail';
      rail.position.set(x, y, (z0 + z1) / 2);
      rail.rotation.x = Math.PI / 2;
      this.add(rail);
    }
  }

  private addSecondFloorShell(): void {
    this.wall('L2 west fired-clay corridor wall', 6.5, 4.5, 6.5, 6.65, 6.6);
    this.wall('L2 east fired-clay corridor wall', 8.5, 4.5, 8.5, 7.95, 6.6);
    const roof = new THREE.Mesh(new RoundedBoxGeometry(2.24, .2, 3.68, 2, .012), siteMaterial('concrete', 0xcac3b8, .8, 1.5));
    roof.name = 'L2 corridor structural roof slab';
    roof.position.set(7.5, 9.8, 6.25);
    roof.castShadow = roof.receiveShadow = true;
    this.add(roof);
    const roomRoof = new THREE.Mesh(new RoundedBoxGeometry(6.28, .2, 4.72, 2, .012), siteMaterial('concrete', 0xcac3b8, 2, 1.5));
    roomRoof.name = 'L2 office shell slab prepared for next floor';
    roomRoof.position.set(9.5, 9.8, 2.25);
    roomRoof.castShadow = roomRoof.receiveShadow = true;
    this.add(roomRoof);
    const infill = createClaySoffitPreview(6, 4.5, 9.52);
    infill.name = 'L2 exposed fired-clay and concrete ceiling construction';
    infill.position.set(9.5, 0, 2.25);
    this.add(infill);
    this.wall('L2 office north perimeter', 6.5, 0, 12.5, 0, 6.6);
    this.wall('L2 office west perimeter', 6.5, 0, 6.5, 4.5, 6.6);
    this.wall('L2 office east perimeter', 12.5, 0, 12.5, 4.5, 6.6);
    this.wall('L2 office south partition', 8.2, 4.5, 12.5, 4.5, 6.6);
    this.wall('L2 office entrance left masonry pier', 6.5, 4.5, 6.8, 4.5, 6.6);
    const trim = siteMaterial('floor', 0xd4cdc2, .25, .3);
    for (const x of [6.8, 8.2]) {
      const jamb = new THREE.Mesh(new RoundedBoxGeometry(.16, 2.42, .28, 2, .008), trim);
      jamb.name = 'L2 unfinished door-ready opening jamb without door';
      jamb.position.set(x, 7.81, 4.5);
      jamb.castShadow = jamb.receiveShadow = true;
      this.add(jamb);
    }
    const lintel = new THREE.Mesh(new RoundedBoxGeometry(1.56, .28, .32, 2, .008), trim);
    lintel.name = 'L2 supported rough door opening lintel';
    lintel.position.set(7.5, 9.16, 4.5);
    lintel.castShadow = lintel.receiveShadow = true;
    this.add(lintel);
  }

  private addSetbackFloorShell(level: 3 | 4): void {
    const base = level * 3.3;
    const label = `L${level}`;
    const west = 7, east = level === 3 ? 11 : 10;
    const north = level === 3 ? .5 : 1;
    const south = 4.5;
    const width = east - west, depth = south - north;
    // L3 stands on L2's full roof; L4 stands on the smaller L3 roof. Their
    // uncovered margins become narrow construction terraces, not extra rooms.
    this.wall(`${label} corridor west masonry return`, 6.5, 4.5, 6.5, level === 3 ? 6.65 : 7.95, base);
    this.wall(`${label} corridor east masonry return`, 8.5, 4.5, 8.5, 7.95, base);
    const concrete = siteMaterial('concrete', 0xcac3b8, .8, 1.5);
    const corridorRoof = new THREE.Mesh(new RoundedBoxGeometry(2.24, .2, 3.68, 2, .012), concrete);
    corridorRoof.name = `${label} corridor structural roof slab`;
    corridorRoof.position.set(7.5, base + 3.2, 6.25);
    corridorRoof.castShadow = corridorRoof.receiveShadow = true;
    this.add(corridorRoof);
    const roomRoof = new THREE.Mesh(new RoundedBoxGeometry(width + .28, .2, depth + .22, 2, .012),
      siteMaterial('concrete', 0xcac3b8, width / 2, depth / 2));
    roomRoof.name = `${label} setback room structural roof slab`;
    roomRoof.position.set((west + east) / 2, base + 3.2, (north + south) / 2);
    roomRoof.castShadow = roomRoof.receiveShadow = true;
    this.add(roomRoof);
    const infill = createClaySoffitPreview(width, depth, base + 2.92);
    infill.name = `${label} exposed clay-and-concrete room soffit`;
    infill.position.set((west + east) / 2, 0, (north + south) / 2);
    this.add(infill);
    this.wall(`${label} setback room north masonry`, west, north, east, north, base);
    this.wall(`${label} setback room west masonry`, west, north, west, south, base);
    this.wall(`${label} setback room south masonry`, 8.2, south, east, south, base);
    // An unfinished 1.5 m terrace opening is left in the east infill wall.
    this.wall(`${label} terrace wall north pier`, east, north, east, 2, base);
    this.wall(`${label} terrace wall south pier`, east, 3.5, east, south, base);
    const trim = siteMaterial('floor', 0xd4cdc2, .25, .3);
    for (const x of [west, 8.2]) {
      const jamb = new THREE.Mesh(new RoundedBoxGeometry(.16, 2.42, .28, 2, .008), trim);
      jamb.name = `${label} unfinished door-ready room jamb`;
      jamb.position.set(x, base + 1.21, south);
      jamb.castShadow = jamb.receiveShadow = true;
      this.add(jamb);
    }
    const entranceHead = new THREE.Mesh(new RoundedBoxGeometry(1.36, .28, .32, 2, .008), trim);
    entranceHead.name = `${label} supported rough room opening without door`;
    entranceHead.position.set(7.6, base + 2.56, south);
    entranceHead.castShadow = entranceHead.receiveShadow = true;
    this.add(entranceHead);
    for (const z of [2, 3.5]) {
      const jamb = new THREE.Mesh(new RoundedBoxGeometry(.28, 2.42, .16, 2, .008), trim);
      jamb.name = `${label} unfinished terrace aperture jamb`;
      jamb.position.set(east, base + 1.21, z);
      jamb.castShadow = jamb.receiveShadow = true;
      this.add(jamb);
    }
    const terraceHead = new THREE.Mesh(new RoundedBoxGeometry(.32, .28, 1.66, 2, .008), trim);
    terraceHead.name = `${label} structural terrace opening lintel, no glazing`;
    terraceHead.position.set(east, base + 2.56, 2.75);
    terraceHead.castShadow = terraceHead.receiveShadow = true;
    this.add(terraceHead);
    const steel = new THREE.MeshStandardMaterial({ color: 0xc2a731, roughness: .62, metalness: .23 });
    const edgeX = level === 3 ? 12.36 : 10.86;
    for (const z of [1.5, 2.75, 4]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.027, .027, 1.04, 8), steel);
      post.name = `${label} temporary terrace-edge protection post`;
      post.position.set(edgeX, base + .52, z);
      post.castShadow = true;
      this.add(post);
    }
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(.023, .023, 2.5, 8), steel);
    rail.name = `${label} continuous temporary terrace-edge rail`;
    rail.position.set(edgeX, base + 1.02, 2.75);
    rail.rotation.x = Math.PI / 2;
    this.add(rail);
    this.obstacles.push({ id: `${label} terrace east-edge guard`, minX: edgeX - .07, maxX: edgeX + .07,
      minZ: 1.45, maxZ: 4.05, minFloorY: base, maxFloorY: base });
  }

  private addTemporarySafety(): void {
    const guard = new THREE.Group();
    guard.name = 'Temporary edge-protection at future foyer extension';
    const steel = new THREE.MeshStandardMaterial({ color: 0xc2a731, roughness: .6, metalness: .25 });
    for (const x of [2.2, 4.2, 6.2, 8.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 1.08, 8), steel);
      post.position.set(x, .54, 7.96);
      guard.add(post);
    }
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, 6, 8), steel);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(5.2, 1.05, 7.96);
    guard.add(rail);
    this.add(guard);
  }
}
