import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const UPPER_ARM_M = .31;
export const FOREARM_M = .27;
export const MAX_WRIST_REACH_M = UPPER_ARM_M + FOREARM_M - .012;
const skin = new THREE.MeshStandardMaterial({ color: 0xb98562, roughness: .83 });
const nail = new THREE.MeshStandardMaterial({ color: 0xd9b49a, roughness: .65 });
const cloth = new THREE.MeshStandardMaterial({ color: 0x435b52, roughness: .98 });
const hem = new THREE.MeshStandardMaterial({ color: 0x6c8073, roughness: .95 });
const crease = new THREE.MeshStandardMaterial({ color: 0x986d50, roughness: .94 });
const upright = new THREE.Vector3(0, 1, 0);
const v = (a: number[]) => new THREE.Vector3().fromArray(a);
function ellipsoid(radius: number, scale: number[], position: number[]): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(radius, 16, 12);
  g.scale(...scale as [number,number,number]); g.translate(...position as [number,number,number]); return g;
}
function bone(a: THREE.Vector3, b: THREE.Vector3, radius: number): THREE.BufferGeometry {
  const delta=b.clone().sub(a), g=new THREE.CapsuleGeometry(radius, Math.max(.001,delta.length()-radius*2), 5, 12);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(upright,delta.normalize()));
  g.translate(...a.clone().add(b).multiplyScalar(.5).toArray()); return g;
}
function mesh(parent:THREE.Object3D, geometry:THREE.BufferGeometry, material:THREE.Material, name:string):THREE.Mesh {
  const object=new THREE.Mesh(geometry,material); object.name=name; object.castShadow=false; object.receiveShadow=true; parent.add(object); return object;
}

/** Palm and five separately articulated digits, wrapped around a tool handle. */
export function workerHand(side:number, style:string):THREE.Group {
  if(style==='mixer'){
    const hand=new THREE.Group(),grasp=singleToolHand(side,side>0?'mixer-primary':'mixer-support');
    hand.name=`${side<0?'Left':'Right'} five-finger mixer hand`;
    // Transverse handles need an overhand grasp: backs upward, palms down.
    // Mirror the roll so both thumbs oppose the fingers toward the motor.
    grasp.rotation.y=side*Math.PI/2;
    hand.add(grasp);
    hand.userData={...grasp.userData,gripStyle:style,wristPoint:v(grasp.userData.wristPoint).applyQuaternion(grasp.quaternion).toArray()};
    return hand;
  }
  if(!style.startsWith('hammer'))return singleToolHand(side,style);
  const hand=new THREE.Group(); hand.name=`${side<0?'Left':'Right'} five-finger ${style} grip`;
  hand.userData.wristPoint=[side*.018,-.058,.047];
  const shape=new THREE.Shape();shape.moveTo(-.023,-.037);shape.quadraticCurveTo(.001,-.048,.019,-.036);shape.quadraticCurveTo(.033,-.022,.030,.029);shape.quadraticCurveTo(.011,.042,-.024,.030);shape.quadraticCurveTo(-.034,.003,-.023,-.037);shape.closePath();
  const back=new THREE.ExtrudeGeometry(shape,{depth:.016,bevelEnabled:true,bevelThickness:.006,bevelSize:.005,bevelSegments:3,steps:1,curveSegments:8});back.translate(side*.006,0,.028);
  const palm=[back,ellipsoid(1,[.019,.026,.014],[-side*.015,.013,.029]),ellipsoid(1,[.029,.025,.025],[side*.018,-.051,.045])];
  for(let i=0;i<4;i++)palm.push(ellipsoid(1,[.013,.010,.009],[side*.030,.030-i*.020,.035]));
  const palmParts=palm.map(g=>g.index?g.toNonIndexed():g);
  mesh(hand,mergeGeometries(palmParts),skin,'Palm, thenar pad and heel'); [...palm,...palmParts].forEach(g=>g.dispose());
  // Metacarpal tendons and shallow joint folds break up the broad back of the hand.
  for(let i=0;i<3;i++){
    mesh(hand,bone(v([side*.002,-.033+i*.017,.050]),v([side*.026,-.025+i*.017,.046]),.0013),skin,'Subtle hand tendon');
    mesh(hand,bone(v([side*.030,-.023+i*.020,.044]),v([side*.036,-.021+i*.020,.038]),.00055),crease,'Knuckle skin fold');
  }
  const radius=style==='spray'?.033:style==='fitting'?.024:.023;
  const names=['index','middle','ring','little'];
  for(let i=0;i<4;i++){
    const digit=new THREE.Group(); digit.name=names[i]; digit.userData.digit=names[i];
    const y=.030-i*.020, r=.009-i*.0006, length=i===3?.82:1;
    const points=(i===0&&style==='spray'?[[side*.029,y,.040],[side*.038,.084,.028],[side*.014,.121,.001],[0,.120,-.008]]:[[side*.033,y,.039],[side*(radius+.014),y+.002,.005],[side*.025*length,y,-radius-.009],[-side*.008,y-.001,-radius+.004]]).map(v);
    const geos=points.slice(1).map((p,j)=>bone(points[j],p,r*(1-j*.12)));
    mesh(digit,mergeGeometries(geos),skin,`${names[i]} three phalanges`);geos.forEach(g=>g.dispose());
    const end=points[3];
    const n=mesh(digit,ellipsoid(1,[.008,.006,.0015],[end.x,end.y,end.z-.007]),nail,`${names[i]} nail`);n.rotation.y=side*.25;
    hand.add(digit);
  }
  const thumb=new THREE.Group();thumb.name='thumb';thumb.userData.digit='thumb';
  const points=[[-side*.021,.038,.035],[-side*.041,.028,.005],[-side*.026,.016,-.020],[side*.002,.012,-.029]].map(v);
  const geos=points.slice(1).map((p,i)=>bone(points[i],p,.012-i*.0015));
  mesh(thumb,mergeGeometries(geos),skin,'Opposed thumb with articulated joints');geos.forEach(g=>g.dispose());
  mesh(thumb,ellipsoid(1,[.009,.007,.0015],[0,.012,-.038]),nail,'Thumbnail');hand.add(thumb);
  // The supporting hand wraps the transverse auxiliary handle, not the chuck.
  if(style==='hammer-support'){hand.rotation.z=-Math.PI/2;}
  if(style==='level')hand.rotation.z=side*Math.PI/2;
  if(style==='hose')hand.quaternion.setFromUnitVectors(upright,new THREE.Vector3(-.048,.118,-.033).normalize());
  if(style==='cutter')hand.rotation.z=.63;
  if(style==='trowel')hand.quaternion.setFromUnitVectors(upright,new THREE.Vector3(-.083,.097,-.038).normalize());
  hand.userData.gripStyle=style;
  return hand;
}

