import * as THREE from 'three';
import type { BrickWall } from '../world/BrickWall';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { MortarSystem } from './MortarSystem';
import { GAME_CONFIG } from '../data/gameConfig';

type State='proud'|'loose'|'supported'|'bonded'|'floor';
interface Placement {state:State;velocityY:number;secured:boolean;contactMaterial:'brick'|'mortar'|'air'|'floor';checkTime:number;displacedKg:number;repackedKg:number;looseKg:number}
const BACK=new THREE.Vector3(0,0,-1),DOWN=new THREE.Vector3(0,-1,0);
const CLEARANCE=.0012;

/** Boxes are rigid hollow casings. Insertion sweeps their backing footprint,
 * gravity sweeps their bottom faces, and only actual mortar contact bonds them. */
export class BoxPlacementSystem {
  private readonly placements=new Map<InstallationPoint,Placement>();
  constructor(private readonly wall:BrickWall,private readonly mortar:MortarSystem,private readonly points:InstallationPoint[]){}

  place(point:InstallationPoint,camera:THREE.Camera):{success:boolean;message:string}{
    if(point.boxGroup.visible){
      point.updateWorldMatrix(true,true);
      const ray=new THREE.Raycaster(camera.getWorldPosition(new THREE.Vector3()),camera.getWorldDirection(new THREE.Vector3()),0,1.25);
      if(!ray.intersectObjects(point.boxGroup.boxes,true).length)return{success:false,message:'Aim at the placed box and move within reach to pick it up.'};
      return this.retrieve(point);
    }
    const origin=camera.getWorldPosition(new THREE.Vector3()),direction=camera.getWorldDirection(new THREE.Vector3());
    if(direction.z>=-.01)return{success:false,message:'Aim the box at the wall.'};
    const distance=(this.wall.volume.frontZ-origin.z)/direction.z;
    if(distance<=0||distance>GAME_CONFIG.interaction.maxDistance)return{success:false,message:'Move to the wall and choose where the box should sit.'};
    const target=origin.addScaledVector(direction,distance);
    if(Math.abs(target.x)>GAME_CONFIG.room.width/2||target.y<0||target.y>GAME_CONFIG.room.height)return{success:false,message:'Aim at a reachable part of the wall.'};
    point.placeAt(target.x,target.y);point.boxGroup.position.set(0,0,0);point.boxGroup.rotation.set(0,0,0);point.updateWorldMatrix(true,true);
    const insertion=this.insertionLimit(point);
    point.boxGroup.position.z=insertion.depth;point.boxGroup.visible=true;point.boxGroup.levelBar.visible=false;point.updateWorldMatrix(true,true);
    const displaced=this.mortar.pressBox(point);
    const placement:Placement={state:insertion.depth>.003?'proud':'loose',velocityY:0,secured:false,contactMaterial:insertion.material,checkTime:0,...displaced};
    this.placements.set(point,placement);point.boxGroup.userData.placement=placement;point.boxGroup.userData.minimumDepth=insertion.depth;
    point.setStage('fitted');
    return{success:true,message:insertion.depth>.003?`Box placed ${Math.round(insertion.depth*1000)} mm proud against the remaining material. Loose boxes settle; select BOX again to retrieve it.`:'Box placed. It will settle onto a ledge or mortar bed; pack the sides to secure it.'};
  }

  retrieve(point:InstallationPoint):{success:boolean;message:string}{
    point.boxGroup.visible=false;point.boxGroup.levelBar.visible=false;this.placements.delete(point);delete point.boxGroup.userData.placement;delete point.boxGroup.userData.minimumDepth;
    point.boxGroup.position.set(0,0,0);point.boxGroup.rotation.set(0,0,0);
    if(point.conduit){point.remove(point.conduit);point.conduit=null;point.pipeStep='measure';}
    point.setStage(point.chaseHits?'chasing':'inspect');
    return{success:true,message:'Box retrieved. Adjust the cavity or aim elsewhere and place it again.'};
  }

