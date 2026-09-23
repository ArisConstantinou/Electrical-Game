import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PlayerObstacle } from '../player/EquipmentCollision';
import { brickFacePatch } from './BrickFacePatch';
import { masonryFaceMaterial } from './BrickFaceMaterial';
import { siteMaterial } from './SiteMaterials';
import { MansionMasonryDemolition } from './MansionMasonryDemolition';
import { createCourtyardClayStack, createTimberPallet } from './LooseClaySupplies';

/** A traversable open-air room, with reused live olive geometry rather than a backdrop. */
export class MansionCourtyard extends THREE.Group {
  readonly obstacles: PlayerObstacle[] = [];
  readonly masonryDemolition = new Map<string, MansionMasonryDemolition>();
  private readonly tree: THREE.Object3D | null;
  private windTime = 0;

  constructor(oliveSource: THREE.Object3D | null) {
    super();
    this.name = 'Under-construction open central Cypriot courtyard';
    this.userData.studioEntityId = 'world:mansion-courtyard';
    this.addGround();
    this.addPavers();
    this.addConstructionFrame();
    this.addRecessedFacingRooms();
    this.addBrickStorage();
    this.tree = oliveSource?.clone(true) ?? null;
    if (this.tree) {
      this.tree.name = 'Existing olive tree retained in open mansion court';
      this.tree.position.set(13.35, .025, 11.35);
      this.tree.scale.setScalar(1.35);
      this.add(this.tree);
      this.obstacles.push({ id: 'retained-olive-trunk', minX: 13.02, maxX: 13.68, minZ: 11.02, maxZ: 11.68 });
    }
  }

  update(dt: number): void {
    if (!this.tree) return;
    this.windTime += Math.min(.05, Math.max(0, dt));
    const canopy = this.tree.children.find(child => child instanceof THREE.Group);
    // The source canopy is the first Group under the tree; each leaf spray is
    // still a separate instanced branch and can sway without rebuilding meshes.
    if (canopy) {
      canopy.rotation.z = .016 * Math.sin(this.windTime * 1.25) + .006 * Math.sin(this.windTime * 2.7);
      canopy.rotation.x = .011 * Math.sin(this.windTime * .91 + .7);
      canopy.children.filter(child => child.name.startsWith('Wind-responsive olive branch')).forEach((branch, index) => {
        branch.rotation.z = .026 * Math.sin(this.windTime * (1.31 + index * .09) + index * 1.2);
        branch.rotation.x = .019 * Math.sin(this.windTime * (.83 + index * .07) + index * .8);
      });
    }
  }