/** Tool-sized grasp sections. Local Y follows the handle; +Z is the hand back. */
function singleToolHand(side:number,style:string):THREE.Group {
  const hand=new THREE.Group();hand.name=`${side<0?'Left':'Right'} five-finger ${style} hand`;
  const relaxed=style==='relaxed',pinch=style==='fitting';
  const sections:Record<string,[number,number]>={spray:[.0335,.0335],spring:[.0082,.0082],level:[.027,.016],cutter:[.035,.014],trowel:[.0145,.0145],hose:[.022,.022],'mixer-primary':[.033,.033],'mixer-support':[.028,.028],fitting:[.021,.015],relaxed:[.017,.008]};
  const [rx,rz]=sections[style]??[.022,.022],backZ=relaxed?.012:rz+.010, palmX=pinch?side*.027:0;
  hand.userData.wristPoint=[palmX,-.059,backZ];hand.userData.gripStyle=style;
  hand.userData.gripSection=[rx,rz];
  const palm=mesh(hand,ellipsoid(1,[.032,.041,.014],[palmX,-.004,backZ]),skin,'Tapered palm and metacarpals');
  palm.scale.y=.94;
  mesh(hand,ellipsoid(1,[.019,.023,.015],[palmX-side*.017,-.006,backZ-.008]),skin,'Thenar thumb pad');
  mesh(hand,ellipsoid(1,[.024,.020,.019],[palmX,-.047,backZ]),skin,'Rounded wrist heel');
  const names=['index','middle','ring','little'];
  for(let i=0;i<4;i++){
    const digit=new THREE.Group();digit.name=names[i];digit.userData.digit=names[i];
    const y=.026-i*.018, r=.0085-i*.00055;
    let points:number[][];
    if(relaxed){
      // Fingers continue down the hanging hand, with only a loose natural curl.
      const x=side*(.023-i*.015),length=[.066,.074,.069,.053][i];
      points=[[x,.025,.012],[x,.025+length*.43,.008],[x,.025+length*.78,-.003],[x,.025+length,-.014]];
    }else if(pinch){
      points=[[side*.049,y,.025],[side*.046,y+.001,-.006],[side*.018,y,-.028],[-side*.008,y-.004,-.025]];
    }else if(style==='spray'&&i===0){
      points=[[side*.027,.031,backZ],[side*.039,.062,.038],[side*.015,.096,.014],[0,.099,-.002]];
    }else{
      points=[[side*.028,y,backZ],[side*(rx+.009),y+.002,.002],[side*(rx*.57),y,-rz-.009],[-side*(rx*.43),y-.003,-rz-.006]];
    }
    const joints=points.map(v),geos=joints.slice(1).map((p,j)=>bone(joints[j],p,r*(1-j*.10)));
    if(style==='cutter'){
      // Separate rigid phalanges allow a real closing curl around both levers.
      for(let j=0;j<3;j++){
        const length=joints[j].distanceTo(joints[j+1]);
        const segment=mesh(digit,new THREE.CapsuleGeometry(r*(1-j*.10),Math.max(.001,length-2*r*(1-j*.10)),5,12),skin,`${names[i]} rigid phalanx ${j+1}`);
        segment.userData.phalanx=j;
        segment.position.copy(joints[j]).add(joints[j+1]).multiplyScalar(.5);
        segment.quaternion.setFromUnitVectors(upright,joints[j+1].clone().sub(joints[j]).normalize());
      }
    }else mesh(digit,mergeGeometries(geos),skin,`${names[i]} three phalanges`);
    geos.forEach(g=>g.dispose());
    const tip=joints[3],n=mesh(digit,ellipsoid(1,[.0064,.007,.0013],[tip.x,tip.y,tip.z-.006]),nail,`${names[i]} nail`);n.rotation.y=side*.2;
    digit.userData.restPoints=points;hand.add(digit);
  }
  const thumb=new THREE.Group();thumb.name='thumb';thumb.userData.digit='thumb';
  const thumbPoints=relaxed?[[-side*.024,.002,.012],[-side*.040,.018,.006],[-side*.045,.038,-.005],[-side*.036,.048,-.009]]:
    pinch?[[side*.021,.016,.028],[side*.008,.031,.037],[-side*.010,.025,.030],[-side*.016,.018,.019]]:
      [[-side*.021,.023,backZ],[-side*(rx+.014),.025,.002],[-side*(rx*.6),.020,-rz-.012],[side*.006,.018,-rz-.013]];
  const points=thumbPoints.map(v),geos=points.slice(1).map((p,i)=>bone(points[i],p,.0105-i*.001));
  mesh(thumb,mergeGeometries(geos),skin,'Opposed thumb with articulated joints');geos.forEach(g=>g.dispose());
  const end=points[3];mesh(thumb,ellipsoid(1,[.008,.008,.0015],[end.x,end.y,end.z-.006]),nail,'Thumbnail');hand.add(thumb);
  return hand;
}

