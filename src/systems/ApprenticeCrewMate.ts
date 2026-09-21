import * as THREE from 'three';
import type {Game} from '../core/Game';
import {WorkerBody} from '../player/WorkerBody';
import {FPSRig} from '../player/FPSRig';
import {buildToolModel} from '../player/ToolModels';
import {MAX_WRIST_REACH_M,type WorkerGripTarget} from '../player/WorkerArm';
import {apprenticePath,type FloorPoint} from './ApprenticeNavigation';
import {APPRENTICE_PIPE_LENGTH_M,type ApprenticePipeKind} from './ApprenticePipeBatch';
import type {ApprenticePipeBatch} from './ApprenticePipeBatch';
import type {ApprenticePipeYard} from './ApprenticePipeYard';

/** Additional physical worker with an independent cutter, path and stock receipts. */
export class ApprenticeCrewMate {
  readonly body:WorkerBody;
  readonly ready:Promise<void>;
  readonly camera=new THREE.PerspectiveCamera(65,1,.025,60);
  private readonly rig=new FPSRig();
  private readonly velocity=new THREE.Vector3();
  private readonly cutter=buildToolModel('cutter');
  private readonly target=new THREE.Vector3();
  private path:FloorPoint[]=[];
  private assignment:{bundle:number;kind:ApprenticePipeKind;target:number;produced:number;elapsed:number;step:'approach'|'cut'}|null=null;
  private blocked=false;

  constructor(private readonly game:Game,readonly index:number,private readonly batch:ApprenticePipeBatch,private readonly yard:ApprenticePipeYard){
    const scene=game.renderer.scene;
    this.body=new WorkerBody(scene,{detail:'apprentice',castShadow:!matchMedia('(pointer:coarse)').matches});this.body.name=`Apprentice ${index}`;this.body.overview=true;this.ready=this.body.ready;
    this.camera.position.set(2.65,1.65,.25+index*.39);this.camera.add(this.rig);scene.add(this.camera);
    this.rig.show('hammer');this.rig.visible=false;this.camera.visible=false;
    this.cutter.name=`Apprentice ${index} cutter`;this.cutter.visible=false;scene.add(this.cutter);
  }
  get active():boolean{return this.assignment!==null;}
  get isBlocked():boolean{return this.blocked;}
  get done():boolean{return this.assignment===null&&!this.blocked;}
  get produced():number{return this.assignment?.produced??0;}
  get obstacle(){const p=this.camera.position;return{id:`apprentice-${this.index}`,minX:p.x-.18,maxX:p.x+.18,minZ:p.z-.08,maxZ:p.z+.28};}
  assign(bundle:number,kind:ApprenticePipeKind,target:number):void{
    this.assignment={bundle,kind,target,produced:0,elapsed:0,step:'approach'};this.blocked=false;this.path=[];
  }
  cancel():void{this.assignment=null;this.blocked=false;this.path=[];this.cutter.visible=false;}
  resume():void{this.blocked=false;this.path=[];}
  update(dt:number,visible:boolean):'working'|'done'|'blocked'{
    this.body.visible=visible;this.camera.visible=visible;this.cutter.visible=visible&&this.assignment?.step==='cut';
    if(!visible||!this.body.loaded)return'working';
    dt=Math.min(dt,.05);this.velocity.set(0,0,0);
    const job=this.assignment;
    if(job){
      const center=this.game.pvc.stock.bundleCenter(job.bundle);
      const height=job.kind==='socket'?.95:1.7;
      this.camera.position.y=THREE.MathUtils.damp(this.camera.position.y,height,6,dt);
      if(job.step==='approach'){
        const destination={x:3.13,z:center.z-.1};
        const p=this.camera.position,distance=Math.hypot(destination.x-p.x,destination.z-p.z);
        if(distance<.08){job.step='cut';job.elapsed=0;this.path=[];}
        else {
          if(!this.path.length)this.path=apprenticePath(p,destination,this.game.mixing.collisionObstacles())??[];
          const next=this.path[0];if(!next){this.blocked=true;return'blocked';}
          const dx=next.x-p.x,dz=next.z-p.z,leg=Math.hypot(dx,dz);
          if(leg<.06)this.path.shift();
          else if(Math.hypot(p.x-this.game.renderer.camera.position.x,p.z-this.game.renderer.camera.position.z)>.52){
            const speed=Math.min(.9,leg/Math.max(dt,.001));this.velocity.set(dx/leg*speed,0,dz/leg*speed);p.addScaledVector(this.velocity,dt);p.y=height;
          }
        }
      }
      if(job.step==='cut'){
        const need=APPRENTICE_PIPE_LENGTH_M[job.kind]+.003;
        const source=this.batch.remnants[job.bundle].findIndex(length=>length+1e-9>=need);
        this.target.set(source<0?center.x-.025:center.x-.14,APPRENTICE_PIPE_LENGTH_M[job.kind],source<0?center.z:center.z-.085-source*.022);
        this.camera.lookAt(this.target);
        const grips=this.poseCutter();
        if(grips.length)job.elapsed+=dt;else job.elapsed=Math.max(0,job.elapsed-dt*.3);
        const moving=this.cutter.getObjectByName('cutter-moving-handle');if(moving)moving.rotation.z=.13+Math.sin(Math.min(1,job.elapsed/1.25)*Math.PI)*.48;
        if(job.elapsed>=1.25){
          const receipt=this.batch.cut(job.bundle,job.kind,()=>this.game.pvc.consumeRawForApprentice(job.bundle));
          if(!receipt){this.blocked=true;return'blocked';}
          this.yard.addCut(receipt);job.produced++;job.elapsed=-.35;
          if(job.produced>=job.target){this.cancel();return'done';}
        }
      }
    }
    this.camera.updateMatrixWorld(true);
    const grips=job?.step==='cut'?this.poseCutter():[];
    this.rig.beginFrame(dt,null,false);this.rig.update(dt,this.velocity.lengthSq()>.01);this.rig.show('hammer');
    this.body.update(dt,this.camera,{eyeHeight:this.camera.position.y,velocity:this.velocity,yaw:this.camera.rotation.y,pitch:this.camera.rotation.x},this.rig,'hammer',false,grips.length>0,grips);
    this.body.overview=true;
    return this.blocked?'blocked':this.assignment?'working':'done';
  }
  private poseCutter():WorkerGripTarget[]{
    const model=this.cutter,primary=new THREE.Vector3().fromArray(model.userData.gripPoint??[.15,.20,0]),secondary=model.userData.secondaryGripPoint as number[]|undefined,tip=new THREE.Vector3().fromArray(model.userData.tipPoint as number[]);
    this.camera.updateMatrixWorld(true);
    const shoulder=this.camera.localToWorld(new THREE.Vector3(.18,-.30,.08));
    model.quaternion.setFromUnitVectors(primary.clone().sub(tip).normalize(),shoulder.clone().sub(this.target).normalize());
    const root=this.target.clone().sub(tip.applyQuaternion(model.quaternion));
    const grip=root.clone().add(primary.clone().applyQuaternion(model.quaternion));
    if(grip.distanceTo(shoulder)>MAX_WRIST_REACH_M-.008||this.target.distanceTo(this.camera.position)>.96)return[];
    model.position.copy(root);model.updateWorldMatrix(true,true);
    const target=(side:number,local:THREE.Vector3):WorkerGripTarget=>({side,center:model.localToWorld(local.clone()),rotation:model.getWorldQuaternion(new THREE.Quaternion()),section:[.023,.023],active:true,object:model});
    return[target(1,primary),...(secondary?[target(-1,new THREE.Vector3().fromArray(secondary))]:[])];
  }
}
