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

export interface WorkerArm {
  group:THREE.Group; upper:THREE.Group; forearm:THREE.Group; hand:THREE.Group;
  side:number; grip:THREE.Vector3; shoulder:THREE.Vector3; elbow:THREE.Vector3; wrist:THREE.Vector3;
}
export function workerArm(side:number, hand:THREE.Group, grip:THREE.Vector3):WorkerArm {
  const group=new THREE.Group(),upper=new THREE.Group(),forearm=new THREE.Group();
  group.name=`${side<0?'Left':'Right'} fixed-length work arm`;
  // Authored at metre scale; these segments rotate but never stretch.
  mesh(upper,new THREE.CapsuleGeometry(.047,UPPER_ARM_M-.094,6,16),skin,'Upper arm skin');
  const sleeve=mesh(upper,new THREE.CylinderGeometry(.076,.061,.19,20,3,true),cloth,'Short work shirt sleeve');sleeve.position.y=-.075;
  const cuff=mesh(upper,new THREE.CylinderGeometry(.063,.062,.025,20,1,true),hem,'Folded sleeve hem');cuff.position.y=.022;
  const stitch=mesh(upper,new THREE.TorusGeometry(.062,.0012,4,24),hem,'Sleeve double stitched edge');stitch.rotation.x=Math.PI/2;stitch.position.y=.033;
  const lower=mesh(forearm,new THREE.CylinderGeometry(.030,.047,FOREARM_M,20,5),skin,'Tapered bare forearm');
  lower.geometry.computeVertexNormals();
  mesh(forearm,ellipsoid(1,[.041,.037,.041],[0,-FOREARM_M/2+.01,0]),skin,'Rounded elbow');
  const rolled=mesh(forearm,new THREE.CylinderGeometry(.046,.054,.065,20,2,true),cloth,'Rolled work sleeve ending below elbow');rolled.position.y=-.111;
  for(const y of [-.085,-.079]){const seam=mesh(forearm,new THREE.TorusGeometry(.047,.0025,5,24),hem,'Rolled cuff seam');seam.rotation.x=Math.PI/2;seam.position.y=y;}
  group.add(upper,forearm);
  return {group,upper,forearm,hand,side,grip,shoulder:new THREE.Vector3(),elbow:new THREE.Vector3(),wrist:new THREE.Vector3()};
}

/** Two-bone IK with a fixed body-space shoulder and outward/downward elbow pole. */
export function poseWorkerArm(arm:WorkerArm, shoulder:THREE.Vector3, wrist:THREE.Vector3, bodyRight:THREE.Vector3):void {
  const direction=wrist.clone().sub(shoulder), distance=THREE.MathUtils.clamp(direction.length(),.045,MAX_WRIST_REACH_M);direction.normalize();
  const a=(UPPER_ARM_M**2-FOREARM_M**2+distance**2)/(2*distance);
  const height=Math.sqrt(Math.max(0,UPPER_ARM_M**2-a*a));
  const pole=new THREE.Vector3(0,-1,0).addScaledVector(bodyRight,arm.side*.65);
  pole.addScaledVector(direction,-pole.dot(direction)).normalize();
  const elbow=shoulder.clone().addScaledVector(direction,a).addScaledVector(pole,height);
  arm.shoulder.copy(shoulder);arm.elbow.copy(elbow);arm.wrist.copy(wrist);
  const pose=(part:THREE.Group,start:THREE.Vector3,end:THREE.Vector3)=>{
    part.position.copy(arm.group.worldToLocal(start.clone())).add(arm.group.worldToLocal(end.clone())).multiplyScalar(.5);
    const axis=end.clone().sub(start).normalize();
    part.quaternion.copy(arm.group.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(new THREE.Quaternion().setFromUnitVectors(upright,axis)));
  };
  pose(arm.upper,shoulder,elbow);pose(arm.forearm,elbow,wrist);
}

export function flexWorkerHand(hand:THREE.Group, effort:number,time:number):void {
  for(const [i,digit]of hand.children.filter(o=>o.userData.digit).entries()){
    digit.rotation.y=Math.sin(time*1.3+i*.6)*.007+effort*.026;
  }
}
