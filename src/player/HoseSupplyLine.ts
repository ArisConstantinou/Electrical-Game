import * as THREE from 'three';

/** One continuous, reusable world-space hose from the hand coupling to the coil. */
export class HoseSupplyLine {
  readonly mesh:THREE.Mesh;
  readonly start=new THREE.Vector3();
  readonly end=new THREE.Vector3();
  private readonly points=Array.from({length:5},()=>new THREE.Vector3());
  private readonly curve=new THREE.CatmullRomCurve3(this.points);
  private readonly last=new THREE.Vector3(Infinity,Infinity,Infinity);
  private readonly positions=new Float32Array(65*8*3);
  private readonly normals=new Float32Array(65*8*3);
  constructor(scene:THREE.Scene,private readonly tool:THREE.Object3D){
    const coil=scene.getObjectByName('Coiled water hose') as THREE.Mesh<THREE.TubeGeometry>;
    coil.updateWorldMatrix(true,false);this.end.copy(coil.geometry.parameters.path.getPoint(1));coil.localToWorld(this.end);
    const geometry=new THREE.BufferGeometry(),indices:number[]=[];
    geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('normal',new THREE.BufferAttribute(this.normals,3).setUsage(THREE.DynamicDrawUsage));
    for(let i=0;i<64;i++)for(let j=0;j<8;j++){const a=i*8+j,b=i*8+(j+1)%8,c=b+8,d=a+8;indices.push(a,b,d,b,c,d);}
    geometry.setIndex(indices);
    this.mesh=new THREE.Mesh(geometry,(coil.material as THREE.Material).clone());this.mesh.name='Continuous nozzle supply hose';this.mesh.visible=false;this.mesh.frustumCulled=false;this.mesh.receiveShadow=true;scene.add(this.mesh);
    const stub=tool.getObjectByName('Flexible water supply hose');if(stub)stub.visible=false;
  }
  update(visible:boolean):void{
    this.mesh.visible=visible;if(!visible)return;
    this.tool.updateWorldMatrix(true,true);this.start.copy(this.tool.localToWorld(new THREE.Vector3(.207,-.181,.026)));
    if(this.last.distanceToSquared(this.start)<1e-9)return;this.last.copy(this.start);
    const exit=new THREE.Vector3(.009,-.056,.020).transformDirection(this.tool.matrixWorld);
    this.points[0].copy(this.start);this.points[1].copy(this.start).addScaledVector(exit,.15);
    this.points[1].y=Math.max(.028,this.points[1].y);
    this.points[2].copy(this.start).lerp(this.end,.16);this.points[2].y=.06;
    this.points[3].copy(this.start).lerp(this.end,.57);this.points[3].y=.018;
    this.points[4].copy(this.end);this.curve.updateArcLengths();
    const p=new THREE.Vector3(),t=new THREE.Vector3(),n=new THREE.Vector3(),b=new THREE.Vector3(),v=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
    for(let i=0;i<=64;i++){
      this.curve.getPoint(i/64,p);p.y=Math.max(.012,p.y);this.curve.getTangent(i/64,t);n.crossVectors(t,up);if(n.lengthSq()<.001)n.set(1,0,0);n.normalize();b.crossVectors(t,n).normalize();
      for(let j=0;j<8;j++){const a=j*Math.PI/4,k=(i*8+j)*3;v.copy(n).multiplyScalar(Math.cos(a)).addScaledVector(b,Math.sin(a));v.toArray(this.normals,k);v.multiplyScalar(.009).add(p).toArray(this.positions,k);}
    }
    this.mesh.geometry.attributes.position.needsUpdate=true;this.mesh.geometry.attributes.normal.needsUpdate=true;
  }
}
