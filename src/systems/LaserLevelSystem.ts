import * as THREE from 'three';
import type {BrickWall} from '../world/BrickWall';
import type {HeightMeasureSystem,HeightReferenceMark} from './HeightMeasureSystem';
import {queryWallWorkSurface} from './WallWorkSurface';
import {buildReferenceToolModel} from '../player/ReferenceToolModels';

const UP=new THREE.Vector3(0,1,0);
const DRILL_SECONDS=.8;
const DRIVE_SECONDS=.7;
interface Fixing {mark:HeightReferenceMark;progress:number;visual:THREE.Group;anchor:THREE.Mesh}
type Phase='hidden'|'aim-mark'|'out-of-reach'|'drill-ready'|'drilling'|'drilled'|'mount-ready'|'mounted'|'fastening'|'active'|'fallen';

/** One physical wall reference: drill its marked fixing, hang the laser, then tighten it. */
export class LaserLevelSystem {
  readonly root=new THREE.Group();
  readonly device=buildReferenceToolModel('laser');
  target:THREE.Vector3|null=null;
  readonly targetNormal=new THREE.Vector3(0,0,1);
  working=false;
  private phase:Phase='hidden';
  private hint='Measure a height and make a pencil mark.';
  private readonly fixings=new Map<string,Fixing>();
  private selected:HeightReferenceMark|null=null;
  private mountedMark:HeightReferenceMark|null=null;
  private fastening=0;
  private enabled=false;
  private tool='';
  private supportClock=0;
  private supportRevision=-1;
  private falling=false;
  private fallen=false;
  private readonly fallVelocity=new THREE.Vector3();
  private readonly rayOrigin=new THREE.Vector3();
  private readonly rayDirection=new THREE.Vector3();
  private readonly basis=new THREE.Matrix4();
  private readonly right=new THREE.Vector3();
  private readonly floorBounds=new THREE.Box3();

  constructor(scene:THREE.Scene,private readonly measure:HeightMeasureSystem,private readonly wall:BrickWall,private readonly stableWalls:THREE.Object3D[]=[]){
    this.root.name='Laser reference and drilled fixings';
    this.device.name='Installed wall laser';this.device.visible=false;
    // Installed equipment belongs to the room, not the held-tool draw order.
    this.device.traverse(object=>{object.renderOrder=0;object.userData.toolModelPart=false;});
    this.root.add(this.device);scene.add(this.root);this.setActive(false);
  }

  get mountedPoint():THREE.Vector3|null{return this.mountedMark?.point.clone()??null;}
  get activeHeightM():number|null{return this.enabled?this.mountedMark?.heightM??null:null;}

  update(camera:THREE.Camera,tool:string,held:boolean,dt:number,canReach:(point:THREE.Vector3,normal:THREE.Vector3)=>boolean):void {
    const seconds=Number.isFinite(dt)?THREE.MathUtils.clamp(dt,0,.05):0;
    this.updateSupport(seconds);this.updateFalling(seconds);
    this.tool=tool;this.target=null;this.selected=null;this.working=false;
    if(!['drill','driver','laser'].includes(tool)){this.phase=this.fallen?'fallen':'hidden';return;}
    const hit=queryWallWorkSurface(camera,this.wall,this.stableWalls,12);
    if(hit){
      let nearest=.10;
      for(const mark of this.measure.marks){
        if(mark.normal.dot(hit.normal)<.98)continue;
        const offset=mark.point.clone().sub(hit.point);
        if(Math.abs(offset.dot(hit.normal))>.012)continue;
        const distance=offset.length();
        if(distance<nearest){nearest=distance;this.selected=mark;}
      }
    }
    const mark=this.selected;
    if(!mark){this.phase=this.fallen?'fallen':'aim-mark';this.hint=this.fallen?'Backing broke. Pick a new marked fixing.':'Aim at a pencil height mark.';return;}
    const workPoint=mark.point.clone();
    if(tool==='driver'&&this.mountedMark?.id===mark.id)workPoint.addScaledVector(mark.normal,.013);
    this.targetNormal.copy(mark.normal);
    if(!canReach(workPoint,mark.normal)){this.phase='out-of-reach';this.hint='Move closer to the marked fixing.';return;}
    this.target=workPoint;
    const fixing=this.fixings.get(mark.id);
    if(this.mountedMark?.id===mark.id){
      if(this.enabled){this.phase='active';this.hint=tool==='laser'?'Reference set · tap to remove laser.':'Reference height is fixed.';return;}
      if(tool==='driver'){
        if(held){this.working=true;this.fastening=Math.min(1,this.fastening+seconds/DRIVE_SECONDS);}
        if(this.fastening>=1){this.setActive(true);this.working=false;this.phase='active';this.hint='Laser secured · reference height is fixed.';}
        else {this.phase=held?'fastening':'mounted';this.hint='Hold the driver to secure the laser.';}
      }else{this.phase='mounted';this.hint=tool==='laser'?'Laser hung · select DRIVER to secure it.':'Select DRIVER to secure the laser.';}
      return;
    }
    if(tool==='drill'){
      if(fixing?.progress===1){this.phase='drilled';this.hint='Fixing ready · select LASER.';return;}
      if(held){
        const next=fixing??this.createFixing(mark);this.working=true;
        next.progress=Math.min(1,next.progress+seconds/DRILL_SECONDS);
        next.visual.visible=true;next.anchor.visible=next.progress===1;
        if(next.progress===1){this.phase='drilled';this.working=false;this.hint='Hole and anchor ready · select LASER.';}
        else{this.phase='drilling';this.hint='Drilling the marked fixing…';}
      }else{this.phase='drill-ready';this.hint='Hold DRILL to prepare the fixing.';}
      return;
    }
    if(tool==='laser'){
      this.phase=fixing?.progress===1?'mount-ready':'drill-ready';
      this.hint=this.mountedMark?'Remove the existing laser before relocating it.':fixing?.progress===1?'Tap to hang the laser on this fixing.':'Drill the marked fixing before hanging the laser.';
    }else{this.phase='drill-ready';this.hint=fixing?.progress===1?'Hang the LASER before tightening it.':'Use DRILL to prepare this pencil mark.';}
  }

