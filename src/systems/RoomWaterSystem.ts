import * as THREE from 'three';
import type { BrickWall } from '../world/BrickWall';
import { RoomWaterField } from './RoomWaterField';

export interface WaterRunoff {point:THREE.Vector3;normal:THREE.Vector3;litres:number;mortarKg:number}
export interface WaterEmission {origin:THREE.Vector3;velocity:THREE.Vector3;litres:number}
export interface WaterJetState {active:boolean;origin:THREE.Vector3;direction:THREE.Vector3;flowLitresPerSecond:number;speedMps:number;spreadRadians:number;impactPoint?:THREE.Vector3;impactNormal?:THREE.Vector3}
type Drop={point:THREE.Vector3;velocity:THREE.Vector3;litres:number;age:number};

/** Room-scale water accounting and finite geometry; Water Pro supplies the
 * actual optical surface material through Renderer.attachRoomWater. */
export class RoomWaterSystem {
  readonly field=new RoomWaterField();
  readonly group=new THREE.Group();
  readonly surfaceGeometry=new THREE.BufferGeometry();
  readonly surface=new THREE.Mesh(this.surfaceGeometry,new THREE.MeshPhysicalMaterial({color:0x94bdc4,roughness:.12,metalness:.05,transparent:true,opacity:.62,depthWrite:false}));
  readonly droplets=new THREE.InstancedMesh(new THREE.SphereGeometry(1,10,8),new THREE.MeshPhysicalMaterial({color:0xd8f0ed,roughness:.07,metalness:.05,transparent:true,opacity:.4,depthWrite:false}),128);
  readonly streaks=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xc5e7eb,transparent:true,opacity:.22}));
  readonly jetState:WaterJetState={active:false,origin:new THREE.Vector3(),direction:new THREE.Vector3(0,0,-1),flowLitresPerSecond:0,speedMps:8,spreadRadians:.12};
  private readonly streamCount=25;
  private readonly streamSteps=14;
  private readonly jetStreams=new THREE.InstancedMesh(new THREE.CylinderGeometry(1,1,1,8,1,true),new THREE.MeshPhysicalMaterial({color:0xd4e9e8,emissive:0x172123,roughness:.045,metalness:.05,transparent:true,opacity:.3,depthWrite:false}),25*14);
  private readonly sprayDrops=new THREE.InstancedMesh(new THREE.SphereGeometry(1,8,6),new THREE.MeshPhysicalMaterial({color:0xe1f3f3,emissive:0x151a1b,roughness:.06,transparent:true,opacity:.55,depthWrite:false}),160);
  private readonly coreSides=16;
  private readonly corePositions=new Float32Array(15*16*3);
  private readonly jetCore=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshPhysicalMaterial({color:0xb7d8db,emissive:0x101719,roughness:.035,metalness:.05,clearcoat:1,clearcoatRoughness:.03,transparent:true,opacity:.46,depthWrite:false}));
  private readonly upAxis=new THREE.Vector3(0,1,0);
  private jetGeometryTime=0;
  private jetSegments=0;
  private sprayCount=0;
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
    this.jetStreams.name='Water gun continuous curved shower streams';this.sprayDrops.name='Water gun moving droplets and impact splash';
    this.jetCore.name='Cohesive transparent water gun pressure column';this.jetCore.frustumCulled=false;this.jetCore.visible=false;
    this.jetCore.geometry.setAttribute('position',new THREE.BufferAttribute(this.corePositions,3).setUsage(THREE.DynamicDrawUsage));
    const coreIndices=[];
    for(let ring=0;ring<this.streamSteps;ring++)for(let side=0;side<this.coreSides;side++){
      const a=ring*this.coreSides+side,b=ring*this.coreSides+(side+1)%this.coreSides;
      coreIndices.push(a,b,a+this.coreSides,b,b+this.coreSides,a+this.coreSides);
    }
    this.jetCore.geometry.setIndex(coreIndices);this.jetCore.geometry.setDrawRange(0,0);
    for(const mesh of [this.jetStreams,this.sprayDrops]){mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.count=0;}
    this.group.add(this.surface,this.droplets,this.streaks,this.jetStreams,this.sprayDrops,this.jetCore);scene.add(this.group);this.rebuildGeometry();
  }
  setJetState(state:WaterJetState):void{
    // Re-anchor immediately while the wrist/camera moves; a 30 Hz visual
    // throttle must never leave a detached jet behind the visible nozzle.
    if(state.active&&(this.jetState.origin.distanceToSquared(state.origin)>1e-8||this.jetState.direction.dot(state.direction)<.999999))this.jetGeometryTime=1/30;
    this.jetState.active=state.active;
    this.jetState.origin.copy(state.origin);this.jetState.direction.copy(state.direction).normalize();
    this.jetState.flowLitresPerSecond=Math.max(0,state.flowLitresPerSecond);this.jetState.speedMps=Math.max(.1,state.speedMps);this.jetState.spreadRadians=THREE.MathUtils.clamp(state.spreadRadians,0,.6);
    if(state.impactPoint)this.jetState.impactPoint=state.impactPoint.clone();
    if(state.impactNormal)this.jetState.impactNormal=state.impactNormal.clone();
    if(!state.active){this.jetState.impactPoint=undefined;this.jetState.impactNormal=undefined;}
    if(!state.active){this.jetStreams.count=0;this.sprayDrops.count=0;this.jetCore.visible=false;this.jetSegments=0;this.sprayCount=0;}
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
    dt=Math.max(0,Math.min(dt,.1));this.time+=dt;this.geometryTime+=dt;this.jetGeometryTime+=dt;
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
      this.transform.position.copy(drop.point);this.transform.quaternion.setFromUnitVectors(this.upAxis,drop.velocity.clone().normalize());this.transform.scale.set(r,r*(1+Math.min(2,drop.velocity.length()*.22)),r);this.transform.updateMatrix();this.droplets.setMatrixAt(i,this.transform.matrix);
      // A short motion trail reads as falling water rather than a rigid wire.
      // This visual cap never changes the batch's velocity or carried litres.
      const speed=drop.velocity.length(),trailLength=Math.min(.04,speed*.008);
      this.streakPositions.set(drop.point.toArray(),i*6);this.streakPositions.set(drop.point.clone().addScaledVector(drop.velocity,-trailLength/Math.max(speed,.0001)).toArray(),i*6+3);
    }
    this.droplets.count=this.drops.length;this.droplets.instanceMatrix.needsUpdate=true;
    this.streaks.geometry.setDrawRange(0,this.drops.length*2);this.streaks.geometry.getAttribute('position').needsUpdate=true;
    if(this.jetState.active&&this.jetGeometryTime>=1/30){this.jetGeometryTime=0;this.updateJetVisuals();}
    if(this.geometryTime>=1/20){this.geometryTime=0;this.rebuildGeometry();}
  }
  /** A fixed visual budget samples the ballistic nozzle sheet. Water accounting
   * remains exclusively in emission/runoff batches: these are never extra litres. */
  private updateJetVisuals():void{
    const jet=this.jetState,direction=jet.direction;
    jet.impactPoint=undefined;jet.impactNormal=undefined;
    const right=new THREE.Vector3().crossVectors(direction,Math.abs(direction.y)>.95?new THREE.Vector3(1,0,0):this.upAxis).normalize();
    const up=new THREE.Vector3().crossVectors(right,direction).normalize();
    const radius=THREE.MathUtils.clamp(Math.sqrt(jet.flowLitresPerSecond*.001/(Math.PI*jet.speedMps*this.streamCount))*.6,.0011,.007);
    const flightTime=Math.min(1.4,5/jet.speedMps);
    const corePoints:THREE.Vector3[]=[];
    let segments=0,spray=0;
    const drawDrop=(point:THREE.Vector3,velocity:THREE.Vector3,r:number)=>{
      if(spray>=160)return;
      this.transform.position.copy(point);this.transform.quaternion.setFromUnitVectors(this.upAxis,velocity.clone().normalize());
      this.transform.scale.set(r,r*(1+Math.min(3,velocity.length()*.18)),r);this.transform.updateMatrix();this.sprayDrops.setMatrixAt(spray++,this.transform.matrix);
    };
    for(let i=0;i<this.streamCount;i++){
      const ring=i===0?0:Math.sqrt(i/(this.streamCount-1)),angle=i*2.399963229728653;
      const streamDirection=direction.clone().addScaledVector(right,Math.cos(angle)*ring*Math.tan(jet.spreadRadians)).addScaledVector(up,Math.sin(angle)*ring*Math.tan(jet.spreadRadians)).normalize();
      const origin=jet.origin.clone().addScaledVector(right,Math.cos(angle)*ring*.014).addScaledVector(up,Math.sin(angle)*ring*.014);
      if(i===0)corePoints.push(origin.clone());
      const velocity=streamDirection.clone().multiplyScalar(jet.speedMps);
      const pointAt=(time:number)=>origin.clone().addScaledVector(velocity,time).addScaledVector(this.upAxis,-4.905*time*time);
      let previous=origin.clone(),impact:THREE.Vector3|undefined,normal:THREE.Vector3|undefined;
      for(let step=1;step<=this.streamSteps;step++){
        const t=flightTime*step/this.streamSteps,next=pointAt(t),delta=next.clone().sub(previous);
        const hit=this.wall.volume.raycast(previous,delta.clone().normalize(),delta.length());
        if(hit){next.set(hit.point.x,hit.point.y,hit.point.z);normal=new THREE.Vector3(hit.normal.x,hit.normal.y,hit.normal.z);impact=next.clone();}
        const height=this.field.surfaceAt(next.x,next.z);
        if(!hit&&next.y<=height){const fraction=THREE.MathUtils.clamp((previous.y-height)/Math.max(.000001,previous.y-next.y),0,1);next.copy(previous).lerp(pointAt(t),fraction);next.y=height;impact=next.clone();normal=this.upAxis.clone();}
        if(!impact){
          const borderDelta=next.clone().sub(previous);let fraction=1;
          for(const axis of ['x','z'] as const){
            const min=axis==='x'?this.field.minX:this.field.minZ,max=min+(axis==='x'?this.field.width:this.field.depth);
            if(next[axis]<min||next[axis]>max){const hitFraction=((next[axis]<min?min:max)-previous[axis])/borderDelta[axis];if(hitFraction>=0&&hitFraction<fraction){fraction=hitFraction;normal=new THREE.Vector3();normal[axis]=next[axis]<min?1:-1;}}
          }
          if(fraction<1){next.copy(previous).addScaledVector(borderDelta,fraction);impact=next.clone();}
        }
        const length=previous.distanceTo(next);
        if(i===0)corePoints.push(next.clone());
        if(length>.0001){
          this.transform.position.copy(previous).lerp(next,.5);this.transform.quaternion.setFromUnitVectors(this.upAxis,next.clone().sub(previous).normalize());
          // Moving necks in the liquid columns and bright beads convey flow.
          const neck=.82+.18*Math.sin(this.time*32-step*1.7+i);
          this.transform.scale.set(radius*neck,length,radius*neck);this.transform.updateMatrix();this.jetStreams.setMatrixAt(segments++,this.transform.matrix);
          if(step%4===i%4){const phase=(this.time*jet.speedMps*.8+i*.37)%1;drawDrop(previous.clone().lerp(next,phase),velocity,radius*1.5);}
        }
        if(impact)break;previous.copy(next);
      }
      if(impact&&normal){
        if(i===0){jet.impactPoint=impact.clone();jet.impactNormal=normal.clone();}
        for(let k=0;k<2;k++){
          const age=(this.time*2.8+i*.137+k*.43)%1*.22;
          const tangent=new THREE.Vector3(Math.cos(angle+k*2),.6,Math.sin(angle+k*2));
          const splashVelocity=normal.clone().multiplyScalar(.45+Math.min(1.5,jet.speedMps*.045)).add(tangent.multiplyScalar(.45));
          const point=impact.clone().addScaledVector(normal,.004).addScaledVector(splashVelocity,age).addScaledVector(this.upAxis,-4.905*age*age);
          if(point.y>this.field.surfaceAt(point.x,point.z))drawDrop(point,splashVelocity.clone().addScaledVector(this.upAxis,-9.81*age),radius*.9);
        }
      }
    }
    this.jetStreams.count=segments;this.sprayDrops.count=spray;this.jetSegments=segments;this.sprayCount=spray;
    this.jetStreams.instanceMatrix.needsUpdate=true;this.sprayDrops.instanceMatrix.needsUpdate=true;
    this.updatePressureColumn(corePoints,right);
  }
  private updatePressureColumn(points:THREE.Vector3[],right:THREE.Vector3):void{
    const jet=this.jetState;
    this.jetCore.visible=jet.flowLitresPerSecond>=3&&points.length>1;
    if(!this.jetCore.visible)return;
    const baseRadius=THREE.MathUtils.clamp(Math.sqrt(jet.flowLitresPerSecond*.001/(Math.PI*jet.speedMps))*.84,.006,.03);
    let travelled=0;
    for(let ring=0;ring<points.length;ring++){
      if(ring>0)travelled+=points[ring].distanceTo(points[ring-1]);
      const tangent=points[Math.min(points.length-1,ring+1)].clone().sub(points[Math.max(0,ring-1)]).normalize();
      const up=new THREE.Vector3().crossVectors(right,tangent).normalize();
      const neck=.9+.07*Math.sin(travelled*39-this.time*26)+.03*Math.sin(travelled*91-this.time*48);
      // Keep the column joined to the nozzle, expanding into a coherent heavy
      // stream under FLOOD. Smaller bright strands remain around its boundary.
      const radius=THREE.MathUtils.lerp(Math.min(.017,baseRadius),baseRadius,Math.min(1,travelled*4))*neck;
      for(let side=0;side<this.coreSides;side++){
        const angle=side/this.coreSides*Math.PI*2;
        const ripple=1+.055*Math.sin(angle*3+travelled*28-this.time*18);
        const point=points[ring].clone().addScaledVector(right,Math.cos(angle)*radius*ripple).addScaledVector(up,Math.sin(angle)*radius*ripple);
        this.corePositions.set(point.toArray(),(ring*this.coreSides+side)*3);
      }
    }
    // Unused tail rings collapse to the end; normal generation never samples
    // stale previous trajectories behind the current collision point.
    for(let ring=points.length;ring<=this.streamSteps;ring++)this.corePositions.copyWithin(ring*this.coreSides*3,(points.length-1)*this.coreSides*3,points.length*this.coreSides*3);
    this.jetCore.geometry.setDrawRange(0,(points.length-1)*this.coreSides*6);
    this.jetCore.geometry.getAttribute('position').needsUpdate=true;this.jetCore.geometry.computeVertexNormals();
  }
  private rebuildGeometry():void{
    const f=this.field,stride=f.columns+1;
    let hasWater=false;
    for(let z=0;z<=f.rows;z++)for(let x=0;x<=f.columns;x++){
      let height=0,depth=0,count=0;
      for(const dz of [-1,0])for(const dx of [-1,0])if(x+dx>=0&&x+dx<f.columns&&z+dz>=0&&z+dz<f.rows){const i=(z+dz)*f.columns+x+dx;height+=f.bed[i]+f.depths[i];depth+=f.depths[i];count++;}
      // The optical shoreline spans neighbouring dry cells. A compact Gaussian
      // reconstruction prevents square cell cut-outs without moving physical
      // water or changing the conservative field's surface heights/volume.
      let opticalDepth=0,weight=0;
      for(let dz=-2;dz<=1;dz++)for(let dx=-2;dx<=1;dx++)if(x+dx>=0&&x+dx<f.columns&&z+dz>=0&&z+dz<f.rows){
        const w=Math.exp(-((dx+.5)**2+(dz+.5)**2)/1.1),i=(z+dz)*f.columns+x+dx;
        opticalDepth+=f.depths[i]*w;weight+=w;
      }
      const v=z*stride+x;this.positions[v*3]=f.minX+x*f.dx;this.positions[v*3+1]=Math.max(.0002,height/count);this.positions[v*3+2]=f.minZ+z*f.dz;this.thickness[v]=opticalDepth/weight;
      hasWater ||= depth>0.000003;
    }
    let count=0;
    // Keep dry perimeter triangles: their zero waterDepth lets the Water Pro
    // alpha fade finish continuously rather than clipping at a wet-cell edge.
    for(let z=0;z<f.rows;z++)for(let x=0;x<f.columns;x++){const a=z*stride+x;this.indices.set([a,a+stride,a+1,a+1,a+stride,a+stride+1],count);count+=6;}
    this.surfaceGeometry.getAttribute('position').needsUpdate=true;this.surfaceGeometry.getAttribute('waterDepth').needsUpdate=true;this.surfaceGeometry.index!.needsUpdate=true;
    this.surfaceGeometry.setDrawRange(0,hasWater?count:0);this.surfaceGeometry.computeVertexNormals();this.surface.visible=hasWater;
  }
  get telemetry(){const airborne=this.drops.reduce((sum,drop)=>sum+drop.litres,0),floor=this.field.volumeLitres;return{vendor:'Water Pro 3.5.1',active:this.waterProActive,backend:this.waterProBackend,receivedLitres:this.receivedLitres,runoffLitres:this.runoffLitres,emissionLitres:this.emissionLitres,airborneLitres:airborne,floorLitres:floor,conservationErrorLitres:this.receivedLitres-airborne-floor,wetAreaM2:this.field.wetArea,meanDepthMm:floor/(this.field.width*this.field.depth),maxDepthMm:this.field.maxDepth*1000,activeDrops:this.drops.length,dropBudget:128,flowCells:this.field.depths.length,jetActive:this.jetState.active,jetFlowLitresPerSecond:this.jetState.flowLitresPerSecond,jetSpeedMps:this.jetState.speedMps,jetStreamSegments:this.jetSegments,jetStreamBudget:this.streamCount*this.streamSteps,sprayDrops:this.sprayCount,sprayBudget:160,jetImpact:this.jetState.impactPoint?.toArray(),sedimentKg:this.sedimentKg,seconds:this.time};}
}
