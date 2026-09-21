import * as THREE from 'three';
import { PvcBend, PVC } from './PvcBend';
import type { PvcPreset } from './PvcPresets';
export const pvcMaterial=new THREE.MeshStandardMaterial({color:0xe1e2d8,roughness:.57});
const STOCK_CENTER=new THREE.Vector3(3.46,.02,1.15);
const STOCK_LEAN=.095;
const STOCK_DIRECTION=new THREE.Vector3(Math.sin(STOCK_LEAN),Math.cos(STOCK_LEAN),0);
const STOCK_BUNDLE_OFFSETS=[
  new THREE.Vector2(0,0),
  ...Array.from({length:6},(_,i)=>new THREE.Vector2(Math.cos(i*Math.PI/3)*.022,Math.sin(i*Math.PI/3)*.022)),
  ...Array.from({length:13},(_,i)=>{const angle=i*Math.PI*2/13+Math.PI/13;return new THREE.Vector2(Math.cos(angle)*.044,Math.sin(angle)*.044);}),
];
export const PVC_BUNDLE_COUNT=5;
const RESERVE_BUNDLE_Z=[.51,.82,1.47,1.78];
export function part(parent:THREE.Object3D,g:THREE.BufferGeometry,m:THREE.Material,name:string,p=[0,0,0]):THREE.Mesh{
  const mesh=new THREE.Mesh(g,m);mesh.name=name;mesh.position.fromArray(p);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
export function label(text:string,width:number,height:number):THREE.Mesh{
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=128;
  const ctx=canvas.getContext('2d')!;ctx.fillStyle='#192824';ctx.fillRect(0,0,1024,128);ctx.fillStyle='#f4f0df';ctx.font='bold 44px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,66);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));
}
/** Reusable hollow tube, updated in-place. No allocations of GPU geometry while bending. */
export class PvcTube extends THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>{
  readonly sections=160;readonly sides=10;
  constructor(material=pvcMaterial){
    const geometry=new THREE.BufferGeometry();const sides=10,sections=160,indices:number[]=[];
    for(let shell=0;shell<2;shell++)for(let i=0;i<sections;i++)for(let j=0;j<sides;j++){
      const a=shell*(sections+1)*sides+i*sides+j,b=shell*(sections+1)*sides+i*sides+(j+1)%sides,c=a+sides,d=b+sides;
      if(shell===0)indices.push(a,c,b,b,c,d);else indices.push(a,b,c,b,d,c);
    }
    for(const i of [0,sections])for(let j=0;j<sides;j++){
      const a=i*sides+j,b=i*sides+(j+1)%sides,c=a+(sections+1)*sides,d=b+(sections+1)*sides;
      indices.push(a,b,c,b,d,c);
    }
    geometry.setIndex(indices);geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array((sections+1)*sides*2*3),3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('normal',new THREE.BufferAttribute(new Float32Array((sections+1)*sides*2*3),3).setUsage(THREE.DynamicDrawUsage));
    super(geometry,material);this.castShadow=this.receiveShadow=true;this.name='Hollow 20 mm PVC';this.update(new PvcBend());
  }
  update(bend:PvcBend,from=0,to:number=PVC.length):void{
    const pos=this.geometry.getAttribute('position') as THREE.BufferAttribute,norm=this.geometry.getAttribute('normal') as THREE.BufferAttribute;
    for(let i=0;i<=this.sections;i++){
      const p=bend.at(from+(to-from)*i/this.sections),nx=-Math.sin(p.angle),ny=Math.cos(p.angle);
      for(let shell=0;shell<2;shell++)for(let j=0;j<this.sides;j++){
        const a=j/this.sides*Math.PI*2,r=shell?.008:.01,co=Math.cos(a),si=Math.sin(a),idx=shell*(this.sections+1)*this.sides+i*this.sides+j;
        pos.setXYZ(idx,p.x+nx*co*r,p.y+ny*co*r,si*r);norm.setXYZ(idx,nx*co*(shell?-1:1),ny*co*(shell?-1:1),si*(shell?-1:1));
      }
    }
    pos.needsUpdate=norm.needsUpdate=true;this.geometry.computeBoundingSphere();this.geometry.computeBoundingBox();
  }
}
export class PvcStock extends THREE.Group{
  readonly pipes:THREE.Group[]=[];readonly straps:THREE.Mesh[]=[];
  readonly bundleRoots:THREE.Group[]=[];
  readonly bundleRemaining=Array<number>(PVC_BUNDLE_COUNT).fill(PVC.count);
  private readonly reserveMeshes:Array<{pipes:THREE.InstancedMesh;ends:THREE.InstancedMesh;straps:THREE.Mesh[]}>=[];
  readonly bundleHighlight:THREE.Box3Helper;
  private readonly bundleBox=new THREE.Box3();
  private readonly bundleRay=new THREE.Raycaster();
  readonly straightedge=new THREE.Group();readonly marks:THREE.Mesh[]=[];
  readonly ruler=new THREE.Group();
  readonly liveMarks=new THREE.Group();
  readonly presetMarks=new THREE.Group();
  private spread=0;
  constructor(){
    super();this.name='PVC workshop · 20 × 3 m';this.userData.studioEntityId='pvc:workshop';
    const original=new THREE.Group();original.name='PVC bundle 1 · 20 × 3 m';original.userData.pvcBundleIndex=0;this.bundleRoots.push(original);this.add(original);
    const pipeG=new THREE.CylinderGeometry(.01,.01,3,10,1,true),endG=new THREE.RingGeometry(.008,.01,10);
    for(let i=0;i<PVC.count;i++){
      const group=new THREE.Group();group.userData.pvcStock=i;original.add(group);this.pipes.push(group);
      part(group,pipeG,pvcMaterial,'3 m PVC length',[0,1.5,0]);
      for(const y of [0,3]){const end=part(group,endG,pvcMaterial,'Open pipe end',[0,y,0]);end.rotation.x=Math.PI/2;}
      const mark=part(group,new THREE.CylinderGeometry(.0103,.0103,.005,10,1,true),new THREE.MeshStandardMaterial({color:0x15191b,roughness:.85}),'Permanent marker ring');mark.visible=false;this.marks.push(mark);
    }
    const bandMaterial=new THREE.MeshStandardMaterial({color:0x1b7e78,roughness:.45});
    for(const y of [.4,1.5,2.6]){
      const strap=part(original,new THREE.TorusGeometry(.055,.004,5,32),bandMaterial,'Rounded factory plastic strap');
      strap.position.copy(STOCK_CENTER).addScaledVector(STOCK_DIRECTION,y);
      strap.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),STOCK_DIRECTION);
      this.straps.push(strap);
    }
    const dummy=new THREE.Object3D();
    for(let bundle=1;bundle<PVC_BUNDLE_COUNT;bundle++){
      const root=new THREE.Group();root.name=`PVC bundle ${bundle+1} · 20 × 3 m`;root.userData.pvcBundleIndex=bundle;root.position.set(STOCK_CENTER.x,STOCK_CENTER.y,RESERVE_BUNDLE_Z[bundle-1]);root.rotation.z=-STOCK_LEAN;this.add(root);this.bundleRoots.push(root);
      const barrels=new THREE.InstancedMesh(pipeG,pvcMaterial,PVC.count);barrels.name='Individual 3 m hollow PVC tubes';barrels.castShadow=barrels.receiveShadow=true;root.add(barrels);
      const ends=new THREE.InstancedMesh(endG,pvcMaterial,PVC.count*2);ends.name='Open PVC tube ends';root.add(ends);
      for(let i=0;i<PVC.count;i++){
        const offset=STOCK_BUNDLE_OFFSETS[i];dummy.position.set(offset.x,1.5,offset.y);dummy.rotation.set(0,0,0);dummy.updateMatrix();barrels.setMatrixAt(i,dummy.matrix);
        for(let end=0;end<2;end++){dummy.position.set(offset.x,end*3,offset.y);dummy.rotation.set(Math.PI/2,0,0);dummy.updateMatrix();ends.setMatrixAt(i*2+end,dummy.matrix);}
      }
      barrels.instanceMatrix.needsUpdate=ends.instanceMatrix.needsUpdate=true;
      const bands:THREE.Mesh[]=[];
      for(const y of [.4,1.5,2.6]){const band=part(root,new THREE.TorusGeometry(.055,.004,5,32),bandMaterial,'Rounded factory plastic strap',[0,y,0]);band.rotation.x=Math.PI/2;bands.push(band);}
      this.reserveMeshes.push({pipes:barrels,ends,straps:bands});
    }
    this.bundleHighlight=new THREE.Box3Helper(this.bundleBox,0xffda35);this.bundleHighlight.name='Selected PVC bundle highlight';this.bundleHighlight.visible=false;this.bundleHighlight.raycast=()=>{};this.add(this.bundleHighlight);
    const metal=new THREE.MeshStandardMaterial({color:0xa6b4b4,roughness:.4,metalness:.6});
    part(this.straightedge,new THREE.BoxGeometry(.66,.012,.04),metal,'Straightedge');
    part(this.straightedge,new THREE.BoxGeometry(.04,.025,.22),metal,'Carpenter square heel',[-.33,0,.09]);
    this.add(this.straightedge);this.straightedge.visible=false;
    const previewMaterial=new THREE.MeshBasicMaterial({color:0xffce67,depthTest:true});
    const previewGeometry=new THREE.BoxGeometry(.019,.002,.006);
    for(let i=0;i<PVC.count;i++)part(this.liveMarks,previewGeometry,previewMaterial,'Live mark preview',[1.94+i*.028,.031,0]);
    this.liveMarks.visible=false;this.add(this.liveMarks,this.presetMarks);
    part(this.ruler,new THREE.BoxGeometry(.026,.003,3),new THREE.MeshStandardMaterial({color:0xe7bc52,roughness:.65}),'3 m measuring tape');
    for(let i=0;i<=60;i++){const tick=part(this.ruler,new THREE.BoxGeometry(i%10===0?.025:.013,.001,.001),new THREE.MeshBasicMaterial({color:0x182020}),'5 cm tape graduation',[0,.002,-1.5+i*.05]);if(i%10===0){const t=label(`${i*5} cm`,.16,.026);t.rotation.x=-Math.PI/2;t.position.set(-.06,.006,tick.position.z);this.ruler.add(t);}}
    this.ruler.position.set(1.84,.028,1.15);this.ruler.visible=false;this.add(this.ruler);this.layout(0);
  }
  setBundleRemaining(index:number,count:number):void{
    if(!Number.isInteger(index)||index<0||index>=PVC_BUNDLE_COUNT)throw new RangeError('Unknown PVC bundle');
    const remaining=Math.max(0,Math.min(PVC.count,Math.floor(count)));this.bundleRemaining[index]=remaining;
    if(index===0){this.pipes.forEach((pipe,i)=>pipe.visible=i<remaining);this.straps.forEach(strap=>strap.visible=remaining>0);}
    else{const bundle=this.reserveMeshes[index-1];bundle.pipes.count=remaining;bundle.ends.count=remaining*2;bundle.straps.forEach(strap=>strap.visible=remaining>0);}
  }
  bundleCenter(index:number):THREE.Vector3{
    if(!Number.isInteger(index)||index<0||index>=PVC_BUNDLE_COUNT)throw new RangeError('Unknown PVC bundle');
    return new THREE.Vector3(STOCK_CENTER.x,STOCK_CENTER.y,index===0?STOCK_CENTER.z:RESERVE_BUNDLE_Z[index-1]);
  }
  bundleAt(camera:THREE.Camera,maxDistance=4.2):{index:number;point:THREE.Vector3}|null{
    camera.updateMatrixWorld(true);this.updateMatrixWorld(true);this.bundleRay.setFromCamera(new THREE.Vector2(),camera);
    const hit=this.bundleRay.intersectObjects(this.bundleRoots,true).find(hit=>hit.distance<=maxDistance);
    if(!hit)return null;
    let node:THREE.Object3D|null=hit.object;while(node&&!Number.isInteger(node.userData.pvcBundleIndex))node=node.parent;
    return node?{index:node.userData.pvcBundleIndex as number,point:hit.point.clone()}:null;
  }
  highlightBundle(index:number|null):void{
    this.bundleHighlight.visible=index!==null;
    if(index===null)return;
    this.bundleBox.setFromObject(this.bundleRoots[index]);this.bundleBox.expandByScalar(.015);this.bundleHighlight.updateMatrixWorld(true);
  }
  layout(progress:number):void{
    this.spread=progress;
    for(let i=0;i<PVC.count;i++){
      const p=this.pipes[i],offset=STOCK_BUNDLE_OFFSETS[i];
      p.position.set(THREE.MathUtils.lerp(STOCK_CENTER.x+offset.x,1.94+i*.028,progress),STOCK_CENTER.y,THREE.MathUtils.lerp(STOCK_CENTER.z+offset.y,-.35,progress));
      p.rotation.z=THREE.MathUtils.lerp(-STOCK_LEAN,0,progress);p.rotation.x=progress*Math.PI/2;
    }
    this.ruler.visible=progress===1;
    this.presetMarks.visible=progress===1;
  }
  setPresets(presets:readonly PvcPreset[]):void{
    this.presetMarks.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();const material=o.material as THREE.MeshBasicMaterial;material.map?.dispose();material.dispose();}});
    this.presetMarks.clear();
    for(const preset of presets){
      const row=new THREE.Group();row.position.z=-.35+preset.cm/100;row.userData.presetCm=preset.cm;this.presetMarks.add(row);
      const material=new THREE.MeshBasicMaterial({color:preset.builtin?0x69b7de:0xb596df});
      const geometry=new THREE.BoxGeometry(.019,.002,.004);
      for(let i=0;i<PVC.count;i++)part(row,geometry,material,'Preset reference line',[1.94+i*.028,.031,0]);
      const caption=label(`${preset.name} · ${preset.cm} cm`,.38,.045);caption.position.set(1.60,.035,0);caption.rotation.x=-Math.PI/2;row.add(caption);
    }
    this.presetMarks.visible=this.spread===1;
  }
  markAt(distance:number,stroke:number):void{
    this.straightedge.visible=this.spread===1;this.straightedge.position.set(2.20,.042,-.35+distance+.04);
    this.liveMarks.position.z=-.35+distance;
    this.marks.forEach((mesh,i)=>{mesh.position.y=distance;mesh.visible=(i+1)/PVC.count<=stroke;});
  }
}
