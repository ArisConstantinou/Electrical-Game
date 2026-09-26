import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { batchStaticVisuals } from '../world/StaticVisualBatch';

type Point = readonly [number, number, number];
const vector = (p: Point) => new THREE.Vector3(...p);
const paint = (color: number, roughness = .62, metalness = .04) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

function piece(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, at: Point, name: string): THREE.Mesh {
  const item = new THREE.Mesh(geometry, material);
  item.name = name;
  item.position.set(...at);
  item.castShadow = true;
  item.receiveShadow = true;
  parent.add(item);
  return item;
}
function rod(parent: THREE.Object3D, a: Point, b: Point, radius: number, material: THREE.Material, name: string): THREE.Mesh {
  const start = vector(a), end = vector(b), axis = end.clone().sub(start);
  const item = piece(parent, new THREE.CylinderGeometry(radius, radius, axis.length(), 16), material, [0, 0, 0], name);
  item.position.copy(start).add(end).multiplyScalar(.5);
  item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
  return item;
}
function rail(parent: THREE.Object3D, path: Point[], radius: number, material: THREE.Material, name: string): void {
  piece(parent, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path.map(vector)), 32, radius, 10, false), material, [0, 0, 0], name);
}
function ring(parent: THREE.Object3D, at: Point, radius: number, thickness: number, material: THREE.Material, name: string): THREE.Mesh {
  return piece(parent, new THREE.TorusGeometry(radius, thickness, 8, 32), material, at, name);
}
function profiledHousing(parent: THREE.Object3D, outline: readonly (readonly [number, number])[], width: number, material: THREE.Material, name: string): void {
  // Side profile: first coordinate is forward distance (-Z), second is height.
  const shape = new THREE.Shape();
  shape.moveTo(...outline[0]);
  for (const p of outline.slice(1)) shape.lineTo(...p);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width, steps: 1, bevelEnabled: true, bevelThickness: .006,
    bevelSize: .006, bevelSegments: 2, curveSegments: 8,
  });
  geometry.translate(0, 0, -width / 2);
  geometry.rotateY(Math.PI / 2);
  piece(parent, geometry, material, [.02, 0, 0], name);
}

/** Original FORGE concept-C model. Dimensions are metres in the FPS tool frame.
 * The grip centres, moving collar pivot, and chisel dust seal are independent
 * anchors, so changing the handle angle never moves the masonry contact point.
 */
