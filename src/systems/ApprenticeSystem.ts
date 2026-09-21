import * as THREE from 'three';
import type { Game } from '../core/Game';
import { WorkerBody } from '../player/WorkerBody';
import { FPSRig } from '../player/FPSRig';
import { ElectricalBox } from '../electrical/Box';
import { BoxGroup } from '../electrical/BoxGroup';
import { boxAssemblyBounds,boxAssemblyKey,boxModuleSize,type BoxModuleLayout } from '../electrical/BoxAssembly';
import { ChasingSystem } from './ChasingSystem';
import { apprenticePath,type FloorPoint } from './ApprenticeNavigation';
import type { BrickWall } from '../world/BrickWall';
import { createMixerModel,createShovelModel } from '../world/MixingStationModels';
import { buildToolModel } from '../player/ToolModels';
import { MAX_WRIST_REACH_M,type WorkerGripTarget } from '../player/WorkerArm';

type Phase='idle'|'fetching'|'picking-up'|'lifting'|'walking'|'breaking'|'construction'|'done'|'blocked';
type Mode='off'|'point'|'layout'|'plan';
type WorkStep='claim'|'return-hammer'|'water-source'|'water-drum'|'cement-source'|'cement-drum'|'sand-source'|'sand-drum'|'mixer-source'|'mixer-drum'|'mixing'|'bucket-source'|'bucket-cart'|'trowel-source'|'wall-mortar'|'box-source'|'wall-box'|'bonding';
type WorkTool='water'|'trowel'|'shovel'|'mixer'|'bucket'|'box';
interface Job {anchor:THREE.Vector3;modules:BoxModuleLayout[];targets:THREE.Vector3[];cursor:number;refinements:number;fitRefinements:number}
const FRONT=-2.41,DEPTH=.052;

/** One independent apprentice. Job confirmation is the only demolition entry point. */
export class ApprenticeSystem {
  mode:Mode='off';phase:Phase='idle';count=1;
  readonly ready:Promise<void>;
  readonly body:WorkerBody;
  readonly camera=new THREE.PerspectiveCamera(65,1,.025,60);
  readonly rig=new FPSRig();
  private readonly debris:ChasingSystem;
  private readonly hammerWall:BrickWall;
  private readonly velocity=new THREE.Vector3();
  private readonly workWallMarker=new THREE.Object3D();
  private readonly hammerRestMarker=new THREE.Object3D();
  private readonly highlight=new THREE.Group();
  private readonly ghost=new THREE.Group();
  private readonly lines:THREE.Vector3[]=[];
  private readonly lineGeometry=new THREE.PlaneGeometry(1,.009);
  private readonly linePool:THREE.Mesh[]=[];
  private readonly previewBoxes=new Map<string,ElectricalBox[]>();
  private readonly toolbar=document.createElement('section');
  private readonly status=document.createElement('div');
  private readonly paperCanvas=document.createElement('canvas');
  private readonly paper:THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>;
  private job:Job|null=null;
  private anchor:THREE.Vector3|null=null;
  private path:FloorPoint[]=[];
  private elapsed=0;
  private cooldown=0;
  private stall=0;
  private strikes=0;
  private removedVolume=0;
  private previewKey='';
  private hasHammer=false;
  private hammer:THREE.Object3D;
  private hammerParent:THREE.Object3D;
  private readonly carriedPosition=new THREE.Vector3();
  private readonly carriedRotation=new THREE.Quaternion();
  private waiting=false;
  private workStep:WorkStep='claim';
  private workElapsed=0;
  private workDestination:FloorPoint|null=null;
  private workTool:WorkTool|null=null;
  private readonly workTools=new Map<WorkTool,THREE.Object3D>();
  private readonly workTargets:THREE.Vector3[]=[];
  private workCursor=0;
  private batchCycle=0;
  private cementDone=0;
  private sandDone=0;
  private carriedKg=0;
  private workContactReady=false;
  private workGripReachM=0;
  private workTargetRangeM=0;
  private wallApproach=.69;
  private wallReachWait=0;
  private workerPoint:import('../electrical/InstallationPoint').InstallationPoint|null=null;
  private stagedBoxes:BoxGroup|null=null;
  private readonly stagedBoxPosition=new THREE.Vector3();
  private workFailure='';
  private blockedFrom:'breaking'|'construction'|null=null;
  private message='Έτοιμος για οδηγίες';
  private readonly yellow=new THREE.MeshBasicMaterial({color:0xffdc35,transparent:true,opacity:.72,depthWrite:false});

