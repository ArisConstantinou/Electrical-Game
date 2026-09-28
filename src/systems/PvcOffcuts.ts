import * as THREE from 'three';

interface FallingPiece {
  mesh:THREE.Mesh;velocity:THREE.Vector3;rotation:THREE.Quaternion;
  angle:number;spin:number;contact:boolean;settled:boolean;bounds:THREE.Box3;
}
/** Detached real pipe geometry, with gravity and a floor contact/roll response. */
export class PvcOffcuts {
  readonly pieces:FallingPiece[]=[];
  private readonly point=new THREE.Vector3();
  private readonly turn=new THREE.Quaternion();
  private readonly axis=new THREE.Vector3(0,0,1);
  release(mesh:THREE.Mesh):void{
    mesh.geometry.computeBoundingBox();
    const center=mesh.geometry.boundingBox!.getCenter(new THREE.Vector3());
    mesh.position.add(center.clone().applyQuaternion(mesh.quaternion));
    mesh.geometry.translate(-center.x,-center.y,-center.z);
    mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
    mesh.name='Falling hollow PVC offcut';
    this.pieces.push({mesh,velocity:new THREE.Vector3(.045,0,.14),rotation:mesh.quaternion.clone(),angle:0,spin:1.1,contact:false,settled:false,bounds:mesh.geometry.boundingBox!.clone()});
  }
  take(mesh:THREE.Mesh):void{
    const index=this.pieces.findIndex(piece=>piece.mesh===mesh);
    if(index>=0)this.pieces.splice(index,1);
  }
  update(seconds:number):void{
    if(seconds<=0||!Number.isFinite(seconds))return;
    for(const piece of this.pieces){
      if(piece.settled)continue;
      // Substeps retain the same release/floor behavior at variable frame rates.
      let remaining=Math.min(seconds,.10);
      while(remaining>0){
        const dt=Math.min(remaining,1/120);remaining-=dt;
        piece.velocity.y-=9.81*dt;piece.mesh.position.addScaledVector(piece.velocity,dt);
        piece.angle=Math.min(Math.PI/2,piece.angle+piece.spin*dt);
        piece.mesh.quaternion.copy(this.turn.setFromAxisAngle(this.axis,piece.angle)).multiply(piece.rotation);
        let minimum=Infinity;
        for(const x of [piece.bounds.min.x,piece.bounds.max.x])for(const y of [piece.bounds.min.y,piece.bounds.max.y])for(const z of [piece.bounds.min.z,piece.bounds.max.z]){
          minimum=Math.min(minimum,this.point.set(x,y,z).applyQuaternion(piece.mesh.quaternion).y+piece.mesh.position.y);
        }
        if(minimum<.001){
          piece.mesh.position.y+=.001-minimum;
          piece.velocity.y=Math.abs(piece.velocity.y)>.35?-piece.velocity.y*.12:0;
          piece.velocity.x*=Math.exp(-8*dt);piece.velocity.z*=Math.exp(-8*dt);
          piece.contact=true;piece.spin=3.2;
          if(piece.angle===Math.PI/2&&piece.velocity.y<.04){piece.velocity.set(0,0,0);piece.settled=true;}
        }
      }
      piece.mesh.updateMatrixWorld(true);
    }
  }
  get telemetry(){return this.pieces.map(p=>({position:p.mesh.position.toArray(),velocity:p.velocity.toArray(),angle:p.angle,contact:p.contact,settled:p.settled}));}
}
