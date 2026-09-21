import * as THREE from 'three';
import { siteMaterial } from './SiteMaterials';

/** Real geometry beyond the unglazed left opening, with a small wind-driven canopy. */
export class ExteriorCourtyard extends THREE.Group {
  private readonly canopy = new THREE.Group();
  private readonly branchCrowns: THREE.Group[] = [];
  private windTime = 0;

  constructor() {
    super();
    this.name = 'Open-air residential construction courtyard';
    this.userData.studioEntityId = 'world:exterior-courtyard';
    const earth = siteMaterial('floor', 0xc4b59c, 4.8, 3.2);
    const plaster = siteMaterial('plaster', 0xf2e8d5, 2.6, 1.4);
    const concrete = siteMaterial('concrete', 0xdbd6c9, 1.8, 1.4);
    const recess = new THREE.MeshStandardMaterial({ color: 0x4b504a, roughness: 1 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x444844, metalness: .45, roughness: .65 });
    const bark = new THREE.MeshStandardMaterial({ color: 0x786a56, roughness: 1 });
    const leaves = new THREE.MeshStandardMaterial({ color: 0x697a55, roughness: 1, side: THREE.DoubleSide });

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

    block('Compacted courtyard ground', earth, -11.7, -.105, 0, 15.7, .21, 17, false);
    // Separate concrete pads and a low curb establish measurable distances
    // between the nearby opening, planting strip and neighbouring building.
    const padGeometry = new THREE.BoxGeometry(.78, .055, .82);
    const pads = new THREE.InstancedMesh(padGeometry, concrete, 15);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 15; i++) {
      matrix.makeTranslation(-4.7 - Math.floor(i / 3) * .88, -.006, -1.18 + (i % 3) * .92);
      pads.setMatrixAt(i, matrix);
    }
    pads.name = 'Separate walkable courtyard paving slabs';
    pads.receiveShadow = true; pads.raycast = () => undefined; pads.computeBoundingSphere(); this.add(pads);
    block('Raised planted verge', concrete, -6.6, .11, 2.80, 3.25, .22, .62);
    block('Dry soil in planted verge', earth, -6.6, .23, 2.80, 3.12, .025, .53, false);
    block('Courtyard boundary wall', new THREE.MeshStandardMaterial({color:0x898176,roughness:1}), -11.6, .63, 2.72, .36, 1.26, 3.8);
    block('Cast coping on boundary wall', concrete, -11.6, 1.31, 2.72, .49, .09, 3.95);
    const boundaryBricks = new THREE.InstancedMesh(new THREE.BoxGeometry(.045, .091, .235), siteMaterial('clay', 0xc59676), 168);
    for (let i = 0; i < 168; i++) {
      const row = Math.floor(i / 14), column = i % 14;
      matrix.makeTranslation(-11.385, .075 + row * .101, .91 + column * .263 + (row % 2) * .09);
      boundaryBricks.setMatrixAt(i, matrix);
    }
    boundaryBricks.name = 'Individual clay courses on courtyard boundary';
    boundaryBricks.castShadow = boundaryBricks.receiveShadow = true;
    boundaryBricks.raycast = () => undefined; boundaryBricks.computeBoundingSphere(); this.add(boundaryBricks);
    const grass = new THREE.InstancedMesh(new THREE.ConeGeometry(.024, .30, 4), new THREE.MeshStandardMaterial({color:0x788363,roughness:1,side:THREE.DoubleSide}), 55);
    const grassTint = new THREE.Color();
    for (let i = 0; i < 55; i++) {
      const x = -8.02 + i * .053, z = 2.8 + Math.sin(i * 2.17) * .15;
      matrix.makeTranslation(x, .25 + (i % 6) * .018, z); grass.setMatrixAt(i, matrix);
      grass.setColorAt(i, grassTint.setRGB(.79+i%4*.025, .82+i%5*.025, .65+i%3*.04));
    }
    grass.name = 'Sparse plants in soil around olive trunk'; grass.raycast = () => undefined;
    grass.computeBoundingSphere(); this.add(grass);

