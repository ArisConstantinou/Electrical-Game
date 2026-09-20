import * as THREE from 'three';
import type { BrickWall } from '../world/BrickWall';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { MortarSystem } from './MortarSystem';
import { GAME_CONFIG } from '../data/gameConfig';

type State='proud'|'loose'|'supported'|'bonded'|'floor';
interface Placement {state:State;velocityY:number;secured:boolean;contactMaterial:'brick'|'mortar'|'air'|'floor'|'box';checkTime:number;displacedKg:number;repackedKg:number;looseKg:number;supportRevision?:string}
interface CasingPart {center:THREE.Vector3;half:THREE.Vector3;axes:THREE.Vector3[]}
interface Casing {matrix:number[];parts:CasingPart[];bounds:THREE.Box3}
const BACK=new THREE.Vector3(0,0,-1),DOWN=new THREE.Vector3(0,-1,0);
const CLEARANCE=.0012;
export type BoxFitReason='fits'|'out-of-reach'|'other-box'|'masonry'|'cured-mortar';
export interface BoxFitCell {x:number;y:number;surfaceZ:number;extraDepthM:number;material:'masonry'|'cured-mortar'|'other-box'}
export interface BoxFitAssessment {
  target:{x:number;y:number;wallFrontZ:number}|null;
  required:{width:number;height:number;depth:number};
  fits:boolean;canPlace:boolean;proudDepthM:number;seatDepthM:number;backstopDepthM:number;blockedCells:BoxFitCell[];reason:BoxFitReason;message:string;
}

/** Boxes are rigid hollow casings. Insertion sweeps their backing footprint,
 * gravity sweeps their bottom faces, and only actual mortar contact bonds them. */
export class BoxPlacementSystem {
  private readonly placements=new Map<InstallationPoint,Placement>();
  private readonly casings=new WeakMap<InstallationPoint,Casing>();
  private wallFitRevision='';
  private readonly wallFitColumns=new Map<string,number|null>();
  private boxesRevision=0;
  constructor(private readonly wall:BrickWall,private readonly mortar:MortarSystem,private readonly points:InstallationPoint[]){}
  get fitRevision():string{return `${this.wall.volume.options.hollowProfile}:${this.wall.volume.impactCount}:${this.wall.volume.removedNodeCount}:${this.mortar.field.revision}:${this.boxesRevision}`;}

  /** Place a supplied box group in an authored, already-cleared cavity. The
   * mortar field is populated immediately afterwards by Game construction. */
  prepareInstalled(point:InstallationPoint):void {
    point.boxGroup.visible=true;
    point.boxGroup.levelBar.visible=false;
    point.boxGroup.position.set(0,0,0);
    point.boxGroup.rotation.set(0,0,0);
    point.updateWorldMatrix(true,true);
    const placement:Placement={state:'bonded',velocityY:0,secured:true,contactMaterial:'mortar',checkTime:.12,displacedKg:0,repackedKg:0,looseKg:0};
    this.placements.set(point,placement);
    point.boxGroup.userData.placement=placement;
    point.boxGroup.userData.minimumDepth=-.058;
    point.boxGroup.userData.finishDepth=0;
    point.boxGroup.userData.conduitEntry='bottom';
    this.boxesRevision++;
    point.chaseHits=1;
    point.pipeStep='measure';
    point.setStage('leveled');
  }

  /** Select the nearest visible casing, including boxes dropped to the floor. */
  target(camera:THREE.Camera):InstallationPoint|null{
    const ray=new THREE.Raycaster(camera.getWorldPosition(new THREE.Vector3()),camera.getWorldDirection(new THREE.Vector3()),0,GAME_CONFIG.interaction.maxDistance);
    let target:InstallationPoint|null=null,distance=Infinity;
    for(const point of this.points){if(!point.boxGroup.visible)continue;point.updateWorldMatrix(true,true);
      const hit=ray.intersectObjects(point.boxGroup.boxes,true)[0];if(hit&&hit.distance<distance){distance=hit.distance;target=point;}}
    return target;
  }

