import * as THREE from 'three';
import {PvcBend,PVC} from './PvcBend';

/** Pipe-local sleeves share the exact material distances used by PvcBend.press. */
export class PvcBendHighlight extends THREE.Group {
  readonly zone=this.sleeve(32,.0112,0xffd43b,.22);
  readonly active=this.sleeve(4,.012,0x36a8ff,.75);
  readonly zoneEnds=this.rings(0xffd43b,.0118,.0007);
  readonly activeEnds=this.rings(0x8bdbff,.013,.0011);
  private readonly pose=new THREE.Object3D();
  private readonly tangent=new THREE.Vector3();
  private readonly axis=new THREE.Vector3(0,0,1);
  private lastBend:PvcBend|null=null;
  private lastRevision=-1;
  private lastGrip=-1;
  private lastMark=-1;

  constructor(){
    super();this.name='PVC bend zone and active cell';this.visible=false;
    this.add(this.zone,this.active,this.zoneEnds,this.activeEnds);
    this.traverse(object=>{object.raycast=()=>{};object.renderOrder=12;});
  }
  private sleeve(sections:number,radius:number,color:number,opacity:number):THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>{
    const geometry=new THREE.BufferGeometry(),indices:number[]=[],sides=12;
    for(let i=0;i<sections;i++)for(let j=0;j<sides;j++){
      const a=i*sides+j,b=i*sides+(j+1)%sides;
      indices.push(a,a+sides,b,b,a+sides,b+sides);
    }
    geometry.setIndex(indices);
    geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array((sections+1)*sides*3),3).setUsage(THREE.DynamicDrawUsage));
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,opacity,transparent:true,depthWrite:false,side:THREE.DoubleSide}));
    mesh.material.forceSinglePass=true;
    mesh.userData.sections=sections;mesh.userData.radius=radius;mesh.name=color===0xffd43b?'Spring protected bend zone':'Active 25 mm bend cell';return mesh;
  }
  private rings(color:number,radius:number,width:number):THREE.InstancedMesh{
    const rings=new THREE.InstancedMesh(new THREE.TorusGeometry(radius,width,4,24),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.95,depthWrite:false}),2);
    rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);return rings;
  }
  private updateSleeve(mesh:THREE.Mesh,bend:PvcBend,from:number,to:number):void{
    const sections=mesh.userData.sections as number,radius=mesh.userData.radius as number;
    const positions=mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for(let i=0;i<=sections;i++){
      const p=bend.at(from+(to-from)*i/sections),nx=-Math.sin(p.angle),ny=Math.cos(p.angle);
      for(let j=0;j<12;j++){
        const angle=j*Math.PI/6,co=Math.cos(angle),si=Math.sin(angle);
        positions.setXYZ(i*12+j,p.x+nx*co*radius,p.y+ny*co*radius,si*radius);
      }
    }
    positions.needsUpdate=true;mesh.geometry.computeBoundingSphere();
  }
  private updateRings(rings:THREE.InstancedMesh,bend:PvcBend,from:number,to:number):void{
    for(let i=0;i<2;i++){
      const p=bend.at(i?to:from);
      this.pose.position.set(p.x,p.y,0);this.tangent.set(Math.cos(p.angle),Math.sin(p.angle),0);
      this.pose.quaternion.setFromUnitVectors(this.axis,this.tangent);this.pose.updateMatrix();rings.setMatrixAt(i,this.pose.matrix);
    }
    rings.instanceMatrix.needsUpdate=true;rings.computeBoundingSphere();
  }
  update(bend:PvcBend,visible:boolean,selectable:boolean):void{
    this.visible=visible;this.active.visible=this.activeEnds.visible=selectable;
    if(!visible)return;
    const shapeChanged=this.lastBend!==bend||this.lastRevision!==bend.revision||this.lastMark!==bend.mark;
    const from=bend.mark-PVC.springLength/2,to=from+PVC.springLength;
    if(shapeChanged){this.updateSleeve(this.zone,bend,from,to);this.updateRings(this.zoneEnds,bend,from,to);}
    const activeFrom=from+bend.grip*PVC.cell,activeTo=activeFrom+PVC.cell;
    if(shapeChanged||this.lastGrip!==bend.grip){
      this.updateSleeve(this.active,bend,activeFrom,activeTo);this.updateRings(this.activeEnds,bend,activeFrom,activeTo);
    }
    if(shapeChanged||this.lastGrip!==bend.grip){this.userData.range=[from,to];this.userData.activeRange=[activeFrom,activeTo];}
    this.lastBend=bend;this.lastRevision=bend.revision;this.lastMark=bend.mark;this.lastGrip=bend.grip;
  }
}
