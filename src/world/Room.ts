import * as THREE from 'three';
import { GAME_CONFIG } from '../data/gameConfig';
import { INSTALLATION_POINTS } from '../data/installationRules';
import { BrickWall } from './BrickWall';
import { addLighting } from './Lighting';
import { matteMaterial, siteMaterial } from './SiteMaterials';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export class Room extends THREE.Group {
  readonly brickWall: BrickWall;
  readonly intactPracticeWall: BrickWall;
  readonly referenceWalls: THREE.Object3D[] = [];

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

    const floor = new THREE.Mesh(new THREE.BoxGeometry(GAME_CONFIG.room.width, 0.12, GAME_CONFIG.room.depth), siteMaterial('floor', 0xffffff, 3.6, 3.4));
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

    // These are unfinished structural returns, cast with the slab and piers.
    // Give them the same concrete aggregate and tint; the rear lift remains
    // plaster because its exposed brick edge explains the different finish.
    const sideMaterial = siteMaterial('concrete', 0xf0ede7, 1.8, .75);
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

  private addRearWall(): void {
    // The player already stops at this elevation. Keep the room enclosed until
    // a real exterior scene can be built and tested behind any future opening.
    const rearZ = GAME_CONFIG.room.depth / 2;
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(GAME_CONFIG.room.width, GAME_CONFIG.room.height, .16),
      matteMaterial(0x827b70),
    );
    wall.name = 'Unfinished rear plaster wall';
    wall.userData.studioEntityId = 'world:rear-wall';
    wall.userData.referenceLaserReceiver = true;
    wall.position.set(0, GAME_CONFIG.room.height / 2, rearZ + .08);
    wall.receiveShadow = true;
    this.referenceWalls.push(wall);
    this.add(wall);

    // Staggered, individually three-dimensional clay courses behind a partly
    // finished plaster lift. The masonry and the plaster do not share a flat
    // photographic plane: their edges cast shadows at the actual transition.
    const brickWidth = .235, course = .094, gap = .012;
    const columns = 16, rows = 31;
    const brickGeometry = new THREE.BoxGeometry(brickWidth - gap, course - gap, .085);
    const brickMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/masonry/brick-face-site.webp`), roughness: 1,
    });
    brickMaterial.map!.colorSpace = THREE.SRGBColorSpace;
    const bricks = new THREE.InstancedMesh(brickGeometry, brickMaterial, columns * rows);
    bricks.name = 'Exposed staggered rear clay courses';
    bricks.userData.studioEntityId = 'world:rear-exposed-masonry';
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1);
    const shade = new THREE.Color();
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      position.set(-GAME_CONFIG.room.width / 2 + .12 + column * brickWidth + (row % 2) * brickWidth / 2, .055 + row * course, rearZ - .043);
      matrix.compose(position, rotation, scale);
      bricks.setMatrixAt(index, matrix);
      bricks.setColorAt(index, shade.setRGB(.88 + (index * 7 % 5) * .026, .86 + (index * 11 % 4) * .025, .82 + (index * 13 % 5) * .018));
    }
    bricks.castShadow = bricks.receiveShadow = true;
    bricks.computeBoundingSphere();
    bricks.raycast = () => undefined;
    this.add(bricks);

    const plasterShape = new THREE.Shape();
    plasterShape.moveTo(-.86, 0);
    plasterShape.lineTo(3.8, 0);
    plasterShape.lineTo(3.8, 3);
    plasterShape.lineTo(-.84, 3);
    for (let y = 2.88; y >= .12; y -= .12) {
      const edge = -.89 + Math.sin(y * 11.7) * .035 + Math.sin(y * 24.1) * .014;
      plasterShape.lineTo(edge, y);
    }
    plasterShape.closePath();
    const plasterGeometry = new THREE.ExtrudeGeometry(plasterShape, {depth: .024, bevelEnabled: true, bevelSize: .006, bevelThickness: .004, bevelSegments: 1, curveSegments: 1});
    const plaster = new THREE.Mesh(plasterGeometry, siteMaterial('plaster', 0xf5f1eb, .25, .25));
    plaster.position.z = rearZ - .111;
    plaster.name = 'Trowelled plaster lift with unfinished masonry edge';
    plaster.userData.studioEntityId = 'world:rear-plaster-lift';
    plaster.castShadow = plaster.receiveShadow = true;
    plaster.raycast = () => undefined;
    this.add(plaster);

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

    const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), siteMaterial('concrete', 0xf0ede7, 1, .15), 3);
    for (const [index, z] of [-2.65, .1, 2.65].entries()) {
      transform.compose(new THREE.Vector3(0, GAME_CONFIG.room.height - .085, z), new THREE.Quaternion(), new THREE.Vector3(width, .17, .24));
      beams.setMatrixAt(index, transform);
    }
    beams.name = 'Downstand concrete ceiling beams';
    beams.castShadow = beams.receiveShadow = true;
    beams.raycast = () => undefined;
    beams.computeBoundingSphere();
    this.add(beams);
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
    // Repeated shutter panel joints continue from the slab onto both cast
    // side walls. They establish construction scale instead of leaving the
    // large concrete surfaces as uninterrupted texture planes.
    for(const x of [-3.795,3.795]){
      for(const z of [-2.4,-1.2,0,1.2,2.4])segments.push({position:new THREE.Vector3(x,1.5,z),size:new THREE.Vector3(.0015,2.97,.0025)});
      for(const y of [1.2,2.4])segments.push({position:new THREE.Vector3(x,y,0),size:new THREE.Vector3(.0015,.0025,7.05)});
    }
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
