import * as THREE from 'three';
import { buildReferenceToolModel } from '../player/ReferenceToolModels';

const steel=(color=0x747a78,roughness=.38)=>new THREE.MeshStandardMaterial({color,metalness:.72,roughness});
const dark=new THREE.MeshStandardMaterial({color:0x252927,metalness:.34,roughness:.62});
const red=new THREE.MeshStandardMaterial({color:0xb9282d,roughness:.52});
const upright=new THREE.Vector3(0,1,0);

function rod(parent:THREE.Object3D,a:THREE.Vector3,b:THREE.Vector3,r:number,material:THREE.Material,name:string):THREE.Mesh{
  const d=b.clone().sub(a),mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,d.length(),12),material);
  mesh.name=name;mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(upright,d.normalize());parent.add(mesh);return mesh;
}

/** Dedicated masonry drill whose visible bit is truly 12 mm diameter. */
export function buildPvcDrill12():THREE.Group{
  const drill=buildReferenceToolModel('drill');drill.name='Cordless masonry drill · 12 mm bit';
  drill.traverse(object=>{if(/masonry drill bit|helical cutting land|carbide masonry/i.test(object.name))object.visible=false;});
  const motor=drill.getObjectByName('reference-motor')!;
  const bit=new THREE.Mesh(new THREE.CylinderGeometry(.006,.006,.145,16),steel(0xaab4b5,.26));
  bit.name='12 mm masonry drill bit';bit.rotation.x=Math.PI/2;bit.position.z=-.112;motor.add(bit);
  for(const phase of [0,Math.PI]){
    const points=Array.from({length:81},(_,i)=>{const t=i/80,a=phase+t*Math.PI*14;return new THREE.Vector3(Math.cos(a)*.0061,Math.sin(a)*.0061,-.043-t*.137);});
    const land=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),80,.00075,4,false),steel());land.name='12 mm helical masonry cutting land';motor.add(land);
  }
  const head=new THREE.Mesh(new THREE.BoxGeometry(.014,.003,.006),steel(0xc0c6c4,.20));head.name='12 mm carbide cutting head';head.position.z=-.185;motor.add(head);
  drill.userData.tipPoint=[0,.064,(motor.position.z as number)-.185];drill.userData.gripPoint=[0,-.005,.011];drill.userData.bitDiameterMm=12;
  return drill;
}

/** Long-handled rebar pliers, with a separately animated jaw. */
export function buildRebarPliers():THREE.Group{
  const group=new THREE.Group();group.name='Rebar tying pliers';
  rod(group,new THREE.Vector3(-.012,-.015,0),new THREE.Vector3(-.080,-.165,.004),.010,red,'Left insulated plier handle');
  rod(group,new THREE.Vector3(.012,-.015,0),new THREE.Vector3(.080,-.165,.004),.010,red,'Right insulated plier handle');
  const pivot=new THREE.Mesh(new THREE.CylinderGeometry(.017,.017,.012,18),dark);pivot.name='Pliers forged pivot';pivot.rotation.x=Math.PI/2;group.add(pivot);
  const fixed=new THREE.Group();fixed.name='fixed-jaw';group.add(fixed);
  rod(fixed,new THREE.Vector3(-.008,.005,0),new THREE.Vector3(-.017,.087,0),.009,steel(),'Fixed forged plier jaw');
  const moving=new THREE.Group();moving.name='rebar-plier-moving-jaw';group.add(moving);
  rod(moving,new THREE.Vector3(.008,.005,0),new THREE.Vector3(.017,.087,0),.009,steel(),'Moving forged plier jaw');
  for(const x of [-.017,.017]){const tooth=new THREE.Mesh(new THREE.BoxGeometry(.013,.018,.015),steel(0x555b59,.28));tooth.name='Serrated rebar gripping tooth';tooth.position.set(x,.086,0);(x<0?fixed:moving).add(tooth);}
  group.userData.gripPoint=[.064,-.125,.004];group.userData.tipPoint=[0,.092,0];return group;
}

