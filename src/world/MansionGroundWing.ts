import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PlayerObstacle } from '../player/EquipmentCollision';
import { brickFacePatch } from './BrickFacePatch';
import { masonryFaceMaterial } from './BrickFaceMaterial';
import { siteMaterial } from './SiteMaterials';
import { createClaySoffitPreview } from './ClaySoffitPreview';
import { MansionCourtyard } from './MansionCourtyard';

/** First traversable part of the approved ground plan, kept out of the released room. */
export class MansionGroundWing extends THREE.Group {
  readonly obstacles: PlayerObstacle[] = [];
  readonly courtyard: MansionCourtyard;

  constructor(oliveSource: THREE.Object3D | null) {
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
    this.wall('Foyer south fired-clay partition', 1.35, 7.65, 9, 7.65);
    this.courtyard = new MansionCourtyard(oliveSource);
    this.add(this.courtyard);
    this.obstacles.push(...this.courtyard.obstacles);
    this.addStairCore();
    this.addFirstFloorLanding();
    this.addFirstFloorRoom();
    this.addSecondStairCore();
    this.addSecondFloorShell();
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
  }

  update(dt: number): void { this.courtyard.update(dt); }

  surfaceHeight(x: number, z: number, currentFloor = 0): number {
    const closest = (heights: number[]): number => heights.reduce((best, height) =>
      Math.abs(height - currentFloor) < Math.abs(best - currentFloor) ? height : best);
    const onFirst = x >= 4.8 && x <= 6.2 && z >= 8 && z < 11.08;
    if (onFirst) {
      const step = Math.min(11, Math.floor((z - 8) / .28) + 1) * .15;
      return closest([step, 3.3 + step]);
    }
    const onLanding = x >= 4.8 && x <= 8.2 && z >= 11.08 && z <= 12.2;
    if (onLanding) return closest([1.65, 4.95]);
    const onSecond = x >= 6.8 && x <= 8.2 && z >= 8 && z < 11.08;
    if (onSecond) {
      const step = 1.65 + Math.min(11, Math.floor((11.08 - z) / .28) + 1) * .15;
      return closest([step, 3.3 + step]);
    }
    if (x >= 4.48 && x <= 6.6 && z >= 6.5 && z < 8) return closest([0, 3.3]);
    if (x >= 6.5 && x <= 8.5 && z >= 4.5 && z < 8) return closest([0, 3.3, 6.6]);
    if (x >= 6.5 && x <= 12.5 && z >= 0 && z < 4.5) return closest([3.3, 6.6]);
    return 0;
  }

  obstaclesAt(floorY: number): PlayerObstacle[] {
    return this.obstacles.filter(obstacle =>
      floorY >= (obstacle.minFloorY ?? -Infinity) - .16 && floorY <= (obstacle.maxFloorY ?? Infinity) + .16);
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
    const backing = new THREE.Mesh(new THREE.BoxGeometry(alongX ? length : .20, 3, alongX ? .20 : length), siteMaterial('concrete', 0x8b8176, length / 2, 1.5));
    backing.name = `${name} mortar backing`;
    backing.position.set(centreX, baseY + 1.5, centreZ);
    backing.castShadow = backing.receiveShadow = true;
    this.add(backing);
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
      const position = new THREE.Vector3(centreX + (alongX ? coordinate : 0), baseY + (row + .5) * course, centreZ + (alongX ? 0 : coordinate));
      const size = new THREE.Vector3(alongX ? span : .24, span ? course - gap : 0, alongX ? .24 : span);
      bricks.setMatrixAt(index, matrix.compose(position, quaternion, size));
    }
    bricks.computeBoundingSphere();
    this.add(bricks);
    this.obstacles.push({ id: name, minX: Math.min(x0, x1) - .12, maxX: Math.max(x0, x1) + .12,
      minZ: Math.min(z0, z1) - .12, maxZ: Math.max(z0, z1) + .12,
      minFloorY: baseY, maxFloorY: baseY + 3 });
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

