import * as THREE from 'three';
import { buildReferenceToolModel } from '../player/ReferenceToolModels';

const steel=(color=0x747a78,roughness=.38)=>new THREE.MeshStandardMaterial({color,metalness:.72,roughness});
export {buildRebarPliers,buildHeldRebar,buildRebarHug,setRebarPliersClosed,setTieWireProgress,setTieWireTarget} from './RebarTyingModels';

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