export function buildForgeHammerModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'FORGE SDS Max rotary hammer';
  const red = paint(0xb44a3c, .56), edge = paint(0x702c2a, .67);
  const armour = paint(0x2c3335, .77), rubber = paint(0x171c1e, .94);
  const steel = paint(0x8f999a, .34, .72), cast = paint(0x727a7b, .48, .48);
  const vent = paint(0x12191b, .88);
  const accent = paint(0xd29665, .53, .15);

  // Deep forward casting and raised red drive unit reproduce the selected
  // concept's stepped silhouette without relying on the discarded hammer mesh.
  profiledHousing(root, [[.089,.069],[.125,.099],[.233,.101],[.306,.070],[.321,.017],[.301,-.084],[.245,-.114],[.130,-.116],[.078,-.076]], .138, cast, 'Broad ribbed aluminium impact gearbox');
  profiledHousing(root, [[-.084,.066],[-.065,.099],[.089,.099],[.136,.060],[.142,-.116],[.101,-.153],[-.070,-.150],[-.087,-.097]], .132, red, 'Wide horizontal red motor housing');
  profiledHousing(root, [[-.074,.073],[-.052,.108],[.061,.111],[.094,.095],[.079,.073]], .127, armour, 'Impact resistant raised top spine');
  profiledHousing(root, [[-.076,-.112],[-.063,-.173],[.085,-.174],[.119,-.126]], .126, edge, 'Stepped lower motor cradle');
  profiledHousing(root, [[.123,.096],[.171,.111],[.269,.108],[.307,.071],[.222,.054],[.132,.069]], .134, steel, 'Gearbox top wear plate');
  // Tapered armour cheeks overlap both cast gearbox and red motor. This
  // staggered joint avoids the disconnected slabs of the old viewmodel.
  for(const side of [-1,1]) {
    const cheek=piece(root,new THREE.BoxGeometry(.007,.128,.075),armour,[.02+side*.074,-.001,-.095],'Graphite gearbox cheek');
    cheek.rotation.x=-.13;
    for(const z of [-.028,.001,.030,.059])
      piece(root,new THREE.BoxGeometry(.004,.007,.021),vent,[.02+side*.079,-.039,z],'Deep motor cooling louvre');
    for(const z of [-.159,-.194,-.229,-.264])
      rod(root,[.02+side*.073,-.077,z],[.02+side*.073,.073,z],.0035,steel,'Cast gearbox stiffening rib');
    for(const z of [-.081,.099]) {
      const bolt=piece(root,new THREE.CylinderGeometry(.004,.004,.003,12),armour,[.02+side*.079,-.098,z],'Recessed housing fastener');
      bolt.rotation.z=Math.PI/2;
    }
  }

  // Perpendicular barrel and coaxial SDS Max locking sleeve. The rig adds the
  // exchangeable chisel from the dust seal at z=-.349 to the cutting edge.
  rod(root, [.02,.005,-.301], [.02,.005,-.321], .047, cast, 'Cast cylindrical nose');
  ring(root, [.02,.005,-.271], .047, .004, armour, 'Gearbox collar');
  rod(root, [.02,.005,-.302], [.02,.005,-.341], .036, rubber, 'SDS Max quick release chuck');
  for (const z of [-.293,-.310,-.327]) ring(root, [.02,.005,z], .0365, .0022, vent, 'Locking sleeve grip ring');
  ring(root, [.02,.005,-.345], .023, .004, steel, 'Steel chuck lip');
  ring(root, [.02,.005,-.349], .015, .0035, rubber, 'Chisel dust seal');
  const selector = piece(root, new THREE.CylinderGeometry(.020,.020,.009,24), armour, [.096,.055,-.079], 'Hammer-drill / chisel selector');
  selector.rotation.z = Math.PI / 2;
  rod(root, [.101,.055,-.079], [.105,.067,-.079], .004, accent, 'Mode selector pointer');

  const rear = new THREE.Group();
  rear.name = 'Longitudinal rear handle and battery';
  root.add(rear);
  // Open D-frame with two separate vibration springs leaves real hand space.
  rail(rear, [[.02,.091,.076],[.02,.113,.121],[.02,.088,.167],[.02,.043,.184],[.02,-.142,.184],[.02,-.170,.126],[.02,-.151,.075]], .016, red, 'Open reinforced rear D frame');
  rod(rear, [.02,.023,.184], [.02,-.137,.184], .023, rubber, 'Rear rubber grip');
  for (const y of [.014,-.011,-.036,-.061,-.086,-.111,-.135]) {
    const groove = ring(rear, [.02,y,.184], .0234, .0014, armour, 'Rear grip raised texture');
    groove.rotation.x = Math.PI / 2;
  }
  for (const y of [.080,-.151]) {
    rod(rear, [.02,y,.082], [.02,y,.125], .011, armour, 'Vibration isolator');
    ring(rear, [.02,y,.104], .0115, .0016, steel, 'Isolation spring collar');
  }
  rod(rear, [.02,-.019,.136], [.02,-.060,.136], .006, armour, 'hammer-trigger');

  // Centre the removable battery directly below the lower motor cradle.
  // The rail overlaps the pack and the motor; neither part floats in side view.
  piece(rear, new THREE.BoxGeometry(.124,.017,.185), armour, [.02,-.173,-.022], 'Battery mounting rail');
  piece(rear, new THREE.BoxGeometry(.157,.018,.195), edge, [.02,-.194,-.022], 'Battery sliding latch seam');
  piece(rear, new THREE.BoxGeometry(.162,.083,.198), rubber, [.02,-.242,-.022], 'Removable high output battery pack');
  piece(rear, new THREE.BoxGeometry(.166,.013,.200), armour, [.02,-.290,-.022], 'Battery impact sole');
  for (const x of [-.060,.100]) piece(rear, new THREE.BoxGeometry(.009,.022,.034), red, [x,-.197,.048], 'Battery release button');
  for (let i=0;i<4;i++)piece(rear,new THREE.BoxGeometry(.006,.005,.003),i<3?accent:armour,[.062-i*.012,-.263,.079],'Battery charge indicator');

  // Every child is authored relative to the collar origin. Rotating this group
  // sweeps the full auxiliary assembly around the steel barrel.
  const auxiliary = new THREE.Group();
  auxiliary.name = 'Rotatable auxiliary handle';
  auxiliary.position.set(.02,.005,-.275);
  root.add(auxiliary);
  ring(auxiliary, [0,0,0], .047, .006, steel, '360 degree handle clamp');
  rod(auxiliary, [0,0,0], [-.091,0,0], .0145, steel, 'Auxiliary handle clamp spindle');
  rod(auxiliary, [-.075,0,0], [-.191,0,0], .0235, rubber, 'Auxiliary rubber hand grip');
  for (let i=0;i<7;i++) {
    const groove=ring(auxiliary,[-.086-i*.016,0,0],.024,.0012,armour,'Auxiliary rubber grip texture');
    groove.rotation.y=Math.PI/2;
  }
  const stop=piece(auxiliary,new THREE.CylinderGeometry(.027,.027,.007,24),armour,[-.194,0,0],'Auxiliary handle end stop');
  stop.rotation.z=Math.PI/2;
  auxiliary.userData.gripPoint=[-.145,0,0];

  root.userData.gripPoint=[.02,-.060,.184];
  root.userData.secondaryGripPoint=[-.125,.005,-.275];
  root.userData.tipPoint=[.02,.005,-.749];
  root.userData.reference='FORGE concept C';
  root.userData.ready=loadForgeHammerAsset(root);
  return root;
}

