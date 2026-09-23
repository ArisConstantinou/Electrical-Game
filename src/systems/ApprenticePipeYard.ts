import * as THREE from 'three';
import {APPRENTICE_PIPE_LENGTH_M,APPRENTICE_PIPE_TARGET,type ApprenticeCutReceipt,type ApprenticePipeKind} from './ApprenticePipeBatch';
import {pvcMaterial,PvcStock} from './PvcModels';

/** The cut pieces and retained partial tubes remain visible in the room. */
export class ApprenticePipeYard extends THREE.Group {
  private readonly finished=new Map<ApprenticePipeKind,{barrels:THREE.InstancedMesh;ends:THREE.InstancedMesh;count:number}>();
  private readonly remnants=new Map<string,THREE.Mesh>();
  constructor(private readonly stock:PvcStock){
    super();this.name='Apprentice cut PVC racks';this.userData.studioEntityId='pvc:apprentice-cut-racks';
    const body=new THREE.CylinderGeometry(.01,.01,1,10,1,true),end=new THREE.RingGeometry(.008,.01,10),material=pvcMaterial.clone();
    for(const kind of ['socket','switch'] as const){
      const barrels=new THREE.InstancedMesh(body,material,APPRENTICE_PIPE_TARGET),ends=new THREE.InstancedMesh(end,material,APPRENTICE_PIPE_TARGET*2);
      barrels.count=ends.count=0;barrels.castShadow=barrels.receiveShadow=true;barrels.name=`Cut ${kind} PVC lengths`;ends.name=`Open ends of ${kind} lengths`;this.add(barrels,ends);this.finished.set(kind,{barrels,ends,count:0});
    }
  }
  cuttingPoint(bundle:number,kind:ApprenticePipeKind):THREE.Vector3{
    const centre=this.stock.siteWorldToLocal(this.stock.bundleCenter(bundle)),length=APPRENTICE_PIPE_LENGTH_M[kind];
    return this.stock.sitePoint(centre.x-.18,Math.min(length,1.42),centre.z-.055);
  }
  addCut(receipt:ApprenticeCutReceipt):void{
    const set=this.finished.get(receipt.kind)!;if(set.count>=APPRENTICE_PIPE_TARGET)throw new Error('Cut rack full');
    const n=set.count++,row=n%5,layer=Math.floor(n/5),length=receipt.lengthM;
    const x=receipt.kind==='socket'?2.78:2.29,z=(receipt.kind==='socket'?2.18:2.54)+row*.027,y=.022+layer*.022;
    const dummy=new THREE.Object3D();dummy.position.set(x,y,z);dummy.rotation.z=Math.PI/2;dummy.scale.set(1,length,1);dummy.updateMatrix();set.barrels.setMatrixAt(n,dummy.matrix);
    for(let end=0;end<2;end++){dummy.position.set(x+(end?1:-1)*length/2,y,z);dummy.rotation.set(0,Math.PI/2,0);dummy.scale.set(1,1,1);dummy.updateMatrix();set.ends.setMatrixAt(n*2+end,dummy.matrix);}
    set.barrels.count=set.count;set.ends.count=set.count*2;set.barrels.instanceMatrix.needsUpdate=set.ends.instanceMatrix.needsUpdate=true;
    const key=`${receipt.bundle}:${receipt.source}`;let remnant=this.remnants.get(key);
    if(!remnant){remnant=new THREE.Mesh(new THREE.CylinderGeometry(.01,.01,1,10,1,true),pvcMaterial);remnant.name='Retained uncut PVC remnant';remnant.castShadow=true;this.add(remnant);this.remnants.set(key,remnant);}
    const centre=this.stock.siteWorldToLocal(this.stock.bundleCenter(receipt.bundle));
    remnant.visible=receipt.remainingM>.02;remnant.position.set(centre.x-.14,Math.max(.001,receipt.remainingM)/2,centre.z-.085-receipt.source*.022);remnant.scale.y=Math.max(.001,receipt.remainingM);
  }
  get telemetry(){return{socket:this.finished.get('socket')!.count,switch:this.finished.get('switch')!.count,visibleRemnants:[...this.remnants.values()].filter(p=>p.visible).length};}
}
