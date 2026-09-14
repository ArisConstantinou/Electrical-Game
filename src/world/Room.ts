import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';
import { INSTALLATION_POINTS } from '../data/installationRules';
import { BrickWall } from './BrickWall';
import { addLighting } from './Lighting';
import { matteMaterial, siteMaterial } from './SiteMaterials';

export class Room extends THREE.Group {
  readonly brickWall: BrickWall;
  readonly referenceWalls: THREE.Object3D[] = [];

  constructor(scene: THREE.Scene) {
    super();
    this.name = 'Living room first-fix site';
    this.userData.studioEntityId = 'world:living-room';
    this.brickWall = new BrickWall(INSTALLATION_POINTS);
    this.add(this.brickWall);

    const floor = new THREE.Mesh(new THREE.BoxGeometry(GAME_CONFIG.room.width, 0.12, GAME_CONFIG.room.depth), siteMaterial('floor', 0xa39d90, 4, 3.4));
    floor.position.y = -0.06;
    floor.name = 'Rough unfinished concrete floor';
    floor.userData.studioEntityId = 'world:floor';
    floor.receiveShadow = true;
    this.add(floor);

    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(GAME_CONFIG.room.width, 0.16, GAME_CONFIG.room.depth), siteMaterial('concrete', 0xafada5, 5, 4));
    ceiling.position.y = GAME_CONFIG.room.height + 0.08;
    ceiling.name = 'Concrete slab ceiling';
    ceiling.userData.studioEntityId = 'world:ceiling';
    ceiling.receiveShadow = true;
    this.add(ceiling);

    const sideMaterial = siteMaterial('plaster', 0xaca89d, 2.2, 3.4);
    sideMaterial.userData.referenceLaserReceiver=true;
    const sideGeometry = new THREE.BoxGeometry(0.22, GAME_CONFIG.room.height, GAME_CONFIG.room.depth);
    for (const [name, x] of [['Left concrete wall', -GAME_CONFIG.room.width / 2 - 0.11], ['Right concrete wall', GAME_CONFIG.room.width / 2 + 0.11]] as const) {
      const side = new THREE.Mesh(sideGeometry, sideMaterial);
      side.position.set(x, GAME_CONFIG.room.height / 2, 0);
      side.name = name;
      side.userData.studioEntityId = `world:${name.toLowerCase().replaceAll(' ', '-')}`;
      side.receiveShadow = true;
      this.referenceWalls.push(side);
      this.add(side);
    }

    const columnMaterial = siteMaterial('concrete', 0xa7a69d, .7, 5);
    columnMaterial.userData.referenceLaserReceiver=true;
    for (const x of [-2.72, 2.72]) {
      const column = new THREE.Mesh(new THREE.BoxGeometry(0.36, GAME_CONFIG.room.height, 0.38), columnMaterial);
      column.position.set(x, GAME_CONFIG.room.height / 2, -2.37);
      column.name = 'Structural concrete column';
      column.userData.studioEntityId = `world:column:${x}`;
      column.castShadow = true;
      column.receiveShadow = true;
      this.referenceWalls.push(column);
      this.add(column);
    }

    this.addFormworkMarks();
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

  private addFormworkMarks(): void {
    const marks = new THREE.Group();
    marks.name = 'Shallow concrete formwork imprints';
    marks.userData.studioEntityId = 'world:concrete-formwork-imprints';
    const segments: Array<{ position: THREE.Vector3; size: THREE.Vector3 }> = [];
    // Fine board junctions remain surface marks on the existing solid slab.
    for (let x = -2.4; x < 3; x += 1.2) segments.push({ position: new THREE.Vector3(x, GAME_CONFIG.room.height - .001, 0), size: new THREE.Vector3(.003, .001, 5) });
    for (let z = -1.9; z < 2.5; z += 1.2) segments.push({ position: new THREE.Vector3(0, GAME_CONFIG.room.height - .001, z), size: new THREE.Vector3(6, .001, .003) });
    for (const x of [-2.72, 2.72]) for (const y of [.73, 1.47, 2.21]) segments.push({ position: new THREE.Vector3(x, y, -2.179), size: new THREE.Vector3(.36, .0025, .001) });
    const seams = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), matteMaterial(0x93938b), segments.length);
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
