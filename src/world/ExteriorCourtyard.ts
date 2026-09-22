import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { siteMaterial } from './SiteMaterials';
import { brickFacePatch } from './BrickFacePatch';
import { masonryFaceMaterial } from './BrickFaceMaterial';

/** Real geometry beyond the unglazed left opening, with a small wind-driven canopy. */
export class ExteriorCourtyard extends THREE.Group {
  private readonly canopy = new THREE.Group();
  private readonly branchCrowns: THREE.Group[] = [];
  private windTime = 0;

  constructor() {
    super();
    this.name = 'Open-air residential construction courtyard';
    this.userData.studioEntityId = 'world:exterior-courtyard';
    // Poly Haven gravelly sand is a 2.5 m-wide photographed outdoor surface.
    // The same scan covers the courtyard and the smaller planted verge at its
    // recorded physical scale, rather than tinting an interior cement floor.
    const groundAlbedo = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/site-materials/gravelly_sand-albedo-512.webp`);
    groundAlbedo.colorSpace = THREE.SRGBColorSpace;
    groundAlbedo.wrapS = groundAlbedo.wrapT = THREE.RepeatWrapping;
    // World-scaled UVs below preserve the 2.5 m scan size at every distance.
    groundAlbedo.repeat.set(1, 1);
    groundAlbedo.anisotropy = 4;
    const earth = new THREE.MeshStandardMaterial({ name: 'Photographed compacted courtyard gravel', map: groundAlbedo, roughness: 1 });
    const vergeAlbedo = groundAlbedo.clone();
    vergeAlbedo.repeat.set(3.12 / 2.5, .53 / 2.5);
    const vergeSoil = new THREE.MeshStandardMaterial({ name: 'Photographed dry planting soil', map: vergeAlbedo, roughness: 1 });
    const plaster = siteMaterial('plaster', 0xf2e8d5, 2.6, 1.4);
    const concrete = siteMaterial('concrete', 0xdbd6c9, 1.8, 1.4);
    const paving = siteMaterial('floor', 0xe2ddd4, .4, .4);
    const steel = new THREE.MeshStandardMaterial({ color: 0x444844, metalness: .45, roughness: .65 });
    const barkAlbedo = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/site-materials/bark-willow-512.webp`);
    barkAlbedo.colorSpace = THREE.SRGBColorSpace;
    barkAlbedo.wrapS = barkAlbedo.wrapT = THREE.RepeatWrapping;
    barkAlbedo.repeat.set(.35, .70);
    barkAlbedo.anisotropy = 4;
    const bark = new THREE.MeshStandardMaterial({ name: 'Weathered grey olive bark', map: barkAlbedo, color: 0xe8e2d7, roughness: 1 });
    const leaves = new THREE.MeshStandardMaterial({ color: 0x899981, roughness: 1, side: THREE.DoubleSide });