  /** Exact rectangular solids used by ElectricalBox, retaining its hollow centre. */
  private casing(point:InstallationPoint):Casing{
    point.updateWorldMatrix(true,true);const matrix=point.boxGroup.matrixWorld.elements,cached=this.casings.get(point);
    if(cached&&matrix.every((value,index)=>value===cached.matrix[index]))return cached;
    const parts:CasingPart[]=[],bounds=new THREE.Box3();
    for(const box of point.boxGroup.boxes)for(const child of box.children){
      if(!(child instanceof THREE.Mesh)||child.geometry.type!=='BoxGeometry')continue;
      child.geometry.computeBoundingBox();const local=child.geometry.boundingBox!;
      const axes=[new THREE.Vector3().setFromMatrixColumn(child.matrixWorld,0),new THREE.Vector3().setFromMatrixColumn(child.matrixWorld,1),new THREE.Vector3().setFromMatrixColumn(child.matrixWorld,2)];
      const half=local.getSize(new THREE.Vector3()).multiplyScalar(.5).multiply(new THREE.Vector3(...axes.map(axis=>axis.length())));
      axes.forEach(axis=>axis.normalize());parts.push({center:local.getCenter(new THREE.Vector3()).applyMatrix4(child.matrixWorld),half,axes});
      bounds.union(local.clone().applyMatrix4(child.matrixWorld));
    }
    const result={matrix:[...matrix],parts,bounds};this.casings.set(point,result);return result;
  }

  /** Continuous separating-axis sweep of two rigid casing panels. */
  private panelTravel(a:CasingPart,b:CasingPart,direction:THREE.Vector3,distance:number,offset:THREE.Vector3):number|null{
    const delta=b.center.clone().sub(a.center).sub(offset),axes=[...a.axes,...b.axes];
    for(const x of a.axes)for(const y of b.axes){const cross=new THREE.Vector3().crossVectors(x,y);if(cross.lengthSq()>1e-16)axes.push(cross.normalize());}
    let enter=-Infinity,leave=Infinity;
    for(const axis of axes){
      const radius=a.half.x*Math.abs(axis.dot(a.axes[0]))+a.half.y*Math.abs(axis.dot(a.axes[1]))+a.half.z*Math.abs(axis.dot(a.axes[2]))+b.half.x*Math.abs(axis.dot(b.axes[0]))+b.half.y*Math.abs(axis.dot(b.axes[1]))+b.half.z*Math.abs(axis.dot(b.axes[2]));
      const gap=delta.dot(axis),speed=direction.dot(axis);
      if(Math.abs(speed)<1e-12){if(Math.abs(gap)>=radius-1e-9)return null;continue;}
      const t0=(gap-radius)/speed,t1=(gap+radius)/speed;enter=Math.max(enter,Math.min(t0,t1));leave=Math.min(leave,Math.max(t0,t1));
      if(enter>=leave-1e-9)return null;
    }
    if(leave<=1e-9||enter>distance+1e-9)return null;
    return Math.max(0,enter);
  }

  private casingTravel(point:InstallationPoint,direction:THREE.Vector3,distance:number,offset=new THREE.Vector3()):number|null{
    const moving=this.casing(point),start=moving.bounds.clone().translate(offset),swept=start.clone().union(start.clone().translate(direction.clone().multiplyScalar(distance)));
    let nearest:number|null=null;
    for(const other of this.points){if(other===point||!other.boxGroup.visible)continue;const fixed=this.casing(other);if(!swept.intersectsBox(fixed.bounds))continue;
      for(const a of moving.parts)for(const b of fixed.parts){const travel=this.panelTravel(a,b,direction,nearest??distance,offset);if(travel!==null&&(nearest===null||travel<nearest))nearest=travel;}
    }
    return nearest;
  }

