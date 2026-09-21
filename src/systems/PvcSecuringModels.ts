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

export function buildRebarHug(left:THREE.Vector3,right:THREE.Vector3,frontZ:number):THREE.Group{
  // Store vertices around the strap centre. Scaling during tightening must
  // deform the bow without scaling its absolute wall coordinates toward 0.
  const middle=left.clone().add(right).multiplyScalar(.5),local=(point:THREE.Vector3)=>point.clone().sub(middle),curve=new THREE.CatmullRomCurve3([
    local(left),local(new THREE.Vector3(left.x+.025,left.y,frontZ)),local(new THREE.Vector3(middle.x-.021,middle.y,frontZ+.030)),
    local(new THREE.Vector3(middle.x,middle.y,frontZ+.038)),local(new THREE.Vector3(middle.x+.021,middle.y,frontZ+.030)),local(new THREE.Vector3(right.x-.025,right.y,frontZ)),local(right),
  ]);
  const group=new THREE.Group();group.name='Galvanized conduit tying wire';group.position.copy(middle);group.userData.leftHole=left.toArray();group.userData.rightHole=right.toArray();
  const wire=new THREE.Mesh(new THREE.TubeGeometry(curve,48,.00115,6,false),steel(0x777d7b,.58));wire.name='Open wall-anchored tying wire';group.add(wire);
  const twist=new THREE.Group();twist.name='tie-wire-twist';twist.visible=false;twist.position.set(0,0,frontZ-middle.z);group.add(twist);
  for(const phase of [0,Math.PI]){const points=Array.from({length:25},(_,i)=>{const t=i/24,a=phase+t*Math.PI*5;return new THREE.Vector3(Math.cos(a)*.0022,-t*.018,Math.sin(a)*.0022);});const strand=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),24,.00065,5,false),steel(0x6c7270,.5));strand.name='Twisted tying-wire strand';twist.add(strand);}
  return group;
}
