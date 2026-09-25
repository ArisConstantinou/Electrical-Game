import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';
import { INSTALLATION_POINTS } from '../data/installationRules';
import { BrickWall } from './BrickWall';
import { brickFacePatch, brickFaceTone } from './BrickFacePatch';
import { masonryFaceMaterial } from './BrickFaceMaterial';
import { laidClayGeometry, type LaidClayWear } from './LaidClayDamage';
import { addLighting } from './Lighting';
import { matteMaterial, siteMaterial, siteProScreedMaterial } from './SiteMaterials';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ExteriorCourtyard } from './ExteriorCourtyard';
import { MansionGroundWing } from './MansionGroundWing';
import { createWorksiteBench } from './WorksiteBench';
import { createSiteFloorDebris } from './SiteFloorDebris';
import type { PlayerObstacle } from '../player/EquipmentCollision';

/** Constant-time hit on a raised clay face; backing remains hittable in joints. */
const setBrickFaceRaycast = (
  mesh: THREE.InstancedMesh, normal: THREE.Vector3, facePoint: THREE.Vector3,
  containsBrick: (point: THREE.Vector3) => boolean,
): void => {
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, facePoint);
  const inverse = new THREE.Matrix4(), localRay = new THREE.Ray(), localHit = new THREE.Vector3();
  mesh.raycast = (raycaster, intersects) => {
    inverse.copy(mesh.matrixWorld).invert();
    localRay.copy(raycaster.ray).applyMatrix4(inverse);
    if (!localRay.intersectPlane(plane, localHit) || !containsBrick(localHit)) return;
    const point = localHit.clone().applyMatrix4(mesh.matrixWorld);
    const distance = raycaster.ray.origin.distanceTo(point);
    if (distance < raycaster.near || distance > raycaster.far) return;
    intersects.push({ distance, point, object: mesh, faceIndex: 0,
      face: { a: 0, b: 1, c: 2, normal: normal.clone(), materialIndex: 0 } });
  };
};

export class Room extends THREE.Group {
  readonly brickWall: BrickWall;
  readonly intactPracticeWall: BrickWall;
  readonly referenceWalls: THREE.Object3D[] = [];
  readonly exterior: ExteriorCourtyard;
  readonly mansionWing: MansionGroundWing | null;
  readonly worksiteBench: THREE.Group;
  private readonly benchMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly benchObstacle: PlayerObstacle = {
    id: 'temporary-electrician-bench', minX: 0, maxX: 0, minZ: 0, maxZ: 0,
    minFloorY: 0, maxFloorY: 1.2,
  };

  private sun: THREE.DirectionalLight | null = null;
  private readonly sunShadowAnchor = new THREE.Vector3(Infinity, Infinity, Infinity);
  private readonly sunViewPosition = new THREE.Vector3();

