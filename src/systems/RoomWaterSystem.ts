import * as THREE from 'three';
import type { BrickWall } from '../world/BrickWall';
import { RoomWaterField } from './RoomWaterField';

export interface WaterRunoff {point:THREE.Vector3;normal:THREE.Vector3;litres:number;mortarKg:number}
export interface WaterEmission {origin:THREE.Vector3;velocity:THREE.Vector3;litres:number}
type Drop={point:THREE.Vector3;velocity:THREE.Vector3;litres:number;age:number};

/** Room-scale water accounting and finite geometry; Water Pro supplies the
 * actual optical surface material through Renderer.attachRoomWater. */
export class RoomWaterSystem {
  readonly field=new RoomWaterField();
  readonly group=new THREE.Group();
  readonly surfaceGeometry=new THREE.BufferGeometry();
  readonly surface=new THREE.Mesh(this.surfaceGeometry,new THREE.MeshPhysicalMaterial({color:0x94bdc4,roughness:.12,metalness:.05,transparent:true,opacity:.62,depthWrite:false}));
  readonly droplets=new THREE.InstancedMesh(new THREE.SphereGeometry(1,5,4),new THREE.MeshPhysicalMaterial({color:0xb9dce1,roughness:.12,metalness:.1,transparent:true,opacity:.65}),128);
  readonly streaks=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xc5e7eb,transparent:true,opacity:.22}));
  private readonly drops:Drop[]=[];
  private readonly transform=new THREE.Object3D();
  private readonly positions:Float32Array;
  private readonly thickness:Float32Array;
  private readonly indices:Uint32Array;
  private readonly streakPositions=new Float32Array(128*6);
  private time=0;
  private geometryTime=0;
  receivedLitres=0;
  runoffLitres=0;
  emissionLitres=0;
  sedimentKg=0;
  waterProActive=false;
  waterProBackend='pending';
  constructor(scene:THREE.Scene,private readonly wall:BrickWall){
    this.group.name='Water Pro room puddles, runoff and flood';this.group.userData.studioEntityId='room-water';
    this.surface.name='Finite room Water Pro surface';this.surface.frustumCulled=false;
    const n=(this.field.columns+1)*(this.field.rows+1);
    this.positions=new Float32Array(n*3);this.thickness=new Float32Array(n);
    this.indices=new Uint32Array(this.field.columns*this.field.rows*6);
    this.surfaceGeometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3).setUsage(THREE.DynamicDrawUsage));
    this.surfaceGeometry.setAttribute('waterDepth',new THREE.BufferAttribute(this.thickness,1).setUsage(THREE.DynamicDrawUsage));
    this.surfaceGeometry.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(n*3),3));
    this.surfaceGeometry.setIndex(new THREE.BufferAttribute(this.indices,1).setUsage(THREE.DynamicDrawUsage));
    this.surfaceGeometry.setDrawRange(0,0);this.surface.visible=false;
    this.droplets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.droplets.count=0;this.droplets.frustumCulled=false;
    this.streaks.geometry.setAttribute('position',new THREE.BufferAttribute(this.streakPositions,3).setUsage(THREE.DynamicDrawUsage));
    this.streaks.frustumCulled=false;
    this.group.add(this.surface,this.droplets,this.streaks);scene.add(this.group);this.rebuildGeometry();
  }
  addRunoff(event:WaterRunoff):void{
    if(!(event.litres>0))return;
    this.receivedLitres+=event.litres;this.runoffLitres+=event.litres;this.sedimentKg+=Math.max(0,event.mortarKg);
    const point=event.point.clone().addScaledVector(event.normal,.009);
    this.addDrop(point,event.normal.clone().multiplyScalar(.13).add(new THREE.Vector3(0,-.28,0)),event.litres);
  }
  addEmission(event:WaterEmission):void{
    if(!(event.litres>0))return;
    this.receivedLitres+=event.litres;this.emissionLitres+=event.litres;
    this.addDrop(event.origin,event.velocity,event.litres);
  }
  /** Explicit injected volume is useful for saved state and long-duration QA. */
  addFloorWater(x:number,z:number,litres:number):void{if(litres>0){this.receivedLitres+=litres;this.field.add(x,z,litres);}}
  private addDrop(point:THREE.Vector3,velocity:THREE.Vector3,litres:number):void{
    if(this.drops.length<128)this.drops.push({point:point.clone(),velocity:velocity.clone(),litres,age:0});
    else{
      let nearest=this.drops[0];for(const drop of this.drops)if(drop.point.distanceToSquared(point)<nearest.point.distanceToSquared(point))nearest=drop;
      const total=nearest.litres+litres;nearest.velocity.multiplyScalar(nearest.litres/total).addScaledVector(velocity,litres/total);nearest.litres=total;
    }
  }
  update(dt:number):void{
    dt=Math.max(0,Math.min(dt,.1));this.time+=dt;this.geometryTime+=dt;
    for(let i=this.drops.length-1;i>=0;i--){
      const drop=this.drops[i];drop.age+=dt;drop.velocity.y-=9.81*dt;
      const delta=drop.velocity.clone().multiplyScalar(dt),hit=this.wall.volume.raycast(drop.point,delta.clone().normalize(),delta.length());
      if(hit){
        const normal=new THREE.Vector3(hit.normal.x,hit.normal.y,hit.normal.z);
        drop.point.set(hit.point.x,hit.point.y,hit.point.z).addScaledVector(normal,.005);
        const normalSpeed=drop.velocity.dot(normal);if(normalSpeed<0)drop.velocity.addScaledVector(normal,-normalSpeed);
        drop.velocity.multiplyScalar(.78);drop.velocity.y=Math.min(drop.velocity.y,-.13);
      }else drop.point.add(delta);
      drop.point.x=THREE.MathUtils.clamp(drop.point.x,this.field.minX+.002,this.field.minX+this.field.width-.002);
      drop.point.z=THREE.MathUtils.clamp(drop.point.z,this.field.minZ+.002,this.field.minZ+this.field.depth-.002);
      if(drop.point.y<=Math.max(.003,this.field.surfaceAt(drop.point.x,drop.point.z))){this.field.add(drop.point.x,drop.point.z,drop.litres);this.drops.splice(i,1);}
    }
    this.field.update(dt);
    for(let i=0;i<this.drops.length;i++){
      const drop=this.drops[i],r=THREE.MathUtils.clamp(Math.cbrt(drop.litres*.001)*.25,.002,.013);
      this.transform.position.copy(drop.point);this.transform.scale.set(r,r*(1+Math.min(2,drop.velocity.length()*.22)),r);this.transform.updateMatrix();this.droplets.setMatrixAt(i,this.transform.matrix);
      // A short motion trail reads as falling water rather than a rigid wire.
      // This visual cap never changes the batch's velocity or carried litres.
      const speed=drop.velocity.length(),trailLength=Math.min(.04,speed*.008);
      this.streakPositions.set(drop.point.toArray(),i*6);this.streakPositions.set(drop.point.clone().addScaledVector(drop.velocity,-trailLength/Math.max(speed,.0001)).toArray(),i*6+3);
    }
    this.droplets.count=this.drops.length;this.droplets.instanceMatrix.needsUpdate=true;
    this.streaks.geometry.setDrawRange(0,this.drops.length*2);this.streaks.geometry.getAttribute('position').needsUpdate=true;
    if(this.geometryTime>=1/20){this.geometryTime=0;this.rebuildGeometry();}
  }
  private rebuildGeometry():void{
    const f=this.field,stride=f.columns+1;
    for(let z=0;z<=f.rows;z++)for(let x=0;x<=f.columns;x++){
      let height=0,depth=0,count=0;
      for(const dz of [-1,0])for(const dx of [-1,0])if(x+dx>=0&&x+dx<f.columns&&z+dz>=0&&z+dz<f.rows){const i=(z+dz)*f.columns+x+dx;height+=f.bed[i]+f.depths[i];depth+=f.depths[i];count++;}
      const v=z*stride+x;this.positions[v*3]=f.minX+x*f.dx;this.positions[v*3+1]=Math.max(.0002,height/count);this.positions[v*3+2]=f.minZ+z*f.dz;this.thickness[v]=depth/count;
    }
    let count=0;
    for(let z=0;z<f.rows;z++)for(let x=0;x<f.columns;x++)if(f.depths[z*f.columns+x]>.000003){const a=z*stride+x;this.indices.set([a,a+stride,a+1,a+1,a+stride,a+stride+1],count);count+=6;}
    this.surfaceGeometry.getAttribute('position').needsUpdate=true;this.surfaceGeometry.getAttribute('waterDepth').needsUpdate=true;this.surfaceGeometry.index!.needsUpdate=true;
    this.surfaceGeometry.setDrawRange(0,count);this.surfaceGeometry.computeVertexNormals();this.surface.visible=count>0;
  }
  get telemetry(){const airborne=this.drops.reduce((sum,drop)=>sum+drop.litres,0),floor=this.field.volumeLitres;return{vendor:'Water Pro 3.5.1',active:this.waterProActive,backend:this.waterProBackend,receivedLitres:this.receivedLitres,runoffLitres:this.runoffLitres,emissionLitres:this.emissionLitres,airborneLitres:airborne,floorLitres:floor,conservationErrorLitres:this.receivedLitres-airborne-floor,wetAreaM2:this.field.wetArea,meanDepthMm:floor/(this.field.width*this.field.depth),maxDepthMm:this.field.maxDepth*1000,activeDrops:this.drops.length,dropBudget:128,flowCells:this.field.depths.length,sedimentKg:this.sedimentKg,seconds:this.time};}
}