  constructor(private readonly game:Game,debris:ChasingSystem){
    const scene=game.renderer.scene;
    this.body=new WorkerBody(scene);this.body.name='Apprentice 1';this.body.overview=true;
    this.ready=this.body.ready;
    this.camera.position.set(.8,1.65,1.25);this.camera.add(this.rig);scene.add(this.camera);
    this.rig.show('hammer');this.rig.workStanceTiltDegrees=0;this.rig.workStanceSide=0;
    this.hammer=this.rig.getObjectByName('FPS hammer tool')!;
    if(!this.hammer)throw new Error('Apprentice requires the existing hammer model');
    this.hammerParent=this.hammer.parent!;
    scene.attach(this.hammer);this.hammer.position.set(.8,.2,.5);this.hammer.rotation.set(0,0,Math.PI/2);
    this.rig.visible=false;
    // World tools must be occluded by walls and the worker, unlike the player's viewmodel.
    this.hammer.traverse(o=>{o.renderOrder=0;if(o instanceof THREE.Mesh){const source=Array.isArray(o.material)?o.material:[o.material];const materials=source.map(m=>{const c=m.clone();c.transparent=false;c.depthTest=true;c.depthWrite=true;return c;});o.material=Array.isArray(o.material)?materials:materials[0];}});
    this.debris=debris;
    // Share immutable geometry access while keeping the apprentice's chisel
    // settings independent of the player's tool controls.
    this.hammerWall=Object.assign(Object.create(game.room.brickWall),{chiselType:'flat',chiselWidthM:.035,chiselEnergyJ:8,chiselEdgeAngle:0,chiselTiltDegrees:0,chiselSideDegrees:0});
    this.highlight.name='Apprentice yellow directive';this.ghost.name='Apprentice box preview';scene.add(this.highlight,this.ghost,this.workWallMarker,this.hammerRestMarker);
    this.hammerRestMarker.position.set(.8,0,.5);
    this.paperCanvas.width=1024;this.paperCanvas.height=768;
    this.paper=new THREE.Mesh(new THREE.PlaneGeometry(.42,.315),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(this.paperCanvas),side:THREE.DoubleSide}));
    this.paper.name='Electrical instruction drawing';this.paper.position.set(0,-.20,-.51);this.paper.rotation.x=-.15;this.paper.visible=false;game.renderer.camera.add(this.paper);this.drawPlan();
    const label=document.createElement('label');label.className='apprentice-count';label.innerHTML='Apprentices <select id="apprentice-count" aria-label="Apprentices"><option value="0">0</option><option value="1" selected>1</option></select>';
    document.querySelector('#start-button')!.after(label);
    label.querySelector('select')!.addEventListener('change',e=>{this.count=Number((e.target as HTMLSelectElement).value);});
    this.toolbar.id='apprentice-controls';this.toolbar.setAttribute('aria-label','Οδηγίες Apprentice');
    this.toolbar.innerHTML='<div class="apprentice-actions"><button data-apprentice="point">T · ΔΕΙΞΕ</button><button data-apprentice="layout">E · ΚΟΥΤΙΑ</button><button data-apprentice="confirm">OK · ENTER</button><button data-apprentice="plan">V · ΣΧΕΔΙΟ</button><button data-apprentice="resume">ΣΥΝΕΧΕΙΑ</button><button data-apprentice="cancel">ΕΞΟΔΟΣ</button></div>';
    this.status.className='apprentice-status';this.status.setAttribute('role','status');this.toolbar.prepend(this.status);game.hud.shell.append(this.toolbar);
    this.toolbar.addEventListener('click',e=>{const action=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-apprentice]')?.dataset.apprentice;if(action)this.command(action);});
    addEventListener('keydown',e=>{
      if(!game.started||e.repeat||e.target instanceof Element&&e.target.closest('input,textarea,select,[contenteditable="true"]')||game.hud.shell.classList.contains('settings-open')||game.modelInspector?.active)return;
      const action=e.code==='KeyT'&&!e.shiftKey?'point':e.code==='KeyV'&&!e.shiftKey?'plan':e.code==='KeyE'&&this.mode==='point'?'layout':e.code==='Enter'&&this.mode==='layout'?'confirm':e.code==='Escape'&&this.mode!=='off'?'cancel':null;
      if(action){e.preventDefault();e.stopImmediatePropagation();game.input.resetTransientInput();this.command(action);}
    },{capture:true});
    addEventListener('wirehouse:select-tool',()=>{this.mode='off';this.paper.visible=false;this.ghost.visible=false;});
    addEventListener('wirehouse:cycle-tool',()=>{if(this.mode!=='layout'){this.mode='off';this.paper.visible=false;}});
    this.presentUI();
  }
  get ownsInput():boolean{return this.mode!=='off';}
  collisionObstacles(){return this.game.started&&this.count===1?[{id:'apprentice-1',minX:this.camera.position.x-.18,maxX:this.camera.position.x+.18,minZ:this.camera.position.z-.08,maxZ:this.camera.position.z+.28}]:[];}
  get bareHands():boolean{return this.mode==='point'||this.mode==='plan';}
  get telemetry(){return{count:this.count,mode:this.mode,phase:this.phase,blockedFrom:this.blockedFrom,workStep:this.phase==='construction'?this.workStep:null,workCursor:this.workCursor,workTargets:this.workTargets.length,workContactReady:this.workContactReady,workGripReachM:this.workGripReachM,workTargetRangeM:this.workTargetRangeM,wallApproach:this.wallApproach,batchCycle:this.batchCycle,cementDone:this.cementDone,sandDone:this.sandDone,carriedKg:this.carriedKg,workFailure:this.workFailure,waiting:this.waiting,message:this.message,position:this.camera.position.toArray(),highlightSamples:this.lines.length,strikes:this.strikes,removedVolume:this.removedVolume,job:this.job?{anchor:this.job.anchor.toArray(),modules:this.job.modules,cursor:this.job.cursor,targets:this.job.targets.length,fitRefinements:this.job.fitRefinements}:null};}

  command(action:string):void {
    const g=this.game;if(!g.started)return;
    if(action==='resume'&&this.phase==='blocked'&&this.job){
      if(g.mixing.wheelbarrow.busy||g.pvc.blocksWork){this.message='Άφησε πρώτα τον εξοπλισμό για να συνεχίσω';return;}
      this.phase=this.blockedFrom??'breaking';this.blockedFrom=null;this.workFailure='';this.stall=0;this.wallReachWait=0;this.path=[];this.workDestination=null;this.message='Συνεχίζω την επιβεβαιωμένη εργασία';return;
    }
    if(g.mixing.wheelbarrow.busy||g.mixing.blocksWork||g.pvc.blocksWork){g.hud.notify('Άφησε πρώτα τον εξοπλισμό που κρατάς.',false,1500);return;}
    if(action==='confirm'){this.confirm();return;}
    if(action==='layout'){
      if(!this.anchor){this.message='T · Δείξε πρώτα την περιοχή στον τοίχο';return;}
      if(!['idle','done'].includes(this.phase)){this.message='Η προηγούμενη εργασία παραμένει ενεργή · ΣΥΝΕΧΕΙΑ ή ΑΚΥΡΩΣΗ';return;}
      window.dispatchEvent(new CustomEvent('wirehouse:select-tool',{detail:'fitting'}));
      window.dispatchEvent(new CustomEvent('wirehouse:box-enter-assembly'));this.mode='layout';this.previewKey='';this.message='1–4 σύνδεση · τροχός 1G/2G · R περιστροφή · OK επιβεβαίωση';return;
    }
    if(action==='cancel'){
      if(this.phase==='blocked'){
        if(this.carriedKg>0){const returned=g.mixing.wheelbarrow.receiveCarried(this.carriedKg);this.carriedKg-=returned;if(this.carriedKg>1e-6){this.message='Δεν χωρά η ποσότητα που κρατώ · άδειασε το αμαξάκι';return;}}
        g.mixing.drum.running=false;g.mixing.releaseApprentice();this.holdWorkTool(null);
        if(this.stagedBoxes){this.stagedBoxes.position.copy(this.stagedBoxPosition);this.stagedBoxes.visible=true;}
        g.renderer.scene.attach(this.hammer);this.hammer.position.set(.8,.2,.5);this.hammer.rotation.set(0,0,Math.PI/2);this.hasHammer=false;this.hammer.visible=true;
        this.job=null;this.phase='idle';this.blockedFrom=null;this.workFailure='';this.message='Η εργασία ακυρώθηκε · τα υλικά παραμένουν στη σκηνή';
      }
      this.mode='off';this.ghost.visible=false;this.paper.visible=false;
      window.dispatchEvent(new CustomEvent('wirehouse:box-exit-assembly'));return;
    }
    if(action==='point'||action==='plan'){
      window.dispatchEvent(new CustomEvent('wirehouse:box-exit-assembly'));
      this.mode=action;this.ghost.visible=false;this.paper.visible=action==='plan';g.input.resetTransientInput();
      if(action==='plan')this.drawPlan();
      this.message=action==='point'?'Κράτα το κλικ για κίτρινη γραμμή · E για κουτιά':'Ηλεκτρολογικό σχέδιο · T επιστροφή στις οδηγίες';
    }
  }
  handleInput(requested:boolean):boolean {
    if(!this.ownsInput)return false;
    if(this.mode==='point'&&(requested||this.game.input.actionHeld)&&['idle','done'].includes(this.phase)){
      const hit=this.game.room.brickWall.aim(this.game.renderer.camera,4);
      if(hit&&Math.abs(hit.point.x)<2.48&&hit.point.y>.13&&hit.point.y<2.5){
        const p=hit.point.clone();p.z=FRONT+.025;
        const last=this.lines.at(-1);if(!last||last.distanceTo(p)>.015){
          if(this.lines.length>=240){this.message='Η γραμμή είναι αρκετή · E για κουτιά';return true;}
          if(!this.game.input.actionHeld||!last||last.distanceTo(p)>.16)this.addLine(p.clone().add(new THREE.Vector3(-.016,0,0)),p.clone().add(new THREE.Vector3(.016,0,0)),this.highlight,this.yellow);
          else this.addLine(last,p,this.highlight,this.yellow);
          this.lines.push(p);this.anchor=p.clone();
        }
      }
    }
    return true;
  }
  private addLine(a:THREE.Vector3,b:THREE.Vector3,parent:THREE.Group,material:THREE.MeshBasicMaterial):void{
    const direction=b.clone().sub(a),length=direction.length();if(length<.0001)return;
    const mesh=this.linePool.pop()??new THREE.Mesh(this.lineGeometry,material);mesh.scale.x=length;mesh.position.copy(a).lerp(b,.5);mesh.rotation.z=Math.atan2(direction.y,direction.x);mesh.raycast=()=>{};parent.add(mesh);
  }
  private clear(group:THREE.Group):void{
    // Like the existing live box builder, detach buffers rather than disposing
    // them while WebGPU render bundles can still reference the previous frame.
    if(group===this.highlight)this.linePool.push(...group.children as THREE.Mesh[]);
    group.clear();
  }
  private preview():void {
    if(!this.anchor)return;
    const modules=this.game.boxAssembly.snapshot.modules,key=boxAssemblyKey(modules);this.ghost.visible=true;
    if(key===this.previewKey)return;this.previewKey=key;this.clear(this.ghost);
    const bounds=boxAssemblyBounds(modules);
    const used:Record<string,number>={};
    for(const m of modules){
      const index=used[m.kind]??0;used[m.kind]=index+1;const pool=this.previewBoxes.get(m.kind)??[];this.previewBoxes.set(m.kind,pool);
      let box=pool[index];if(!box){box=new ElectricalBox(m.kind,`apprentice-preview:${m.kind}:${index}`);pool.push(box);box.traverse(o=>{if(o instanceof THREE.Mesh){const originals=Array.isArray(o.material)?o.material:[o.material];o.material=originals.map(mat=>{const clone=mat.clone();clone.transparent=true;clone.opacity=.6;return clone;});}});}
      box.position.set(this.anchor.x+m.x-bounds.centerX,this.anchor.y+m.y-bounds.centerY,FRONT+.045);box.rotation.z=m.rotation*Math.PI/2;this.ghost.add(box);
    }
  }
  confirm():void {
    if(this.mode!=='layout'||!this.anchor)return;
    if(this.count===0){this.message='Δεν έχει επιλεγεί Apprentice στην αρχική οθόνη';return;}
    if(!['idle','done'].includes(this.phase))return;
    const modules=this.game.boxAssembly.snapshot.modules.map(m=>({...m})),bounds=boxAssemblyBounds(modules);
    if(modules.length>12||this.anchor.x-bounds.width/2< -2.48||this.anchor.x+bounds.width/2>2.48||this.anchor.y-bounds.height/2<.13||this.anchor.y+bounds.height/2>2.45){this.message='Η διάταξη πρέπει να χωρά στον τοίχο και στην εμβέλεια του εργάτη';return;}
    for(const point of this.game.mission.points){if(!point.boxGroup.visible)continue;const center=point.getWorldPosition(new THREE.Vector3());if(Math.abs(center.x-this.anchor.x)<(bounds.width+point.boxGroup.groupWidth)/2+.08&&Math.abs(center.y-this.anchor.y)<(bounds.height+point.boxGroup.groupHeight)/2+.08){this.message='Υπάρχουν ήδη εγκατεστημένα κουτιά εδώ · διάλεξε ελεύθερη περιοχή';return;}}
    const targets:THREE.Vector3[]=[];
    // The yellow route is a work instruction too, not merely an anchor for boxes.
    for(let i=0;i<this.lines.length;i++){
      const end=this.lines[i],start=i>0&&end.distanceTo(this.lines[i-1])<.17?this.lines[i-1]:end;
      const count=Math.max(1,Math.ceil(start.distanceTo(end)/.015));
      for(let n=0;n<=count;n++){const p=start.clone().lerp(end,n/count);p.z=FRONT;targets.push(p);}
    }
    for(const m of modules){const size=boxModuleSize(m),cx=this.anchor.x+m.x-bounds.centerX,cy=this.anchor.y+m.y-bounds.centerY;
      for(let y=cy-size.height/2-.012;y<=cy+size.height/2+.02;y+=.018)for(let x=cx-size.width/2-.012;x<=cx+size.width/2+.02;x+=.018)targets.push(new THREE.Vector3(x,y,FRONT));
      const corners=[[-size.width/2-.012,-size.height/2-.012],[size.width/2+.012,-size.height/2-.012],[size.width/2+.012,size.height/2+.012],[-size.width/2-.012,size.height/2+.012]];
      const c=new THREE.PerspectiveCamera();for(let i=0;i<4;i++){const a=corners[i],b=corners[(i+1)%4];this.game.room.brickWall.endSprayStroke();for(let t=0;t<=1.001;t+=.1){c.position.set(cx+a[0]+(b[0]-a[0])*t,cy+a[1]+(b[1]-a[1])*t,FRONT+.2);c.rotation.set(0,0,0);this.game.room.brickWall.spray(c,'apprentice-job','live',0x087fce);}}this.game.room.brickWall.endSprayStroke();
    }
    this.job={anchor:this.anchor.clone(),modules,targets,cursor:0,refinements:0,fitRefinements:0};this.workWallMarker.position.copy(this.anchor).setZ(FRONT);this.strikes=0;this.removedVolume=0;this.stall=0;this.workFailure='';this.blockedFrom=null;this.workerPoint=null;
    if(this.stagedBoxes)this.game.renderer.scene.remove(this.stagedBoxes);
    this.stagedBoxes=new BoxGroup(modules.map(m=>m.kind),'apprentice-confirmed-boxes',modules);
    this.stagedBoxPosition.set(THREE.MathUtils.clamp(this.anchor.x+.46,-2.3,2.3),bounds.height/2+.018,FRONT+1.06);
    this.stagedBoxes.position.copy(this.stagedBoxPosition);this.game.renderer.scene.add(this.stagedBoxes);
    this.mode='point';this.ghost.visible=false;this.clear(this.highlight);this.lines.length=0;window.dispatchEvent(new CustomEvent('wirehouse:box-exit-assembly'));
    this.phase=this.hasHammer?'walking':'fetching';this.elapsed=0;this.path=[];this.message='Επιβεβαιώθηκε · ο Apprentice παίρνει το κάγκο';this.drawPlan();
  }
  private moveTo(destination:FloorPoint,dt:number):boolean{
    const pos=this.camera.position;
    if(Math.hypot(destination.x-pos.x,destination.z-pos.z)<.045){this.velocity.set(0,0,0);this.path=[];return true;}
    if(!this.path.length){const path=apprenticePath(pos,destination,this.game.mixing.collisionObstacles());if(!path){this.blockedFrom=this.phase==='construction'?'construction':'breaking';this.phase='blocked';this.message='Δεν υπάρχει ελεύθερη διαδρομή · μετακίνησε τον εξοπλισμό';return false;}this.path=path;}
    const next=this.path[0],dx=next.x-pos.x,dz=next.z-pos.z,distance=Math.hypot(dx,dz),speed=Math.min(.9,distance/Math.max(.001,dt));
    if(this.game.mixing.collisionObstacles().some(o=>next.x>o.minX-.29&&next.x<o.maxX+.29&&next.z>o.minZ-.29&&next.z<o.maxZ+.29)){
      this.path=[];this.waiting=true;this.message='Η διαδρομή άλλαξε · ελέγχω τον εξοπλισμό';return false;
    }
    const player=this.game.renderer.camera.position;
    if(Math.hypot(pos.x+dx/Math.max(.001,distance)*.32-player.x,pos.z+dz/Math.max(.001,distance)*.32-player.z)<.55){this.waiting=true;this.velocity.set(0,0,0);this.message='Περιμένω να ελευθερωθεί η διαδρομή';return false;}
    this.velocity.set(dx/distance*speed,0,dz/distance*speed);pos.addScaledVector(this.velocity,dt);this.camera.rotation.set(0,Math.atan2(-dx,-dz),0);
    if(distance<.06)this.path.shift();return false;
  }
  update(dt:number):void {
    this.toolbar.hidden=!this.game.started;
    this.body.visible=this.game.started&&this.count===1;this.hammer.visible=this.count===1;this.camera.visible=this.game.started&&this.count===1;
    if(!this.game.started||this.count===0||!this.body.loaded){this.presentUI();return;}
    dt=Math.min(dt,.05);this.elapsed+=dt;this.waiting=false;this.velocity.set(0,0,0);
    if(this.mode==='layout')this.preview();
    if(this.phase==='fetching'&&this.moveTo({x:.8,z:1.05},dt)){this.phase='picking-up';this.elapsed=0;}
    if(this.phase==='picking-up'){
      this.camera.position.y=THREE.MathUtils.damp(this.camera.position.y,.9,8,dt);this.camera.rotation.set(-.45,0,0);
      if(this.elapsed>.8){this.hammer.getWorldPosition(this.carriedPosition);this.hammer.getWorldQuaternion(this.carriedRotation);this.hammerParent.attach(this.hammer);this.hasHammer=true;this.phase='lifting';this.elapsed=0;this.message='Σηκώνω το κάγκο';}
    }
    if(this.phase==='lifting'){this.camera.position.y=THREE.MathUtils.damp(this.camera.position.y,1.65,4,dt);if(this.elapsed>1){this.phase='walking';this.path=[];this.message='Μεταφέρω το κάγκο στην επιβεβαιωμένη περιοχή';}}
    if(this.phase==='walking'&&this.job){this.camera.position.y=THREE.MathUtils.damp(this.camera.position.y,1.65,6,dt);if(this.moveTo({x:this.job.anchor.x,z:FRONT+.8},dt)){this.phase='breaking';this.elapsed=0;this.cooldown=0;}}
    this.rig.visible=this.hasHammer||this.phase==='picking-up';this.rig.beginFrame(dt,null,this.phase==='breaking');this.rig.update(dt,this.velocity.lengthSq()>.01);this.rig.show('hammer');
    if(this.phase==='breaking'&&this.job)this.breakWall(dt);
    if(this.phase==='construction')this.updateConstruction(dt);
    else if(this.phase!=='breaking'&&this.hasHammer){
      this.rig.restHammer(this.camera);
      const target=this.hammer.getWorldPosition(new THREE.Vector3()),rotation=this.hammer.getWorldQuaternion(new THREE.Quaternion()),alpha=1-Math.exp(-8*dt);
      this.carriedPosition.lerp(target,alpha);this.carriedRotation.slerp(rotation,alpha);
      this.hammer.position.copy(this.hammer.parent!.worldToLocal(this.carriedPosition.clone()));
      this.hammer.quaternion.copy(this.hammer.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(this.carriedRotation));this.hammer.updateWorldMatrix(false,true);this.rig.poseArms(this.camera);
    }
    this.camera.updateMatrixWorld(true);
    const grips=this.phase==='construction'||this.phase==='blocked'&&this.workTool?this.poseWorkTool():[];
    this.body.update(dt,this.camera,{eyeHeight:this.camera.position.y,velocity:this.velocity,yaw:this.camera.rotation.y,pitch:this.camera.rotation.x},this.rig,'hammer',this.phase==='breaking',grips.length>0,grips);
    this.body.overview=true;this.presentUI();
  }
  private breakWall(dt:number):void{
    const job=this.job!,wall=this.game.room.brickWall;
    let target=job.targets[job.cursor];
    while(target&&!this.columnOccupied(target)){job.cursor++;target=job.targets[job.cursor];this.stall=0;}
    if(!target){
      const bounds=boxAssemblyBounds(job.modules);
      const clear=job.modules.every(m=>{const size=boxModuleSize(m),x=job.anchor.x+m.x-bounds.centerX,y=job.anchor.y+m.y-bounds.centerY;return wall.volume.cavityBox({x:x-size.width/2,y:y-size.height/2,z:FRONT-.049},{x:x+size.width/2,y:y+size.height/2,z:FRONT}).clear;});
      if(!clear&&job.refinements<2){
        job.refinements++;job.targets=[];job.cursor=0;
        const step=job.refinements===1?.006:.003;
        for(const m of job.modules){const size=boxModuleSize(m),cx=job.anchor.x+m.x-bounds.centerX,cy=job.anchor.y+m.y-bounds.centerY;
          for(let y=cy-size.height/2-.004;y<=cy+size.height/2+.004;y+=step)for(let x=cx-size.width/2-.004;x<=cx+size.width/2+.004;x+=step)job.targets.push(new THREE.Vector3(x,y,FRONT));
        }
        this.message='Ελέγχω και καθαρίζω τα μικρά υπολείμματα μέσα στις υποδοχές';return;
      }
      if(clear){
        const point=this.workerPoint??this.game.mission.placementCandidate(job.modules);
        if(!point){this.phase='blocked';this.blockedFrom='breaking';this.message='Δεν υπάρχει διαθέσιμη θέση για τα κουτιά';return;}
        this.workerPoint=point;point.placeAt(job.anchor.x,job.anchor.y);
        this.camera.position.set(job.anchor.x,THREE.MathUtils.clamp(job.anchor.y+.35,.9,1.8),FRONT+.70);
        this.camera.lookAt(job.anchor);this.camera.updateMatrixWorld(true);
        const fit=this.game.boxPlacement.assess(point,this.camera);
        if(!fit.canPlace){
          if(fit.reason==='masonry'&&fit.blockedCells.length&&job.fitRefinements<3){
            job.fitRefinements++;job.targets=[];job.cursor=0;
            const seen=new Set<string>(),stride=Math.max(1,Math.floor(fit.blockedCells.length/480));
            for(let i=0;i<fit.blockedCells.length;i+=stride){
              const cell=fit.blockedCells[i],key=`${Math.round(cell.x/.005)}:${Math.round(cell.y/.005)}`;
              if(seen.has(key))continue;seen.add(key);job.targets.push(new THREE.Vector3(cell.x,cell.y,FRONT));
            }
            this.message='Καθαρίζω τα πραγματικά σημεία που εμποδίζουν το περίβλημα των κουτιών';return;
          }
          this.phase='blocked';this.blockedFrom='breaking';this.message=`Τα κουτιά δεν χωρούν ακόμη: ${fit.message}`;return;
        }
      }
      this.phase=clear?'construction':'blocked';this.blockedFrom=clear?null:'breaking';this.message=clear?'Το σπάσιμο ολοκληρώθηκε · ετοιμάζω πηλό':'Υπάρχει υπόλοιπο υλικού στην κοιλότητα · απαιτείται έλεγχος';
      if(clear){this.workStep='claim';this.workElapsed=0;this.batchCycle=0;this.cementDone=0;this.sandDone=0;this.workCursor=0;this.workTargets.length=0;}
      return;
    }
    const player=this.game.renderer.camera.position;
    if(Math.hypot(player.x-this.camera.position.x,player.z-this.camera.position.z)<.58){this.waiting=true;this.message='Κάνε λίγο χώρο για να δουλέψω';return;}
    this.camera.position.x=THREE.MathUtils.damp(this.camera.position.x,target.x,12,dt);
    this.camera.position.y=THREE.MathUtils.damp(this.camera.position.y,THREE.MathUtils.clamp(target.y+.33,.66,1.9),12,dt);
    this.camera.position.z=THREE.MathUtils.damp(this.camera.position.z,FRONT+.76,12,dt);
    this.camera.lookAt(target);this.camera.updateMatrixWorld(true);
    const contact=this.rig.contact(this.camera,this.hammerWall);this.cooldown-=dt;
    if(this.cooldown>0)return;this.cooldown=.10;
    if(!contact||Math.hypot(contact.point.x-target.x,contact.point.y-target.y)>.08){if(++this.stall>50){this.phase='blocked';this.blockedFrom='breaking';this.message='Δεν φτάνω τη θέση με ασφαλή επαφή εργαλείου';}return;}
    const impact=this.debris.hitContact({...contact,energyJ:8,chisel:'flat',widthM:.035});
    this.strikes++;this.rig.strike();this.game.audio.play('hammer',.65);
    if(impact?.removedVolume){this.removedVolume+=impact.removedVolume;this.stall=0;}else if(++this.stall>80){this.phase='blocked';this.blockedFrom='breaking';this.message='Το εργαλείο δεν προχωρά · χρειάζεται έλεγχος της επαφής';}
    this.message=`Σπάσιμο · ${Math.round(job.cursor/job.targets.length*100)}% της επιβεβαιωμένης περιοχής`;
  }
  private nextWork(step:WorkStep):void{
    this.workStep=step;this.workElapsed=0;this.workDestination=null;this.path=[];
  }
  private failWork(message:string):void{
    this.workFailure=message;this.message=message;this.blockedFrom='construction';this.phase='blocked';
    this.game.mixing.drum.running=false;
  }
  private nearWork(key:string,object:THREE.Object3D,dt:number,radius=.77):boolean{
    object.updateWorldMatrix(true,false);
    const target=object.getWorldPosition(new THREE.Vector3());
    if(!this.workDestination){
      const obstacles=this.game.mixing.collisionObstacles();let selected:FloorPoint|null=null,shortest=Infinity;
      for(const r of [radius,radius+.23,radius+.46])for(let i=0;i<16;i++){
        const angle=i*Math.PI/8,p={x:target.x+Math.cos(angle)*r,z:target.z+Math.sin(angle)*r};
        const route=apprenticePath(this.camera.position,p,obstacles);
        if(!route)continue;
        const length=route.reduce((sum,q,j)=>sum+(j?Math.hypot(q.x-route[j-1].x,q.z-route[j-1].z):Math.hypot(q.x-this.camera.position.x,q.z-this.camera.position.z)),0);
        if(length<shortest){shortest=length;selected=p;}
      }
      if(!selected){this.failWork(`Δεν βρίσκω ασφαλή πρόσβαση στο ${key} · μετακίνησε τον εξοπλισμό`);return false;}
      this.workDestination=selected;
    }
    if(!this.moveTo(this.workDestination,dt))return false;
    this.camera.position.y=THREE.MathUtils.damp(this.camera.position.y,1.65,6,dt);
    this.camera.lookAt(target.clone().setY(Math.max(.55,Math.min(1.35,target.y+.45))));
    return true;
  }
  private nearWall(dt:number):boolean{
    if(!this.job)return false;
    const workingX=this.workStep==='wall-mortar'?this.workTargets[this.workCursor]?.x??this.job.anchor.x:this.job.anchor.x;
    if(!this.moveTo({x:workingX,z:FRONT+this.wallApproach},dt))return false;
    this.camera.position.y=THREE.MathUtils.damp(this.camera.position.y,THREE.MathUtils.clamp(this.job.anchor.y+.38,.9,1.75),8,dt);
    this.camera.lookAt(this.job.anchor);this.camera.updateMatrixWorld(true);
    return true;
  }
  private holdWorkTool(kind:WorkTool|null):void{
    if(this.workTool===kind)return;
    if(this.workTool)this.workTools.get(this.workTool)!.visible=false;
    this.workTool=kind;if(!kind)return;
    let tool=this.workTools.get(kind);
    if(!tool||kind==='box'&&tool!==this.stagedBoxes){
      const models=this.game.mixing.models;
      tool=kind==='box'?this.stagedBoxes!:kind==='trowel'?buildToolModel('trowel'):kind==='shovel'?createShovelModel():kind==='mixer'?createMixerModel():kind==='water'?models.water.clone(true):models.bucket.clone(true);
      tool.name=`Apprentice held ${kind}`;this.game.renderer.scene.add(tool);this.workTools.set(kind,tool);
    }
    tool.visible=true;
  }
  private poseWorkTool():WorkerGripTarget[]{
    if(!this.workTool)return[];
    const kind=this.workTool,model=this.workTools.get(kind)!;
    const source=kind==='trowel'?this.game.mixing.stationTrowel:kind==='shovel'?this.game.mixing.models.shovel:kind==='mixer'?this.game.mixing.models.mixer:kind==='water'?this.game.mixing.models.water:kind==='bucket'?this.game.mixing.models.bucket:null;
    if(source)source.visible=false;
    this.camera.updateMatrixWorld(true);
    const localRotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(kind==='shovel'?.42:kind==='mixer'?.32:0,0,kind==='bucket'?-.08:kind==='water'?-.2:0));
    model.quaternion.copy(this.camera.quaternion).multiply(localRotation);
    const primary=new THREE.Vector3().fromArray(model.userData.gripPoint??(kind==='box'?[Math.min(.08,this.stagedBoxes!.groupWidth/3),0,.02]:kind==='bucket'?[0,.26,.20]:[.15,.20,0]));
    const secondary=kind==='box'?[-Math.min(.08,this.stagedBoxes!.groupWidth/3),0,.02]:model.userData.secondaryGripPoint as number[]|undefined;
    const hand=this.camera.localToWorld(new THREE.Vector3(.18,-.31,-.40));
    model.position.copy(hand).sub(primary.clone().applyQuaternion(model.quaternion));
    this.workContactReady=false;
    if(kind==='trowel'&&this.workStep==='wall-mortar'){
      const target=this.workTargets[this.workCursor],tipArray=model.userData.tipPoint as number[]|undefined;
      if(target&&tipArray){
        const tipLocal=new THREE.Vector3().fromArray(tipArray);
        const shoulder=this.camera.localToWorld(new THREE.Vector3(.18,-.30,.08));
        // A real trowel presents its blade to the masonry while the handle
        // points back to the worker. Solve that rigid orientation at each spot.
        const fromTipToGrip=primary.clone().sub(tipLocal).normalize();
        const towardShoulder=shoulder.clone().sub(target).normalize();
        model.quaternion.setFromUnitVectors(fromTipToGrip,towardShoulder);
        const root=target.clone().sub(tipLocal.applyQuaternion(model.quaternion));
        const grip=root.clone().add(primary.clone().applyQuaternion(model.quaternion));
        this.workGripReachM=grip.distanceTo(shoulder);this.workTargetRangeM=target.distanceTo(this.camera.position);
        if(this.workGripReachM<=MAX_WRIST_REACH_M-.008&&this.workTargetRangeM<=.96){
          model.position.copy(root);this.workContactReady=true;
        }
      }
    }
    if(kind==='bucket'){
      const fill=model.getObjectByName('mixing-garden-bucket-contents');
      if(fill){fill.visible=this.carriedKg>.05;fill.position.y=.029+.26*Math.min(1,this.carriedKg/20);}
    }
    model.updateWorldMatrix(true,true);
    const grip=(side:number,local:THREE.Vector3):WorkerGripTarget=>({side,center:model.localToWorld(local.clone()),rotation:model.getWorldQuaternion(new THREE.Quaternion()),section:[kind==='bucket'?.012:.023,kind==='bucket'?.012:.023],active:true,object:model});
    return[grip(1,primary),...(secondary?[grip(-1,new THREE.Vector3().fromArray(secondary))]:kind==='bucket'?[grip(-1,new THREE.Vector3(-.045,.22,.20))]:[])];
  }
  private prepareMortarTargets():void{
    this.workTargets.length=0;this.workCursor=0;
    const job=this.job!,bounds=boxAssemblyBounds(job.modules);
    for(const m of job.modules){
      const size=boxModuleSize(m),x=job.anchor.x+m.x-bounds.centerX,y=job.anchor.y+m.y-bounds.centerY;
      for(let side=0;side<3;side++)for(let i=0;i<12;i++){
        const t=-.91+1.82*i/11;
        const px=side===0?x+t*(size.width/2+.022):x+(side===1?-1:1)*(size.width/2+.022);
        const py=side===0?y+size.height/2+.020:y+t*(size.height/2+.018);
        this.workTargets.push(new THREE.Vector3(px,py,FRONT-.025));
      }
    }
  }
  private updateConstruction(dt:number):void{
    const mix=this.game.mixing,models=mix.models,drum=mix.drum,cart=mix.wheelbarrow;
    const wait=(seconds:number)=>{this.workElapsed+=dt;return this.workElapsed>=seconds;};
    const near=(name:string,object:THREE.Object3D,radius?:number)=>this.nearWork(name,object,dt,radius);
    const recipe=this.batchCycle===0?{water:20,cement:18,sand:36}:{water:1.2,cement:1,sand:2};
    if(this.workStep==='claim'){
      if(!mix.claimForApprentice()){this.waiting=true;this.message='Περιμένω να ελευθερωθεί ο σταθμός ανάμιξης';return;}
      this.batchCycle=cart.massKg>0?1:0;
      this.nextWork('return-hammer');
    }
    else if(this.workStep==='return-hammer'){
      if(!near('κάγκο',this.hammerRestMarker,.6))return;
      if(wait(.6)){
        if(this.hasHammer){this.game.renderer.scene.attach(this.hammer);this.hammer.position.set(.8,.2,.5);this.hammer.rotation.set(0,0,Math.PI/2);this.hasHammer=false;this.rig.visible=false;}
        if(cart.massKg>=Math.max(4,(this.job?.modules.length??1)*4)){
          this.message='Υπάρχει έτοιμος πηλός στο αμαξάκι · παίρνω το μιστρί';this.nextWork('trowel-source');
        }else if(drum.batch.ready){this.message='Μεταφέρω τον έτοιμο πηλό από την προηγούμενη παρτίδα';this.nextWork('bucket-source');}
        else{this.message='Παίρνω νερό για τον πηλό';this.nextWork('water-source');}
      }
    }
    else if(this.workStep==='water-source'){
      if(!near('νερό',models.water))return;
      if(wait(.48)){this.holdWorkTool('water');this.nextWork('water-drum');}
    }
    else if(this.workStep==='water-drum'){
      if(!near('μπετονιέρα',models.concreteMixer,1.0))return;
      if(wait(1.15)){
        if(drum.batch.addWater(recipe.water)<recipe.water-.001){this.failWork('Δεν χωρά το νερό στη μπετονιέρα');return;}
        this.holdWorkTool(null);this.message=`Νερό ${recipe.water.toFixed(1)} L · ετοιμάζω τσιμέντο`;this.nextWork('cement-source');
      }
    }
    else if(this.workStep==='cement-source'){
      const state=mix.batch.getState(),index=state.sacks.findIndex(s=>s.remainingKg>.5),sack=models.sacks[index];
      if(!sack){this.failWork('Δεν υπάρχει άλλο τσιμέντο στις σακούλες');return;}
      if(!near('σακούλα τσιμέντου',sack))return;
      if(wait(.65)){
        if(!state.sacks[index].open)mix.batch.openSack(index);
        if(!mix.batch.scoopCement(index)){this.failWork('Δεν μπόρεσα να πάρω μιστριά τσιμέντου');return;}
        this.holdWorkTool('trowel');this.nextWork('cement-drum');
      }
    }
    else if(this.workStep==='cement-drum'){
      if(!near('μπετονιέρα',models.concreteMixer,1.0))return;
      if(wait(.63)){
        if(!mix.batch.pour('trowel',drum.batch)){this.failWork('Η μπετονιέρα δεν δέχεται άλλη δόση τσιμέντου');return;}
        this.cementDone++;this.holdWorkTool(null);this.message=`Τσιμέντο ${this.cementDone}/${recipe.cement}`;
        this.nextWork(this.cementDone>=recipe.cement?'sand-source':'cement-source');
      }
    }
    else if(this.workStep==='sand-source'){
      if(!near('άμμο',models.sand,1.0))return;
      if(wait(.68)){
        if(!mix.batch.scoopSand()){this.failWork('Δεν μπόρεσα να πάρω φτυαριά άμμου');return;}
        this.holdWorkTool('shovel');this.nextWork('sand-drum');
      }
    }
    else if(this.workStep==='sand-drum'){
      if(!near('μπετονιέρα',models.concreteMixer,1.0))return;
      if(wait(.67)){
        if(!mix.batch.pour('shovel',drum.batch)){this.failWork('Η μπετονιέρα δεν δέχεται άλλη δόση άμμου');return;}
        this.sandDone++;this.holdWorkTool(null);this.message=`Άμμος ${this.sandDone}/${recipe.sand}`;
        this.nextWork(this.sandDone>=recipe.sand?'mixer-source':'sand-source');
      }
    }
    else if(this.workStep==='mixer-source'){
      if(!near('μεγάλη μπετονιέρα',models.concreteMixer,.86))return;
      if(wait(.6)){this.message='Θέτω σε λειτουργία τη μεγάλη μπετονιέρα';this.nextWork('mixer-drum');}
    }
    else if(this.workStep==='mixer-drum'){
      if(!near('μπετονιέρα',models.concreteMixer,1.0))return;
      if(wait(.7)){drum.running=true;this.message='Αναμιγνύω τον πραγματικό πηλό στη μπετονιέρα';this.nextWork('mixing');}
    }
    else if(this.workStep==='mixing'){
      if(!near('μπετονιέρα',models.concreteMixer,1.0))return;
      if(drum.batch.ready){drum.running=false;this.message='Ο πηλός είναι έτοιμος · γεμίζω το αμαξάκι';this.nextWork('bucket-source');}
    }
    else if(this.workStep==='bucket-source'){
      if(!near('μπετονιέρα',models.concreteMixer,1.0))return;
      if(wait(.9)){
        if(this.carriedKg>0){this.failWork('Η σύκλα δεν άδειασε στο προηγούμενο δρομολόγιο');return;}
        this.carriedKg=drum.batch.consumeKg(Math.min(20,cart.capacityKg-cart.massKg));
        if(this.carriedKg<=0){
          if(cart.massKg>=cart.capacityKg-.01){this.nextWork('trowel-source');return;}
          if(this.batchCycle===0){this.batchCycle=1;this.cementDone=0;this.sandDone=0;this.nextWork('water-source');return;}
          this.failWork('Δεν έφτασε ο πηλός για να γεμίσει το αμαξάκι');return;
        }
        this.holdWorkTool('bucket');this.nextWork('bucket-cart');
      }
    }
    else if(this.workStep==='bucket-cart'){
      if(!near('αμαξάκι',cart.model.group,1.08))return;
      if(wait(.85)){
        const received=cart.receiveCarried(this.carriedKg);this.carriedKg-=received;
        if(this.carriedKg>.001){this.failWork('Το αμαξάκι δεν δέχθηκε όλο τον πηλό · κράτησα την υπόλοιπη ποσότητα');return;}
        this.holdWorkTool(null);this.message=`Αμαξάκι ${cart.massKg.toFixed(1)} / ${cart.capacityKg} kg`;
        this.nextWork(cart.massKg>=cart.capacityKg-.01?'trowel-source':'bucket-source');
      }
    }
    else if(this.workStep==='trowel-source'){
      if(!near('μιστρί',mix.stationTrowel))return;
      if(wait(.55)){this.holdWorkTool('trowel');this.prepareMortarTargets();this.wallApproach=.69;this.wallReachWait=0;this.nextWork('wall-mortar');}
    }
    else if(this.workStep==='wall-mortar'){
      if(!this.job)return;
      if(!this.nearWall(dt))return;
      const target=this.workTargets[this.workCursor];
      if(!target){this.holdWorkTool(null);this.nextWork('box-source');return;}
      this.camera.lookAt(target);this.camera.updateMatrixWorld(true);
      this.poseWorkTool();
      if(!this.workContactReady){
        this.workElapsed=0;this.wallReachWait+=dt;this.wallApproach=Math.max(.53,this.wallApproach-.025);
        if(this.wallReachWait>4){this.failWork('Το μιστρί δεν φτάνει με ασφαλή στάση στον τοίχο');return;}
        this.message='Φέρνω το μιστρί σε πραγματική επαφή με τον τοίχο';return;
      }
      this.wallReachWait=0;
      if(wait(.42)){
        const amount=this.game.mortar.pressWorkerScoop(target,Math.min(.10,cart.massKg));
        if(amount>0){const removed=cart.consume(amount);if(Math.abs(removed-amount)>.0001){this.failWork('Ασυμφωνία στη μεταφορά πηλού από το αμαξάκι');return;}}
        this.workCursor++;this.workElapsed=0;this.message=`Πηλός γύρω από τα κουτιά ${this.workCursor}/${this.workTargets.length}`;
      }
    }
    else if(this.workStep==='box-source'){
      if(!this.stagedBoxes){this.failWork('Η επιβεβαιωμένη διάταξη κουτιών δεν είναι διαθέσιμη');return;}
      if(!near('κουτιά',this.stagedBoxes,.63))return;
      if(wait(.65)){
        this.holdWorkTool('box');this.message='Μεταφέρω τα επιβεβαιωμένα κουτιά στον νωπό πηλό';this.nextWork('wall-box');
      }
    }
    else if(this.workStep==='wall-box'){
      if(!this.job)return;
      if(!this.nearWall(dt))return;
      this.camera.lookAt(this.job.anchor);this.camera.updateMatrixWorld(true);
      if(!wait(.8))return;
      const point=this.workerPoint??this.game.mission.placementCandidate(this.job.modules);
      if(!point){this.failWork('Δεν υπάρχει διαθέσιμη θέση για τα επιβεβαιωμένα κουτιά');return;}
      point.placeAt(this.job.anchor.x,this.job.anchor.y);
      const result=this.game.boxPlacement.place(point,this.camera);
      if(!result.success){this.failWork(`Τα κουτιά δεν εφαρμόζουν: ${result.message}`);return;}
      this.workerPoint=point;this.holdWorkTool(null);this.message='Πιέζω τα κουτιά στον νωπό πηλό · ελέγχω τη στήριξη';this.nextWork('bonding');
    }
    else if(this.workStep==='bonding'){
      const point=this.workerPoint;if(!point){this.failWork('Χάθηκε η θέση των κουτιών');return;}
      this.workElapsed+=dt;
      const state=this.game.boxPlacement.telemetry.find(p=>p.id===point.definition.id);
      if(state?.secured&&state.state==='bonded'){
        this.phase='done';this.message='Πηλός και κουτιά τοποθετήθηκαν και στηρίζονται';this.game.mixing.releaseApprentice();return;
      }
      if(this.workElapsed>4){this.failWork('Τα κουτιά δεν στηρίζονται ακόμη · έλεγξε την επαφή με τον πηλό');}
    }
  }
  private columnOccupied(p:THREE.Vector3):boolean {
    const hit=this.game.room.brickWall.volume.raycast({x:p.x,y:p.y,z:FRONT+.01},{x:0,y:0,z:-1},DEPTH+.01);
    return Boolean(hit&&hit.point.z>FRONT-DEPTH);
  }
  presentPlayer():void {
    if(!this.bareHands)return;
    this.game.fpsRig.visible=false;
    this.game.workerBody.update(0,this.game.renderer.camera,this.game.player,this.game.fpsRig,this.game.selectedTool,false,true,[]);
    this.game.workerBody.poseDirective(this.game.renderer.camera,this.mode==='plan');
  }
  private presentUI():void{
    this.toolbar.hidden=!this.game.started;
    this.game.hud.shell.dataset.apprenticeMode=this.mode;
    const tool=this.game.hud.shell.querySelector<HTMLElement>('#tool-status')!;
    tool.dataset.directive=this.mode==='point'?'ΔΑΧΤΥΛΟ · ΚΙΤΡΙΝΗ ΕΠΙΣΗΜΑΝΣΗ':this.mode==='plan'?'ΗΛΕΚΤΡΟΛΟΓΙΚΟ ΣΧΕΔΙΟ':'';
    const touch=matchMedia('(pointer:coarse)').matches;
    const instruction=touch&&this.mode==='layout'?'Σύνδεσε τα κουτιά · OK για ανάθεση':touch&&this.mode==='point'&&this.phase==='idle'?'Κράτα USE και σημάδεψε · μετά ΚΟΥΤΙΑ':this.message;
    const text=this.count===0?'Apprentices: 0':`Apprentice 1 · ${instruction}`;if(this.status.textContent!==text)this.status.textContent=text;
    for(const b of this.toolbar.querySelectorAll<HTMLButtonElement>('button')){
      const action=b.dataset.apprentice;b.hidden=action==='layout'&&this.mode!=='point'||action==='confirm'&&this.mode!=='layout'||action==='cancel'&&this.mode==='off';
      b.classList.toggle('selected',action===this.mode);
      if(action==='resume')b.hidden=this.phase!=='blocked';
      if(action==='cancel'&&this.phase==='blocked')b.hidden=false;
      const label=action==='cancel'&&this.phase==='blocked'?'ΑΚΥΡΩΣΗ ΕΡΓΑΣΙΑΣ':touch?({point:'ΔΕΙΞΕ',layout:'ΚΟΥΤΙΑ',confirm:'OK',plan:'ΣΧΕΔΙΟ',resume:'ΣΥΝΕΧΕΙΑ',cancel:'ΕΞΟΔΟΣ'} as Record<string,string>)[action!]:null;
      if(label&&b.textContent!==label)b.textContent=label;
    }
  }
  private drawPlan():void{
    const ctx=this.paperCanvas.getContext('2d')!;ctx.fillStyle='#f4f1e5';ctx.fillRect(0,0,1024,768);ctx.strokeStyle='#d7dedc';ctx.lineWidth=1;
    for(let x=32;x<1024;x+=32){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,768);ctx.stroke();}for(let y=32;y<768;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1024,y);ctx.stroke();}
    ctx.fillStyle='#163b51';ctx.font='bold 42px sans-serif';ctx.fillText('ΗΛΕΚΤΡΟΛΟΓΙΚΟ ΣΧΕΔΙΟ',48,70);ctx.font='34px sans-serif';ctx.fillText('ΤΟΙΧΟΣ · ΠΡΩΤΗ ΕΓΚΑΤΑΣΤΑΣΗ',48,116);
    ctx.lineWidth=4;ctx.strokeStyle='#163b51';ctx.strokeRect(56,170,910,450);
    if(this.job){const b=boxAssemblyBounds(this.job.modules),scale=Math.min(650/Math.max(.35,b.width),260/Math.max(.15,b.height));for(const m of this.job.modules){const s=boxModuleSize(m);ctx.strokeRect(512+(m.x-b.centerX-s.width/2)*scale,375-(m.y-b.centerY+s.height/2)*scale,s.width*scale,s.height*scale);ctx.font='bold 24px sans-serif';ctx.fillText(m.kind,500+(m.x-b.centerX)*scale,385-(m.y-b.centerY)*scale);}ctx.font='26px sans-serif';ctx.fillText(`Κέντρο κουτιών: ${Math.round(this.job.anchor.y*100)} cm από δάπεδο`,85,580);}else{ctx.font='28px sans-serif';ctx.fillText('T → περιοχή → κουτιά → OK',265,390);}
    ctx.font='26px sans-serif';ctx.fillText('Πρίζα: 50 cm × 20     |     Switch: 140 cm × 20',48,692);
    this.paper.material.map!.needsUpdate=true;
  }
}
