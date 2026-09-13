import * as THREE from 'three';
import {splitDebrisGeometry} from './splitDebrisGeometry';
const scope=self as unknown as {postMessage:(message:unknown,transfer?:Transferable[])=>void};
self.onmessage=event=>{
  const {id,positions}=event.data as {id:number;positions:Float32Array};
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.computeBoundingBox();
  const size=geometry.boundingBox!.getSize(new THREE.Vector3());
  const axes=(['x','y','z'] as const).slice().sort((a,b)=>size[b]-size[a]);
  let result=null;
  for(const axis of axes){
    if(size[axis]<.008)continue;
    for(const fraction of [.5,.43]){
      result=splitDebrisGeometry(geometry,axis,geometry.boundingBox!.min[axis]+size[axis]*fraction,{maxVertices:120000});
      if(result)break;
    }
    if(result)break;
  }
  geometry.dispose();
  if(!result){scope.postMessage({id,result:null});return;}
  const pieces=result.pieces.map(piece=>{const positions=new Float32Array(piece.geometry.getAttribute('position').array);piece.geometry.dispose();return{positions,volume:piece.volume}});
  scope.postMessage({id,result:{pieces,originalVolume:result.originalVolume}},pieces.map(piece=>piece.positions.buffer));
};