/** Thin galvanized tying wire held in the left hand before anchoring. */
export function buildHeldRebar():THREE.Group{
  const group=new THREE.Group(),material=steel(0x717776,.58);group.name='Galvanized conduit tying wire';
  const loop=new THREE.Mesh(new THREE.TorusGeometry(.052,.00115,6,40,Math.PI*1.72),material);loop.name='Open tying-wire loop';loop.rotation.x=Math.PI/2;loop.position.y=.04;group.add(loop);
  rod(group,new THREE.Vector3(-.050,.030,0),new THREE.Vector3(-.018,-.17,0),.00115,material,'Left wire tail');
  rod(group,new THREE.Vector3(.050,.030,0),new THREE.Vector3(.018,-.17,0),.00115,material,'Right wire tail');
  group.userData.gripPoint=[0,-.02,0];return group;
}

/** Wall-anchored wire which morphs into contact with a vertical 20 mm PVC. */
export function buildConduitTie(left:THREE.Vector3,right:THREE.Vector3,pipeCentreX:number,pipeCentreZ:number):THREE.Group{
  const middle=left.clone().add(right).multiplyScalar(.5),local=(point:THREE.Vector3)=>point.clone().sub(middle);
  const tieY=middle.y,openRadius=.050,contactRadius=.0115;
  const openPoints=[
    left.clone(),new THREE.Vector3(left.x+.018,left.y,pipeCentreZ+.010),
    new THREE.Vector3(pipeCentreX-openRadius,tieY-.016,pipeCentreZ+.018),new THREE.Vector3(pipeCentreX,tieY-.042,pipeCentreZ+openRadius),
    new THREE.Vector3(pipeCentreX+openRadius,tieY-.016,pipeCentreZ+.018),new THREE.Vector3(right.x-.018,right.y,pipeCentreZ+.010),right.clone(),
  ].map(local);
  const tightPoints=[left.clone(),new THREE.Vector3(pipeCentreX-contactRadius-.008,tieY,pipeCentreZ)].concat(
    Array.from({length:9},(_,i)=>{const angle=Math.PI-i*Math.PI/8;return new THREE.Vector3(pipeCentreX+Math.cos(angle)*contactRadius,tieY,pipeCentreZ+Math.sin(angle)*contactRadius);}),
    [new THREE.Vector3(pipeCentreX+contactRadius+.008,tieY,pipeCentreZ),right.clone()],
  ).map(local);
  const openGeometry=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(openPoints,false,'centripetal'),64,.00115,6,false);
  const tightGeometry=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tightPoints,false,'centripetal'),64,.00115,6,false);
  openGeometry.morphAttributes.position=[tightGeometry.getAttribute('position').clone()];
  openGeometry.morphAttributes.normal=[tightGeometry.getAttribute('normal').clone()];
  tightGeometry.dispose();
  const group=new THREE.Group();group.name='Galvanized PVC tying-wire loop';group.position.copy(middle);
  group.userData.leftHole=left.toArray();group.userData.rightHole=right.toArray();group.userData.pipeCentre=[pipeCentreX,tieY,pipeCentreZ];group.userData.contactRadiusMm=contactRadius*1000;group.userData.tightness=0;
  const wire=new THREE.Mesh(openGeometry,steel(0x666d6b,.52));wire.name='Morphing PVC tying-wire loop';wire.updateMorphTargets();group.add(wire);
  const twist=new THREE.Group();twist.name='tie-wire-twist';twist.visible=false;twist.position.copy(local(new THREE.Vector3(pipeCentreX+contactRadius*.72,tieY-.001,pipeCentreZ+contactRadius*.72)));group.add(twist);
  for(const phase of [0,Math.PI]){
    const points=Array.from({length:25},(_,i)=>{const t=i/24,a=phase+t*Math.PI*5;return new THREE.Vector3(Math.cos(a)*.0021,-t*.020,Math.sin(a)*.0021);});
    const strand=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),24,.00065,5,false),steel(0x5f6664,.48));strand.name='Twisted tying-wire tail';twist.add(strand);
  }
  return group;
}

export function setConduitTieTightness(group:THREE.Group,value:number):void{
  const tightness=THREE.MathUtils.clamp(value,0,1),wire=group.getObjectByName('Morphing PVC tying-wire loop') as THREE.Mesh|undefined;
  if(wire?.morphTargetInfluences)wire.morphTargetInfluences[0]=tightness;
  const twist=group.getObjectByName('tie-wire-twist');
  if(twist){twist.visible=tightness>.52;twist.scale.y=THREE.MathUtils.smoothstep(tightness,.52,1);twist.rotation.y=tightness*Math.PI*3;}
  group.userData.tightness=tightness;
}