let assetPromise:Promise<THREE.Group>|undefined;
function sourceAsset():Promise<THREE.Group>{
  assetPromise ??= new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/tools/sds-max-reference.glb`).then(gltf=>gltf.scene);
  return assetPromise;
}

/** Replace the temporary construction shell with the authored, editable
 * Blender asset. The existing grip and impact datums remain gameplay-owned. */
async function loadForgeHammerAsset(root:THREE.Group):Promise<void>{
  try{
    const scene=await sourceAsset();
    const named=(parent:THREE.Object3D,name:string)=>{
      let result:THREE.Object3D|undefined;
      parent.traverse(object=>{if(object.name.replaceAll('_',' ').toLowerCase()===name.toLowerCase())result=object;});
      return result;
    };
    const asset=named(scene,'FORGE SDS MAX');
    const body=asset&&named(asset,'Hammer body');
    const rearAsset=asset&&named(asset,'Longitudinal rear handle and battery');
    const auxAsset=asset&&named(asset,'Rotatable auxiliary handle');
    const rear=root.getObjectByName('Longitudinal rear handle and battery') as THREE.Group|undefined;
    const auxiliary=root.getObjectByName('Rotatable auxiliary handle') as THREE.Group|undefined;
    if(!body||!rearAsset||!auxAsset||!rear||!auxiliary)throw new Error(`FORGE GLB assembly missing: ${JSON.stringify({asset:!!asset,body:!!body,rearAsset:!!rearAsset,auxAsset:!!auxAsset,rear:!!rear,auxiliary:!!auxiliary,sceneChildren:scene.children.map(child=>child.name)})}`);
    // The fallback stays available on load failure, but is fully hidden once
    // the real asset is present. Hands and the physical chisel are attached by
    // FPSRig after this builder returns and are never touched here.
    root.traverse(object=>{if(object instanceof THREE.Mesh&&object.name!=='400 mm exposed chisel shaft'&&object.name!=='50 mm flat chisel with ground cutting bevel'&&object.name!=='Interchangeable pointed chisel'){
      let parent:THREE.Object3D|null=object.parent,hand=false;
      while(parent&&parent!==root){if(parent.name.includes('five-finger')){hand=true;break;}parent=parent.parent;}
      if(!hand)object.visible=false;
    }});
    const materials=new Map<THREE.Material,THREE.Material>();
    // Keep the authored handle sizes relative to the anatomical gloves.
    // Presentation scaling also shrank the clearance around both fists.
    const viewScale=1;
    const chuck=new THREE.Vector3(.02,.005,-.349);
    const viewOffset=chuck.clone().multiplyScalar(1-viewScale);
    const install=(from:THREE.Object3D,to:THREE.Group,local=false)=>{
      const visual=new THREE.Group();
      visual.name=`${from.name} rendered assembly`;
      visual.scale.setScalar(viewScale);
      if(!local)visual.position.copy(viewOffset);
      for(const child of from.children){
        const part=child.clone(true);
        part.traverse(object=>{if(object instanceof THREE.Mesh){
          const clone=(material:THREE.Material)=>{
            let result=materials.get(material);
            if(!result){result=material.clone();materials.set(material,result);}
            return result;
          };
          object.material=Array.isArray(object.material)?object.material.map(clone):clone(object.material);
          for(const material of Array.isArray(object.material)?object.material:[object.material]){
            // The shell, battery and hands share the scene depth buffer. An
            // opaque overlay without depth makes far faces show through the
            // housing after meshes are batched by material.
            material.transparent=false;material.opacity=1;material.depthTest=true;material.depthWrite=true;
          }
          object.castShadow=false;object.receiveShadow=false;object.renderOrder=21;
        }});
        visual.add(part);
      }
      to.add(visual);
    };
    install(body,root);install(rearAsset,rear);install(auxAsset,auxiliary,true);
    auxiliary.position.fromArray(auxAsset.userData.pivotGame);
    auxiliary.userData.gripPoint=auxAsset.userData.gripPoint;
    auxiliary.userData.gripRadiusM=auxAsset.userData.gripRadiusM;
    root.userData.gripRadiusM=asset!.userData.gripRadiusM;
    batchStaticVisuals(root,[...root.children].filter(child=>child.name!=='Longitudinal rear handle and battery'&&child.name!=='Rotatable auxiliary handle'&&!child.name.includes('five-finger')));
    batchStaticVisuals(rear,[...rear.children],mesh=>mesh.name==='hammer-trigger');
    batchStaticVisuals(auxiliary,[...auxiliary.children]);
    root.userData.gripPoint=asset!.userData.gripPoint;
    root.userData.visualAsset='SDS Max reference Blender GLB';
    root.userData.reference=asset!.userData.reference;
    root.userData.handClearanceSolids=JSON.parse(asset!.userData.handClearanceSolids);
    root.userData.assetMeshCount=114;
  }catch(error){
    console.warn('FORGE SDS Max asset unavailable; preserving working hammer geometry',error);
    root.userData.visualAsset='Fallback procedural hammer';
  }
}