  private addSecondStairCore(): void {
    const concrete = siteMaterial('floor', 0xd7d1c7, .35, .35);
    const formwork = siteMaterial('concrete', 0xb5ada2, .2, .8);
    const deck = new THREE.Mesh(new RoundedBoxGeometry(2.15, .18, 1.48, 2, .01), concrete);
    deck.name = 'Supported L1 side deck leading to L2 stair';
    deck.position.set(5.55, 3.21, 7.24);
    deck.castShadow = deck.receiveShadow = true;
    this.add(deck);
    const deckColumn = new THREE.Mesh(new RoundedBoxGeometry(.27, 3.21, .27, 2, .008), formwork);
    for (const z of [6.6, 7.85]) {
      const support = deckColumn.clone();
      support.name = 'Cast support under L1 side deck';
      support.position.set(4.52, 1.6, z);
      support.castShadow = support.receiveShadow = true;
      this.add(support);
    }
    const edgeSteel = new THREE.MeshStandardMaterial({ color: 0xc2a731, roughness: .62, metalness: .25 });
    for (const z of [6.56, 7.24, 7.9]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.028, .028, 1.05, 8), edgeSteel);
      post.name = 'Temporary L1 side-deck edge-protection post';
      post.position.set(4.48, 3.825, z);
      post.castShadow = true;
      this.add(post);
    }
    const deckRail = new THREE.Mesh(new THREE.CylinderGeometry(.023, .023, 1.46, 8), edgeSteel);
    deckRail.name = 'Visible guard at open L1 side deck';
    deckRail.position.set(4.48, 4.3, 7.23);
    deckRail.rotation.x = Math.PI / 2;
    this.add(deckRail);
    this.obstacles.push({ id: 'L1 side-deck edge guard', minX: 4.42, maxX: 4.53, minZ: 6.51, maxZ: 7.97,
      minFloorY: 3.3, maxFloorY: 3.3 });
    const geometry = new RoundedBoxGeometry(1, 1, 1, 2, .006);
    const treads = new THREE.InstancedMesh(geometry, concrete, 22);
    const risers = new THREE.InstancedMesh(geometry, formwork, 22);
    treads.name = 'L1 to L2 cast stair treads';
    risers.name = 'L1 to L2 cast stair risers';
    const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
    for (let step = 1; step <= 11; step++) {
      const firstTop = 3.3 + step * .15;
      const firstZ = 8 + (step - .5) * .28;
      treads.setMatrixAt(step - 1, matrix.compose(new THREE.Vector3(5.5, firstTop - .065, firstZ), quaternion,
        new THREE.Vector3(1.38, .13, .28)));
      risers.setMatrixAt(step - 1, matrix.compose(new THREE.Vector3(5.5, firstTop - .075, firstZ - .14), quaternion,
        new THREE.Vector3(1.38, .15, .045)));
      const secondTop = 4.95 + step * .15;
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
    landing.name = 'L1 to L2 mid-flight structural landing';
    landing.position.set(6.5, 4.855, 11.64);
    landing.castShadow = landing.receiveShadow = true;
    this.add(landing);
    // The L1 corridor and room roof slabs have their top at 6.6 m and serve
    // as the actual L2 floor; no duplicate surface is placed over them.
    const steel = new THREE.MeshStandardMaterial({ color: 0xc2a731, roughness: .64, metalness: .2 });
    for (const [x, z0, z1, y] of [[4.72, 8, 12.22, 4.3], [6.5, 8, 11.08, 5.1], [8.3, 8, 12.22, 6.0]]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, z1 - z0, 8), steel);
      rail.name = 'Temporary upper stair-edge protection rail';
      rail.position.set(x, y, (z0 + z1) / 2);
      rail.rotation.x = Math.PI / 2;
      this.add(rail);
    }
  }

  private addSecondFloorShell(): void {
    this.wall('L2 west fired-clay corridor wall', 6.5, 4.5, 6.5, 7.95, 6.6);
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