    // A vertex-coloured atmosphere is spatial sky geometry, not a view image.
    // It remains behind every building and tree as the player changes angle.
    const skyGeometry = new THREE.SphereGeometry(60, 32, 12);
    const skyPositions = skyGeometry.getAttribute('position');
    const skyColors: number[] = [];
    const horizon = new THREE.Color(0xb9cdd4), blue = new THREE.Color(0x78a8ca), skyColor = new THREE.Color();
    for (let i = 0; i < skyPositions.count; i++) {
      const height = THREE.MathUtils.clamp((skyPositions.getY(i) / 60 + .02) * 2.1, 0, 1);
      skyColor.copy(horizon).lerp(blue, height);
      skyColors.push(skyColor.r, skyColor.g, skyColor.b);
    }
    skyGeometry.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));
    const sky = new THREE.Mesh(skyGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.name = 'Atmospheric sky gradient behind modeled courtyard'; sky.raycast = () => undefined; this.add(sky);

    let parent: THREE.Group = this;
    const block = (name: string, material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, shadow = true) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
      mesh.name = name; mesh.position.set(x, y, z);
      mesh.castShadow = shadow; mesh.receiveShadow = true;
      mesh.raycast = () => undefined;
      parent.add(mesh); return mesh;
    };

    // Use dense spacing beside the playable room and progressively wider
    // cells toward the horizon. A short rectangular ground plane exposed its
    // edge as a bright wedge under the olive tree when viewed through the hole.
    const xValues = Array.from({ length: 17 }, (_, i) => -19.55 - 110 * (1 - i / 16) ** 2);
    for (let i = 1; i <= 32; i++) xValues.push(-19.55 + i * 15.7 / 32);
    const zValues = Array.from({ length: 11 }, (_, i) => -8.5 - 90 * (1 - i / 10) ** 2);
    for (let i = 1; i <= 34; i++) zValues.push(-8.5 + i * 17 / 34);
    for (let i = 1; i <= 10; i++) zValues.push(8.5 + 90 * (i / 10) ** 2);
    const groundVertices: number[] = [], groundUVs: number[] = [], groundIndices: number[] = [];
    const groundHeight = (x: number, z: number): number => {
      const localX = x + 11.7;
      return .010 * Math.sin(localX * .83 + z * .27) + .007 * Math.sin(z * 1.37 - localX * .41)
        + .003 * Math.sin(localX * 4.7 + z * 3.1);
    };
    for (const z of zValues) for (const x of xValues) {
      const localX = x + 11.7;
      groundVertices.push(x, groundHeight(x, z), z);
      groundUVs.push(localX / 2.5 + 15.7 / 5, z / 2.5 + 17 / 5);
    }
    for (let row = 0; row < zValues.length - 1; row++) for (let col = 0; col < xValues.length - 1; col++) {
      const a = row * xValues.length + col, b = a + xValues.length;
      groundIndices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const groundGeometry = new THREE.BufferGeometry();
    groundGeometry.setAttribute('position', new THREE.Float32BufferAttribute(groundVertices, 3));
    groundGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(groundUVs, 2));
    groundGeometry.setIndex(groundIndices);
    groundGeometry.computeVertexNormals();
    const ground = new THREE.Mesh(groundGeometry, earth);
    ground.name = 'Compacted courtyard ground';
    ground.receiveShadow = true;
    ground.raycast = () => undefined;
    this.add(ground);
    // Separate concrete pads and a low curb establish measurable distances
    // between the nearby opening, planting strip and neighbouring building.
    const padGeometry = new THREE.BoxGeometry(.78, .055, .82);
    const pads = new THREE.InstancedMesh(padGeometry, paving, 15);
    const matrix = new THREE.Matrix4();
    const padTint = new THREE.Color();
    for (let i = 0; i < 15; i++) {
      matrix.makeTranslation(-4.7 - Math.floor(i / 3) * .88, -.006, -1.18 + (i % 3) * .92);
      pads.setMatrixAt(i, matrix);
      const shade = .90 + ((i * .61803398875) % 1) * .10;
      pads.setColorAt(i, padTint.setRGB(shade, shade * .99, shade * .97));
    }
    pads.name = 'Separate walkable courtyard paving slabs';
    pads.receiveShadow = true; pads.raycast = () => undefined; pads.computeBoundingSphere(); this.add(pads);
    block('Raised planted verge', concrete, -6.6, .11, 2.80, 3.25, .22, .62);
    block('Dry soil in planted verge', vergeSoil, -6.6, .23, 2.80, 3.12, .025, .53, false);
    block('Courtyard boundary wall', new THREE.MeshStandardMaterial({color:0x898176,roughness:1}), -11.6, .63, 2.72, .36, 1.26, 3.8);
    block('Cast coping on boundary wall', concrete, -11.6, 1.31, 2.72, .49, .09, 3.95);
    const boundaryGeometry = new THREE.BoxGeometry(.045, .091, .235);
    const boundaryPatches = new Float32Array(168 * 4);
    boundaryGeometry.setAttribute('brickPatch', new THREE.InstancedBufferAttribute(boundaryPatches, 4));
    const boundaryBricks = new THREE.InstancedMesh(boundaryGeometry, masonryFaceMaterial, 168);
    for (let i = 0; i < 168; i++) {
      const row = Math.floor(i / 14), column = i % 14;
      matrix.makeTranslation(-11.385, .075 + row * .101, .91 + column * .263 + (row % 2) * .09);
      boundaryBricks.setMatrixAt(i, matrix);
      boundaryPatches.set(brickFacePatch(row, column, 4), i * 4);
    }
    boundaryBricks.name = 'Individual clay courses on courtyard boundary';
    boundaryBricks.castShadow = boundaryBricks.receiveShadow = true;
    boundaryBricks.raycast = () => undefined; boundaryBricks.computeBoundingSphere(); this.add(boundaryBricks);
    const grass = new THREE.InstancedMesh(new THREE.ConeGeometry(.024, .30, 4), new THREE.MeshStandardMaterial({color:0x788363,roughness:1,side:THREE.DoubleSide}), 55);
    const grassTint = new THREE.Color();
    const grassPosition = new THREE.Vector3(), grassRotation = new THREE.Quaternion(), grassScale = new THREE.Vector3();
    for (let i = 0; i < 55; i++) {
      const x = -8.05 + ((i * .61803398875) % 1) * 2.90;
      const z = 2.8 + Math.sin(i * 2.17) * .20;
      const height = .10 + ((i * .41421356237) % 1) * .15;
      grassPosition.set(x, .24 + height / 2, z);
      grassRotation.setFromEuler(new THREE.Euler(Math.sin(i * 1.37) * .24, i * 2.40, Math.cos(i * 1.91) * .20));
      grassScale.set(.65 + i % 3 * .11, height / .30, .65 + i % 4 * .08);
      grass.setMatrixAt(i, matrix.compose(grassPosition, grassRotation, grassScale));
      grass.setColorAt(i, grassTint.setRGB(.72+i%4*.025, .78+i%5*.025, .62+i%3*.04));
    }
    grass.name = 'Sparse plants in soil around olive trunk'; grass.raycast = () => undefined;
    grass.computeBoundingSphere(); this.add(grass);

    // The facing unfinished house has real open bays: each storey is built
    // from masonry strips and piers, not window decals on an unbroken plane.
    const neighbour = new THREE.Group(); neighbour.name = 'Offset adjacent residential block';
    neighbour.position.z = -4.2; this.add(neighbour); parent = neighbour;
    const facadeX = -11.15, wallThickness = .31, facadeWidth = 10.4;
    const bayBackMaterial = siteMaterial('plaster', 0xb7b6aa, 1.3, .8);
    const baySideMaterial = siteMaterial('plaster', 0xd2cabe, 1.1, .8);
    const baySideWalls: Array<{ x: number; y: number; z: number; sx: number; sy: number; sz: number }> = [];
    const baySlabs: typeof baySideWalls = [];
    const bayBacks: typeof baySideWalls = [];
    const addBaySurface = (parts: typeof baySideWalls, x: number, y: number, z: number, sx: number, sy: number, sz: number) =>
      parts.push({ x, y, z, sx, sy, sz });
    for (const storey of [0, 1]) {
      const base = storey * 2.64;
      block('Neighbour facade below open bays', plaster, facadeX, base + .43, 0, wallThickness, .86, facadeWidth);
      block('Neighbour facade lintel band', plaster, facadeX, base + 2.40, 0, wallThickness, .48, facadeWidth);
      for (const [z, width] of [[-4.415, 1.57], [-.25, 2.44], [4.165, 2.07]] as const)
        block('Solid masonry between neighbouring openings', plaster, facadeX, base + 1.51, z, wallThickness, 1.30, width);
      for (const z of [-2.55, 2.05]) {
        // The aperture opens into a real 1.5 m-deep unfinished room. Its side
        // returns, floor and ceiling move against the rear wall with parallax.
        addBaySurface(bayBacks, facadeX - 1.51, base + 1.51, z, .12, 1.30, 2.16);
        for (const edge of [-1, 1])
          addBaySurface(baySideWalls, facadeX - .78, base + 1.51, z + edge * 1.04, 1.48, 1.30, .12);
        addBaySurface(baySlabs, facadeX - .78, base + .855, z, 1.48, .09, 2.16);
        addBaySurface(baySlabs, facadeX - .78, base + 2.165, z, 1.48, .09, 2.16);
        block('Cast sill under exterior opening', concrete, facadeX + .04, base + .86, z, .46, .09, 2.28);
        block('Cast lintel over exterior opening', concrete, facadeX + .04, base + 2.11, z, .46, .12, 2.28);
      }
      block('Exposed horizontal concrete frame', concrete, facadeX + .18, base + 2.62, 0, .67, .18, facadeWidth + .15);
    }
    for (const [name, material, parts] of [
      ['Recessed plaster rear walls in open bays', bayBackMaterial, bayBacks],
      ['Plastered side returns inside open bays', baySideMaterial, baySideWalls],
      ['Structural slab returns inside open bays', concrete, baySlabs],
    ] as const) {
      const interiors = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, parts.length);
      interiors.name = name;
      for (let i = 0; i < parts.length; i++) {
        const { x, y, z, sx, sy, sz } = parts[i];
        interiors.setMatrixAt(i, matrix.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz)));
      }
      interiors.receiveShadow = true;
      interiors.raycast = () => undefined;
      interiors.computeBoundingSphere(); neighbour.add(interiors);
    }
    for (const z of [-5.12, -.25, 5.12])
      block('Neighbouring reinforced-concrete pier', concrete, facadeX + .10, 2.68, z, .51, 5.36, .26);
    block('Overhanging unfinished roof slab', concrete, facadeX + .28, 5.40, 0, 1.15, .23, facadeWidth + .42);
    // A short balcony sits in front of the upper floor and its steel rail has
    // depth and a shadow; it does not close the apertures with glass.
    block('Upper balcony slab', concrete, facadeX + .60, 2.69, 0, 1.05, .13, 7.5);
    const rail = new THREE.InstancedMesh(new THREE.CylinderGeometry(.013, .013, 1, 7), steel, 19);
    for (let i = 0; i < 19; i++) rail.setMatrixAt(i, matrix.makeTranslation(facadeX + 1.07, 3.18, -3.54 + i * .393));
    rail.name = 'Individual balcony railing uprights'; rail.castShadow = true; rail.raycast = () => undefined;
    rail.computeBoundingSphere(); neighbour.add(rail);
    block('Balcony top rail', steel, facadeX + 1.07, 3.66, 0, .033, .032, 7.35);
    // Each cast/plastered piece must sample the scan at one world-space scale.
    // Repeating the full photograph on a 9 cm sill and a 10 m facade made the
    // formwork grain change size abruptly at every structural connection.
    const continuousPlaster = siteMaterial('plaster', 0xf2e8d5);
    const continuousConcrete = siteMaterial('concrete', 0xf0ece5);
    if (continuousConcrete.map) {
      continuousConcrete.map = continuousConcrete.map.clone();
      continuousConcrete.map.offset.x = .18;
    }
    neighbour.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
      if (object.material !== plaster && object.material !== concrete) return;
      const positions = object.geometry.getAttribute('position');
      const normals = object.geometry.getAttribute('normal');
      const uvs = object.geometry.getAttribute('uv');
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i) + object.position.x;
        const y = positions.getY(i) + object.position.y;
        const z = positions.getZ(i) + object.position.z;
        const nx = Math.abs(normals.getX(i)), ny = Math.abs(normals.getY(i));
        if (ny > .5) uvs.setXY(i, x / 4, z / 4);
        else uvs.setXY(i, (nx > .5 ? z : x) / 4, y / 4);
      }
      object.material = object.material === plaster ? continuousPlaster : continuousConcrete;
    });
    // Beyond the low brick boundary, a single-storey residence has its own
    // depth and punched apertures. Its lower roof leaves actual sky visible
    // through the room's open window instead of filling it with a facade.
    const farHouse = new THREE.Group(); farHouse.name = 'Residence beyond courtyard boundary';
    farHouse.position.set(-13.3, 0, 2.1); this.add(farHouse); parent = farHouse;
    const warmPlaster = siteMaterial('plaster', 0xe0bb98, 1.9, 1.2);
    const roomPlaster = siteMaterial('plaster', 0xc2b8aa, 1.4, 1.1);
    const terracotta = siteMaterial('clay', 0xb97255, 1.3, 1);
    const farShapes = new Map<THREE.Material, Array<{ position: THREE.Vector3; scale: THREE.Vector3 }>>();
    const farBlock = (material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): void => {
      const shapes = farShapes.get(material) ?? [];
      shapes.push({ position: new THREE.Vector3(x, y, z), scale: new THREE.Vector3(sx, sy, sz) });
      farShapes.set(material, shapes);
    };
    farBlock(warmPlaster, 0, .55, 0, .32, 1.1, 6.3);
    farBlock(warmPlaster, 0, 2.27, 0, .32, .42, 6.3);
    for (const [z, width] of [[-2.68, .94], [-.87, .83], [.94, .83], [2.68, .94]] as const)
      farBlock(warmPlaster, 0, 1.51, z, .32, 1.24, width);
    // The one-storey house has a three-metre shell behind the front masonry,
    // with separate unfinished rooms visible through its unglazed openings.
    farBlock(roomPlaster, -2.75, 1.30, 0, .22, 2.60, 6.3);
    for (const z of [-3.10, -.895, .895, 3.10])
      farBlock(roomPlaster, -1.37, 1.30, z, 2.75, 2.60, .16);
    farBlock(concrete, -1.37, .085, 0, 2.95, .17, 6.45);
    for (const z of [-1.79, 0, 1.79]) {
      farBlock(concrete, .09, .91, z, .50, .075, 1.06);
      farBlock(concrete, -.035, 1.51, z - .52, .26, 1.24, .055);
      farBlock(concrete, -.035, 1.51, z + .52, .26, 1.24, .055);
      farBlock(roomPlaster, -.84, 1.51, z - .50, 1.55, 1.24, .09);
      farBlock(roomPlaster, -.84, 1.51, z + .50, 1.55, 1.24, .09);
      farBlock(concrete, -.84, .875, z, 1.55, .09, .98);
      farBlock(concrete, -.84, 2.145, z, 1.55, .09, .98);
    }
    farBlock(concrete, -1.20, 2.52, 0, 3.50, .17, 6.55);
    farBlock(terracotta, .10, 2.65, 0, .68, .12, 6.72);
    for (const [material, shapes] of farShapes) {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, shapes.length);
      mesh.name = `Batched far-residence ${material.name || material.type} structure`;
      for (let i = 0; i < shapes.length; i++) {
        const shape = shapes[i];
        mesh.setMatrixAt(i, matrix.compose(shape.position, new THREE.Quaternion(), shape.scale));
      }
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.raycast = () => undefined; mesh.computeBoundingSphere(); farHouse.add(mesh);
    }
    const drain = new THREE.Mesh(new THREE.CylinderGeometry(.037, .037, 2.65, 8), steel);
    drain.name = 'Rainwater downpipe with wall offset'; drain.position.set(.23, 1.325, 2.88);
    drain.castShadow = true; drain.raycast = () => undefined; farHouse.add(drain);
    parent = this;

    // A pruned olive tree contributes near/mid/far parallax and gentle motion.
    const tree = new THREE.Group(); tree.name = 'Olive tree outside unfinished opening'; tree.position.set(-6.35, 0, 2.80); this.add(tree);
    const trunkProfile = [
      [.205, 0], [.178, .12], [.151, .37], [.137, .73], [.123, 1.04], [.099, 1.32], [.073, 1.57],
    ].map(([radius, height]) => new THREE.Vector2(radius, height));
    const trunkGeometry = new THREE.LatheGeometry(trunkProfile, 14);
    const trunkPositions = trunkGeometry.getAttribute('position');
    for (let i = 0; i < trunkPositions.count; i++) {
      const x = trunkPositions.getX(i), y = trunkPositions.getY(i), z = trunkPositions.getZ(i);
      const angle = Math.atan2(z, x);
      const furrow = 1 + .055 * Math.sin(angle * 5 + y * 5.1) + .028 * Math.sin(angle * 9 - y * 8.3);
      trunkPositions.setXYZ(i, x * furrow + .045 * Math.sin(y * 3.3), y, z * furrow + .035 * Math.sin(y * 4.2 + .6));
    }
    trunkGeometry.computeVertexNormals();
    const woodyParts: THREE.BufferGeometry[] = [trunkGeometry];
    for (const [start, bend, tip, radius] of [
      [[.03, 1.13, 0], [-.27, 1.52, -.12], [-.69, 1.88, -.24], .073],
      [[.05, 1.23, 0], [.30, 1.56, -.08], [.72, 1.85, -.20], .068],
      [[.02, 1.36, .02], [.12, 1.70, .22], [.52, 2.15, .36], .055],
    ] as const) {
      woodyParts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
        new THREE.Vector3(...start), new THREE.Vector3(...bend), new THREE.Vector3(...tip),
      ]), 14, radius, 7, false));
    }
    const woodyGeometry = mergeGeometries(woodyParts);
    woodyParts.forEach(geometry => geometry.dispose());
    if (!woodyGeometry) throw new Error('Olive trunk geometry could not be merged');
    const trunk = new THREE.Mesh(woodyGeometry, bark);
    trunk.name = 'Tapered forked weathered olive trunk';
    trunk.castShadow = true; tree.add(trunk);
    this.canopy.position.set(.07, 1.43, 0); tree.add(this.canopy);
    const sprays = [[-.72,.44,-.25],[.70,.42,-.22],[-.47,.73,.35],[.50,.76,.36],[-.08,.87,-.43],[.06,.34,.53]] as const;
    const sprayBranches = sprays.map(([x, y, z]) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
        new THREE.Vector3(0,0,0), new THREE.Vector3(x*.42,y*.63,z*.34), new THREE.Vector3(x,y,z),
      ]), 12, .034, 6, false));
    const branchGeometry = mergeGeometries(sprayBranches);
    sprayBranches.forEach(geometry => geometry.dispose());
    if (!branchGeometry) throw new Error('Olive canopy branch geometry could not be merged');
    const branches = new THREE.Mesh(branchGeometry, bark);
    branches.name = 'Forked olive canopy limbs'; branches.castShadow = true; this.canopy.add(branches);
    // Kew describes narrow, leathery 2–9.5 cm blades with pale undersides.
    // Each low-poly blade is about 7 cm long and 1.2 cm wide, rather than a
    // quarter-metre triangular silhouette. Six instanced sprays keep draw cost
    // bounded while each crown responds independently to wind.
    const leafGeometry = new THREE.BufferGeometry();
    const leafVertices: number[] = [];
    for (let leaf = 0; leaf < 7; leaf++) {
      const centerX = (leaf - 3) * .022, centerY = (leaf % 2 ? .015 : -.015), centerZ = (leaf % 3 - 1) * .018;
      const direction = leaf % 2 ? .61 : -.61;
      const point = (x: number, y: number): [number, number, number] => [
        centerX + x * Math.cos(direction) - y * Math.sin(direction),
        centerY + x * Math.sin(direction) + y * Math.cos(direction),
        centerZ + x * .17,
      ];
      const stem = point(0, -.035), leftLow = point(-.004, -.018), leftWide = point(-.006, .003);
      const tip = point(0, .036), rightWide = point(.006, .003), rightLow = point(.004, -.018);
      for (const vertex of [stem,leftLow,leftWide, stem,leftWide,tip, stem,tip,rightWide, stem,rightWide,rightLow])
        leafVertices.push(...vertex);
    }
    leafGeometry.setAttribute('position', new THREE.Float32BufferAttribute(leafVertices, 3));
    leafGeometry.computeVertexNormals();
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(), tint = new THREE.Color();
    for (let sprayIndex = 0; sprayIndex < sprays.length; sprayIndex++) {
      const [sx, sy, sz] = sprays[sprayIndex];
      const crown = new THREE.Group(); crown.position.set(sx, sy, sz);
      crown.name = `Wind-responsive olive branch ${sprayIndex + 1}`;
      this.canopy.add(crown); this.branchCrowns.push(crown);
      const twig = new THREE.Mesh(new THREE.CylinderGeometry(.003, .012, .69, 5), bark);
      twig.position.y = -.20; twig.rotation.z = (sprayIndex % 2 ? -1 : 1) * .35;
      crown.add(twig);
      const foliage = new THREE.InstancedMesh(leafGeometry, leaves, 270);
      for (let i = 0; i < 270; i++) {
        const angle = i * 2.39996 + sprayIndex * 1.37;
        const radial = Math.sqrt((i + .5) / 270);
        position.set(Math.cos(angle) * radial * .37, Math.sin(i * 1.71 + sprayIndex) * .27, Math.sin(angle) * radial * .28);
        quaternion.setFromEuler(new THREE.Euler(.38 * Math.sin(i * 2.11), angle + .42, .9 * Math.sin(i * 1.37)));
        scale.setScalar(.72 + i % 5 * .095);
        matrix.compose(position, quaternion, scale); foliage.setMatrixAt(i, matrix);
        foliage.setColorAt(i, tint.setRGB(.80 + i % 5 * .026, .85 + i % 4 * .021, .78 + i % 3 * .031));
      }
      foliage.name = `Narrow silver-backed olive leaves ${sprayIndex + 1}`;
      foliage.castShadow = false; foliage.raycast = () => undefined;
      foliage.computeBoundingSphere(); crown.add(foliage);
    }
  }

  update(dt: number): void {
    this.windTime += Math.min(.05, Math.max(0, dt));
    this.canopy.rotation.z = .016 * Math.sin(this.windTime * 1.25) + .006 * Math.sin(this.windTime * 2.7);
    this.canopy.rotation.x = .011 * Math.sin(this.windTime * .91 + .7);
    for (let i = 0; i < this.branchCrowns.length; i++) {
      const crown = this.branchCrowns[i];
      crown.rotation.z = .026 * Math.sin(this.windTime * (1.31 + i * .09) + i * 1.2);
      crown.rotation.x = .019 * Math.sin(this.windTime * (.83 + i * .07) + i * .8);
    }
  }
}
