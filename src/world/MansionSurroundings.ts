import * as THREE from 'three';
import { siteMaterial } from './SiteMaterials';

/** Geometry beyond the open mansion terraces; no sky photograph or flat backdrop. */
export class MansionSurroundings extends THREE.Group {
  private readonly canopies: THREE.Group[] = [];
  private windTime = 0;

  constructor(oliveSource: THREE.Object3D | null, neighbourSource: THREE.Object3D | null) {
    super();
    this.name = 'Modeled Cypriot terrain and neighbouring unfinished buildings';
    this.userData.studioEntityId = 'world:mansion-surroundings';
    this.addTerrain();
    this.addRetainingWall();
    this.addDryFieldDetails();
    this.addOliveGrove(oliveSource);
    if (neighbourSource) {
      const building = new THREE.LOD();
      building.name = 'Distant Cypriot unfinished residential block with open bays';
      const detailed = neighbourSource.clone(true);
      detailed.position.set(0, 0, 0);
      building.addLevel(detailed, 0);
      building.addLevel(this.makeDistantNeighbour(), 38);
      building.position.set(45, 0, 3);
      building.scale.setScalar(1.18);
      building.traverse(object => { object.raycast = () => undefined; });
      this.add(building);
    }
  }

  update(dt: number): void {
    this.windTime += Math.min(.05, Math.max(0, dt));
    this.canopies.forEach((canopy, index) => {
      canopy.rotation.z = .017 * Math.sin(this.windTime * (1.05 + index * .07) + index * 1.1);
      canopy.rotation.x = .011 * Math.sin(this.windTime * (.77 + index * .05) + index * .8);
    });
  }

  private terrainHeight(x: number, z: number): number {
    const rise = THREE.MathUtils.clamp((x - 22) / 47, 0, 1.25);
    const hill = 1.4 * rise + 7.1 * rise * rise;
    return -.075 + hill + rise * (.65 * Math.sin(z * .095 + x * .035) + .32 * Math.sin(z * .24 - x * .071))
      + .035 * Math.sin(x * .74 + z * .41) * (1 - Math.min(1, rise));
  }