  /** Read-only fit preview. The same complete casing footprint is checked at
   * placement time; no visible box, stage or mortar state changes on refusal. */
  assess(point:InstallationPoint,camera:THREE.Camera):BoxFitAssessment{
    const required={width:point.boxGroup.groupWidth,height:point.boxGroup.groupHeight,depth:Math.max(...point.boxGroup.boxes.map(box=>box.depth))};
    const result:BoxFitAssessment={target:null,required,fits:false,canPlace:false,proudDepthM:0,seatDepthM:0,backstopDepthM:0,blockedCells:[],reason:'out-of-reach',message:'Aim the full box group at a reachable wall cavity.'};
    const origin=camera.getWorldPosition(new THREE.Vector3()),direction=camera.getWorldDirection(new THREE.Vector3());
    if(direction.z>=-.01)return result;
    const distance=(this.wall.volume.frontZ-origin.z)/direction.z;
    if(distance<=0||distance>GAME_CONFIG.interaction.maxDistance)return result;
    const target=origin.clone().addScaledVector(direction,distance);
    result.target={x:target.x,y:target.y,wallFrontZ:this.wall.volume.frontZ};
    // The rim remains in front of the wall. Refuse an out-of-bounds aim rather
    // than moving the selected footprint away from the player's crosshair.
    if(Math.abs(target.x)+required.width/2+.006>GAME_CONFIG.room.width/2||target.y-required.height/2-.006<0||target.y+required.height/2+.006>GAME_CONFIG.room.height)return result;
    const previousPointPosition=point.position.clone(),previousPosition=point.boxGroup.position.clone(),previousRotation=point.boxGroup.quaternion.clone();
    try{
      point.position.copy(point.parent?point.parent.worldToLocal(target.clone()):target);
      point.boxGroup.position.set(0,0,0);point.boxGroup.rotation.set(0,0,0);point.updateWorldMatrix(true,true);
      const finishDepth=this.finishDepth(point),insertion=this.insertionLimit(point,result.blockedCells,finishDepth);
      result.seatDepthM=finishDepth;result.backstopDepthM=insertion.depth;result.proudDepthM=Math.max(0,insertion.depth-finishDepth);
      result.blockedCells=[...new Map(result.blockedCells.map(cell=>[`${Math.round(cell.x*1e6)}:${Math.round(cell.y*1e6)}`,cell])).values()].slice(0,4095);
      // Stop at the real masonry surface. The insertion sweep ends at this
      // proud pose, not at an imaginary flush pose behind the obstruction.
      const startDepth=Math.max(insertion.depth,finishDepth,origin.z-.08-this.wall.volume.frontZ);
      const travel=startDepth-insertion.depth;
      if(this.casingTravel(point,BACK,travel,new THREE.Vector3(0,0,startDepth))!==null){
        result.reason='other-box';result.message='Another box blocks this position. Leave room for both casings and their front rims.';
        result.blockedCells.push({x:target.x,y:target.y,surfaceZ:this.wall.volume.frontZ,extraDepthM:required.depth,material:'other-box'});
        return result;
      }
      if(insertion.depth>finishDepth+CLEARANCE+1e-8){
        result.reason=insertion.material==='mortar'?'cured-mortar':'masonry';
        const footprint=`${Math.round(required.width*1000)} × ${Math.round(required.height*1000)} × ${Math.round(required.depth*1000)} mm`;
        result.message=`Box would protrude ${Math.ceil(result.proudDepthM*1000)} mm beyond the mortar finish. ${result.reason==='cured-mortar'?'Hard mortar':'Brick'} stops it; deepen the marked ${footprint} recess.`;
        return result;
      }
      result.fits=true;result.canPlace=true;result.reason='fits';result.message='Full box assembly fits at or behind the mortar finish plane.';return result;
    }finally{
      point.position.copy(previousPointPosition);point.boxGroup.position.copy(previousPosition);point.boxGroup.quaternion.copy(previousRotation);point.updateWorldMatrix(true,true);
    }
  }

  place(point:InstallationPoint,camera:THREE.Camera):{success:boolean;message:string}{
    if(point.boxGroup.visible){
      point.updateWorldMatrix(true,true);
      const ray=new THREE.Raycaster(camera.getWorldPosition(new THREE.Vector3()),camera.getWorldDirection(new THREE.Vector3()),0,1.25);
      if(!ray.intersectObjects(point.boxGroup.boxes,true).length)return{success:false,message:this.retrievalHint(point)!};
      return this.retrieve(point);
    }
    const assessment=this.assess(point,camera);if(!assessment.canPlace||!assessment.target)return{success:false,message:assessment.message};
    const target=new THREE.Vector3(assessment.target.x,assessment.target.y,assessment.target.wallFrontZ);
    point.position.copy(point.parent?point.parent.worldToLocal(target):target);point.boxGroup.position.set(0,0,assessment.seatDepthM);point.boxGroup.rotation.set(0,0,0);point.updateWorldMatrix(true,true);
    point.boxGroup.visible=true;point.boxGroup.levelBar.visible=false;this.boxesRevision++;
    const displaced=this.mortar.pressBox(point);
    const placement:Placement={state:'loose',velocityY:0,secured:false,contactMaterial:'air',checkTime:0,...displaced};
    this.placements.set(point,placement);point.boxGroup.userData.placement=placement;point.boxGroup.userData.minimumDepth=assessment.backstopDepthM;point.boxGroup.userData.finishDepth=assessment.seatDepthM;
    point.setStage('fitted');
    return{success:true,message:'Box assembly seated flush with the mortar finish. It may move inward to the physical back-stop, never outward beyond this plane.'};
  }