  constructor(scene: THREE.Scene, private readonly mansionPreview = false) {
    super();
    this.name = 'Living room first-fix site';
    this.userData.studioEntityId = 'world:living-room';
    this.brickWall = new BrickWall(INSTALLATION_POINTS);
    this.add(this.brickWall);

    // Preserve the former untouched masonry as a separate right-hand practice
    // surface while the main installation wall starts at the PVC phase.
    this.intactPracticeWall = new BrickWall([]);
    this.intactPracticeWall.name = 'Untouched right-hand masonry practice wall';
    this.intactPracticeWall.setStudioEntityId('world:intact-practice-wall');
    this.intactPracticeWall.rotation.y = -Math.PI / 2;
    this.intactPracticeWall.position.x = GAME_CONFIG.room.width / 2 - Math.abs(GAME_CONFIG.room.wallFrontZ) - .002;
    this.referenceWalls.push(this.intactPracticeWall);
    this.add(this.intactPracticeWall);

    const floor = new THREE.Mesh(new THREE.BoxGeometry(GAME_CONFIG.room.width, 0.12, GAME_CONFIG.room.depth), siteProScreedMaterial());
    floor.position.y = -0.06;
    floor.name = 'Rough unfinished concrete floor';
    floor.userData.studioEntityId = 'world:floor';
    floor.receiveShadow = true;
    this.add(floor);

    // The slab bears across the 22 cm side walls and the 16 cm rear wall.
    // The former room-sized slab stopped at their inner faces, making its
    // photographed underside read as a separate plane at the junction.
    const ceilingGeometry = new RoundedBoxGeometry(GAME_CONFIG.room.width + .50, 0.16, GAME_CONFIG.room.depth + .20, 2, .012);
    const ceilingPositions = ceilingGeometry.getAttribute('position');
    const ceilingNormals = ceilingGeometry.getAttribute('normal');
    const ceilingUVs = ceilingGeometry.getAttribute('uv');
    for (let i = 0; i < ceilingPositions.count; i++) {
      const x = ceilingPositions.getX(i), y = ceilingPositions.getY(i), z = ceilingPositions.getZ(i);
      const nx = Math.abs(ceilingNormals.getX(i)), ny = Math.abs(ceilingNormals.getY(i));
      if (ny > .5) ceilingUVs.setXY(i, x / 2, z / 2);
      else ceilingUVs.setXY(i, .37 + (y + GAME_CONFIG.room.height + .08) / 2, (nx > .5 ? z : x) / 2);
    }
    const ceilingMaterial = siteMaterial('concrete', 0xe6e2dc);
    const ceilingNormal = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/site-materials/concrete-normal-512.webp`);
    ceilingNormal.name = 'Board-formed concrete normal 512 CC0';
    ceilingNormal.wrapS = ceilingNormal.wrapT = THREE.RepeatWrapping;
    ceilingNormal.anisotropy = 4;
    ceilingMaterial.normalMap = ceilingNormal;
    ceilingMaterial.normalScale.set(.38, .38);
    // A small warm floor bounce reaches the underside of the slab. Keep the
    // photographed shutter marks but avoid a near-black roof over warm clay.
    ceilingMaterial.emissive.set(0x827366);
    ceilingMaterial.emissiveIntensity = .28;
    const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
    // The exposed underside is cast concrete, bearing directly on the masonry
    // wall heads. No fired-clay blocks are used overhead in this building.
    ceiling.position.set(0, GAME_CONFIG.room.height + 0.08, .10);
    ceiling.name = 'Concrete slab ceiling';
    ceiling.userData.studioEntityId = 'world:ceiling';
    ceiling.receiveShadow = true;
    this.add(ceiling);

    // Mortar backing stays solid for contact and measurement. Individually
    // raised clay courses on all side-wall segments match the primary wall.
    const sideMaterial = matteMaterial(0x746d64);
    sideMaterial.userData.referenceLaserReceiver=true;
    const sideGeometry = new THREE.BoxGeometry(0.22, GAME_CONFIG.room.height, GAME_CONFIG.room.depth);
    for (const [name, x] of [['Left concrete wall', -GAME_CONFIG.room.width / 2 - 0.11], ['Right concrete wall', GAME_CONFIG.room.width / 2 + 0.11]] as const) {
      const side = new THREE.Group();
      if (x < 0) {
        // Four solid pieces leave a true 1.9 x 1.3 m opening through the
        // 22 cm cast wall. No transparent panel or flat exterior image.
        const openingHalfZ = .95, openingZ = 2, sillY = 1.05, lintelY = 2.35;
        const wallPart = (label: string, y: number, z: number, height: number, depth: number) => {
          const piece = new THREE.Mesh(new THREE.BoxGeometry(.22, height, depth), sideMaterial);
          piece.name = label; piece.position.set(x, y, z);
          piece.castShadow = piece.receiveShadow = true; side.add(piece);
        };
        const beforeLength = GAME_CONFIG.room.depth / 2 + openingZ - openingHalfZ;
        const afterLength = GAME_CONFIG.room.depth / 2 - openingZ - openingHalfZ;
        wallPart('Solid wall before window opening', 1.5, (-GAME_CONFIG.room.depth / 2 + openingZ - openingHalfZ) / 2, 3, beforeLength);
        wallPart('Solid wall after window opening', 1.5, (openingZ + openingHalfZ + GAME_CONFIG.room.depth / 2) / 2, 3, afterLength);
        wallPart('Solid cast sill below opening', sillY / 2, openingZ, sillY, openingHalfZ * 2);
        wallPart('Solid lintel above opening', (lintelY + 3) / 2, openingZ, 3 - lintelY, openingHalfZ * 2);
        const revealMaterial = matteMaterial(0xaaa99f, .97);
        const sill = new THREE.Mesh(new RoundedBoxGeometry(.40, .085, 1.98, 2, .009), revealMaterial);
        sill.name = 'Raw concrete opening sill with exterior drip edge';
        sill.position.set(x, sillY + .012, openingZ); sill.castShadow = sill.receiveShadow = true; side.add(sill);
        const lintel = new THREE.Mesh(new RoundedBoxGeometry(.30, .13, 2.02, 2, .006), revealMaterial);
        lintel.name = 'Structural exposed concrete window lintel';
        lintel.position.set(x, lintelY + .055, openingZ); lintel.castShadow = lintel.receiveShadow = true; side.add(lintel);
      } else {
        const solid = new THREE.Mesh(sideGeometry, sideMaterial);
        solid.position.set(x, GAME_CONFIG.room.height / 2, 0);
        solid.receiveShadow = true; side.add(solid);
      }
      side.name = name;
      side.userData.studioEntityId = `world:${name.toLowerCase().replaceAll(' ', '-')}`;
      side.receiveShadow = true;
      this.addSideBrickCourses(side, x, x < 0);
      this.referenceWalls.push(side);
      this.add(side);
    }
    this.exterior = new ExteriorCourtyard();
    this.add(this.exterior);

    const columnMaterial = siteMaterial('concrete', 0xf0ede7, .1, .75);
    // The first tenth of the scan is unusually dark; sample its cleaner
    // central shutter panel at the same physical scale as the slab.
    if (columnMaterial.map) columnMaterial.map.offset.x = .2;
    columnMaterial.userData.referenceLaserReceiver=true;
    for (const x of [-2.72, 2.72]) {
      const column = new THREE.Mesh(new RoundedBoxGeometry(0.36, GAME_CONFIG.room.height, 0.38, 2, .009), columnMaterial);
      column.position.set(x, GAME_CONFIG.room.height / 2, -2.37);
      column.name = 'Structural concrete column';
      column.userData.studioEntityId = `world:column:${x}`;
      column.castShadow = true;
      column.receiveShadow = true;
      this.referenceWalls.push(column);
      this.brickWall.occluders.push(column);
      this.add(column);
    }

    this.addFormworkMarks();
    this.addConstructionJoints();
    this.addRearWall();
    this.mansionWing = this.mansionPreview ? new MansionGroundWing(
      this.exterior.getObjectByName('Olive tree outside unfinished opening') ?? null,
      this.exterior.getObjectByName('Offset adjacent residential block') ?? null,
    ) : null;
    if (this.mansionWing) this.add(this.mansionWing);
    // The slab bears over the wall heads and columns. Exposed brick meets its
    // soffit directly, with no decorative inner downstand or shadow band.
    this.addWallHeadContact();
    this.addFloorReturns();
    this.addContactPatina();
    this.addSiteSupplies();
    this.worksiteBench = createWorksiteBench();
    this.add(this.worksiteBench);

    // Small site offcuts accumulate at actual work locations. Keep the old
    // Studio asset name/ID so saved scene transforms still find the rubble.
    this.add(createSiteFloorDebris());
    this.mansionWing?.registerOriginalRoomSurfaces(floor, ceiling);
    this.mansionWing?.registerOriginalRoomAssets(this, this.exterior, [this.brickWall, ...this.referenceWalls]);
    this.sun = addLighting(scene);
    if (this.mansionPreview) {
      // The mansion spans several bays beyond the original workroom's 10 m map.
      // Follow the active view rather than spending resolution on the entire site.
      const shadowCamera = this.sun.shadow.camera;
      shadowCamera.left = shadowCamera.bottom = -8;
      shadowCamera.right = shadowCamera.top = 8;
      shadowCamera.far = 28;
      shadowCamera.updateProjectionMatrix();
      // The site and sun are stationary while the player only turns the view.
      // Reuse the exact shadow texture until the light's anchor or construction
      // changes; rebuilding its 600+ static casters on every look frame costs
      // more than the colour pass on desktop.
      this.sun.shadow.autoUpdate = false;
      this.sun.shadow.needsUpdate = true;
    }
  }

  invalidateSunShadow(): void { if (this.mansionPreview && this.sun) this.sun.shadow.needsUpdate = true; }

  update(dt: number, view?: THREE.Camera): void {
    this.exterior.update(dt);
    this.mansionWing?.update(dt);
    if (!this.mansionPreview || !view || !this.sun) return;
    const position = view.getWorldPosition(this.sunViewPosition);
    // One-metre steps move the shadow map only when the view changes site bay.
    // The light-target offset is retained, including any direction edited in Studio.
    const anchorX = Math.round(position.x), anchorY = Math.round(position.y * 2) / 2 - .55, anchorZ = Math.round(position.z);
    if (this.sunShadowAnchor.x === anchorX && this.sunShadowAnchor.y === anchorY && this.sunShadowAnchor.z === anchorZ) return;
    const offset = this.sun.position.clone().sub(this.sun.target.position);
    this.sun.target.position.set(anchorX, anchorY, anchorZ);
    this.sun.position.copy(this.sun.target.position).add(offset);
    this.sun.target.updateMatrixWorld(true);
    this.sun.updateMatrixWorld(true);
    this.sun.shadow.needsUpdate = true;
    this.sunShadowAnchor.set(anchorX, anchorY, anchorZ);
  }

  /** Follow Level Editor moves without recomputing every mesh bound per frame. */
  worksiteBenchObstacles(): PlayerObstacle[] {
    this.worksiteBench.updateWorldMatrix(true, true);
    if (!this.benchMatrix.equals(this.worksiteBench.matrixWorld)) {
      this.benchMatrix.copy(this.worksiteBench.matrixWorld);
      const bounds = new THREE.Box3().setFromObject(this.worksiteBench, true);
      this.benchObstacle.minX = bounds.min.x;
      this.benchObstacle.maxX = bounds.max.x;
      this.benchObstacle.minZ = bounds.min.z;
      this.benchObstacle.maxZ = bounds.max.z;
      this.benchObstacle.minFloorY = bounds.min.y;
      this.benchObstacle.maxFloorY = bounds.max.y;
    }
    return this.worksiteBench.visible ? [this.benchObstacle] : [];
  }

  private addSideBrickCourses(side: THREE.Group, wallX: number, hasOpening: boolean): void {
    const pitch = GAME_CONFIG.room.depth / 20, course = GAME_CONFIG.room.height / 23, gap = .006;
    const zMin = -GAME_CONFIG.room.depth / 2, zMax = GAME_CONFIG.room.depth / 2;
    const pieces: Array<{ y: number; z: number; height: number; length: number }> = [];
    const add = (y0: number, y1: number, z0: number, z1: number): void => {
      if (y1 - y0 > .016 && z1 - z0 > .016)
        pieces.push({ y: (y0 + y1) / 2, z: (z0 + z1) / 2, height: y1 - y0, length: z1 - z0 });
    };
    for (let row = 0; row < 23; row++) for (let column = -1; column <= 20; column++) {
      const offset = (row % 2) * pitch / 2;
      const y0 = row * course + gap / 2, y1 = (row + 1) * course - gap / 2;
      const z0 = Math.max(zMin, zMin + column * pitch + offset + gap / 2);
      const z1 = Math.min(zMax, zMin + (column + 1) * pitch + offset - gap / 2);
      if (z1 <= z0) continue;
      if (!hasOpening || y1 <= 1.05 || y0 >= 2.35 || z1 <= 1.05 || z0 >= 2.95) { add(y0, y1, z0, z1); continue; }
      add(y0, Math.min(y1, 1.05), z0, z1);
      add(Math.max(y0, 2.35), y1, z0, z1);
      const middleBottom = Math.max(y0, 1.05), middleTop = Math.min(y1, 2.35);
      add(middleBottom, middleTop, z0, Math.min(z1, 1.05));
      add(middleBottom, middleTop, Math.max(z0, 2.95), z1);
    }
    // One shared eased clay shape gives each physical unit a narrow broken
    // silhouette at the mortar joint without adding a draw call per brick.
    const geometry = new RoundedBoxGeometry(1, 1, 1, 1, .035);
    const patchRects = new Float32Array(pieces.length * 4);
    geometry.setAttribute('brickPatch', new THREE.InstancedBufferAttribute(patchRects, 4));
    const bricks = new THREE.InstancedMesh(geometry, masonryFaceMaterial, pieces.length);
    bricks.name = hasOpening ? 'Left fired-clay courses cut around unglazed opening' : 'Right fired-clay courses';
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3(), tint = new THREE.Color();
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    const wearTypes: LaidClayWear[] = ['small-chip-a', 'small-chip-b', 'broken-corner'];
    const chips = wearTypes.map(() => ({ matrices: [] as THREE.Matrix4[], colors: [] as THREE.Color[], patches: [] as number[] }));
    for (const [index, piece] of pieces.entries()) {
      const row = Math.floor(piece.y / course), offset = (row % 2) * pitch / 2;
      const column = Math.floor((piece.z - zMin - offset) / pitch);
      const base = brickFacePatch(row, column, wallX < 0 ? 1 : 2);
      const startZ = zMin + column * pitch + offset + gap / 2;
      const startY = row * course + gap / 2;
      const u = (piece.z - piece.length / 2 - startZ) / (pitch - gap);
      const v = (piece.y - piece.height / 2 - startY) / (course - gap);
      const patch = [base[0] + base[2] * u, base[1] + base[3] * v,
        base[2] * piece.length / (pitch - gap), base[3] * piece.height / (course - gap)];
      patchRects.set(patch, index * 4);
      const hash = (Math.imul(row + 1, 2246822519) ^ Math.imul(column + 1, 3266489917) ^ Math.imul(index + 1, 668265263) ^ (wallX < 0 ? 0x3f51c7 : 0x51a3d9)) >>> 0;
      const relief = ((hash >>> 8) % 101 / 100 - .5) * .005;
      position.set(wallX + (wallX < 0 ? .120 : -.120) + relief, piece.y, piece.z);
      scale.set(.020, piece.height, piece.length);
      matrix.compose(position, rotation, scale);
      const tone = brickFaceTone(row, column, wallX < 0 ? 1 : 2);
      tint.setRGB(tone[0], tone[1], tone[2]);
      const wear = hash % 100;
      const variant = piece.length >= pitch * .35 && piece.height >= course * .55
        ? wear < 4 ? 2 : wear < 14 ? 1 : wear < 24 ? 0 : -1 : -1;
      if (variant < 0) bricks.setMatrixAt(index, matrix);
      else {
        // The original mesh remains the single physical pick surface. Only
        // its render instance is hidden; a chipped shell takes its place.
        bricks.setMatrixAt(index, hidden);
        chips[variant].matrices.push(matrix.clone());
        chips[variant].colors.push(tint.clone());
        chips[variant].patches.push(...patch);
      }
      bricks.setColorAt(index, tint);
    }
    bricks.castShadow = bricks.receiveShadow = true;
    const inward = wallX < 0 ? 1 : -1;
    setBrickFaceRaycast(bricks, new THREE.Vector3(inward, 0, 0), new THREE.Vector3(wallX + inward * .13, 0, 0), point => {
      if (point.y <= 0 || point.y >= GAME_CONFIG.room.height || point.z <= zMin || point.z >= zMax) return false;
      if (hasOpening && point.y > 1.05 && point.y < 2.35 && point.z > 1.05 && point.z < 2.95) return false;
      const row = Math.floor(point.y / course), rowY = point.y - row * course;
      const shiftedZ = point.z - zMin - (row % 2) * pitch / 2;
      const brickZ = ((shiftedZ % pitch) + pitch) % pitch;
      return rowY > gap / 2 && rowY < course - gap / 2 && brickZ > gap / 2 && brickZ < pitch - gap / 2;
    });
    bricks.computeBoundingSphere(); side.add(bricks);
    for (const [variant, batch] of chips.entries()) {
      if (!batch.matrices.length) continue;
      const chippedGeometry = laidClayGeometry(wearTypes[variant], false);
      chippedGeometry.setAttribute('brickPatch', new THREE.InstancedBufferAttribute(new Float32Array(batch.patches), 4));
      const chipped = new THREE.InstancedMesh(chippedGeometry, masonryFaceMaterial, batch.matrices.length);
      chipped.name = `${wallX < 0 ? 'Left' : 'Right'} physically chipped clay units ${variant + 1}`;
      chipped.castShadow = chipped.receiveShadow = true;
      chipped.raycast = () => undefined;
      for (let i = 0; i < batch.matrices.length; i++) {
        chipped.setMatrixAt(i, batch.matrices[i]);
        chipped.setColorAt(i, batch.colors[i]);
      }
      chipped.computeBoundingSphere();
      side.add(chipped);
    }
  }

  private addRearWall(): void {
    // The fourth perimeter wall uses the same clay photograph and course
    // dimensions as the primary wall. A solid mortar backing retains contact.
    const rearZ = GAME_CONFIG.room.depth / 2;
    const rearGroup = new THREE.Group();
    rearGroup.name = 'Rear masonry work surface';
    rearGroup.userData.studioEntityId = 'world:rear-wall';
    const brickWidth = GAME_CONFIG.room.width / 21, course = GAME_CONFIG.room.height / 23, gap = .006;
    const columns = 22, rows = 23;
    const openingHalfWidth = 1.35, openingHeight = 18 * course;
    const backingMaterial = matteMaterial(0x746d64);
    const backing = (name: string, x: number, y: number, width: number, height: number): void => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, .16), backingMaterial);
      wall.name = name;
      wall.userData.referenceLaserReceiver = true;
      wall.position.set(x, y, rearZ + .08);
      wall.receiveShadow = true;
      rearGroup.add(wall);
    };
    if (this.mansionPreview) {
      const flank = GAME_CONFIG.room.width / 2 - openingHalfWidth;
      backing('Left rear masonry backing', -(openingHalfWidth + flank / 2), GAME_CONFIG.room.height / 2, flank, GAME_CONFIG.room.height);
      backing('Right rear masonry backing', openingHalfWidth + flank / 2, GAME_CONFIG.room.height / 2, flank, GAME_CONFIG.room.height);
      backing('Supported rear lintel backing', 0, (GAME_CONFIG.room.height + openingHeight) / 2,
        openingHalfWidth * 2, GAME_CONFIG.room.height - openingHeight);
      const frameMaterial = siteMaterial('floor', 0xdad4ca, .15, .72);
      for (const x of [-openingHalfWidth - .13, openingHalfWidth + .13]) {
        const jamb = new THREE.Mesh(new RoundedBoxGeometry(.26, GAME_CONFIG.room.height, .26, 2, .012), frameMaterial);
        jamb.name = 'Exposed concrete passage jamb';
        jamb.position.set(x, GAME_CONFIG.room.height / 2, rearZ + .035);
        jamb.castShadow = jamb.receiveShadow = true;
        rearGroup.add(jamb);
      }
      const lintel = new THREE.Mesh(new RoundedBoxGeometry(openingHalfWidth * 2 + .52, .29, .30, 2, .012), frameMaterial);
      lintel.name = 'Cast concrete passage lintel';
      lintel.position.set(0, openingHeight + .145, rearZ + .035);
      lintel.castShadow = lintel.receiveShadow = true;
      rearGroup.add(lintel);
    } else backing('Solid rear masonry backing', 0, GAME_CONFIG.room.height / 2, GAME_CONFIG.room.width, GAME_CONFIG.room.height);
    const geometry = new RoundedBoxGeometry(1, 1, 1, 1, .035);
    const instancesPerUnit = this.mansionPreview ? 2 : 1;
    const patchRects = new Float32Array(columns * rows * instancesPerUnit * 4);
    geometry.setAttribute('brickPatch', new THREE.InstancedBufferAttribute(patchRects, 4));
    const bricks = new THREE.InstancedMesh(geometry, masonryFaceMaterial, columns * rows * instancesPerUnit);
    bricks.name = this.mansionPreview ? 'Staggered rear clay courses around structural opening' : 'Full staggered rear clay courses';
    bricks.userData.textureSource = 'human-laid-brick-face-atlas-v3.png';
    bricks.userData.studioEntityId = 'world:rear-exposed-masonry';
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(), tint = new THREE.Color();
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const index = (row * columns + column) * instancesPerUnit;
      const left = -GAME_CONFIG.room.width / 2 + column * brickWidth + (row % 2) * brickWidth / 2;
      const right = Math.min(GAME_CONFIG.room.width / 2, left + brickWidth - gap);
      const clippedLeft = Math.max(-GAME_CONFIG.room.width / 2, left + gap / 2);
      const base = brickFacePatch(row, column, 3);
      const fullLeft = left + gap / 2;
      const segments = this.mansionPreview && row < 18
        ? [[clippedLeft, Math.min(right, -openingHalfWidth)], [Math.max(clippedLeft, openingHalfWidth), right]]
        : [[clippedLeft, right]];
      for (let part = 0; part < instancesPerUnit; part++) {
        const [start, end] = segments[part] ?? [0, 0];
        const width = Math.max(0, end - start);
        patchRects.set(width > 0 ? [base[0] + base[2] * (start - fullLeft) / (brickWidth - gap), base[1],
          base[2] * width / (brickWidth - gap), base[3]] : [base[0], base[1], 0, base[3]], (index + part) * 4);
        position.set((start + end) / 2, (row + .5) * course, rearZ - .010);
        scale.set(width, width > 0 ? course - gap : 0, width > 0 ? .020 : 0);
        matrix.compose(position, rotation, scale);
        bricks.setMatrixAt(index + part, matrix);
        const warmth = ((row * 19 + column * 31 + part * 7) % 13) / 12;
        bricks.setColorAt(index + part, tint.setRGB(.90 + warmth * .16, .88 + warmth * .15, .85 + warmth * .14));
      }
    }
    bricks.castShadow = bricks.receiveShadow = true;
    bricks.computeBoundingSphere();
    setBrickFaceRaycast(bricks, new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, rearZ - .020), point => {
      if (point.y <= 0 || point.y >= GAME_CONFIG.room.height || point.x <= -GAME_CONFIG.room.width / 2 || point.x >= GAME_CONFIG.room.width / 2) return false;
      if (this.mansionPreview && point.y < openingHeight && Math.abs(point.x) < openingHalfWidth) return false;
      const row = Math.floor(point.y / course), rowY = point.y - row * course;
      const shiftedX = point.x + GAME_CONFIG.room.width / 2 - (row % 2) * brickWidth / 2;
      const column = Math.floor(shiftedX / brickWidth);
      const brickX = ((shiftedX % brickWidth) + brickWidth) % brickWidth;
      return column >= 0 && column < columns && rowY > gap / 2 && rowY < course - gap / 2 && brickX > gap / 2 && brickX < brickWidth - gap / 2;
    });
    rearGroup.add(bricks);
    this.referenceWalls.push(rearGroup);
    this.add(rearGroup);

    const cornerMaterial = siteMaterial('concrete', 0xf0ede7, .075, .75);
    const corners = new THREE.InstancedMesh(new THREE.BoxGeometry(.28, GAME_CONFIG.room.height, .30), cornerMaterial, 2);
    corners.name = 'Poured rear corner pilasters';
    for (const [index, x] of [-GAME_CONFIG.room.width / 2 + .14, GAME_CONFIG.room.width / 2 - .14].entries()) {
      corners.setMatrixAt(index, matrix.makeTranslation(x, GAME_CONFIG.room.height / 2, rearZ - .015));
    }
    corners.castShadow = corners.receiveShadow = true;
    corners.raycast = () => undefined;
    corners.computeBoundingSphere();
    this.add(corners);
  }

  private addConstructionJoints(): void {
    const width = GAME_CONFIG.room.width, depth = GAME_CONFIG.room.depth;
    const sections: Array<{position: THREE.Vector3; size: THREE.Vector3}> = [];
    // The unfinished screed is poured as one field. The previous four full
    // length, equally spaced cuts read like manufactured floor tiles.
    for (const x of [-width / 2 + .015, width / 2 - .015]) sections.push({position: new THREE.Vector3(x, .002, 0), size: new THREE.Vector3(.022, .004, depth)});
    for (const z of [-depth / 2 + .015, depth / 2 - .015]) sections.push({position: new THREE.Vector3(0, .002, z), size: new THREE.Vector3(width, .004, .022)});
    const cuts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), matteMaterial(0x756d60), sections.length);
    const transform = new THREE.Matrix4();
    for (const [index, section] of sections.entries()) cuts.setMatrixAt(index, transform.compose(section.position, new THREE.Quaternion(), section.size));
    cuts.name = 'Screed wall perimeter gap';
    cuts.raycast = () => undefined;
    cuts.computeBoundingSphere();
    this.add(cuts);
  }

  private addWallHeadContact(): void {
    // A packed head joint leaves cement dust on BOTH the top clay course and
    // the poured soffit. One-sided staining made the materials meet at a
    // perfectly straight, visually disconnected line.
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) return;
    const pixels = context.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const rise = 1 - y / (canvas.height - 1);
      const speckle = Math.sin(x * 13.73 + y * 8.31) * Math.sin(x * 3.61 - y * 18.17);
      const edge = Math.sin(x * .14) * .10 + Math.sin(x * .49) * .05;
      const coverage = THREE.MathUtils.smoothstep(rise + edge, .16, .91);
      const alpha = coverage * (.32 + Math.max(0, speckle) * .12);
      const index = (y * canvas.width + x) * 4;
      pixels.data[index] = 146;
      pixels.data[index + 1] = 137;
      pixels.data[index + 2] = 124;
      pixels.data[index + 3] = Math.round(alpha * 255);
    }
    context.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    const material = new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, roughness: 1 });
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
      const start = positions.length / 3, length = a.distanceTo(b);
      positions.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...d.toArray());
      uvs.push(0, 0, length / 1.4, 0, 0, 1, length / 1.4, 1);
      indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
    };
    const headY = GAME_CONFIG.room.height, wallFootY = headY - .14;
    const head = (a: THREE.Vector3, b: THREE.Vector3) => {
      quad(a.clone().setY(wallFootY), b.clone().setY(wallFootY), a.clone().setY(headY), b.clone().setY(headY));
    };
    head(new THREE.Vector3(-3, 0, GAME_CONFIG.room.wallFrontZ + .005), new THREE.Vector3(3, 0, GAME_CONFIG.room.wallFrontZ + .005));
    head(new THREE.Vector3(-3.77, 0, 3.575), new THREE.Vector3(3.77, 0, 3.575));
    head(new THREE.Vector3(-3.772, 0, -3.57), new THREE.Vector3(-3.772, 0, 3.57));
    head(new THREE.Vector3(3.772, 0, -3.57), new THREE.Vector3(3.772, 0, 3.57));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const contact = new THREE.Mesh(geometry, material);
    contact.name = 'Fine wall head mortar dust against slab soffit';
    contact.userData.studioEntityId = 'world:wall-head-contact';
    contact.raycast = () => undefined;
    this.add(contact);

    // The same site dust feathers a short distance across the underside of
    // the slab. Its broken edge is alpha-masked, not a raised decorative trim.
    const soffitCanvas = document.createElement('canvas');
    soffitCanvas.width = 256; soffitCanvas.height = 64;
    const soffitContext = soffitCanvas.getContext('2d');
    if (soffitContext) {
      const soffitPixels = soffitContext.createImageData(256, 64);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 256; x++) {
        const fromWall = y / 63;
        const ragged = Math.sin(x * .16) * .12 + Math.sin(x * .47 + 1.3) * .07;
        const grain = Math.sin(x * 17.7 + y * 11.3) * Math.sin(x * 3.1 - y * 19.1);
        const alpha = (1 - THREE.MathUtils.smoothstep(fromWall + ragged, .12, .88)) * (.22 + Math.max(0, grain) * .09);
        const index = (y * 256 + x) * 4;
        soffitPixels.data[index] = 132;
        soffitPixels.data[index + 1] = 125;
        soffitPixels.data[index + 2] = 115;
        soffitPixels.data[index + 3] = Math.round(alpha * 255);
      }
      soffitContext.putImageData(soffitPixels, 0, 0);
      const soffitTexture = new THREE.CanvasTexture(soffitCanvas);
      soffitTexture.colorSpace = THREE.SRGBColorSpace;
      soffitTexture.wrapS = THREE.RepeatWrapping;
      const soffitMaterial = new THREE.MeshStandardMaterial({ map: soffitTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, roughness: 1 });
      const slabPositions: number[] = [], slabUvs: number[] = [], slabIndices: number[] = [];
      const slabEdge = (a: THREE.Vector3, b: THREE.Vector3, inward: THREE.Vector3) => {
        const start = slabPositions.length / 3, width = .105, length = a.distanceTo(b);
        const nearA = a.clone().setY(headY - .002), nearB = b.clone().setY(headY - .002);
        const farA = nearA.clone().addScaledVector(inward, width), farB = nearB.clone().addScaledVector(inward, width);
        slabPositions.push(...nearA.toArray(), ...nearB.toArray(), ...farA.toArray(), ...farB.toArray());
        slabUvs.push(0, 0, length / 1.4, 0, 0, 1, length / 1.4, 1);
        slabIndices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
      };
      slabEdge(new THREE.Vector3(-3, 0, GAME_CONFIG.room.wallFrontZ + .005), new THREE.Vector3(3, 0, GAME_CONFIG.room.wallFrontZ + .005), new THREE.Vector3(0, 0, 1));
      slabEdge(new THREE.Vector3(-3.77, 0, 3.575), new THREE.Vector3(3.77, 0, 3.575), new THREE.Vector3(0, 0, -1));
      slabEdge(new THREE.Vector3(-3.772, 0, -3.57), new THREE.Vector3(-3.772, 0, 3.57), new THREE.Vector3(1, 0, 0));
      slabEdge(new THREE.Vector3(3.772, 0, -3.57), new THREE.Vector3(3.772, 0, 3.57), new THREE.Vector3(-1, 0, 0));
      const slabGeometry = new THREE.BufferGeometry();
      slabGeometry.setAttribute('position', new THREE.Float32BufferAttribute(slabPositions, 3));
      slabGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(slabUvs, 2));
      slabGeometry.setIndex(slabIndices); slabGeometry.computeVertexNormals();
      const soffitDust = new THREE.Mesh(slabGeometry, soffitMaterial);
      soffitDust.name = 'Feathered cement dust across slab soffit';
      soffitDust.userData.studioEntityId = 'world:slab-head-contact';
      soffitDust.raycast = () => undefined;
      this.add(soffitDust);
    }

    const bedPositions: number[] = [], bedUvs: number[] = [], bedIndices: number[] = [];
    const beds = [
      [new THREE.Vector3(-3, 0, GAME_CONFIG.room.wallFrontZ + .007), new THREE.Vector3(3, 0, GAME_CONFIG.room.wallFrontZ + .007)],
      [new THREE.Vector3(-3.77, 0, 3.573), new THREE.Vector3(3.77, 0, 3.573)],
      [new THREE.Vector3(-3.77, 0, -3.57), new THREE.Vector3(-3.77, 0, 3.57)],
      [new THREE.Vector3(3.77, 0, -3.57), new THREE.Vector3(3.77, 0, 3.57)],
    ];
    for (const [edge, [from, to]] of beds.entries()) {
      const length = from.distanceTo(to), steps = Math.ceil(length / .12);
      const start = bedPositions.length / 3;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, point = from.clone().lerp(to, t);
        const uneven = .006 * Math.sin(i * 2.37 + edge * 1.7) + .003 * Math.sin(i * 5.19 - edge);
        bedPositions.push(point.x, headY - .016 + uneven, point.z, point.x, headY + .001, point.z);
        bedUvs.push(t * length, 0, t * length, 1);
        if (i < steps) {
          const a = start + i * 2;
          bedIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
    const bedGeometry = new THREE.BufferGeometry();
    bedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bedPositions, 3));
    bedGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(bedUvs, 2));
    bedGeometry.setIndex(bedIndices); bedGeometry.computeVertexNormals();
    const bed = new THREE.Mesh(bedGeometry, matteMaterial(0x9a9285));
    bed.name = 'Irregular packed mortar at brick wall heads';
    bed.raycast = () => undefined;
    this.add(bed);
  }

  private addFloorReturns(): void {
    // The screed is pressed into the rough wall base. A low, uneven cove
    // connects the horizontal pour to the vertical substrate instead of
    // leaving two photo-textured planes intersecting at a razor-sharp edge.
    const material = siteMaterial('concrete', 0xb0aca5, 2.1, .25);
    material.side = THREE.DoubleSide;
    const strips: Array<{from: THREE.Vector3; to: THREE.Vector3; inward: THREE.Vector3; column?: boolean}> = [
      ...(this.mansionPreview ? [
        {from:new THREE.Vector3(-3.78,0,3.485),to:new THREE.Vector3(-1.35,0,3.485),inward:new THREE.Vector3(0,0,-1)},
        {from:new THREE.Vector3(1.35,0,3.485),to:new THREE.Vector3(3.78,0,3.485),inward:new THREE.Vector3(0,0,-1)},
      ] : [{from:new THREE.Vector3(-3.78,0,3.485),to:new THREE.Vector3(3.78,0,3.485),inward:new THREE.Vector3(0,0,-1)}]),
      {from:new THREE.Vector3(-3.79,0,-3.58),to:new THREE.Vector3(3.79,0,-3.58),inward:new THREE.Vector3(0,0,1)},
      {from:new THREE.Vector3(-3.785,0,-3.58),to:new THREE.Vector3(-3.785,0,3.48),inward:new THREE.Vector3(1,0,0)},
      {from:new THREE.Vector3(3.785,0,-3.58),to:new THREE.Vector3(3.785,0,3.48),inward:new THREE.Vector3(-1,0,0)},
    ];
    for(const x of [-2.72,2.72]){
      strips.push({from:new THREE.Vector3(x-.18,0,-2.18),to:new THREE.Vector3(x+.18,0,-2.18),inward:new THREE.Vector3(0,0,1),column:true});
      strips.push({from:new THREE.Vector3(x-.18,0,-2.56),to:new THREE.Vector3(x-.18,0,-2.18),inward:new THREE.Vector3(-1,0,0),column:true});
      strips.push({from:new THREE.Vector3(x+.18,0,-2.56),to:new THREE.Vector3(x+.18,0,-2.18),inward:new THREE.Vector3(1,0,0),column:true});
      strips.push({from:new THREE.Vector3(x-.18,0,-2.56),to:new THREE.Vector3(x+.18,0,-2.56),inward:new THREE.Vector3(0,0,-1),column:true});
    }
    const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
    let vertex=0;
    for(const [edge,strip] of strips.entries()){
      const length=strip.from.distanceTo(strip.to),steps=Math.max(3,Math.ceil(length/.24));
      for(let i=0;i<=steps;i++){
        const t=i/steps,point=strip.from.clone().lerp(strip.to,t);
        const variation=Math.sin(i*2.73+edge*4.1)*.012+Math.sin(i*6.71+edge)*.005;
        const width=strip.column?Math.max(.017,.025+variation*.45):Math.max(.035,.085+variation);
        const height=strip.column?Math.max(.012,.019+variation*.25):Math.max(.025,.054+variation*.35);
        const foot=point.clone().addScaledVector(strip.inward,width);
        positions.push(foot.x,.002,foot.z, point.x,height,point.z);
        uvs.push(t*length/2.1,0,t*length/2.1,.25);
        if(i<steps){const a=vertex+i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
      }
      vertex+=(steps+1)*2;
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    geometry.setIndex(indices);geometry.computeVertexNormals();
    const returns=new THREE.Mesh(geometry,material);
    returns.name='Uneven screed returns against rough wall bases';
    returns.userData.studioEntityId='world:screed-returns';
    returns.castShadow=returns.receiveShadow=true;
    returns.raycast=()=>undefined;
    this.add(returns);
  }

  private addContactPatina(): void {
    // Real site dust rides up the porous wall base and feathers out. A single
    // small alpha texture covers the structural returns and unfinished plaster
    // with an irregular, fading contact stain; it does not change work hits.
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
    const context=canvas.getContext('2d');if(!context)return;
    const data=context.createImageData(128,128);
    for(let y=0;y<128;y++)for(let x=0;x<128;x++){
      const fade=Math.pow(y/127,2.2);
      const waviness=.75+.13*Math.sin(x*.29+y*.13)+.12*Math.sin(x*.77-y*.17);
      const grain=(Math.sin(x*42.17+y*13.89)*43758.5453)%1;
      const index=(y*128+x)*4;
      data.data[index]=110;data.data[index+1]=103;data.data[index+2]=91;
      data.data[index+3]=Math.round(THREE.MathUtils.clamp(fade*waviness*(.48+Math.abs(grain)*.16),0,.65)*255);
    }
    context.putImageData(data,0,0);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    texture.wrapS=THREE.RepeatWrapping;texture.repeat.x=5;
    const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1});
    const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
    const span=(a:THREE.Vector3,b:THREE.Vector3)=>{
      const start=positions.length/3,h=.31;
      positions.push(a.x,.005,a.z,b.x,.005,b.z,a.x,h,a.z,b.x,h,b.z);
      uvs.push(0,0,1,0,0,1,1,1);
      indices.push(start,start+1,start+2,start+1,start+3,start+2);
    };
    span(new THREE.Vector3(-3.797,0,-3.55),new THREE.Vector3(-3.797,0,3.47));
    span(new THREE.Vector3(3.797,0,-3.55),new THREE.Vector3(3.797,0,3.47));
    span(new THREE.Vector3(-3.6,0,3.48),new THREE.Vector3(3.6,0,3.48));
    for(const x of [-2.72,2.72])span(new THREE.Vector3(x-.18,0,-2.174),new THREE.Vector3(x+.18,0,-2.174));
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
    const patina=new THREE.Mesh(geometry,material);patina.name='Feathered construction dust at wall contacts';
    patina.userData.studioEntityId='world:contact-patina';
    // Keep gameplay rays clear; LevelEditor temporarily restores mesh raycasting
    // so this visible finish can be selected at its actual triangles.
    patina.raycast=()=>undefined;
    this.add(patina);
  }

  private addFormworkMarks(): void {
    const marks = new THREE.Group();
    marks.name = 'Shallow concrete formwork imprints';
    marks.userData.studioEntityId = 'world:concrete-formwork-imprints';
    const segments: Array<{ position: THREE.Vector3; size: THREE.Vector3 }> = [];
    // Fine board junctions remain surface marks on the existing solid slab.
    for (let x = -2.4; x < 3; x += 1.2) segments.push({ position: new THREE.Vector3(x, GAME_CONFIG.room.height - .001, 0), size: new THREE.Vector3(.003, .001, 5) });
    for (let z = -1.9; z < 2.5; z += 1.2) segments.push({ position: new THREE.Vector3(0, GAME_CONFIG.room.height - .001, z), size: new THREE.Vector3(6, .001, .003) });
    for (const x of [-2.72, 2.72]) for (const y of [.73, 1.47, 2.21]) segments.push({ position: new THREE.Vector3(x, y, -2.179), size: new THREE.Vector3(.36, .0025, .001) });
    // Shutter marks belong to the slab and concrete columns, not the new
    // exposed fired-clay side walls.
    const seams = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), matteMaterial(0x55554d), segments.length);
    seams.name = 'Board joints in poured concrete';
    const transform = new THREE.Matrix4();
    for (const [index, segment] of segments.entries()) seams.setMatrixAt(index, transform.compose(segment.position, new THREE.Quaternion(), segment.size));
    seams.receiveShadow = true;
    seams.computeBoundingSphere();
    marks.add(seams);
    this.add(marks);
  }

  private addSiteSupplies(): void {
    // Stowed along the rear perimeter, well away from the installation wall and
    // its working lanes. These visual props do not alter movement or collisions.
    const supplies = new THREE.Group();
    supplies.name = 'First-fix supplies at the site perimeter';
    supplies.userData.studioEntityId = 'world:site-supplies';

    const bucket = new THREE.Group();
    bucket.name = 'Open mortar bucket';
    bucket.userData.studioEntityId = 'world:site-mortar-bucket';
    bucket.position.set(2.79, .005, 2.26);
    const bucketPlastic = matteMaterial(0x68736e, .86);
    bucketPlastic.side = THREE.DoubleSide;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.151, .125, .255, 20, 1, true), bucketPlastic);
    body.position.y = .13;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.125, .125, .012, 20), bucketPlastic);
    base.position.y = .006;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(.151, .007, 5, 20), bucketPlastic);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = .2575;
    const mortar = new THREE.Mesh(new THREE.CylinderGeometry(.137, .135, .018, 20), siteMaterial('plaster', 0x7c7b70));
    mortar.position.y = .155;
    const handlePath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-.15,.20,0),new THREE.Vector3(-.13,.36,.015),new THREE.Vector3(0,.405,.022),new THREE.Vector3(.13,.36,.015),new THREE.Vector3(.15,.20,0),
    ]);
    const handle = new THREE.Mesh(new THREE.TubeGeometry(handlePath, 18, .0035, 5, false), new THREE.MeshStandardMaterial({color:0x8f948d,roughness:.55,metalness:.55}));
    bucket.add(body, base, rim, mortar, handle);
    supplies.add(bucket);

    const coilPoints: THREE.Vector3[] = [];
    for (let index = 0; index <= 100; index++) {
      const t = index / 100, angle = t * Math.PI * 5.5, radius = .095 + t * .105;
      coilPoints.push(new THREE.Vector3(2.66 + Math.cos(angle) * radius, .013 + Math.sin(t * Math.PI) * .003, 1.74 + Math.sin(angle) * radius));
    }
    const last = coilPoints[coilPoints.length - 1];
    coilPoints.push(last.clone().add(new THREE.Vector3(-.05,0,-.07)), last.clone().add(new THREE.Vector3(-.08,0,-.18)));
    const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coilPoints), 110, .009, 6, false), matteMaterial(0x506660, .86));
    hose.name = 'Coiled water hose';
    hose.userData.studioEntityId = 'world:site-water-hose';
    supplies.add(hose);

    const pipeMaterial = matteMaterial(0xc7c9bf, .68);
    pipeMaterial.side = THREE.DoubleSide;
    const pipeBody = new THREE.CylinderGeometry(.012, .012, 1, 12, 1, true);
    const pipeEnd = new THREE.RingGeometry(.0095, .012, 12);
    const pipes = new THREE.Group();
    pipes.name = 'Spare rigid PVC lengths';
    pipes.userData.studioEntityId = 'world:site-spare-pvc';
    for (let index = 0; index < 3; index++) {
      const length = 1.12 + index * .13;
      const tube = new THREE.Mesh(pipeBody, pipeMaterial);
      tube.rotation.x = Math.PI / 2;
      tube.scale.y = length;
      tube.position.set(-2.88 + index * .032, .013, 1.32 + index * .06);
      pipes.add(tube);
      for (const side of [-1,1]) {
        const end = new THREE.Mesh(pipeEnd, pipeMaterial);
        end.position.copy(tube.position); end.position.z += side * length / 2;
        pipes.add(end);
      }
    }
    supplies.add(pipes);
    supplies.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = object.receiveShadow = true;
        object.raycast = () => undefined;
      }
    });
    this.add(supplies);
  }
}