  private addTerrain(): void {
    const albedo = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/site-materials/gravelly_sand-albedo-512.webp`);
    albedo.name = 'Open-land dry gravel CC0 scan';
    albedo.colorSpace = THREE.SRGBColorSpace;
    albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
    albedo.anisotropy = 4;
    const ground = new THREE.MeshStandardMaterial({ name: 'Measured gravel scan over rising Cypriot terrain',
      map: albedo, color: 0xc9c5b4, vertexColors: true, roughness: 1 });
    const nx = 85, nz = 82, positions: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
    for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
      const x = -25 + ix * 105.15 / nx, z = -43 + iz * 102 / nz;
      positions.push(x, this.terrainHeight(x, z), z);
      uvs.push(x / 2.5, z / 2.5);
      const variation = .91 + .065 * Math.sin(x * .17 + z * .13) + .035 * Math.sin(x * .41 - z * .34);
      colors.push(variation, variation * .985, variation * .955);
      if (ix < nx && iz < nz) {
        const a = iz * (nx + 1) + ix, b = a + nx + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const land = new THREE.Mesh(geometry, ground);
    land.name = 'Rising subdivided ground and distant ridge beyond the construction site';
    land.receiveShadow = true;
    land.raycast = () => undefined;
    this.add(land);
    // A compacted access track has two shallow ruts cut into the same ground,
    // so it reads as a vehicle approach without placing a finished vehicle.
    const rutMaterial = siteMaterial('floor', 0xa99b82, 1.8, 4.5);
    const tracks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), rutMaterial, 2);
    tracks.name = 'Compacted site access track wheel ruts';
    const matrix = new THREE.Matrix4();
    for (const [index, z] of [-.47, .47].entries())
      tracks.setMatrixAt(index, matrix.compose(new THREE.Vector3(30, -.031, z), new THREE.Quaternion(),
        new THREE.Vector3(23, .018, .37)));
    tracks.receiveShadow = true;
    tracks.raycast = () => undefined;
    tracks.computeBoundingSphere();
    this.add(tracks);
  }

  private addDryFieldDetails(): void {
    const shrubs = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(.5, 1),
      new THREE.MeshStandardMaterial({ color: 0x839177, roughness: 1 }), 115);
    shrubs.name = 'Separate drought-tolerant field shrubs at varied depths';
    const stones = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(.35, 0),
      siteMaterial('concrete', 0xb5ad99, .4, .4), 72);
    stones.name = 'Individual rough field stones';
    const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), color = new THREE.Color();
    for (let i = 0; i < 115; i++) {
      const x = 26 + ((i * .61803398875) % 1) * 43;
      const z = -30 + ((i * .41421356237) % 1) * 79;
      const scale = .38 + ((i * .754877666) % 1) * .62;
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 2.39);
      shrubs.setMatrixAt(i, matrix.compose(new THREE.Vector3(x, this.terrainHeight(x, z) + .14 * scale, z),
        quaternion, new THREE.Vector3(scale, scale * .58, scale)));
      const tint = .78 + ((i * .3660254) % 1) * .21;
      shrubs.setColorAt(i, color.setRGB(tint * .94, tint, tint * .83));
    }
    for (let i = 0; i < 72; i++) {
      const x = 25 + ((i * .754877666) % 1) * 45;
      const z = -29 + ((i * .569840291) % 1) * 76;
      const scale = .42 + ((i * .61803398875) % 1) * .66;
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.63);
      stones.setMatrixAt(i, matrix.compose(new THREE.Vector3(x, this.terrainHeight(x, z) + .08, z),
        quaternion, new THREE.Vector3(scale, scale * .43, scale * .83)));
    }
    for (const mesh of [shrubs, stones]) {
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.raycast = () => undefined;
      mesh.computeBoundingSphere();
      this.add(mesh);
    }
  }

  private addRetainingWall(): void {
    const stone = siteMaterial('concrete', 0xa99f8a, 1.1, 2.1);
    const backing = new THREE.Mesh(new THREE.BoxGeometry(.38, .86, 60), stone);
    backing.name = 'Actual low field-boundary masonry beyond mansion';
    backing.position.set(24.2, .36, 8);
    backing.castShadow = backing.receiveShadow = true;
    backing.raycast = () => undefined;
    this.add(backing);
    const units = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stone, 240);
    units.name = 'Irregular individual field-boundary stones';
    const matrix = new THREE.Matrix4(), color = new THREE.Color();
    for (let row = 0; row < 4; row++) for (let col = 0; col < 60; col++) {
      const index = row * 60 + col;
      const z = -21.5 + col * 1.0 + (row % 2) * .12;
      const width = .84 + .12 * Math.sin(index * 1.93);
      units.setMatrixAt(index, matrix.compose(new THREE.Vector3(23.94, .08 + row * .21, z),
        new THREE.Quaternion(), new THREE.Vector3(.17, .19, width)));
      const shade = .84 + ((index * .6180339) % 1) * .16;
      units.setColorAt(index, color.setRGB(shade, shade * .98, shade * .94));
    }
    units.castShadow = units.receiveShadow = true;
    units.raycast = () => undefined;
    units.computeBoundingSphere();
    this.add(units);
  }

  private addOliveGrove(source: THREE.Object3D | null): void {
    if (!source) return;
    for (const [index, [x, z, scale]] of [
      [26.8, 2.7, 2.18], [27, -13, 1.65], [29, 9, 1.9], [34, 21, 1.55],
      [38, -17, 1.7], [43, 14, 1.8], [49, 28, 1.8], [53, -6, 1.5], [58, 5, 1.9],
    ].entries()) {
      const lod = new THREE.LOD();
      lod.name = `Modeled wind-responsive olive in outer grove ${index + 1}`;
      const near = source.clone(true);
      near.position.set(0, 0, 0);
      near.name = `Grove high-detail olive ${index + 1}`;
      const nearCanopy = near.children.find(child => child instanceof THREE.Group);
      if (nearCanopy instanceof THREE.Group) this.canopies.push(nearCanopy);
      lod.addLevel(near, 0);
      lod.addLevel(this.makeDistantOlive(source, index), 19);
      lod.position.set(x, this.terrainHeight(x, z), z);
      lod.scale.setScalar(scale);
      lod.rotation.y = index * 1.13;
      lod.traverse(object => { object.raycast = () => undefined; });
      this.add(lod);
    }
  }

  private makeDistantNeighbour(): THREE.Group {
    const low = new THREE.Group();
    low.name = 'Reduced-depth distant residential shell with true openings';
    type Part = [number, number, number, number, number, number];
    const plasterParts: Part[] = [], concreteParts: Part[] = [];
    for (const level of [0, 1]) {
      const base = level * 2.64;
      plasterParts.push([-11.15, base + .43, 0, .31, .86, 10.4]);
      plasterParts.push([-11.15, base + 2.4, 0, .31, .48, 10.4]);
      for (const z of [-4.4, -.3, 4.15])
        plasterParts.push([-11.15, base + 1.51, z, .31, 1.3, z === -.3 ? 2.35 : 1.55]);
      for (const z of [-2.55, 2.05]) {
        plasterParts.push([-12.65, base + 1.51, z, .14, 1.3, 2.16]);
        for (const side of [-1, 1]) plasterParts.push([-11.88, base + 1.51, z + side * 1.04, 1.52, 1.3, .13]);
        concreteParts.push([-11.88, base + .855, z, 1.52, .1, 2.16]);
        concreteParts.push([-11.88, base + 2.165, z, 1.52, .1, 2.16]);
      }
    }
    for (const z of [-5.12, -.25, 5.12]) concreteParts.push([-11.05, 2.68, z, .51, 5.36, .26]);
    concreteParts.push([-10.87, 5.4, 0, 1.15, .23, 10.8]);
    concreteParts.push([-10.55, 2.69, 0, 1.05, .13, 7.5]);
    const geometry = new THREE.BoxGeometry(1, 1, 1), matrix = new THREE.Matrix4();
    for (const [name, material, parts] of [
      ['Distant cut plaster courses and recessed open bays', siteMaterial('plaster', 0xe4ddcc, 1, 1), plasterParts],
      ['Distant continuous cast columns and slabs', siteMaterial('concrete', 0xc9c3b7, 1, 1), concreteParts],
    ] as const) {
      const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
      mesh.name = name;
      for (let i = 0; i < parts.length; i++) {
        const [x, y, z, sx, sy, sz] = parts[i];
        mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz)));
      }
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      low.add(mesh);
    }
    return low;
  }

  private makeDistantOlive(source: THREE.Object3D, index: number): THREE.Group {
    const low = new THREE.Group();
    low.name = `Grove distant olive ${index + 1}`;
    const trunk = source.getObjectByName('Tapered forked weathered olive trunk');
    const branches = source.getObjectByName('Forked olive canopy limbs');
    const sourceCanopy = source.children.find(child => child instanceof THREE.Group);
    if (!(trunk instanceof THREE.Mesh) || !(branches instanceof THREE.Mesh) || !(sourceCanopy instanceof THREE.Group))
      throw new Error('Source olive model lacks its real trunk, limbs or canopy');
    low.add(trunk.clone());
    const canopy = new THREE.Group();
    canopy.name = `Grove distant canopy ${index + 1}`;
    canopy.position.copy(sourceCanopy.position);
    canopy.add(branches.clone());
    const sprays = sourceCanopy.children.filter(child => child instanceof THREE.Group);
    const foliageSources = sprays.map(spray => spray.children.find(child => child instanceof THREE.InstancedMesh))
      .filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
    if (foliageSources.length !== 8) throw new Error('Source olive model lacks eight leaf sprays');
    const count = foliageSources.reduce((sum, foliage) => sum + Math.ceil(foliage.count / 2), 0);
    const foliage = new THREE.InstancedMesh(foliageSources[0].geometry, foliageSources[0].material, count);
    foliage.name = `Merged photographed-shape olive leaves ${index + 1}`;
    foliage.castShadow = false;
    const matrix = new THREE.Matrix4(), color = new THREE.Color();
    let output = 0;
    for (let sprayIndex = 0; sprayIndex < sprays.length; sprayIndex++) {
      const spray = sprays[sprayIndex], leaves = foliageSources[sprayIndex];
      spray.updateMatrix();
      for (let i = 0; i < leaves.count; i += 2) {
        leaves.getMatrixAt(i, matrix);
        matrix.premultiply(spray.matrix);
        foliage.setMatrixAt(output, matrix);
        if (leaves.instanceColor) { leaves.getColorAt(i, color); foliage.setColorAt(output, color); }
        output++;
      }
    }
    foliage.computeBoundingSphere();
    canopy.add(foliage);
    low.add(canopy);
    this.canopies.push(canopy);
    return low;
  }
}
