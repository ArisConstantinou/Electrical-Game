import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';
import { INSTALLATION_POINTS } from '../data/installationRules';
import { BrickWall } from './BrickWall';
import { brickFacePatch } from './BrickFacePatch';
import { addLighting } from './Lighting';
import { matteMaterial, siteMaterial, siteProScreedMaterial } from './SiteMaterials';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ExteriorCourtyard } from './ExteriorCourtyard';
import { attribute, texture as sampleTexture, uv } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';

// Poly Haven "Red Brick" by Rob Tuytel, CC0: https://polyhaven.com/a/red_brick
// Individual photographed clay faces are assigned to physical bricks; the
// source image's baked mortar is never laid over the game's real joints.
const brickFace = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/masonry/red-brick-polyhaven-1k.jpg`);
brickFace.colorSpace = THREE.SRGBColorSpace;
brickFace.anisotropy = 8;
brickFace.wrapS = brickFace.wrapT = THREE.RepeatWrapping;
const brickMaterial = (): MeshStandardNodeMaterial => {
  const material = new MeshStandardNodeMaterial({ roughness: 1 });
  material.name = 'Varied photographed fired-clay units';
  const patch = attribute<'vec4'>('brickPatch', 'vec4');
  material.colorNode = sampleTexture(brickFace, uv().mul(patch.zw).add(patch.xy)).rgb;
  return material;
};
const masonryFaceMaterial = brickMaterial();

const concreteBeam = (size: THREE.Vector3, material: THREE.Material): THREE.Mesh => {
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), uvs = geometry.getAttribute('uv');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const nx = Math.abs(normals.getX(i)), ny = Math.abs(normals.getY(i));
    // Every face receives approximately 0.75 m of scanned concrete per tile.
    // A long, shallow beam must not stretch one square texture along its span.
    if (ny > .5) uvs.setXY(i, x / .75, z / .75);
    else uvs.setXY(i, .37 + y / .75, (nx > .5 ? z : x) / .75);
  }
  return new THREE.Mesh(geometry, material);
};

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

  constructor(scene: THREE.Scene) {
    super();
    this.name = 'Living room first-fix site';
    this.userData.studioEntityId = 'world:living-room';
    this.brickWall = new BrickWall(INSTALLATION_POINTS);
    this.add(this.brickWall);

    // Preserve the former untouched masonry as a separate right-hand practice
    // surface while the main installation wall starts at the PVC phase.
    this.intactPracticeWall = new BrickWall([]);
    this.intactPracticeWall.name = 'Untouched right-hand masonry practice wall';
    this.intactPracticeWall.userData.studioEntityId = 'world:intact-practice-wall';
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

    const ceiling = new THREE.Mesh(new RoundedBoxGeometry(GAME_CONFIG.room.width, 0.16, GAME_CONFIG.room.depth, 2, .012), siteMaterial('concrete', 0xf0ede7, 1.9, 1.8));
    ceiling.position.y = GAME_CONFIG.room.height + 0.08;
    ceiling.name = 'Concrete slab ceiling';
    ceiling.userData.studioEntityId = 'world:ceiling';
    ceiling.receiveShadow = true;
    this.add(ceiling);

    // Mortar backing stays solid for contact and measurement. Individually
    // raised clay courses on all side-wall segments match the primary wall.
    const sideMaterial = matteMaterial(0x918a81);
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
    columnMaterial.userData.referenceLaserReceiver=true;
    for (const x of [-2.72, 2.72]) {
      const column = new THREE.Mesh(new RoundedBoxGeometry(0.36, GAME_CONFIG.room.height, 0.38, 2, .009), columnMaterial);
      column.position.set(x, GAME_CONFIG.room.height / 2, -2.37);
      column.name = 'Structural concrete column';
      column.userData.studioEntityId = `world:column:${x}`;
      column.castShadow = true;
      column.receiveShadow = true;
      this.referenceWalls.push(column);
      this.add(column);
    }

    this.addFormworkMarks();
    this.addConstructionJoints();
    this.addRearWall();
    this.addWallHeadBeams();
    this.addFloorReturns();
    this.addContactPatina();
    this.addSiteSupplies();

    // Fired-clay shells leave thin angular plates, not round gravel. Share one
    // mesh/draw call for the existing 26 pieces and keep their floor positions.
    const rubbleGeometry = new THREE.BufferGeometry();
    rubbleGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -.5,-.15,-.4, .4,-.15,-.45, .5,-.15,.15, -.3,-.15,.5,
      -.42,.15,-.32, .45,.15,-.26, .25,.15,.23, -.3,.15,.39,
    ], 3));
    rubbleGeometry.setIndex([0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7]);
    const flatRubble = rubbleGeometry.toNonIndexed();
    rubbleGeometry.dispose();
    flatRubble.computeVertexNormals();
    const rubble = new THREE.InstancedMesh(flatRubble, siteMaterial('clay', 0xbd7854), 26);
    rubble.name = 'Brick rubble';
    rubble.userData.studioEntityId = 'world:site-clay-rubble';
    rubble.castShadow = rubble.receiveShadow = true;
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3();
    const vertex = new THREE.Vector3(), color = new THREE.Color();
    for (let index = 0; index < 26; index += 1) {
      scale.set(.033 + index % 4 * .014, .024 + index % 3 * .012, .028 + index % 5 * .006);
      rotation.setFromEuler(new THREE.Euler((index % 4 - 1.5) * .18, index * 2.399, (index % 3 - 1) * .20));
      matrix.compose(new THREE.Vector3(), rotation, scale);
      let lowest = Infinity;
      const points = flatRubble.getAttribute('position');
      for (let i = 0; i < points.count; i++) lowest = Math.min(lowest, vertex.fromBufferAttribute(points, i).applyMatrix4(matrix).y);
      position.set(-2.5 + ((index * 1.71) % 5), -lowest + .001, -2.05 + (index % 5) * .11);
      matrix.compose(position, rotation, scale);
      rubble.setMatrixAt(index, matrix);
      rubble.setColorAt(index, color.setRGB(.85 + index % 4 * .04, .84 + index % 3 * .03, .79 + index % 5 * .035));
    }
    rubble.computeBoundingSphere();
    this.add(rubble);
    addLighting(scene);
  }

  update(dt: number): void { this.exterior.update(dt); }

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
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const patchRects = new Float32Array(pieces.length * 4);
    geometry.setAttribute('brickPatch', new THREE.InstancedBufferAttribute(patchRects, 4));
    const bricks = new THREE.InstancedMesh(geometry, masonryFaceMaterial, pieces.length);
    bricks.name = hasOpening ? 'Left fired-clay courses cut around unglazed opening' : 'Right fired-clay courses';
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3();
    for (const [index, piece] of pieces.entries()) {
      const row = Math.floor(piece.y / course), offset = (row % 2) * pitch / 2;
      const column = Math.floor((piece.z - zMin - offset) / pitch);
      const base = brickFacePatch(row, column, wallX < 0 ? 1 : 2);
      const startZ = zMin + column * pitch + offset + gap / 2;
      const startY = row * course + gap / 2;
      const u = (piece.z - piece.length / 2 - startZ) / (pitch - gap);
      const v = (piece.y - piece.height / 2 - startY) / (course - gap);
      patchRects.set([base[0] + base[2] * u, base[1] + base[3] * v,
        base[2] * piece.length / (pitch - gap), base[3] * piece.height / (course - gap)], index * 4);
      position.set(wallX + (wallX < 0 ? .120 : -.120), piece.y, piece.z);
      scale.set(.020, piece.height, piece.length);
      bricks.setMatrixAt(index, matrix.compose(position, rotation, scale));
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
  }

  private addRearWall(): void {
    // The fourth perimeter wall uses the same clay photograph and course
    // dimensions as the primary wall. A solid mortar backing retains contact.
    const rearZ = GAME_CONFIG.room.depth / 2;
    const rearGroup = new THREE.Group();
    rearGroup.name = 'Rear masonry work surface';
    rearGroup.userData.studioEntityId = 'world:rear-wall';
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(GAME_CONFIG.room.width, GAME_CONFIG.room.height, .16),
      matteMaterial(0x918a81),
    );
    wall.name = 'Solid rear masonry backing';
    wall.userData.referenceLaserReceiver = true;
    wall.position.set(0, GAME_CONFIG.room.height / 2, rearZ + .08);
    wall.receiveShadow = true;
    rearGroup.add(wall);

    const brickWidth = GAME_CONFIG.room.width / 21, course = GAME_CONFIG.room.height / 23, gap = .006;
    const columns = 22, rows = 23;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const patchRects = new Float32Array(columns * rows * 4);
    geometry.setAttribute('brickPatch', new THREE.InstancedBufferAttribute(patchRects, 4));
    const bricks = new THREE.InstancedMesh(geometry, masonryFaceMaterial, columns * rows);
    bricks.name = 'Full staggered rear clay courses';
    bricks.userData.textureSource = 'red-brick-polyhaven-1k.jpg';
    bricks.userData.studioEntityId = 'world:rear-exposed-masonry';
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      const left = -GAME_CONFIG.room.width / 2 + column * brickWidth + (row % 2) * brickWidth / 2;
      const right = Math.min(GAME_CONFIG.room.width / 2, left + brickWidth - gap);
      const clippedLeft = Math.max(-GAME_CONFIG.room.width / 2, left + gap / 2);
      const base = brickFacePatch(row, column, 3);
      const fullLeft = left + gap / 2;
      patchRects.set(right > clippedLeft ? [base[0] + base[2] * (clippedLeft - fullLeft) / (brickWidth - gap), base[1],
        base[2] * (right - clippedLeft) / (brickWidth - gap), base[3]] : [base[0], base[1], 0, base[3]], index * 4);
      position.set((clippedLeft + right) / 2, (row + .5) * course, rearZ - .010);
      scale.set(Math.max(0, right - clippedLeft), course - gap, .020);
      matrix.compose(position, rotation, scale);
      bricks.setMatrixAt(index, matrix);
    }
    bricks.castShadow = bricks.receiveShadow = true;
    bricks.computeBoundingSphere();
    setBrickFaceRaycast(bricks, new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, rearZ - .020), point => {
      if (point.y <= 0 || point.y >= GAME_CONFIG.room.height || point.x <= -GAME_CONFIG.room.width / 2 || point.x >= GAME_CONFIG.room.width / 2) return false;
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

  private addWallHeadBeams(): void {
    // The cast-in-place ring beam bears on the last clay courses and overlaps
    // the floor slab, so the wall head reads as a continuous structural joint.
    const width = GAME_CONFIG.room.width, depth = GAME_CONFIG.room.depth;
    const material = siteMaterial('concrete', 0xd6d2cc);
    const beams = new THREE.Group();
    const parts = [
      { x: 0, z: GAME_CONFIG.room.wallFrontZ - .01, sx: width, sz: .27 },
      { x: 0, z: depth / 2 - .035, sx: width, sz: .27 },
      { x: -width / 2 + .035, z: 0, sx: .27, sz: depth },
      { x: width / 2 - .035, z: 0, sx: .27, sz: depth },
    ];
    for (const part of parts) {
      const beam = concreteBeam(new THREE.Vector3(part.sx, .22, part.sz), material);
      beam.position.set(part.x, GAME_CONFIG.room.height - .09, part.z);
      beam.castShadow = beam.receiveShadow = true;
      beam.raycast = () => undefined;
      beams.add(beam);
    }
    beams.name = 'Concrete slab perimeter bearing on brick walls';
    this.add(beams);
  }

  private addConstructionJoints(): void {
    const width = GAME_CONFIG.room.width, depth = GAME_CONFIG.room.depth;
    const sections: Array<{position: THREE.Vector3; size: THREE.Vector3}> = [];
    // Drying-shrinkage cuts in the screed, and the darker margin at the wall
    // make the floor read as a poured surface inside a built enclosure.
    for (const x of [-1.27, 1.27]) sections.push({position: new THREE.Vector3(x, .0015, 0), size: new THREE.Vector3(.003, .002, depth - .06)});
    for (const z of [-1.2, 1.2]) sections.push({position: new THREE.Vector3(0, .0015, z), size: new THREE.Vector3(width - .06, .002, .003)});
    for (const x of [-width / 2 + .015, width / 2 - .015]) sections.push({position: new THREE.Vector3(x, .002, 0), size: new THREE.Vector3(.022, .004, depth)});
    for (const z of [-depth / 2 + .015, depth / 2 - .015]) sections.push({position: new THREE.Vector3(0, .002, z), size: new THREE.Vector3(width, .004, .022)});
    const cuts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), matteMaterial(0x756d60), sections.length);
    const transform = new THREE.Matrix4();
    for (const [index, section] of sections.entries()) cuts.setMatrixAt(index, transform.compose(section.position, new THREE.Quaternion(), section.size));
    cuts.name = 'Screed joints and wall perimeter gap';
    cuts.raycast = () => undefined;
    cuts.computeBoundingSphere();
    this.add(cuts);

  }

  private addFloorReturns(): void {
    // The screed is pressed into the rough wall base. A low, uneven cove
    // connects the horizontal pour to the vertical substrate instead of
    // leaving two photo-textured planes intersecting at a razor-sharp edge.
    const material = siteMaterial('concrete', 0x817f79, 2.1, .25);
    material.side = THREE.DoubleSide;
    const strips: Array<{from: THREE.Vector3; to: THREE.Vector3; inward: THREE.Vector3}> = [
      {from:new THREE.Vector3(-3.78,0,3.485),to:new THREE.Vector3(3.78,0,3.485),inward:new THREE.Vector3(0,0,-1)},
      {from:new THREE.Vector3(-3.79,0,-3.58),to:new THREE.Vector3(3.79,0,-3.58),inward:new THREE.Vector3(0,0,1)},
      {from:new THREE.Vector3(-3.785,0,-3.58),to:new THREE.Vector3(-3.785,0,3.48),inward:new THREE.Vector3(1,0,0)},
      {from:new THREE.Vector3(3.785,0,-3.58),to:new THREE.Vector3(3.785,0,3.48),inward:new THREE.Vector3(-1,0,0)},
    ];
    for(const x of [-2.72,2.72])strips.push({from:new THREE.Vector3(x-.18,0,-2.18),to:new THREE.Vector3(x+.18,0,-2.18),inward:new THREE.Vector3(0,0,1)});
    const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
    let vertex=0;
    for(const [edge,strip] of strips.entries()){
      const length=strip.from.distanceTo(strip.to),steps=Math.max(3,Math.ceil(length/.24));
      for(let i=0;i<=steps;i++){
        const t=i/steps,point=strip.from.clone().lerp(strip.to,t);
        const variation=Math.sin(i*2.73+edge*4.1)*.012+Math.sin(i*6.71+edge)*.005;
        const width=Math.max(.035,.085+variation),height=Math.max(.025,.054+variation*.35);
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
    patina.userData.studioEntityId='world:contact-patina';patina.raycast=()=>undefined;
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