/** One hand closes the shear: the lower/fixed handle stays against the palm. */
export function poseToolGrip(hand:THREE.Group,tool:THREE.Group,effort:number):void {
  if(hand.userData.gripStyle!=='cutter')return;
  const squeeze=Math.sin(THREE.MathUtils.clamp(effort,0,1)*Math.PI);
  const moving=tool.getObjectByName('cutter-moving-handle');
  if(moving)moving.rotation.z=.13-squeeze*.33;
  hand.userData.squeeze=squeeze;
  // The fingers follow the lever while the palm remains seated on the fixed grip.
  for(const digit of hand.children.filter(o=>o.userData.digit&&o.userData.digit!=='thumb')){
    const points=(digit.userData.restPoints as number[][]).map(v);
    points[1].x-=squeeze*.024;
    points[2].x-=squeeze*.025;
    points[3].x-=squeeze*.018;
    points[3].z+=squeeze*.006;
    for(const segment of digit.children.filter(o=>o.userData.phalanx!==undefined)){
      const index=segment.userData.phalanx as number;
      segment.position.copy(points[index]).add(points[index+1]).multiplyScalar(.5);
      segment.quaternion.setFromUnitVectors(upright,points[index+1].clone().sub(points[index]).normalize());
    }
    const nail=digit.getObjectByName(`${digit.userData.digit} nail`);
    if(nail)nail.position.set(points[3].x-(digit.userData.restPoints[3][0]),0,points[3].z-(digit.userData.restPoints[3][2]));
  }
}