  /** Explain inventory state before a generic wall-reach check obscures it. */
  retrievalHint(point:InstallationPoint):string|null {
    if(!point.boxGroup.visible)return null;
    const placement=this.placements.get(point);
    if(placement?.state==='floor')return 'Your box is on the floor. Look down at it, move close and use BOX to pick it up before placing it elsewhere.';
    if(placement?.state==='loose')return 'Your box is falling. Follow it to the floor and use BOX to pick it up.';
    return 'Your box is already placed. Aim at that box and use BOX to pick it up before choosing another position.';
  }

  retrieve(point:InstallationPoint):{success:boolean;message:string}{
    this.boxesRevision++;
    point.boxGroup.visible=false;point.boxGroup.levelBar.visible=false;this.placements.delete(point);delete point.boxGroup.userData.placement;delete point.boxGroup.userData.minimumDepth;delete point.boxGroup.userData.finishDepth;
    point.boxGroup.position.set(0,0,0);point.boxGroup.rotation.set(0,0,0);
    if(point.conduit){point.remove(point.conduit);point.conduit=null;point.pipeStep='measure';}
    point.setStage(point.chaseHits?'chasing':'inspect');
    return{success:true,message:'Box retrieved. Adjust the cavity or aim elsewhere and place it again.'};
  }

  /** Robust local finish plane from the mortar immediately around the casing
   * rims. A percentile rejects isolated proud clods while retaining a real,
   * continuous rendered finish. Bare masonry remains the zero fallback. */
  private finishDepth(point:InstallationPoint):number {
    if(!this.mortar.field.nodes.size)return 0;
    point.updateWorldMatrix(true,true);const front=this.wall.volume.frontZ,spacing=this.mortar.field.spacing,regions=point.boxGroup.boxes.map(box=>new THREE.Box3().setFromObject(box));
    const depths:number[]=[];
    for(const node of this.mortar.field.nodes.values()){
      if(node.value<.18)continue;
      const x=node.x*spacing,y=node.y*spacing,z=node.z*spacing;
      if(z<front-.018||z>front+.055)continue;
      const besideRim=regions.some(region=>{
        const nearX=x>=region.min.x-.024&&x<=region.max.x+.024&&y>=region.min.y-.024&&y<=region.max.y+.024;
        if(!nearX)return false;
        const innerX=x>region.min.x+.008&&x<region.max.x-.008,innerY=y>region.min.y+.008&&y<region.max.y-.008;
        return !(innerX&&innerY);
      });
      if(besideRim)depths.push(z+spacing*.55-front);
    }
    if(!depths.length)return 0;
    depths.sort((a,b)=>a-b);return THREE.MathUtils.clamp(depths[Math.floor((depths.length-1)*.65)],0,.04);
  }

