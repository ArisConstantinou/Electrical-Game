import * as THREE from 'three';
import { siteMaterial } from './SiteMaterials';

/** Real geometry beyond the unglazed left opening, with a small wind-driven canopy. */
export class ExteriorCourtyard extends THREE.Group {
  private readonly canopy = new THREE.Group();
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
    const horizon = new THREE.Color(0xe2e4dd), blue = new THREE.Color(0x82b5d3), skyColor = new THREE.Color();
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
    block('Distant warm wall past courtyard', plaster, -16.8, 2.0, 0, .35, 4, 18);
    parent = this;

    // A pruned olive tree contributes near/mid/far parallax and gentle motion.
    const tree = new THREE.Group(); tree.name = 'Olive tree outside unfinished opening'; tree.position.set(-6.35, 0, 2.80); this.add(tree);
    const trunkPoints = [new THREE.Vector3(0,0,0), new THREE.Vector3(.03,.48,0), new THREE.Vector3(-.08,1.05,.03), new THREE.Vector3(.04,1.64,0)];
    const trunk = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trunkPoints), 18, .09, 7, false), bark);
    trunk.castShadow = true; tree.add(trunk);
    this.canopy.position.set(.04, 1.59, 0); tree.add(this.canopy);
    for (const [x, y, z] of [[-.65,.48,-.23],[.66,.40,-.17],[-.35,.79,.35],[.41,.83,.41]] as const) {
      const branch = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
        new THREE.Vector3(0,0,0), new THREE.Vector3(x*.45,y*.45,z*.45), new THREE.Vector3(x,y,z),
      ]), 10, .028, 5, false), bark);
      branch.castShadow = true; this.canopy.add(branch);
    }
    const leafGeometry = new THREE.BufferGeometry();
    leafGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0,-.105,0, -.042,0,.018, 0,.145,0,
      0,-.105,0, 0,.145,0, .042,0,.018,
    ], 3));
    leafGeometry.computeVertexNormals();
    const foliage = new THREE.InstancedMesh(leafGeometry, leaves, 188);
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(), tint = new THREE.Color();
    const sprays = [[-.65,.48,-.23],[.66,.40,-.17],[-.35,.79,.35],[.41,.83,.41]] as const;
    for (let i = 0; i < 188; i++) {
      const [sx, sy, sz] = sprays[i % sprays.length];
      const angle = i * 2.39996, radius = .08 + .37 * Math.sqrt((i % 47) / 47);
      position.set(sx + Math.cos(angle)*radius, sy + .21*Math.sin(i*1.71), sz + Math.sin(angle)*radius*.80);
      quaternion.setFromEuler(new THREE.Euler(.36*Math.sin(i*2.11), angle + .42, .65*Math.sin(i*1.37)));
      scale.setScalar(.72 + i%5*.095);
      matrix.compose(position, quaternion, scale); foliage.setMatrixAt(i, matrix);
      foliage.setColorAt(i, tint.setRGB(.73+i%5*.026, .79+i%4*.026, .67+i%3*.027));
    }
    foliage.name = 'Individual silver-green olive foliage clusters'; foliage.castShadow = true;
    foliage.raycast = () => undefined; foliage.computeBoundingSphere(); this.canopy.add(foliage);
  }

  update(dt: number): void {
    this.windTime += Math.min(.05, Math.max(0, dt));
    this.canopy.rotation.z = .016 * Math.sin(this.windTime * 1.25) + .006 * Math.sin(this.windTime * 2.7);
    this.canopy.rotation.x = .011 * Math.sin(this.windTime * .91 + .7);
  }
}
