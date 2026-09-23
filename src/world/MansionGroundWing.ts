import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PlayerObstacle } from '../player/EquipmentCollision';
import { brickFacePatch, brickFaceTone } from './BrickFacePatch';
import { masonryFaceMaterial } from './BrickFaceMaterial';
import { siteMaterial, siteSmoothConcreteMaterial } from './SiteMaterials';
import { curvedWallGeometry, type CurvedWallShape } from './CurvedWallGeometry';
import { createConcreteSoffit } from './ConcreteSoffit';
import { MansionCourtyard } from './MansionCourtyard';
import { MansionSurroundings } from './MansionSurroundings';
import { BrickWall } from './BrickWall';
import { hollowClayWallEnds } from './HollowClayEnd';
import { laidClayGeometry } from './LaidClayDamage';
import { MansionMasonryDemolition, type MasonryAim, type MasonryBrickInstance } from './MansionMasonryDemolition';

/** Traversable unfinished mansion shell, including the original work room. */
export class MansionGroundWing extends THREE.Group {
  readonly obstacles: PlayerObstacle[] = [];
  readonly editableWalls = new Map<string, THREE.Group>();
  readonly editableSurfaces = new Map<string, THREE.Group>();
  readonly editableAssets = new Map<string, THREE.Group>();
  readonly masonryDemolition = new Map<string, MansionMasonryDemolition>();
  private originalRoomFloor: THREE.Group | null = null;
  private readonly editableWallColliders = new Map<THREE.Group, { obstacle: PlayerObstacle; matrix: THREE.Matrix4 }>();
  private readonly editableAssetColliders = new Map<THREE.Group, { obstacle: PlayerObstacle; matrix: THREE.Matrix4; source?: THREE.Object3D;
    segment?: { length: number; halfWidth: number; alongX?: boolean } }>();
  private readonly corner = new THREE.Vector3();
  private readonly inverseSurfaceMatrix = new THREE.Matrix4();
  private readonly gameplayCulled = new Map<THREE.Object3D, boolean>();
  private retainingContactMaterial: THREE.MeshStandardMaterial | null = null;
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
    for (const [id, wall] of this.courtyard.masonryDemolition) this.masonryDemolition.set(id, wall);
    this.surroundings = new MansionSurroundings(oliveSource, neighbourSource);
    this.add(this.surroundings);
    this.addStairCore();
    this.addBasementLevels();
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
      pivot.userData.levelEditorGround = /\b(?:ground|terrain|soil|floor)\b/i.test(object.name);
      if (object.name.startsWith('B1 ')) pivot.userData.levelEditorFloor = 5;
      if (object.name.startsWith('B2 ')) pivot.userData.levelEditorFloor = 6;
      pivot.userData.levelEditorLabel = `${object.name}${count > 1 ? ` · ${count}` : ''}`;
      const windowSill = /^Courtyard east window sill assembly (8|12)$/.exec(object.name);
      if (windowSill) pivot.userData.levelEditorOpeningSill = true;
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
      if (windowSill) {
        const obstacle = this.obstacles.find(item => item.id === `court-open-window-sill-${windowSill[1]}`);
        if (obstacle) this.editableAssetColliders.set(pivot, {
          obstacle, matrix: new THREE.Matrix4().makeScale(0, 0, 0), source: object,
        });
      }
      if (object.name.startsWith('B1 retaining ') || object.name.startsWith('B2 retaining ') ||
        /^(?:B1|B2) exposed frame column /.test(object.name)) {
        const obstacle = this.obstacles.find(item => item.id === object.name);
        if (obstacle) this.editableAssetColliders.set(pivot, {
          obstacle, matrix: new THREE.Matrix4().makeScale(0, 0, 0), source: object,
        });
      }
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
    const supplies = room.getObjectByName('First-fix supplies at the site perimeter');
    const sources = [
      ...[...room.children].filter(object => object !== this && object !== exterior && object !== supplies)
        .map(object => ({ object, parent: room, prefix: 'room-part' })),
      // PVC Workshop hides this decorative duplicate; the live stock has its own editor actor.
      ...(supplies instanceof THREE.Group
        ? [...supplies.children].filter(object => object.userData.studioEntityId !== 'world:site-spare-pvc')
          .map(object => ({ object, parent: supplies, prefix: 'room-supply' })) : []),
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
      const structuralColumn = locked.has(object) && typeof object.userData.studioEntityId === 'string' &&
        object.userData.studioEntityId.startsWith('world:column:');
      const structuralSideWall = locked.has(object) &&
        (object.userData.studioEntityId === 'world:right-concrete-wall' ||
          object.userData.studioEntityId === 'world:left-concrete-wall');
      const workWall = locked.has(object) && object instanceof BrickWall &&
        object.userData.studioEntityId === 'world:brick-wall';
      pivot.userData.levelEditorLocked = locked.has(object) && !structuralColumn && !structuralSideWall;
      pivot.userData.levelEditorGround = /\b(?:ground|terrain|soil|floor)\b/i.test(object.name);
      pivot.userData.baseSize = [Math.max(size.x, .01), Math.max(size.y, .01), Math.max(size.z, .01)];
      pivot.userData.studioEntityId = `mansion:${id}`;
      parent.add(pivot);
      pivot.position.copy(parent.worldToLocal(centre.clone()));
      pivot.attach(object);
      this.editableAssets.set(id, pivot);
      if (structuralColumn || structuralSideWall || workWall) {
        if (object.userData.studioEntityId === 'world:right-concrete-wall') {
          const oldIndex = this.obstacles.findIndex(item => item.id === 'mansion-room-east');
          if (oldIndex >= 0) this.obstacles.splice(oldIndex, 1);
        }
        const obstacle: PlayerObstacle = { id, minX: bounds.min.x, maxX: bounds.max.x,
          minZ: bounds.min.z, maxZ: bounds.max.z, minFloorY: bounds.min.y, maxFloorY: bounds.max.y };
        this.obstacles.push(obstacle);
        this.editableAssetColliders.set(pivot, { obstacle, matrix: new THREE.Matrix4().makeScale(0, 0, 0), source: object,
          segment: structuralSideWall ? { length: size.z, halfWidth: size.x / 2 }
            : workWall ? { length: object.volume.width, halfWidth: object.volume.depth / 2, alongX: true } : undefined });
      }
    }
  }

  update(dt: number): void { this.courtyard.update(dt); this.surroundings.update(dt); }

  /** Underground work areas do not need to draw through their ground slabs.
   * Restore them before the editor takes its own per-floor visibility snapshot. */
  restoreGameplayVisibility(): void {
    for (const [object, wasVisible] of this.gameplayCulled) object.visible = wasVisible;
    this.gameplayCulled.clear();
  }

  updateGameplayVisibility(x: number, z: number, feetY: number): void {
    if (this.emptyTemplate) return;
    const nearStair = Math.hypot(x - 6.5, z - 9.6) < 6.5;
    const showB1 = feetY < -.05 || nearStair;
    const showB2 = feetY < -2.5;
    for (const object of this.children) {
      const floor = object.userData.levelEditorFloor === 5 || object.name.startsWith('B1 ') ? 5
        : object.userData.levelEditorFloor === 6 || object.name.startsWith('B2 ') ? 6 : 0;
      if (!floor) continue;
      const shouldCull = floor === 5 ? !showB1 : !showB2;
      if (shouldCull) {
        if (!this.gameplayCulled.has(object)) this.gameplayCulled.set(object, object.visible);
        object.visible = false;
      } else if (this.gameplayCulled.has(object)) {
        object.visible = this.gameplayCulled.get(object)!;
        this.gameplayCulled.delete(object);
      }
    }
  }

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
    const stairBases = [-6.8, -3.4, 0, 3.3, 6.6, 9.9];
    const onFirst = x >= 4.8 && x <= 6.2 && z >= 8 && z < 11.08;
    if (onFirst) {
      const step = Math.min(11, Math.floor((z - 8) / .28) + 1);
      return closest(stairBases.map(base => base + step * (base < 0 ? 3.4 / 22 : .15)));
    }
    const onLanding = x >= 4.8 && x <= 8.2 && z >= 11.08 && z <= 12.2;
    if (onLanding) return closest(stairBases.map(base => base + (base < 0 ? 1.7 : 1.65)));
    const onSecond = x >= 6.8 && x <= 8.2 && z >= 8 && z < 11.08;
    if (onSecond) {
      const step = Math.min(11, Math.floor((11.08 - z) / .28) + 1);
      return closest(stairBases.map(base => base + (base < 0 ? 1.7 + step * 3.4 / 22 : 1.65 + step * .15)));
    }
    if (x >= 4.48 && x <= 6.6 && z >= 6.5 && z < 8) return closest([-6.8, -3.4, 0, 3.3, 6.6, 9.9]);
    if (x >= 6.5 && x <= 8.5 && z >= 4.5 && z < 8) return closest([-6.8, -3.4, 0, 3.3, 6.6, 9.9, 13.2]);
    if (x >= 6.5 && x <= 9 && z >= 0 && z < 4.5) {
      const heights = [-6.8, -3.4, 0, 3.3, 6.6, 9.9];
      if (x >= 7 && z >= .5) heights.push(13.2); // L4 stands on L3's slab in this shared footprint.
      return closest(heights);
    }
    if (x >= 9 && x <= 18 && z >= -3.5 && z < 6) {
      const heights = [-6.8, -3.4, 0, 3.3, 6.6, 9.9];
      if (x <= 11.14 && z >= .5 && z <= 4.5) heights.push(13.2);
      return closest(heights);
    }
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
      if (asset.userData.levelEditorHidden === true) {
        entry.obstacle.segments = [];
        entry.obstacle.minX = entry.obstacle.minZ = Infinity;
        entry.obstacle.maxX = entry.obstacle.maxZ = -Infinity;
        continue;
      }
      asset.updateWorldMatrix(true, true);
      if (entry.matrix.equals(asset.matrixWorld)) continue;
      entry.matrix.copy(asset.matrixWorld);
      const source = entry.source;
      if (source instanceof BrickWall) source.updateWorldMatrix(true, false);
      if (source instanceof THREE.Mesh && /^(?:B1|B2) retaining /.test(source.name))
        source.updateWorldMatrix(true, false);
      const bounds = source instanceof BrickWall
        ? new THREE.Box3(
          new THREE.Vector3(-source.volume.width / 2, 0, source.volume.frontZ - source.volume.depth),
          new THREE.Vector3(source.volume.width / 2, source.volume.height, source.volume.frontZ),
        ).applyMatrix4(source.matrixWorld)
        : source instanceof THREE.Mesh && /^(?:B1|B2) retaining /.test(source.name)
          ? (source.geometry.computeBoundingBox(), source.geometry.boundingBox!.clone().applyMatrix4(source.matrixWorld))
        : new THREE.Box3().setFromObject(source ?? asset, true);
      const obstacle = entry.obstacle;
      obstacle.minX = bounds.min.x - .01; obstacle.maxX = bounds.max.x + .01;
      obstacle.minZ = bounds.min.z - .01; obstacle.maxZ = bounds.max.z + .01;
      obstacle.minFloorY = bounds.min.y - .2; obstacle.maxFloorY = bounds.max.y;
      if (entry.segment) {
        const { length, alongX } = entry.segment;
        const a = new THREE.Vector3(alongX ? -length / 2 : 0, 0, alongX ? 0 : -length / 2).applyMatrix4(asset.matrixWorld);
        const b = new THREE.Vector3(alongX ? length / 2 : 0, 0, alongX ? 0 : length / 2).applyMatrix4(asset.matrixWorld);
        const scale = new THREE.Vector3().setFromMatrixScale(asset.matrixWorld);
        const widthScale = alongX ? scale.z : scale.x;
        const halfWidth = entry.segment.halfWidth * widthScale + .01;
        obstacle.segments = [{ ax: a.x, az: a.z, bx: b.x, bz: b.z, halfWidth }];
        obstacle.minX = Math.min(a.x, b.x) - halfWidth; obstacle.maxX = Math.max(a.x, b.x) + halfWidth;
        obstacle.minZ = Math.min(a.z, b.z) - halfWidth; obstacle.maxZ = Math.max(a.z, b.z) + halfWidth;
      }
    }
    for (const [wall, entry] of this.editableWallColliders) {
      const obstacle = entry.obstacle;
      if (wall.userData.levelEditorHidden === true) {
        obstacle.segments = [];
        obstacle.minX = obstacle.minZ = Infinity;
        obstacle.maxX = obstacle.maxZ = -Infinity;
        continue;
      }
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
    for (const wall of this.masonryDemolition.values())
      if (wall.group.userData.levelEditorHidden !== true) wall.updateGroundCollision();
    return this.obstacles.filter(obstacle =>
      (!this.emptyTemplate || obstacle.id.startsWith('Editor ')) &&
      floorY >= (obstacle.minFloorY ?? -Infinity) - .16 && floorY <= (obstacle.maxFloorY ?? Infinity) + .16);
  }

  aimMasonry(camera: THREE.Camera): MasonryAim | null {
    let nearest: MasonryAim | null = null;
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const view = camera.getWorldDirection(new THREE.Vector3());
    for (const wall of this.masonryDemolition.values()) {
      const hit = wall.aim(camera, 2.4, eye, view);
      if (hit && (!nearest || hit.distance < nearest.distance)) nearest = hit;
    }
    return nearest;
  }

  demolitionSnapshot(): Record<string, number[]> {
    const result: Record<string, number[]> = {};
    for (const [id, wall] of this.masonryDemolition) if (wall.damaged) result[id] = wall.removedIndices();
    return result;
  }

  restoreDemolition(snapshot: Record<string, number[]>): void {
    for (const wall of this.masonryDemolition.values()) wall.reset();
    for (const [id, indices] of Object.entries(snapshot))
      if (Array.isArray(indices)) this.masonryDemolition.get(id)?.restoreRemoved(indices);
  }

  setEditorWallHidden(group: THREE.Group, hidden: boolean): void {
    const entry = this.editableWallColliders.get(group);
    if (!entry) return;
    if ((group.userData.levelEditorHidden === true) === hidden) return;
    group.userData.levelEditorHidden = hidden;
    group.visible = !hidden;
    entry.matrix.makeScale(0, 0, 0);
    this.obstaclesAt(group.position.y);
  }

  setEditorAssetHidden(group: THREE.Group, hidden: boolean): void {
    if (!group.userData.levelEditorOpeningSill) return;
    if ((group.userData.levelEditorHidden === true) === hidden) return;
    group.userData.levelEditorHidden = hidden;
    group.visible = !hidden;
    this.editableAssetColliders.get(group)?.matrix.makeScale(0, 0, 0);
    this.obstaclesAt(group.position.y);
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
    this.masonryDemolition.delete(group.name);
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
      const soffit = createConcreteSoffit(w, d, 2.94);
      soffit.name = 'Continuous cast garage roof soffit';
      soffit.position.set(x, 0, z);
      this.add(soffit);
    }
    const sharedSoffit = createConcreteSoffit(3.5, 4.5, 2.91);
    sharedSoffit.name = 'Continuous cast soffit under existing L1 floor above garage';
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
    const panels = stairVoid ? [
      { w: 6.05, d: 5, x: 1.675, z: 10.1 },
      { w: .6, d: 5, x: 8.7, z: 10.1 },
      { w: 3.7, d: .4, x: 6.55, z: 7.8 },
      { w: 3.7, d: .4, x: 6.55, z: 12.4 },
    ] : [{ w: width, d: depth, x, z }];
    for (const panel of panels) {
      const floor = new THREE.Mesh(new RoundedBoxGeometry(panel.w, .18, panel.d, 2, .012), concrete);
      floor.name = name;
      floor.position.set(panel.x, -.09, panel.z);
      floor.receiveShadow = true;
      this.add(floor);
      const roof = new THREE.Mesh(new RoundedBoxGeometry(panel.w, .18, panel.d, 2, .012), siteMaterial('concrete', 0xc9c3b8, panel.w / 2.2, panel.d / 2.2));
      roof.name = `${name} load-bearing ceiling slab`;
      roof.position.set(panel.x, 3.19, panel.z);
      roof.castShadow = roof.receiveShadow = true;
      this.add(roof);
      // Keep the stair void open, but make each supported underside continuous
      // cast concrete rather than a grid of fictitious overhead clay cells.
      const soffit = createConcreteSoffit(panel.w, panel.d, 2.92);
      soffit.name = `${name} cast concrete soffit`;
      soffit.position.set(panel.x, 0, panel.z);
      this.add(soffit);
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
    // This backing is the mortar visible in the gaps and handling chips.
    // A little diffuse fill keeps its recessed faces legible in deep shadow.
    const mortarBacking = siteMaterial('concrete', 0xaaa399, length / 2, 1.5);
    mortarBacking.emissive.setHex(0x77736e);
    mortarBacking.emissiveIntensity = .28;
    const backing = new THREE.Mesh(new THREE.BoxGeometry(alongX ? length : .226, 3, alongX ? .226 : length), mortarBacking);
    backing.name = `${name} mortar backing`;
    backing.position.set(0, 1.5, 0);
    backing.castShadow = backing.receiveShadow = true;
    editable.add(backing);
    const pitch = .38, course = 3 / 23, gap = .006;
    const columns = Math.ceil(length / pitch) + 1, rows = 23;
    const wearTypes = ['sound', 'small-chip-a', 'small-chip-b', 'broken-corner'] as const;
    const batches: { matrices: THREE.Matrix4[]; colors: THREE.Color[]; patches: number[] }[] =
      wearTypes.map(() => ({ matrices: [], colors: [], patches: [] }));
    const slots: ({ variant: number; instance: number } | null)[] = Array(columns * rows).fill(null);
    const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), tint = new THREE.Color();
    const wallSeed = [...name].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0;
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      // Running bond needs a half unit at the start of alternate courses.
      // Omitting it left a 19 cm dark slot at every other wall corner.
      const halfStart = row % 2 === 1 && col === 0;
      const origin = row % 2 === 1 ? (col - 1) * pitch + pitch / 2 : col * pitch;
      const hand = (salt: number) => ((Math.imul(row + salt * 17, 73856093) ^ Math.imul(col + salt * 29, 19349663)) >>> 0) % 101 / 100;
      const leftJoint = gap / 2 + (hand(1) - .5) * .005;
      const rightJoint = gap / 2 + (hand(2) - .5) * .005;
      const start = halfStart ? leftJoint : origin + leftJoint;
      const end = Math.min(length - rightJoint, halfStart ? pitch / 2 - rightJoint : origin + pitch - rightJoint);
      const span = Math.max(0, end - start);
      if (span < .005) continue;
      const coordinate = -length / 2 + (start + end) / 2;
      const relief = (hand(5) - .5) * .007;
      const bottom = row * course + gap / 2 + (hand(3) - .5) * .005;
      const top = (row + 1) * course - gap / 2 + (hand(4) - .5) * .005;
      const position = new THREE.Vector3(alongX ? coordinate : relief, (bottom + top) / 2, alongX ? relief : coordinate);
      const size = new THREE.Vector3(alongX ? span : .24, span ? top - bottom : 0, alongX ? .24 : span);
      const wear = (Math.imul(row + 1, 2246822519) ^ Math.imul(col + 1, 3266489917) ^ wallSeed) >>> 0;
      const variant = wear % 100 < 4 ? 3 : wear % 100 < 14 ? 2 : wear % 100 < 24 ? 1 : 0;
      const batch = batches[variant];
      slots[row * columns + col] = { variant, instance: batch.matrices.length };
      batch.matrices.push(matrix.compose(position, quaternion, size).clone());
      const tone = brickFaceTone(row, col, alongX ? 6 : 7);
      batch.colors.push(tint.setRGB(tone[0], tone[1], tone[2]).clone());
      batch.patches.push(...brickFacePatch(row, col, alongX ? 6 : 7));
    }
    const batchMeshes: THREE.InstancedMesh[] = [];
    for (const [index, batch] of batches.entries()) {
      if (!batch.matrices.length) continue;
      const geometry = laidClayGeometry(wearTypes[index], alongX);
      geometry.setAttribute('brickPatch', new THREE.InstancedBufferAttribute(new Float32Array(batch.patches), 4));
      const bricks = new THREE.InstancedMesh(geometry, masonryFaceMaterial, batch.matrices.length);
      bricks.name = `${name} · ${index === 0 ? 'sound clay units' : index === 1 ? 'lightly chipped units A' : index === 2 ? 'lightly chipped units B' : 'broken corners'}`;
      bricks.castShadow = bricks.receiveShadow = true;
      for (let i = 0; i < batch.matrices.length; i++) {
        bricks.setMatrixAt(i, batch.matrices[i]);
        bricks.setColorAt(i, batch.colors[i]);
      }
      bricks.computeBoundingSphere();
      editable.add(bricks);
      batchMeshes[index] = bricks;
    }
    editable.add(hollowClayWallEnds(length, rows, course, gap, alongX, name));
    const obstacle: PlayerObstacle = { id: name, minX: Math.min(x0, x1) - .12, maxX: Math.max(x0, x1) + .12,
      minZ: Math.min(z0, z1) - .12, maxZ: Math.max(z0, z1) + .12,
      minFloorY: baseY, maxFloorY: baseY + 3 };
    this.obstacles.push(obstacle);
    this.editableWallColliders.set(editable, { obstacle, matrix: new THREE.Matrix4().makeScale(0, 0, 0) });
    const brickRefs: (MasonryBrickInstance | null)[] = slots.map(slot => slot
      ? { mesh: batchMeshes[slot.variant], instance: slot.instance }
      : null);
    this.masonryDemolition.set(name, new MansionMasonryDemolition(editable, brickRefs, backing, obstacle, length, alongX, columns, rows));
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
    // Keep the sill assembly together so the editor can remove or restore it
    // with the same collision footprint, turning this bay into a doorway.
    const sill = new THREE.Group();
    sill.name = `Courtyard east window sill assembly ${z0}`;
    this.add(sill);
    const mortar = siteMaterial('floor', 0x938b7f, .5, .5);
    for (const [name, y0, y1] of [
      ['sill masonry', 0, 1.04], ['head masonry', 2.43, 3],
    ] as const) {
      const parent = name === 'sill masonry' ? sill : this;
      const backing = new THREE.Mesh(new THREE.BoxGeometry(.20, y1 - y0, z1 - z0), mortar);
      backing.name = `Courtyard east window ${name}`;
      backing.position.set(18, (y0 + y1) / 2, (z0 + z1) / 2);
      backing.castShadow = backing.receiveShadow = true;
      parent.add(backing);
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
      bricks.computeBoundingSphere(); parent.add(bricks);
    }
    const concrete = siteMaterial('floor', 0xd6cfc4, .22, .25);
    for (const [label, y] of [['raw sill', 1.04], ['supported lintel', 2.43]] as const) {
      const edge = new THREE.Mesh(new RoundedBoxGeometry(.36, .13, z1 - z0 + .24, 2, .009), concrete);
      edge.name = `Courtyard ${label} at window ${z0}`;
      edge.position.set(18, y, (z0 + z1) / 2);
      edge.castShadow = edge.receiveShadow = true;
      (label === 'raw sill' ? sill : this).add(edge);
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
      { id: 'stair-first-flight-west-guard', minX: 4.55, maxX: 4.7, minZ: 8, maxZ: 11.08, minFloorY: 0, maxFloorY: 3.3 },
      { id: 'stair-flight-well-guard', minX: 6.25, maxX: 6.72, minZ: 8, maxZ: 11.08, minFloorY: 0, maxFloorY: 3.3 },
      { id: 'stair-second-flight-east-guard', minX: 8.3, maxX: 8.5, minZ: 8, maxZ: 11.08, minFloorY: 0, maxFloorY: 3.3 },
    );
  }

  private addBasementLevels(): void {
    const floorMaterial = siteMaterial('floor', 0xbdb9b1);
    // Retaining walls share the slab's cast aggregate. Their formwork pattern
    // is geometry below, rather than the repeated dark stripes of the generic
    // concrete photograph on every differently oriented wall.
    const retainingMaterial = siteMaterial('floor', 0xbcbab4);
    const narrowCastMaterial = siteMaterial('floor', 0xbcbab4, .22, 1.6);
    const riserMaterial = siteMaterial('concrete', 0x9f9a91, .3, .8);
    const addCast = (name: string, width: number, height: number, depth: number,
      x: number, y: number, z: number, material = retainingMaterial): THREE.Mesh => {
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 2, .009), material);
      mesh.name = name;
      mesh.position.set(x, y, z);
      if (material === floorMaterial || material === retainingMaterial) {
        const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
        const uScale = material === floorMaterial ? width / 2.5 : Math.max(width, depth) / 2.5;
        const vScale = material === floorMaterial ? depth / 2.5 : height / 2.5;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uScale, uv.getY(i) * vScale);
        uv.needsUpdate = true;
      }
      mesh.castShadow = mesh.receiveShadow = true;
      this.add(mesh);
      return mesh;
    };
    // This closes the otherwise uncovered ground corridor above the basement.
    // The garage and foyer already have their own structural ground slabs.
    addCast('Ground cast corridor slab over basement access', 2.5, .18, 4.5, 7.75, -.09, 2.25, floorMaterial);
    for (const depth of [1, 2]) {
      const base = -3.4 * depth;
      const label = `B${depth}`;
      const corridorFloor = addCast(`${label} circulation structural floor`, 2.5, .18, 7.6, 7.75, base - .09, 3.8, floorMaterial);
      const garageFloor = addCast(`${label} garage and services structural floor`, 9, .18, 9.5, 13.5, base - .09, 1.25, floorMaterial);
      this.addCastFloorJoints(corridorFloor, 2.5, 7.6, 7.75, 3.8);
      this.addCastFloorJoints(garageFloor, 9, 9.5, 13.5, 1.25);
      addCast(`${label} side deck at stair foot`, 2.05, .18, 1.5, 5.53, base - .09, 7.25, floorMaterial);
      const wall = (name: string, x0: number, z0: number, x1: number, z1: number): void => {
        const length = Math.hypot(x1 - x0, z1 - z0);
        const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
        const castWall = addCast(`${label} retaining ${name}`, alongX ? length : .28, 3.22, alongX ? .28 : length,
          (x0 + x1) / 2, base + 1.61, (z0 + z1) / 2);
        this.addRetainingFaceDetails(castWall, length, alongX);
        this.obstacles.push({ id: `${label} retaining ${name}`,
          minX: Math.min(x0, x1) - .15, maxX: Math.max(x0, x1) + .15,
          minZ: Math.min(z0, z1) - .15, maxZ: Math.max(z0, z1) + .15,
          minFloorY: base, maxFloorY: base + 3.22 });
      };
      // Doorless 2.4 m access between the stair corridor and garage; all
      // external edges are genuine below-grade retaining walls.
      wall('corridor west before stair passage', 6.5, 0, 6.5, 5.8);
      wall('corridor south', 6.5, 0, 9, 0);
      wall('corridor east before garage opening', 9, 0, 9, .8);
      wall('corridor east after garage opening', 9, 3.2, 9, 7.65);
      wall('corridor north west pier', 6.5, 7.65, 6.85, 7.65);
      wall('corridor north east pier', 8.15, 7.65, 9, 7.65);
      wall('garage south', 9, -3.5, 18, -3.5);
      wall('garage west', 9, -3.5, 9, 0);
      wall('garage east', 18, -3.5, 18, 6);
      wall('garage north', 9, 6, 18, 6);
      for (const x of [9, 13.5, 18]) for (const z of [-3.5, 6]) {
        const name = `${label} exposed frame column ${x} ${z}`;
        addCast(name, .36, 3.22, .36, x, base + 1.61, z, narrowCastMaterial);
        this.obstacles.push({ id: name, minX: x - .18, maxX: x + .18,
          minZ: z - .18, maxZ: z + .18, minFloorY: base, maxFloorY: base + 3.22 });
      }
      if (depth === 1) {
        this.wall('B1 unfinished workshop partition south', 15.5, -3.3, 15.5, -.8, base);
        this.wall('B1 unfinished workshop partition north', 15.5, 1.2, 15.5, 5.8, base);
        addCast('B1 workshop cast head beam south', .34, .22, 2.5, 15.5, base + 3.11, -2.05, narrowCastMaterial);
        addCast('B1 workshop cast head beam north', .34, .22, 4.6, 15.5, base + 3.11, 3.5, narrowCastMaterial);
      } else {
        this.wall('B2 electrical store partition south', 13, -3.3, 13, -.5, base);
        this.wall('B2 electrical store partition north', 13, 1.2, 13, 5.8, base);
        addCast('B2 store cast head beam south', .34, .22, 2.8, 13, base + 3.11, -1.9, narrowCastMaterial);
        addCast('B2 store cast head beam north', .34, .22, 4.6, 13, base + 3.11, 3.5, narrowCastMaterial);
        this.addBasementServiceTray(base);
      }
      const stepHeight = 3.4 / 22;
      const treadGeometry = new RoundedBoxGeometry(1, 1, 1, 2, .006);
      const treads = new THREE.InstancedMesh(treadGeometry, floorMaterial, 22);
      const risers = new THREE.InstancedMesh(treadGeometry, riserMaterial, 22);
      treads.name = `${label} to ${depth === 1 ? 'ground' : 'B1'} cast stair treads`;
      risers.name = `${label} to ${depth === 1 ? 'ground' : 'B1'} cast stair risers`;
      const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
      for (let step = 1; step <= 11; step++) {
        const firstTop = base + step * stepHeight;
        const firstZ = 8 + (step - .5) * .28;
        treads.setMatrixAt(step - 1, matrix.compose(new THREE.Vector3(5.5, firstTop - .065, firstZ), quaternion,
          new THREE.Vector3(1.38, .13, .28)));
        risers.setMatrixAt(step - 1, matrix.compose(new THREE.Vector3(5.5, firstTop - stepHeight / 2, firstZ - .14), quaternion,
          new THREE.Vector3(1.38, stepHeight, .045)));
        const secondTop = base + 1.7 + step * stepHeight;
        const secondZ = 11.08 - (step - .5) * .28;
        treads.setMatrixAt(step + 10, matrix.compose(new THREE.Vector3(7.5, secondTop - .065, secondZ), quaternion,
          new THREE.Vector3(1.38, .13, .28)));
        risers.setMatrixAt(step + 10, matrix.compose(new THREE.Vector3(7.5, secondTop - stepHeight / 2, secondZ + .14), quaternion,
          new THREE.Vector3(1.38, stepHeight, .045)));
      }
      for (const mesh of [treads, risers]) {
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        this.add(mesh);
      }
      addCast(`${label} intermediate stair landing`, 3.4, .19, 1.12, 6.5, base + 1.7 - .095, 11.64, floorMaterial);
      for (const x of [4.65, 8.35]) {
        addCast(`${label} cast stair-well safety kerb`, .15, .55, 3.15, x, base + 1.2, 9.55, narrowCastMaterial);
      }
    }
  }

  private addBasementServiceTray(base: number): void {
    const tray = new THREE.Group();
    tray.name = 'B2 suspended galvanized cable tray awaiting electrical fit-out';
    tray.position.set(11.35, base + 2.74, 1.6);
    const steel = new THREE.MeshStandardMaterial({ color: 0xa9a9a2, metalness: .48, roughness: .64,
      side: THREE.DoubleSide });
    const pieces = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), steel, 17);
    pieces.name = 'Two rails, open crossbars and four soffit suspension rods';
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
    let index = 0;
    const piece = (width: number, height: number, depth: number, x: number, y: number, z: number): void => {
      pieces.setMatrixAt(index++, matrix.compose(new THREE.Vector3(x, y, z), rotation,
        new THREE.Vector3(width, height, depth)));
    };
    for (const x of [-.56, .56]) piece(.055, .15, 4.4, x, 0, 0);
    for (let i = 0; i < 11; i++)
      piece(1.17, .026, .055, 0, -.064, -2 + i * .4);
    for (const z of [-1.7, 1.7]) for (const x of [-.48, .48])
      piece(.018, .43, .018, x, .29, z);
    pieces.castShadow = pieces.receiveShadow = true;
    pieces.computeBoundingSphere();
    tray.add(pieces);
    this.add(tray);
  }

  private addCastFloorJoints(floor: THREE.Mesh, width: number, depth: number, centreX: number, centreZ: number): void {
    const positions: number[] = [], indices: number[] = [];
    const cut = .006, y = .095;
    const quad = (x0: number, z0: number, x1: number, z1: number): void => {
      const first = positions.length / 3;
      positions.push(x0, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
      indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2);
    };
    const minX = centreX - width / 2, maxX = centreX + width / 2;
    const minZ = centreZ - depth / 2, maxZ = centreZ + depth / 2;
    for (let x = Math.ceil(minX / 2.5) * 2.5; x < maxX - .35; x += 2.5)
      if (x > minX + .35) quad(x - centreX - cut / 2, -depth / 2 + .08,
        x - centreX + cut / 2, depth / 2 - .08);
    for (let z = Math.ceil(minZ / 2.5) * 2.5; z < maxZ - .35; z += 2.5)
      if (z > minZ + .35) quad(-width / 2 + .08, z - centreZ - cut / 2,
        width / 2 - .08, z - centreZ + cut / 2);
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const joints = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: 0x77746e, transparent: true, opacity: .31, roughness: 1,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, side: THREE.DoubleSide,
    }));
    joints.name = 'Subtle unfinished slab control joints';
    joints.raycast = () => undefined;
    floor.add(joints);
  }

  private addRetainingFaceDetails(wall: THREE.Mesh, length: number, alongX: boolean): void {
    if (length < 1.3) return;
    const positions: number[] = [], colors: number[] = [];
    const joint = new THREE.Color(0x484742);
    const rim = new THREE.Color(0x696761);
    const tie = new THREE.Color(0x242521);
    const vertex = (u: number, y: number, side: number, color: THREE.Color): void => {
      const face = side * .148;
      positions.push(alongX ? u : face, y, alongX ? face : u);
      colors.push(color.r, color.g, color.b);
    };
    const triangle = (a: [number, number], b: [number, number], c: [number, number], side: number,
      ca: THREE.Color, cb = ca, cc = ca): void => {
      vertex(a[0], a[1], side, ca); vertex(b[0], b[1], side, cb); vertex(c[0], c[1], side, cc);
    };
    for (const side of [-1, 1]) {
      // Real form panels leave fine casting joints. Keep them subtle enough
      // that the slab and wall still read as one concrete construction.
      for (let u = -length / 2 + 2.4; u < length / 2 - .3; u += 2.4) {
        triangle([u - .004, -1.58], [u + .004, -1.58], [u - .004, 1.58], side, joint);
        triangle([u + .004, -1.58], [u + .004, 1.58], [u - .004, 1.58], side, joint);
      }
      for (const y of [-.7, .65]) for (let u = -length / 2 + .62; u < length / 2 - .35; u += 1.2) {
        const segments = 12, radius = .052;
        for (let i = 0; i < segments; i++) {
          const a = i / segments * Math.PI * 2, b = (i + 1) / segments * Math.PI * 2;
          triangle([u, y], [u + Math.cos(a) * radius, y + Math.sin(a) * radius],
            [u + Math.cos(b) * radius, y + Math.sin(b) * radius], side, tie, rim, rim);
        }
      }
    }
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const details = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    }));
    details.name = 'Cast panel joints and recessed form ties';
    details.raycast = () => undefined;
    wall.add(details);
    this.addRetainingJunctionContact(wall, length, alongX);
  }

  private addRetainingJunctionContact(wall: THREE.Mesh, length: number, alongX: boolean): void {
    if (!this.retainingContactMaterial) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d');
      if (!context) return;
      const pixels = context.createImageData(64, 64);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const edge = 1 - THREE.MathUtils.smoothstep(y / 63 + .025 * Math.sin(x * .39), .02, .97);
        const i = (y * 64 + x) * 4;
        pixels.data[i] = 92; pixels.data[i + 1] = 86; pixels.data[i + 2] = 78;
        pixels.data[i + 3] = Math.round(255 * edge * .19);
      }
      context.putImageData(pixels, 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      this.retainingContactMaterial = new THREE.MeshStandardMaterial({
        map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -1, roughness: 1,
      });
    }
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    const point = (u: number, y: number, side: number, offset: number): THREE.Vector3 =>
      alongX ? new THREE.Vector3(u, y, side * (.143 + offset))
        : new THREE.Vector3(side * (.143 + offset), y, u);
    const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void => {
      const start = positions.length / 3;
      positions.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...d.toArray());
      uvs.push(0, 0, length / 1.2, 0, 0, 1, length / 1.2, 1);
      indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
    };
    for (const side of [-1, 1]) {
      const left = -length / 2 + .04, right = length / 2 - .04;
      quad(point(left, -1.606, side, .006), point(right, -1.606, side, .006),
        point(left, -1.43, side, .006), point(right, -1.43, side, .006));
      quad(point(left, -1.606, side, .006), point(right, -1.606, side, .006),
        point(left, -1.606, side, .2), point(right, -1.606, side, .2));
      quad(point(left, 1.606, side, .006), point(right, 1.606, side, .006),
        point(left, 1.43, side, .006), point(right, 1.43, side, .006));
      quad(point(left, 1.606, side, .006), point(right, 1.606, side, .006),
        point(left, 1.606, side, .15), point(right, 1.606, side, .15));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const contact = new THREE.Mesh(geometry, this.retainingContactMaterial);
    contact.name = 'Dust and shadow joining cast wall to slab and soffit';
    contact.raycast = () => undefined;
    wall.add(contact);
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
    const soffit = createConcreteSoffit(2, 3.5, 6.22);
    soffit.name = 'L1 cast concrete corridor soffit';
    soffit.position.set(7.5, 0, 6.25);
    this.add(soffit);
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
    const soffit = createConcreteSoffit(6, 4.5, 6.22);
    soffit.name = 'L1 room cast concrete soffit';
    soffit.position.set(9.5, 0, 2.25);
    this.add(soffit);
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
    const soffit = createConcreteSoffit(6, 4.5, 9.52);
    soffit.name = 'L2 cast concrete room soffit';
    soffit.position.set(9.5, 0, 2.25);
    this.add(soffit);
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
    const soffit = createConcreteSoffit(width, depth, base + 2.92);
    soffit.name = `${label} cast concrete room soffit`;
    soffit.position.set((west + east) / 2, 0, (north + south) / 2);
    this.add(soffit);
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
