import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PlayerObstacle } from '../player/EquipmentCollision';
import { brickFacePatch, brickFaceTone } from './BrickFacePatch';
import { masonryFaceMaterial } from './BrickFaceMaterial';
import { laidClayGeometry, type LaidClayWear } from './LaidClayDamage';
import { siteMaterial } from './SiteMaterials';
import { MansionMasonryDemolition, type MasonryBrickInstance } from './MansionMasonryDemolition';
import { createCourtyardClayStack, createTimberPallet } from './LooseClaySupplies';

/** A traversable open-air room, with reused live olive geometry rather than a backdrop. */
export class MansionCourtyard extends THREE.Group {
  readonly obstacles: PlayerObstacle[] = [];
  readonly masonryDemolition = new Map<string, MansionMasonryDemolition>();
  private readonly tree: THREE.Object3D | null;
  private readonly treeColliderProxy: THREE.Mesh | null;
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
    this.treeColliderProxy = this.tree
      ? new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false })) : null;
    if (this.tree) {
      this.tree.name = 'Existing olive tree retained in open mansion court';
      this.tree.position.set(13.35, .025, 11.35);
      this.tree.scale.setScalar(1.35);
      this.add(this.tree);
      if (this.treeColliderProxy) {
        this.treeColliderProxy.name = 'Retained olive trunk collision proxy';
        this.treeColliderProxy.position.y = .74;
        this.treeColliderProxy.scale.set(.49, 1.48, .49);
        this.treeColliderProxy.raycast = () => undefined;
        this.tree.add(this.treeColliderProxy);
      }
      this.obstacles.push({ id: 'retained-olive-trunk', minX: 13.02, maxX: 13.68, minZ: 11.02, maxZ: 11.68 });
      this.loadScannedCourtTree(this.tree);
    }
  }

  update(dt: number): void {
    if (!this.tree) return;
    this.windTime += Math.min(.05, Math.max(0, dt));
    const canopy = this.tree.getObjectByName('Scanned olive canopy') ??
      this.tree.children.find(child => child instanceof THREE.Group);
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

  private loadScannedCourtTree(tree: THREE.Object3D): void {
    const requestedAt = performance.now();
    const decoder = new DRACOLoader();
    decoder.setDecoderPath(`${import.meta.env.BASE_URL}assets/draco/`);
    const loader = new GLTFLoader();
    loader.setDRACOLoader(decoder);
    loader.load(`${import.meta.env.BASE_URL}assets/vegetation/courtyard-tree/courtyard-tree-optimized.glb`, asset => {
      const model = asset.scene;
      const trunk = model.getObjectByName('courtyard_tree_trunk');
      const branches = model.getObjectByName('courtyard_tree_branches');
      const leaves = model.getObjectByName('courtyard_tree_leaves');
      if (!(trunk instanceof THREE.Mesh) || !(branches instanceof THREE.Mesh) || !(leaves instanceof THREE.Mesh)) {
        tree.userData.scannedError = 'Optimized tree has missing parts';
        decoder.dispose();
        return;
      }
      const canopy = new THREE.Group();
      canopy.name = 'Scanned olive canopy';
      model.add(canopy);
      canopy.attach(branches);
      canopy.attach(leaves);
      const leafMaterial = leaves.material as THREE.MeshStandardMaterial;
      leafMaterial.color.setHex(0xb9c3b4);
      leafMaterial.transparent = false;
      leafMaterial.depthWrite = true;
      for (const part of [trunk, branches, leaves]) {
        part.castShadow = part === trunk || part === branches;
        part.receiveShadow = true;
        part.raycast = () => undefined;
      }
      const bounds = new THREE.Box3().setFromObject(model);
      // Set the root at the actual foot of the trunk, rather than the centre
      // of an asymmetrical canopy; it belongs in the authored gravel basin.
      model.updateMatrixWorld(true);
      const trunkPositions = trunk.geometry.getAttribute('position');
      const basePoint = new THREE.Vector3();
      let footMinX = Infinity, footMaxX = -Infinity, footMinZ = Infinity, footMaxZ = -Infinity;
      for (let i = 0; i < trunkPositions.count; i++) {
        basePoint.fromBufferAttribute(trunkPositions, i).applyMatrix4(trunk.matrixWorld);
        if (basePoint.y > bounds.min.y + .45) continue;
        footMinX = Math.min(footMinX, basePoint.x); footMaxX = Math.max(footMaxX, basePoint.x);
        footMinZ = Math.min(footMinZ, basePoint.z); footMaxZ = Math.max(footMaxZ, basePoint.z);
      }
      const footX = Number.isFinite(footMinX) ? (footMinX + footMaxX) / 2 : 0;
      const footZ = Number.isFinite(footMinZ) ? (footMinZ + footMaxZ) / 2 : 0;
      // The scan includes a thin capture plinth around the roots. Seat it
      // below the gravel so only the rooted trunk is visible at ground level.
      model.position.set(-footX, -bounds.min.y - .14, -footZ);
      const fallback = tree.children.filter(child => child !== this.treeColliderProxy);
      tree.remove(...fallback);
      tree.add(model);
      // Collision follows the actual trunk below eye height. Its small editor
      // proxy moves with the tree pivot; overhanging branches stay walkable.
      tree.updateWorldMatrix(true, true);
      const vertices = trunkPositions;
      const point = new THREE.Vector3();
      const groundY = tree.getWorldPosition(new THREE.Vector3()).y;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < vertices.count; i++) {
        point.fromBufferAttribute(vertices, i).applyMatrix4(trunk.matrixWorld);
        if (point.y < groundY - .05 || point.y > groundY + 1.8) continue;
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
        minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
      }
      if (Number.isFinite(minX) && this.treeColliderProxy) {
        const margin = .08;
        const centreWorld = new THREE.Vector3((minX + maxX) / 2, groundY + .9, (minZ + maxZ) / 2);
        this.treeColliderProxy.position.copy(tree.worldToLocal(centreWorld));
        const worldScale = tree.getWorldScale(new THREE.Vector3());
        this.treeColliderProxy.scale.set((maxX - minX + margin * 2) / worldScale.x,
          1.8 / worldScale.y, (maxZ - minZ + margin * 2) / worldScale.z);
        const obstacle = this.obstacles.find(item => item.id === 'retained-olive-trunk');
        if (obstacle) {
          obstacle.minX = minX - margin; obstacle.maxX = maxX + margin;
          obstacle.minZ = minZ - margin; obstacle.maxZ = maxZ + margin;
        }
      }
      const pivot = tree.parent;
      if (pivot?.userData.levelEditorKind === 'asset') {
        const size = new THREE.Box3().setFromObject(tree).getSize(new THREE.Vector3());
        pivot.userData.baseSize = [size.x, size.y, size.z];
      }
      tree.userData.scannedReady = true;
      tree.userData.scannedLoadMs = performance.now() - requestedAt;
      tree.userData.scannedTriangles = [trunk, branches, leaves].reduce((sum, part) =>
        sum + (part.geometry.index?.count ?? part.geometry.getAttribute('position').count) / 3, 0);
      decoder.dispose();
    }, undefined, error => { tree.userData.scannedError = String(error); decoder.dispose(); });
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

  /** The recessed rooms use the same laid, chipped hollow-clay surface as the
   * main mansion. Slots stay row-major so demolition and Studio saves remain
   * stable; the extra slot gives alternate courses their two half units. */
  private addRecessedClay(group: THREE.Group, id: string, length: number, alongX: boolean,
    nominalColumns: number, thickness: number): { refs: (MasonryBrickInstance | null)[]; columns: number; rows: number } {
    const rows = 23, columns = nominalColumns + 1, course = 3 / rows, pitch = length / nominalColumns, gap = .006;
    const wearTypes: LaidClayWear[] = ['sound', 'small-chip-a', 'small-chip-b', 'broken-corner'];
    const batches = wearTypes.map(() => ({ matrices: [] as THREE.Matrix4[], colors: [] as THREE.Color[], patches: [] as number[] }));
    const slots: ({ variant: number; instance: number } | null)[] = Array(columns * rows).fill(null);
    const wallSeed = [...id].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0;
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), tint = new THREE.Color();
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const origin = (col - (row % 2 ? .5 : 0)) * pitch;
      const hand = (salt: number) => ((Math.imul(row + salt * 17, 73856093) ^ Math.imul(col + salt * 29, 19349663) ^ wallSeed) >>> 0) % 101 / 100;
      const start = Math.max(gap / 2, origin + gap / 2 + (hand(1) - .5) * .003);
      const end = Math.min(length - gap / 2, origin + pitch - gap / 2 + (hand(2) - .5) * .003);
      const span = end - start;
      if (span <= .01) continue;
      const bottom = row * course + gap / 2 + (hand(3) - .5) * .004;
      const top = (row + 1) * course - gap / 2 + (hand(4) - .5) * .004;
      const relief = (hand(5) - .5) * .006;
      const coordinate = -length / 2 + (start + end) / 2;
      const position = new THREE.Vector3(alongX ? coordinate : relief, (bottom + top) / 2, alongX ? relief : coordinate);
      const scale = new THREE.Vector3(alongX ? span : thickness, top - bottom, alongX ? thickness : span);
      const wear = (Math.imul(row + 1, 2246822519) ^ Math.imul(col + 1, 3266489917) ^ wallSeed) >>> 0;
      const variant = wear % 100 < 4 ? 3 : wear % 100 < 14 ? 2 : wear % 100 < 24 ? 1 : 0;
      const batch = batches[variant];
      slots[row * columns + col] = { variant, instance: batch.matrices.length };
      batch.matrices.push(matrix.compose(position, rotation, scale).clone());
      const tone = brickFaceTone(row, col, wallSeed % 97);
      batch.colors.push(tint.setRGB(tone[0], tone[1], tone[2]).clone());
      batch.patches.push(...brickFacePatch(row, col, wallSeed % 97));
    }
    const meshes: THREE.InstancedMesh[] = [];
    for (const [variant, batch] of batches.entries()) {
      if (!batch.matrices.length) continue;
      const geometry = laidClayGeometry(wearTypes[variant], alongX);
      geometry.setAttribute('brickPatch', new THREE.InstancedBufferAttribute(new Float32Array(batch.patches), 4));
      const mesh = new THREE.InstancedMesh(geometry, masonryFaceMaterial, batch.matrices.length);
      mesh.name = `${id} · ${variant === 0 ? 'sound clay units' : variant === 3 ? 'broken corners' : `lightly chipped clay units ${variant}`}`;
      mesh.castShadow = mesh.receiveShadow = true;
      for (let i = 0; i < batch.matrices.length; i++) {
        mesh.setMatrixAt(i, batch.matrices[i]);
        mesh.setColorAt(i, batch.colors[i]);
      }
      mesh.computeBoundingSphere();
      group.add(mesh);
      meshes[variant] = mesh;
    }
    return { refs: slots.map(slot => slot ? { mesh: meshes[slot.variant], instance: slot.instance } : null), columns, rows };
  }

  private addRecessedFacingRooms(): void {
    const slabMaterial = siteMaterial('floor', 0xcfc9c0, 1.5, .8);
    const mortar = siteMaterial('concrete', 0xaaa399, .9, .8);
    mortar.emissive.setHex(0x77736e);
    mortar.emissiveIntensity = .24;
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
        const courses = this.addRecessedClay(group, id, 3.06, true, 9, .22);
        const obstacle: PlayerObstacle = { id,
          minX: 17.98, maxX: 21.08, minZ: returnZ - .11, maxZ: returnZ + .11,
          minFloorY: 0, maxFloorY: 3 };
        this.obstacles.push(obstacle);
        this.masonryDemolition.set(id, new MansionMasonryDemolition(group, courses.refs, backing, obstacle, 3.06, true, courses.columns, courses.rows));
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
      const bricks = this.addRecessedClay(group, id, 2.26, false, 7, .23);
      const obstacle: PlayerObstacle = { id,
        minX: 20.78, maxX: 21.02, minZ: z - 1.18, maxZ: z + 1.18,
        minFloorY: 0, maxFloorY: 3 };
      this.obstacles.push(obstacle);
      this.masonryDemolition.set(id, new MansionMasonryDemolition(group, bricks.refs, backing, obstacle, 2.26, false, bricks.columns, bricks.rows));
    }
  }

  private addBrickStorage(): void {
    this.add(createCourtyardClayStack());
    this.add(createTimberPallet('Reusable timber pallet under spare bricks', 1.28, .71, 16.85, 14.61));
    this.obstacles.push({ id: 'court-stored-masonry', minX: 16.2, maxX: 17.5, minZ: 14.25, maxZ: 15.0 });
  }
}