  /** The rear casing must travel through every occupied column on insertion;
   * checking the centre alone would let intact edge bricks enter the box. */
  private insertionLimit(point:InstallationPoint,blockedCells?:BoxFitCell[],finishDepth=0):{depth:number;material:'brick'|'mortar'|'air'}{
    const front=this.wall.volume.frontZ;let required=front-.12,material:'brick'|'mortar'|'air'='air',fresh=false,hasCured=false;
    point.updateWorldMatrix(true,true);
    const groupZ=point.boxGroup.getWorldPosition(new THREE.Vector3()).z;
    const regions=point.boxGroup.boxes.map(box=>new THREE.Box3().setFromObject(box));
    const spacing=this.mortar.field.spacing;
    const wallRevision=`${this.wall.volume.options.hollowProfile}:${this.wall.volume.impactCount}:${this.wall.volume.removedNodeCount}`;
    if(wallRevision!==this.wallFitRevision||this.wallFitColumns.size>8192){this.wallFitColumns.clear();this.wallFitRevision=wallRevision;}
    // Most working beds contain only fresh paste. Classify relevant nodes once
    // instead of ray-marching their entire volume for every footprint sample.
    for(const node of this.mortar.field.nodes.values()){
      const x=node.x*spacing,y=node.y*spacing,z=node.z*spacing;
      if(node.value<.1||z<front-.22||z>front+.18||!regions.some(region=>x>=region.min.x&&x<=region.max.x&&y>=region.min.y&&y<=region.max.y))continue;
      if(node.age<3600)fresh=true;else hasCured=true;
      if(fresh&&hasCured)break;
    }
    for(const box of point.boxGroup.boxes){
      const nx=Math.ceil(box.width/.004),ny=Math.ceil(box.height/.004);
      for(let iy=0;iy<=ny;iy++)for(let ix=0;ix<=nx;ix++){
        const p=new THREE.Vector3(-box.width/2+box.width*ix/nx,-box.height/2+box.height*iy/ny,-box.depth).applyMatrix4(box.matrixWorld),rearOffset=p.z-groupZ;p.z=front+.18;
        let cellRequired=front-.12,cellMaterial:'brick'|'mortar'|'air'='air',surfaceZ=front-.12;
        // Material deeper than the casing cannot obstruct insertion. Cache
        // exact columns (no spatial rounding) until actual masonry changes.
        const rayDepth=.18+Math.max(0,-rearOffset)+CLEARANCE;
        const columnKey=`${p.x}:${p.y}:${rayDepth}`;
        let wallZ=this.wallFitColumns.get(columnKey);
        if(wallZ===undefined){wallZ=this.wall.volume.raycast(p,BACK,rayDepth)?.point.z??null;this.wallFitColumns.set(columnKey,wallZ);}
        if(wallZ!==null&&wallZ-rearOffset+CLEARANCE>cellRequired){cellRequired=wallZ-rearOffset+CLEARANCE;cellMaterial='brick';surfaceZ=wallZ;}
        if(hasCured){
          // Fresh paste yields to the casing. Cured field material is a solid.
          for(let d=0;d<.4;d+=.004){const q=p.clone().addScaledVector(BACK,d);if(this.mortar.field.sample(q)<.35)continue;
            const state=this.mortar.field.stateAt(q);if(state.age<3600)continue;
            // The previous 4 mm sample brackets the hard mortar surface.
            // Keep the whole bracket outside the casing rather than allowing
            // the first occupied sample to put its back inside cured material.
            if(q.z+.004-rearOffset+CLEARANCE>cellRequired){cellRequired=q.z+.004-rearOffset+CLEARANCE;cellMaterial='mortar';surfaceZ=q.z+.004;}break;
          }
        }
        if(cellRequired>required){required=cellRequired;material=cellMaterial;}
        const proud=cellRequired-front-finishDepth+(fresh&&cellRequired>front?.002:0);
        if(blockedCells&&proud>CLEARANCE+1e-8)blockedCells.push({x:p.x,y:p.y,surfaceZ,extraDepthM:proud-CLEARANCE,material:cellMaterial==='mortar'?'cured-mortar':'masonry'});
      }
    }
    // Leave a small backing allowance when pressing paste against hard masonry.
    if(fresh&&required>front-.12)required+=.002;
    return{depth:required-front,material};
  }