    // The facing unfinished house has real open bays: each storey is built
    // from masonry strips and piers, not window decals on an unbroken plane.
    const neighbour = new THREE.Group(); neighbour.name = 'Offset adjacent residential block';
    neighbour.position.z = -4.2; this.add(neighbour); parent = neighbour;
    const facadeX = -11.15, wallThickness = .31, facadeWidth = 10.4;
    for (const storey of [0, 1]) {
      const base = storey * 2.64;
      block('Neighbour facade below open bays', plaster, facadeX, base + .43, 0, wallThickness, .86, facadeWidth);
      block('Neighbour facade lintel band', plaster, facadeX, base + 2.40, 0, wallThickness, .48, facadeWidth);
      for (const [z, width] of [[-4.415, 1.57], [-.25, 2.44], [4.165, 2.07]] as const)
        block('Solid masonry between neighbouring openings', plaster, facadeX, base + 1.52, z, wallThickness, 1.10, width);
      for (const z of [-2.55, 2.05]) {
        block('Deep unglazed room behind exterior opening', recess, facadeX - .30, base + 1.52, z, .035, 1.10, 2.16, false);
        block('Cast sill under exterior opening', concrete, facadeX + .04, base + .86, z, .46, .09, 2.28);
        block('Cast lintel over exterior opening', concrete, facadeX + .04, base + 2.11, z, .46, .12, 2.28);
      }
      block('Exposed horizontal concrete frame', concrete, facadeX + .18, base + 2.62, 0, .67, .18, facadeWidth + .15);
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
    // Beyond the low brick boundary, a second residence has its own depth,
    // punched apertures and roof profile. No broad background wall is used.
    const farHouse = new THREE.Group(); farHouse.name = 'Residence beyond courtyard boundary';
    farHouse.position.set(-13.3, 0, 2.1); this.add(farHouse); parent = farHouse;
    const warmPlaster = siteMaterial('plaster', 0xe0bb98, 1.9, 1.2);
    const darkInside = new THREE.MeshStandardMaterial({ color: 0x464137, roughness: 1 });
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
    for (const z of [-1.79, 0, 1.79]) {
      farBlock(darkInside, -.24, 1.51, z, .025, 1.24, .97);
      farBlock(concrete, .09, .91, z, .50, .075, 1.06);
      farBlock(concrete, -.035, 1.51, z - .52, .26, 1.24, .055);
      farBlock(concrete, -.035, 1.51, z + .52, .26, 1.24, .055);
    }
    farBlock(concrete, .12, 2.52, 0, .66, .17, 6.55);
    farBlock(warmPlaster, 0, 3.32, 0, .32, 1.40, 6.3);
    farBlock(terracotta, .10, 4.18, 0, .68, .18, 6.72);
    farBlock(warmPlaster, -.10, 4.47, 0, .29, .43, 6.3);
    for (const [material, shapes] of farShapes) {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, shapes.length);
      mesh.name = `Batched far-residence ${material.name || material.type} structure`;
      for (let i = 0; i < shapes.length; i++) {
        const shape = shapes[i];
        mesh.setMatrixAt(i, matrix.compose(shape.position, new THREE.Quaternion(), shape.scale));
      }
      mesh.castShadow = material !== darkInside; mesh.receiveShadow = true;
      mesh.raycast = () => undefined; mesh.computeBoundingSphere(); farHouse.add(mesh);
    }
    const drain = new THREE.Mesh(new THREE.CylinderGeometry(.037, .037, 4.1, 8), steel);
    drain.name = 'Rainwater downpipe with wall offset'; drain.position.set(.23, 2.05, 2.88);
    drain.castShadow = true; drain.raycast = () => undefined; farHouse.add(drain);
    parent = this;

    // A pruned olive tree contributes near/mid/far parallax and gentle motion.
    const tree = new THREE.Group(); tree.name = 'Olive tree outside unfinished opening'; tree.position.set(-6.35, 0, 2.80); this.add(tree);
    const trunkPoints = [new THREE.Vector3(0,0,0), new THREE.Vector3(.09,.38,.01), new THREE.Vector3(-.06,.87,.07), new THREE.Vector3(.07,1.43,0)];
    const trunk = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trunkPoints), 22, .105, 9, false), bark);
    trunk.castShadow = true; tree.add(trunk);
    this.canopy.position.set(.07, 1.43, 0); tree.add(this.canopy);
    const sprays = [[-.72,.44,-.25],[.70,.42,-.22],[-.47,.73,.35],[.50,.76,.36],[-.08,.87,-.43],[.06,.34,.53]] as const;
    for (const [x, y, z] of sprays) {
      const branch = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
        new THREE.Vector3(0,0,0), new THREE.Vector3(x*.42,y*.63,z*.34), new THREE.Vector3(x,y,z),
      ]), 12, .034, 6, false), bark);
      branch.castShadow = true; this.canopy.add(branch);
    }
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
        foliage.setColorAt(i, tint.setRGB(.72 + i % 5 * .022, .78 + i % 4 * .018, .69 + i % 3 * .025));
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