  /** The rear casing must travel through every occupied column on insertion;
   * checking the centre alone would let intact edge bricks enter the box. */
  private insertionLimit(point:InstallationPoint):{depth:number;material:'brick'|'mortar'|'air'}{
    const front=this.wall.volume.frontZ;let required=front,material:'brick'|'mortar'|'air'='air',fresh=false,hasCured=false;
    point.updateWorldMatrix(true,true);
    const groupZ=point.boxGroup.getWorldPosition(new THREE.Vector3()).z;
    const regions=point.boxGroup.boxes.map(box=>new THREE.Box3().setFromObject(box));
    const spacing=this.mortar.field.spacing;
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
        const hit=this.wall.volume.raycast(p,BACK,.42);
        if(hit&&hit.point.z-rearOffset+CLEARANCE>required){required=hit.point.z-rearOffset+CLEARANCE;material='brick';}
        if(hasCured){
          // Fresh paste yields to the casing. Cured field material is a solid.
          for(let d=0;d<.4;d+=.004){const q=p.clone().addScaledVector(BACK,d);if(this.mortar.field.sample(q)<.35)continue;
            const state=this.mortar.field.stateAt(q);if(state.age<3600)continue;
            // The previous 4 mm sample brackets the hard mortar surface.
            // Keep the whole bracket outside the casing rather than allowing
            // the first occupied sample to put its back inside cured material.
            if(q.z+.004-rearOffset+CLEARANCE>required){required=q.z+.004-rearOffset+CLEARANCE;material='mortar';}break;
          }
        }
      }
    }
    // Leave a small backing allowance when pressing paste against hard masonry.
    if(fresh&&required>front)required+=.002;
    return{depth:Math.max(0,required-front),material};
  }

  canAdjust(point:InstallationPoint):boolean {const p=this.placements.get(point);return !p||p.state==='supported'||p.state==='bonded';}
  constrainAdjustment(point:InstallationPoint,previousPosition:THREE.Vector3,previousTilt:number):void{
    const placement=this.placements.get(point);if(!placement)return;
    const depth=this.insertionLimit(point).depth;
    if(point.boxGroup.position.z<depth||!this.canAdjust(point)){point.boxGroup.position.copy(previousPosition);point.boxGroup.rotation.z=previousTilt;}
    else this.mortar.pressBox(point);
    point.boxGroup.userData.minimumDepth=depth;
  }

  private rearBond(point:InstallationPoint,allowCured=false):{tack:boolean;bonded:boolean}{
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

  private downwardClearance(point:InstallationPoint,distance:number):{distance:number;material:'brick'|'mortar'|'floor'|'air'}{
    let allowed=distance,material:'brick'|'mortar'|'floor'|'air'='air';point.updateWorldMatrix(true,true);
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
    for(const[point,p]of this.placements){
      if(!point.boxGroup.visible)continue;p.checkTime-=dt;
      if(p.checkTime<=0){
        p.checkTime=.12;const bond=this.rearBond(point,p.secured);
        if(bond.tack){p.velocityY=0;p.state=bond.bonded?'bonded':'supported';p.secured=bond.bonded;p.contactMaterial='mortar';}
        else {p.secured=false;if(p.state==='bonded'||p.state==='supported')p.state='loose';}
      }
      if(!p.secured&&['mortared','leveling','leveled','conduit','complete'].includes(point.stage)){point.boxGroup.levelBar.visible=false;point.setStage('fitted');}
      if(p.contactMaterial==='mortar'&&(p.state==='bonded'||p.state==='supported'))continue;
      p.velocityY-=9.81*dt;const travel=-p.velocityY*dt,clearance=this.downwardClearance(point,travel+.0001);
      point.boxGroup.position.y-=Math.min(travel,clearance.distance);
      if(clearance.distance<travel){p.velocityY=0;p.state=clearance.material==='floor'?'floor':'supported';p.contactMaterial=clearance.material;}
      else {p.state='loose';p.contactMaterial='air';}
    }
  }
  get telemetry(){return this.points.map(point=>{const p=this.placements.get(point);return{id:point.definition.id,visible:point.boxGroup.visible,state:p?.state??'held',secured:p?.secured??false,protrusionMm:point.boxGroup.position.z*1000,insertionDepthMm:Math.max(0,.037-point.boxGroup.position.z)*1000,velocityY:p?.velocityY??0,contactMaterial:p?.contactMaterial??'air',displacedKg:p?.displacedKg??0,repackedKg:p?.repackedKg??0,looseKg:p?.looseKg??0};});}
}