  canAdjust(point:InstallationPoint):boolean {const p=this.placements.get(point);return !p||p.state==='supported'||p.state==='bonded';}
  constrainAdjustment(point:InstallationPoint,previousPosition:THREE.Vector3,previousTilt:number):boolean{
    const placement=this.placements.get(point);
    if(placement?.state==='supported'&&!placement.secured&&(placement.contactMaterial==='brick'||placement.contactMaterial==='box')&&point.boxGroup.rotation.z!==previousTilt){
      // A dry casing rotates on its support rather than driving its lower
      // corner into the ledge. Measure the actual casing (never the level bar)
      // and preserve its lowest point before validating the proposed pose.
      const proposedPosition=point.boxGroup.position.clone(),proposedTilt=point.boxGroup.rotation.z;
      point.boxGroup.position.copy(previousPosition);point.boxGroup.rotation.z=previousTilt;
      const previousBottom=this.casing(point).bounds.min.y;
      point.boxGroup.position.copy(proposedPosition);point.boxGroup.rotation.z=proposedTilt;
      const proposedBottom=this.casing(point).bounds.min.y;
      if(Number.isFinite(previousBottom)&&Number.isFinite(proposedBottom))point.boxGroup.position.y+=previousBottom-proposedBottom;
    }
    const finishDepth=this.finishDepth(point),depth=this.insertionLimit(point,undefined,finishDepth).depth;
    let accepted=point.boxGroup.position.z>=depth&&point.boxGroup.position.z<=finishDepth+1e-8&&this.canAdjust(point);
    if(accepted){
      const proposed=point.boxGroup.position.clone(),tilt=point.boxGroup.rotation.z,translation=previousPosition.clone().sub(proposed);
      if(tilt===previousTilt){const distance=translation.length();accepted=this.casingTravel(point,distance?translation.clone().multiplyScalar(-1/distance):BACK,distance,translation)===null;}
      else{
        // A level adjustment rotates rigid panels in small increments; test the
        // full arc as well as its final pose, rather than teleporting past a rim.
        const steps=Math.max(1,Math.ceil(Math.abs(tilt-previousTilt)/.002));
        for(let step=1;step<=steps&&accepted;step++){const t=step/steps;point.boxGroup.position.lerpVectors(previousPosition,proposed,t);point.boxGroup.rotation.z=previousTilt+(tilt-previousTilt)*t;accepted=this.casingTravel(point,BACK,0)===null;}
        point.boxGroup.position.copy(proposed);point.boxGroup.rotation.z=tilt;
      }
    }
    if(!accepted){point.boxGroup.position.copy(previousPosition);point.boxGroup.rotation.z=previousTilt;}
    else{this.mortar.pressBox(point);this.boxesRevision++;if(placement)placement.checkTime=0;}
    point.updateWorldMatrix(true,true);
    point.boxGroup.userData.minimumDepth=depth;
    point.boxGroup.userData.finishDepth=finishDepth;
    return accepted;
  }