  action():{success:boolean;message:string}{
    const mark=this.selected;
    if(this.tool!=='laser'||!mark||!this.target)return{success:false,message:'Aim within reach of a prepared fixing.'};
    if(this.mountedMark?.id===mark.id){
      this.setActive(false);this.mountedMark=null;this.device.visible=false;this.fastening=0;this.falling=false;this.fallen=false;
      this.phase='mount-ready';return{success:true,message:'Laser removed. The drilled fixing remains.'};
    }
    if(this.mountedMark)return{success:false,message:'Remove the existing laser before relocating it.'};
    const fixing=this.fixings.get(mark.id);
    if(!fixing||fixing.progress<1)return{success:false,message:'Drill this pencil mark first.'};
    if(!this.supported(mark))return{success:false,message:'This fixing has lost its backing.'};
    this.mountedMark={...mark,point:mark.point.clone(),normal:mark.normal.clone()};
    this.device.position.copy(mark.point);this.orient(this.device,mark.normal);this.device.visible=true;
    this.fastening=0;this.falling=false;this.fallen=false;this.setActive(false);this.phase='mounted';
    return{success:true,message:'Laser hung. Use DRIVER to tighten the fixing.'};
  }

  private createFixing(mark:HeightReferenceMark):Fixing {
    const visual=new THREE.Group();visual.name=`Drilled fixing ${mark.id}`;visual.position.copy(mark.point);this.orient(visual,mark.normal);
    const hole=new THREE.Mesh(new THREE.CircleGeometry(.004,16),new THREE.MeshBasicMaterial({color:0x24221e}));hole.position.z=.0003;visual.add(hole);
    const anchor=new THREE.Mesh(new THREE.RingGeometry(.0018,.0035,16),new THREE.MeshStandardMaterial({color:0xb2a995,roughness:.9}));anchor.position.z=.0006;anchor.visible=false;visual.add(anchor);
    this.root.add(visual);
    const fixing={mark:{...mark,point:mark.point.clone(),normal:mark.normal.clone()},progress:0,visual,anchor};this.fixings.set(mark.id,fixing);return fixing;
  }

  private orient(object:THREE.Object3D,normal:THREE.Vector3):void {
    this.right.crossVectors(UP,normal).normalize();this.basis.makeBasis(this.right,UP,normal);object.quaternion.setFromRotationMatrix(this.basis);
  }

  private supported(mark:HeightReferenceMark):boolean {
    if(mark.stable)return true;
    this.rayOrigin.copy(mark.point).addScaledVector(mark.normal,.014);this.rayDirection.copy(mark.normal).negate();
    const hit=this.wall.volume.raycast(this.rayOrigin,this.rayDirection,.04);
    if(!hit)return false;
    return Math.abs((hit.point.x-mark.point.x)*mark.normal.x+(hit.point.y-mark.point.y)*mark.normal.y+(hit.point.z-mark.point.z)*mark.normal.z)<.012;
  }

  private updateSupport(dt:number):void {
    this.supportClock+=dt;if(this.supportClock<.1)return;this.supportClock=0;
    const revision=this.wall.volume.surfaceRevision;if(revision===this.supportRevision)return;this.supportRevision=revision;
    for(const fixing of this.fixings.values())if(!fixing.mark.stable&&!this.supported(fixing.mark)){fixing.visual.visible=false;fixing.progress=0;}
    if(!this.mountedMark||this.supported(this.mountedMark))return;
    this.setActive(false);this.fallVelocity.copy(this.mountedMark.normal).multiplyScalar(.16);this.mountedMark=null;this.fastening=0;this.falling=true;this.fallen=true;this.phase='fallen';
  }

  private updateFalling(dt:number):void {
    if(!this.falling)return;
    this.fallVelocity.y-=9.81*dt;this.device.position.addScaledVector(this.fallVelocity,dt);this.device.rotateX(dt*1.8);
    if(this.device.position.y<.16){
      this.floorBounds.setFromObject(this.device);
      if(this.floorBounds.min.y<=0){this.device.position.y-=this.floorBounds.min.y;this.falling=false;this.fallVelocity.set(0,0,0);}
    }
  }

  private setActive(active:boolean):void {
    this.enabled=active;
    const lens=this.device.getObjectByName('Horizontal laser lens') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>|undefined;
    if(lens){lens.material.emissiveIntensity=active?1.8:0;lens.material.color.set(active?0x55ff56:0x244b28);}
  }

  get telemetry(){return{phase:this.phase,hint:this.hint,heightM:this.mountedMark?.heightM??this.selected?.heightM??null,progress:this.mountedMark?this.fastening:this.selected?this.fixings.get(this.selected.id)?.progress??0:0,active:this.enabled,mounted:!!this.mountedMark,markId:this.mountedMark?.id??this.selected?.id??null,target:this.target?.toArray()??null,normal:this.targetNormal.toArray(),working:this.working,fallen:this.fallen,fixings:[...this.fixings].map(([id,fixing])=>({id,progress:fixing.progress,visible:fixing.visual.visible}))};}
}
