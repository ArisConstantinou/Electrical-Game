import * as THREE from 'three';
import { MortarBatch } from './MortarBatch';

/** Independent vessel, shared ingredients supplied through MortarBatch.pour. */
export class DrumMixer {
  readonly batch=new MortarBatch({capacityLitres:60,sackKg:0,sandKg:0});
  running=false;
  private angle=0;
  private readonly drum:THREE.Object3D;
  private readonly contents:THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
  private readonly inner:THREE.BufferGeometry;
  private previousVolume=-1;
  constructor(readonly model:THREE.Group){
    this.drum=model.getObjectByName('hollow-drum')!;
    const inner=[[0,-.269],[.14,-.269],[.218,-.241],[.286,-.191],[.324,-.12],[.333,-.059],[.333,.02],[.315,.119],[.287,.235],[.242,.353],[.240,.369],[0,.369]];
    const lathe=new THREE.LatheGeometry(inner.map(p=>new THREE.Vector2(...p as [number,number])),48);
    lathe.rotateX(-.95);this.inner=lathe.toNonIndexed();lathe.dispose();
    this.contents=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({color:0x87806e,roughness:.88}));
    this.contents.name='drum-contained-ingredients';this.contents.userData.studioEntityId='equipment:drum-contents';this.contents.visible=false;this.contents.receiveShadow=true;
    model.getObjectByName('tilting-drum-cradle')!.add(this.contents);
    model.userData.status='Connected, stopped';
  }
  toggle():void{this.running=!this.running;this.model.userData.status=this.running?'Mixing':'Stopped';}
  update(dt:number):void{
    if(this.running){this.angle=(this.angle+dt*2.1)%(Math.PI*2);this.drum.rotation.y=this.angle;this.batch.mix(dt);}
  }
  present():void{
    const volume=this.batch.volumeLitres;this.contents.visible=volume>0;
    if(Math.abs(volume-this.previousVolume)>1e-7){
      this.previousVolume=volume;
      // Clip the actual tilted inner drum by a horizontal plane. Binary-search
      // the plane for the ingredient volume, so the skin stays in the vessel.
      let low=-.50,high=.005;
      for(let i=0;i<17;i++){const mid=(low+high)/2;if(this.clip(mid,false).litres<volume)low=mid;else high=mid;}
      const result=this.clip((low+high)/2,true),g=new THREE.BufferGeometry();
      g.setAttribute('position',new THREE.Float32BufferAttribute(result.vertices,3));g.computeVertexNormals();g.computeBoundingSphere();this.contents.geometry.dispose();this.contents.geometry=g;
    }
    this.contents.material.color.setHex(this.batch.ready?0x87806e:this.batch.cementScoops>0?0x989181:this.batch.sandScoops>0?0xb79a6c:0x719997);
    this.contents.material.roughness=this.batch.cementScoops+this.batch.sandScoops>0?.88:.19;
  }
  private clip(height:number,keep:boolean):{litres:number;vertices:number[]}{
    const positions=this.inner.getAttribute('position'),triangles:number[]=[],edge=new Map<string,THREE.Vector3>();
    const triangle=(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3)=>triangles.push(...a.toArray(),...b.toArray(),...c.toArray());
    for(let i=0;i<positions.count;i+=3){
      const input=[0,1,2].map(n=>new THREE.Vector3().fromBufferAttribute(positions,i+n)),polygon:THREE.Vector3[]=[];
      for(let j=0;j<3;j++){
        const a=input[j],b=input[(j+1)%3],insideA=a.y<=height,insideB=b.y<=height;
        if(insideA)polygon.push(a);
        if(insideA!==insideB){const p=a.clone().lerp(b,(height-a.y)/(b.y-a.y));polygon.push(p);edge.set(`${p.x.toFixed(6)},${p.z.toFixed(6)}`,p);}
      }
      for(let j=1;j<polygon.length-1;j++)triangle(polygon[0],polygon[j],polygon[j+1]);
    }
    const rim=[...edge.values()];if(rim.length>=3){
      const center=rim.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).divideScalar(rim.length);
      rim.sort((a,b)=>Math.atan2(a.z-center.z,a.x-center.x)-Math.atan2(b.z-center.z,b.x-center.x));
      for(let i=0;i<rim.length;i++)triangle(center,rim[(i+1)%rim.length],rim[i]);
    }
    let volume=0;const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
    for(let i=0;i<triangles.length;i+=9){a.fromArray(triangles,i);b.fromArray(triangles,i+3);c.fromArray(triangles,i+6);volume+=a.dot(b.cross(c))/6;}
    return{litres:Math.abs(volume)*1000,vertices:keep?triangles:[]};
  }
  get ready():boolean{return this.batch.ready&&!this.running;}
  get telemetry(){return{running:this.running,angle:this.angle,batch:this.batch.getState(),contentsVisible:this.contents.visible};}
}