  private rearBond(point:InstallationPoint,allowCured=false):{tack:boolean;bonded:boolean}{
    if(!this.mortar.field.nodes.size)return{tack:false,bonded:false};
    let contacts=0,stable=0,total=0;point.updateWorldMatrix(true,true);
    for(const box of point.boxGroup.boxes){
      const nx=Math.ceil(box.width/.018),ny=4;
      for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
        total++;const p=new THREE.Vector3(-box.width*.42+box.width*.84*x/Math.max(1,nx-1),-box.height*.38+box.height*.76*y/(ny-1),-box.depth+.001).applyMatrix4(box.matrixWorld);
        const hit=this.mortar.field.raycast(p,BACK,.013);if(!hit)continue;
        const state=this.mortar.field.stateAt(hit.point);if(state.dilution>.5||(!allowCured&&state.age>=3600))continue;
        contacts++;if(state.age>=1.3)stable++;
      }
    }
    const sideContacts=[0,0,0,0],sideStable=[0,0,0,0];let sideTotal=0;
    for(const box of point.boxGroup.boxes)for(let side=0;side<4;side++)for(let i=0;i<4;i++){
      const t=-.6+i*.4,horizontal=side<2,sign=side%2===0?-1:1;
      const p=new THREE.Vector3(horizontal?box.width*.5*sign:box.width*.5*t,horizontal?box.height*.5*t:box.height*.5*sign,-box.depth*.55).applyMatrix4(box.matrixWorld);
      const direction=new THREE.Vector3(horizontal?sign:0,horizontal?0:sign,0).transformDirection(box.matrixWorld);
      const hit=this.mortar.field.raycast(p,direction,.011);sideTotal++;if(!hit)continue;
      const state=this.mortar.field.stateAt(hit.point);if(state.dilution>.5||(!allowCured&&state.age>=3600))continue;sideContacts[side]++;if(state.age>=1.3)sideStable[side]++;
    }
    const enough=(counts:number[])=>counts.filter(n=>n>0).length>=2&&counts.reduce((a,b)=>a+b,0)/Math.max(1,sideTotal)>=.35;
    return{tack:contacts/Math.max(1,total)>=.32||enough(sideContacts),bonded:stable/Math.max(1,total)>=.32||enough(sideStable)};
  }

  private downwardClearance(point:InstallationPoint,distance:number):{distance:number;material:'brick'|'mortar'|'floor'|'air'|'box'}{
    let allowed=distance,material:'brick'|'mortar'|'floor'|'air'|'box'='air';point.updateWorldMatrix(true,true);
    const boxTravel=this.casingTravel(point,DOWN,distance+CLEARANCE);if(boxTravel!==null){allowed=Math.max(0,boxTravel-CLEARANCE);material='box';}
    for(const box of point.boxGroup.boxes){
      const nx=Math.ceil((box.width+.012)/.004),nz=Math.ceil((box.depth-.006)/.004);
      const depths=Array.from({length:nz+1},(_,i)=>-box.depth+.0007+(box.depth-.0067)*i/nz);depths.push(.003);
      for(let x=0;x<=nx;x++)for(const z of depths){
        const rim=z>0,localX=-(box.width+(rim?.012:0))/2+(box.width+(rim?.012:0))*x/nx;
        const p=new THREE.Vector3(localX,-box.height/2-(rim?.006:0),z).applyMatrix4(box.matrixWorld);
        if(p.y-CLEARANCE<allowed){allowed=Math.max(0,p.y-CLEARANCE);material='floor';}
        const wall=this.wall.volume.raycast(p,DOWN,allowed+CLEARANCE);
        if(wall&&wall.distance-CLEARANCE<allowed){allowed=Math.max(0,wall.distance-CLEARANCE);material='brick';}
        const mortar=this.mortar.field.raycast(p,DOWN,allowed+CLEARANCE);
        if(mortar&&mortar.distance-CLEARANCE<allowed){allowed=Math.max(0,mortar.distance-CLEARANCE);material='mortar';}
      }
    }
    return{distance:allowed,material};
  }

  update(dt:number):void{
    dt=THREE.MathUtils.clamp(dt,0,.05);
    if(dt===0)return;
    for(const[point,p]of this.placements){
      if(!point.boxGroup.visible)continue;
      if(p.state==='floor'){this.refreshStage(point,p);continue;}p.checkTime-=dt;
      const due=p.checkTime<=0,revision=`${this.wall.volume.removedNodeCount}:${this.mortar.field.revision}:${this.boxesRevision}`;
      if(!due&&(p.state==='supported'||p.state==='bonded')&&p.supportRevision===revision)continue;
      if(p.checkTime<=0){
        p.checkTime=.12;const bond=this.rearBond(point,p.secured);
        if(bond.tack){p.velocityY=0;p.state=bond.bonded?'bonded':'supported';p.secured=bond.bonded;p.contactMaterial='mortar';}
        else {p.secured=false;if(p.state==='bonded'||p.state==='supported')p.state='loose';}
      }
      if(p.contactMaterial==='mortar'&&(p.state==='bonded'||p.state==='supported')){this.refreshStage(point,p);continue;}
      p.velocityY-=9.81*dt;const travel=-p.velocityY*dt,clearance=this.downwardClearance(point,travel+.0001);
      point.boxGroup.position.y-=Math.min(travel,clearance.distance);
      if(Math.min(travel,clearance.distance)>0)this.boxesRevision++;
      if(clearance.distance<travel){p.velocityY=0;p.state=clearance.material==='floor'?'floor':'supported';p.contactMaterial=clearance.material;}
      else {p.state='loose';p.contactMaterial='air';}
      p.supportRevision=`${this.wall.volume.removedNodeCount}:${this.mortar.field.revision}:${this.boxesRevision}`;
      this.refreshStage(point,p);
    }
  }
  private refreshStage(point:InstallationPoint,p:Placement):void{
    if(point.stage==='leveling'&&(p.state==='supported'||p.state==='bonded'))return;
    if(!p.secured&&['mortared','leveling','leveled','conduit','complete'].includes(point.stage)){point.boxGroup.levelBar.visible=false;point.setStage('fitted');}
  }
  get telemetry(){return this.points.map(point=>{const p=this.placements.get(point);return{id:point.definition.id,visible:point.boxGroup.visible,state:p?.state??'held',secured:p?.secured??false,protrusionMm:point.boxGroup.position.z*1000,insertionDepthMm:Math.max(0,.037-point.boxGroup.position.z)*1000,velocityY:p?.velocityY??0,contactMaterial:p?.contactMaterial??'air',displacedKg:p?.displacedKg??0,repackedKg:p?.repackedKg??0,looseKg:p?.looseKg??0};});}
}