  private addGround(): void {
    const albedo = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/site-materials/gravelly_sand-albedo-512.webp`);
    albedo.name = 'Courtyard compacted gravel CC0';
    albedo.colorSpace = THREE.SRGBColorSpace;
    albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
    albedo.anisotropy = 4;
    const gravel = new THREE.MeshStandardMaterial({ name: 'Photographed compacted Cypriot site gravel', map: albedo, roughness: 1 });
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    const nx = 24, nz = 26;
    for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
      const x = 9 + ix * 9 / nx, z = 6 + iz * 10 / nz;
      const edge = ix === 0 || ix === nx || iz === 0 || iz === nz;
      const y = edge ? -.015 : -.012 + .009 * Math.sin(x * 1.19 + z * .34) + .006 * Math.cos(z * 1.73 - x * .42);
      positions.push(x, y, z);
      uvs.push((x - 9) / 2.5, (z - 6) / 2.5);
      if (ix < nx && iz < nz) {
        const a = iz * (nx + 1) + ix, b = a + nx + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const ground = new THREE.Mesh(geometry, gravel);
    ground.name = 'Nine-by-ten-metre open ground within courtyard and shaded veranda zone';
    ground.receiveShadow = true;
    this.add(ground);
    // The retained tree sits in the same compacted gravel, with a slightly
    // darker shallow basin. World-aligned UVs keep the scan continuous across
    // its irregular edge instead of exposing a concrete-textured disc.
    const bedPositions: number[] = [], bedUvs: number[] = [], bedColors: number[] = [], bedIndices: number[] = [];
    const bedX = 13.35, bedZ = 11.35, sides = 48;
    const groundHeight = (x: number, z: number): number => -.012 + .009 * Math.sin(x * 1.19 + z * .34) + .006 * Math.cos(z * 1.73 - x * .42);
    const addBedVertex = (x: number, y: number, z: number, shade: number): void => {
      bedPositions.push(x, y, z);
      bedUvs.push((x - 9) / 2.5, (z - 6) / 2.5);
      bedColors.push(shade, shade * .985, shade * .955);
    };
    addBedVertex(bedX, groundHeight(bedX, bedZ) + .016, bedZ, .82);
    for (let ring = 0; ring < 3; ring++) {
      const radius = [.38, .82, 1.2][ring];
      const shade = [.84, .9, 1][ring];
      for (let side = 0; side < sides; side++) {
        const angle = side * Math.PI * 2 / sides;
        const irregularity = 1 + .055 * Math.sin(angle * 7 + .4) + .033 * Math.sin(angle * 13 - .7);
        const x = bedX + Math.cos(angle) * radius * irregularity;
        const z = bedZ + Math.sin(angle) * radius * irregularity;
        const lift = ring === 2 ? .002 : ring === 1 ? .014 : .018;
        addBedVertex(x, groundHeight(x, z) + lift, z, shade);
        if (ring === 0) bedIndices.push(0, 1 + (side + 1) % sides, 1 + side);
        else {
          const inner = 1 + (ring - 1) * sides + side;
          const innerNext = 1 + (ring - 1) * sides + (side + 1) % sides;
          const outer = 1 + ring * sides + side;
          const outerNext = 1 + ring * sides + (side + 1) % sides;
          bedIndices.push(inner, innerNext, outer, innerNext, outerNext, outer);
        }
      }
    }
    const bedGeometry = new THREE.BufferGeometry();
    bedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bedPositions, 3));
    bedGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(bedUvs, 2));
    bedGeometry.setAttribute('color', new THREE.Float32BufferAttribute(bedColors, 3));
    bedGeometry.setIndex(bedIndices);
    bedGeometry.computeVertexNormals();
    const soil = new THREE.Mesh(bedGeometry, new THREE.MeshStandardMaterial({
      name: 'Compacted gravel around retained olive', map: albedo, vertexColors: true, roughness: 1,
    }));
    soil.name = 'Unfinished planting bed around retained olive';
    soil.receiveShadow = true;
    this.add(soil);
    // A narrow poured threshold physically joins the foyer screed to the
    // compacted court; it is not a fake painted edge on either large surface.
    const threshold = new THREE.Mesh(new RoundedBoxGeometry(.46, .08, 2.28, 2, .01), siteMaterial('floor', 0xcac4b8, .2, 1));
    threshold.name = 'Unfitted courtyard aperture concrete threshold';
    threshold.position.set(9.03, -.025, 14.0);
    threshold.receiveShadow = true;
    this.add(threshold);
  }

  private addPavers(): void {
    const pavers = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 2, .013), siteMaterial('floor', 0xc6c1b7, .35, .45), 18);
    pavers.name = 'Loose temporary walking pads across unpaved court';
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), color = new THREE.Color();
    for (let i = 0; i < 18; i++) {
      const row = Math.floor(i / 6), col = i % 6;
      const x = 9.86 + col * .62 + (row % 2) * .035;
      const z = 12.16 + row * .78 + Math.sin(i * 1.73) * .026;
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(i * 2.29) * .045);
      pavers.setMatrixAt(i, matrix.compose(new THREE.Vector3(x, .025, z), rotation, new THREE.Vector3(.55, .07, .68)));
      const shade = .87 + ((i * .61803) % 1) * .12;
      pavers.setColorAt(i, color.setRGB(shade, shade * .98, shade * .95));
    }
    pavers.castShadow = pavers.receiveShadow = true;
    pavers.raycast = () => undefined;
    pavers.computeBoundingSphere();
    this.add(pavers);
  }

  private addConstructionFrame(): void {
    const concrete = siteMaterial('floor', 0xcac6be, .4, 1.5);
    const columnGeometry = new RoundedBoxGeometry(.34, 6.6, .34, 2, .009);
    const columns = new THREE.InstancedMesh(columnGeometry, concrete, 7);
    columns.name = 'Continuous reinforced-concrete court edge columns';
    const matrix = new THREE.Matrix4();
    for (const [i, [x, z]] of [[18, 6], [18, 10.9], [18, 16], [13.5, 16], [9, 16], [9, 6], [13.5, 6]].entries()) {
      columns.setMatrixAt(i, matrix.makeTranslation(x, 3.3, z));
      this.obstacles.push({ id: `court-structural-column-${i}`,
        minX: x - .17, maxX: x + .17, minZ: z - .17, maxZ: z + .17,
        minFloorY: 0, maxFloorY: 6.6 });
    }
    columns.castShadow = columns.receiveShadow = true;
    columns.computeBoundingSphere(); this.add(columns);
    const frameMaterial = siteMaterial('floor', 0xd2cdc4, 1, .2);
    for (const level of [3.3, 6.6]) for (const [name, x, z, width, depth] of [
      ['east', 18, 11, .42, 10], ['north', 13.5, 16, 9, .42], ['south', 13.5, 6, 9, .42],
    ] as const) {
      const beam = new THREE.Mesh(new RoundedBoxGeometry(width, .28, depth, 2, .009), frameMaterial);
      beam.name = `Open courtyard ${name} structural beam at ${level}m`;
      beam.position.set(x, level, z);
      beam.castShadow = beam.receiveShadow = true;
      this.add(beam);
    }
    const veranda = new THREE.Mesh(new RoundedBoxGeometry(1.1, .18, 4.8, 2, .009), concrete);
    veranda.name = 'Unfinished shaded veranda slab beside foyer';
    veranda.position.set(9.3, 3.19, 10.2);
    veranda.castShadow = veranda.receiveShadow = true;
    this.add(veranda);
  }

  private addRecessedFacingRooms(): void {
    const slabMaterial = siteMaterial('floor', 0xcfc9c0, 1.5, .8);
    const mortar = siteMaterial('floor', 0x897e73, .9, .8);
    for (const z of [9, 13]) {
      const floor = new THREE.Mesh(new RoundedBoxGeometry(3.15, .18, 2.35, 2, .009), slabMaterial);
      floor.name = 'Actual floor inside unfinished east facing room';
      floor.position.set(19.53, -.09, z);
      floor.receiveShadow = true; this.add(floor);
      const ceiling = new THREE.Mesh(new RoundedBoxGeometry(3.15, .18, 2.35, 2, .009), slabMaterial);
      ceiling.name = 'Recessed east facing room structural soffit';
      ceiling.position.set(19.53, 3.09, z);
      ceiling.castShadow = ceiling.receiveShadow = true; this.add(ceiling);
      for (const edge of [-1, 1]) {
        const returnZ = z + edge * 1.15;
        const id = `recessed-room-side-${z}-${edge}`;
        const group = new THREE.Group();
        group.name = id;
        group.position.set(19.53, 0, returnZ);
        this.add(group);
        const backing = new THREE.Mesh(new THREE.BoxGeometry(3.1, 3, .18), mortar);
        backing.name = 'Mortar joints behind recessed-room side brickwork';
        backing.position.set(0, 1.5, 0);
        backing.castShadow = backing.receiveShadow = true; group.add(backing);
        const rows = 23, cols = 9, geometry = new THREE.BoxGeometry(1, 1, 1);
        const patches = new Float32Array(rows * cols * 4);
        geometry.setAttribute('brickPatch', new THREE.InstancedBufferAttribute(patches, 4));
        const courses = new THREE.InstancedMesh(geometry, masonryFaceMaterial, rows * cols);
        courses.name = 'Individual fired-clay units in recessed-room side return';
        const matrix = new THREE.Matrix4();
        for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
          const index = row * cols + col;
          patches.set(brickFacePatch(row, col, z + edge), index * 4);
          courses.setMatrixAt(index, matrix.compose(
            new THREE.Vector3(-1.53 + (col + .5) * 3.06 / cols, (row + .5) * 3 / rows, 0),
            new THREE.Quaternion(), new THREE.Vector3(3.06 / cols - .006, 3 / rows - .006, .22),
          ));
        }
        courses.castShadow = courses.receiveShadow = true;
        courses.computeBoundingSphere(); group.add(courses);
        const obstacle: PlayerObstacle = { id,
          minX: 17.98, maxX: 21.08, minZ: returnZ - .11, maxZ: returnZ + .11,
          minFloorY: 0, maxFloorY: 3 };
        this.obstacles.push(obstacle);
        this.masonryDemolition.set(id, new MansionMasonryDemolition(group, courses, backing, obstacle, 3.06, true, cols, rows));
      }
      const id = `recessed-room-back-${z}`;
      const group = new THREE.Group();
      group.name = id;
      group.position.set(20.89, 0, z);
      this.add(group);
      const backing = new THREE.Mesh(new THREE.BoxGeometry(.2, 3, 2.3), mortar);
      backing.name = 'Mortar backing of recessed room';
      backing.position.set(.11, 1.5, 0);
      backing.receiveShadow = true; group.add(backing);
      const rows = 23, cols = 7, geometry = new THREE.BoxGeometry(1, 1, 1);
      const patches = new Float32Array(rows * cols * 4);
      geometry.setAttribute('brickPatch', new THREE.InstancedBufferAttribute(patches, 4));
      const bricks = new THREE.InstancedMesh(geometry, masonryFaceMaterial, rows * cols);
      bricks.name = 'Deep photographed clay courses behind open courtyard bay';
      const matrix = new THREE.Matrix4();
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        patches.set(brickFacePatch(row, col, z), i * 4);
        bricks.setMatrixAt(i, matrix.compose(new THREE.Vector3(0, (row + .5) * 3 / rows, -1.13 + (col + .5) * 2.26 / cols),
          new THREE.Quaternion(), new THREE.Vector3(.23, 3 / rows - .006, 2.26 / cols - .006)));
      }
      bricks.castShadow = bricks.receiveShadow = true;
      bricks.computeBoundingSphere(); group.add(bricks);
      const obstacle: PlayerObstacle = { id,
        minX: 20.78, maxX: 21.02, minZ: z - 1.18, maxZ: z + 1.18,
        minFloorY: 0, maxFloorY: 3 };
      this.obstacles.push(obstacle);
      this.masonryDemolition.set(id, new MansionMasonryDemolition(group, bricks, backing, obstacle, 2.26, false, cols, rows));
    }
  }

  private addBrickStorage(): void {
    this.add(createCourtyardClayStack());
    this.add(createTimberPallet('Reusable timber pallet under spare bricks', 1.28, .71, 16.85, 14.61));
    this.obstacles.push({ id: 'court-stored-masonry', minX: 16.2, maxX: 17.5, minZ: 14.25, maxZ: 15.0 });
  }
}