export interface WorkerArm {
  group:THREE.Group; upper:THREE.Group; forearm:THREE.Group; hand:THREE.Group;
  side:number; grip:THREE.Vector3; shoulder:THREE.Vector3; elbow:THREE.Vector3; wrist:THREE.Vector3;
}
/** Physical handle targets shared with the anatomical body; no legacy mesh is needed to render them. */
export interface WorkerGripTarget {
  side:number;center:THREE.Vector3;rotation:THREE.Quaternion;section:[number,number];active:boolean;
  shape?:'round'|'box';
  trigger?:THREE.Vector3;
  referenceKey?:string;
  object?:THREE.Object3D;
  contactLocked?:boolean;
}
export function workerGripTarget(arm:WorkerArm,active=arm.hand.userData.gripRole!=='resting'):WorkerGripTarget {
  const frame=arm.hand.children.find(o=>String(o.userData.gripStyle).startsWith('mixer-'))??arm.hand;
  frame.updateWorldMatrix(true,false);
  return {side:arm.side,center:frame.getWorldPosition(new THREE.Vector3()),rotation:frame.getWorldQuaternion(new THREE.Quaternion()),section:frame.userData.gripSection??[.023,.023],active};
}
export function hideLegacyWorkerArm(arm:WorkerArm,active:boolean):void {
  arm.upper.visible=!active;arm.forearm.visible=!active;
  // Keep the authored transform and held accessories (such as the measuring
  // pencil), while replacing every visible skin/clothing component.
  for(const child of arm.hand.children)child.visible=!active||child.userData.heldAccessory===true;
}
export function workerArm(side:number, hand:THREE.Group, grip:THREE.Vector3):WorkerArm {
  const group=new THREE.Group(),upper=new THREE.Group(),forearm=new THREE.Group();
  group.name=`${side<0?'Left':'Right'} fixed-length work arm`;
  // Authored at metre scale; these segments rotate but never stretch.
  mesh(upper,new THREE.CapsuleGeometry(.047,UPPER_ARM_M-.094,6,16),skin,'Upper arm skin');
  // +Y points from shoulder towards elbow. A shirt is broadest at the
  // shoulder, then narrows to its open hem; the old reversed 15 cm cylinder
  // and second forearm cuff read as trouser legs when looking down.
  const sleeve=mesh(upper,new THREE.CylinderGeometry(.049,.058,.175,20,4,true),cloth,'Short work shirt sleeve');sleeve.position.y=-.056;
  mesh(upper,ellipsoid(1,[.058,.045,.058],[0,-.135,0]),cloth,'Rounded shirt shoulder seam');
  const cuff=mesh(upper,new THREE.CylinderGeometry(.050,.051,.018,20,1,true),hem,'Folded sleeve hem');cuff.position.y=.027;
  const stitch=mesh(upper,new THREE.TorusGeometry(.050,.0012,4,24),hem,'Sleeve double stitched edge');stitch.rotation.x=Math.PI/2;stitch.position.y=.035;
  const trowelGrip=hand.userData.gripStyle==='trowel';
  const lower=mesh(forearm,new THREE.CylinderGeometry(trowelGrip?.022:.030,.047,FOREARM_M,20,5),skin,'Tapered bare forearm');
  if(trowelGrip)mesh(forearm,ellipsoid(1,[.022,.015,.022],[0,FOREARM_M/2-.004,0]),skin,'Rounded trowel wrist transition');
  lower.geometry.computeVertexNormals();
  mesh(forearm,ellipsoid(1,[.041,.037,.041],[0,-FOREARM_M/2+.01,0]),skin,'Rounded elbow');
  group.add(upper,forearm);
  return {group,upper,forearm,hand,side,grip,shoulder:new THREE.Vector3(),elbow:new THREE.Vector3(),wrist:new THREE.Vector3()};
}

/** Two-bone IK with a fixed body-space shoulder and outward/downward elbow pole. */
export function poseWorkerArm(arm:WorkerArm, shoulder:THREE.Vector3, wrist:THREE.Vector3, bodyRight:THREE.Vector3, elbowOverride?:THREE.Vector3):void {
  const direction=wrist.clone().sub(shoulder), distance=THREE.MathUtils.clamp(direction.length(),.045,MAX_WRIST_REACH_M);direction.normalize();
  const a=(UPPER_ARM_M**2-FOREARM_M**2+distance**2)/(2*distance);
  const height=Math.sqrt(Math.max(0,UPPER_ARM_M**2-a*a));
  const pole=new THREE.Vector3(0,-1,0).addScaledVector(bodyRight,arm.side*.65);
  pole.addScaledVector(direction,-pole.dot(direction)).normalize();
  // Authored forward kinematics may supply a real elbow; the caller owns
  // its fixed segment lengths and this renderer must not solve it again.
  const elbow=elbowOverride?.clone()??shoulder.clone().addScaledVector(direction,a).addScaledVector(pole,height);
  arm.shoulder.copy(shoulder);arm.elbow.copy(elbow);arm.wrist.copy(wrist);
  const pose=(part:THREE.Group,start:THREE.Vector3,end:THREE.Vector3)=>{
    part.position.copy(arm.group.worldToLocal(start.clone())).add(arm.group.worldToLocal(end.clone())).multiplyScalar(.5);
    const axis=end.clone().sub(start).normalize();
    part.quaternion.copy(arm.group.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(new THREE.Quaternion().setFromUnitVectors(upright,axis)));
  };
  pose(arm.upper,shoulder,elbow);pose(arm.forearm,elbow,wrist);
}

export function flexWorkerHand(hand:THREE.Group, effort:number,time:number):void {
  if(hand.userData.gripStyle==='cutter')return;
  for(const [i,digit]of hand.children.filter(o=>o.userData.digit).entries()){
    digit.rotation.y=Math.sin(time*1.3+i*.6)*.007+effort*.026;
  }
}
