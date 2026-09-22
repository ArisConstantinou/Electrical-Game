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
import {ApprenticePipeBatch,APPRENTICE_PIPE_LENGTH_M,APPRENTICE_PIPE_TARGET,type ApprenticePipeKind} from './ApprenticePipeBatch';
import {ApprenticePipeYard} from './ApprenticePipeYard';
import {ApprenticeCrewMate} from './ApprenticeCrewMate';
import electricalDrawingUrl from '../../artifacts/site-pro-04/mansion-concept/electrical-workroom.svg?url';
import groundFloorDrawingUrl from '../../artifacts/site-pro-04/mansion-concept/ground-floor.svg?url';
import buildingSectionDrawingUrl from '../../artifacts/site-pro-04/mansion-concept/building-section.svg?url';

type Phase='idle'|'directed'|'fetching'|'picking-up'|'lifting'|'walking'|'breaking'|'construction'|'pipe'|'done'|'blocked';
type Mode='off'|'point'|'layout'|'pipe-choice'|'plan';
type GroundAction='go'|'mix'|'break'|'pipe'|'boxes';
type WorkStep='claim'|'return-hammer'|'water-source'|'water-drum'|'cement-source'|'cement-drum'|'sand-source'|'sand-drum'|'mixer-source'|'mixer-drum'|'mixing'|'bucket-source'|'bucket-cart'|'trowel-source'|'wall-mortar'|'box-source'|'wall-box'|'bonding';
type WorkTool='water'|'trowel'|'shovel'|'mixer'|'bucket'|'box'|'cutter';
interface Job {anchor:THREE.Vector3;modules:BoxModuleLayout[];targets:THREE.Vector3[];cursor:number;refinements:number;fitRefinements:number}
interface PipeJob {bundle:number;kind:ApprenticePipeKind;produced:number;target:number;step:'claim'|'approach'|'cut'|'store'|'wait-crew';elapsed:number}
const FRONT=-2.41,DEPTH=.052;
const NAV_ICONS:Record<string,string>={
  point:'M12 2v5m0 10v5M2 12h5m10 0h5M8.5 12a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0',
  layout:'M3 4h8v8H3zM13 4h8v8h-8zM3 14h8v7H3zM13 14h8v7h-8z',
  'break-now':'M4 20 15 9m-3-4 3-3 7 7-3 3zM3 21l4-1',
  confirm:'M3 12l6 6L21 5',
  'pipe-socket':'M3 6h18M3 12h18M3 18h18M7 3v18M17 3v18',
  'pipe-switch':'M3 6h18M3 12h18M3 18h18M7 3v18M17 3v18',
  mix:'M4 13h16l-2 8H6zM7 13V8a5 5 0 0 1 10 0v5M10 4V2m4 2V2',
  plan:'M4 3h12l4 4v14H4zM16 3v5h4M7 12h10M7 16h7',
  resume:'M5 12a7 7 0 1 1 3 6M5 6v6h6',
  cancel:'M5 5l14 14M19 5 5 19',
};
const navButton=(action:string,label:string,title:string)=>`<button type="button" data-apprentice="${action}" aria-label="${title}" title="${title}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${NAV_ICONS[action]}"/></svg><span>${label}</span></button>`;
const groundButton=(action:GroundAction,label:string,icon:string,title:string)=>`<button type="button" data-ground="${action}" aria-label="${title}" title="${title}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${NAV_ICONS[icon]}"/></svg><span>${label}</span></button>`;

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
  private readonly mobilePlan=document.createElement('section');
  private readonly drawingPrompt=document.createElement('div');
  private drawingTab:'electrical'|'ground'|'section'='electrical';
  private drawingFit=false;
  private readonly aimRay=new THREE.Ray();
  private readonly aimDirection=new THREE.Vector3();
  private readonly apprenticeAimCenter=new THREE.Vector3();
  private readonly aimCapsuleStart=new THREE.Vector3();
  private readonly aimCapsuleEnd=new THREE.Vector3();
  private readonly aimClosestPoint=new THREE.Vector3();
  private readonly aimRaycaster=new THREE.Raycaster();
  private readonly aimScreenCenter=new THREE.Vector2();
  private readonly groundMenu=document.createElement('section');
  private readonly groundMarker=new THREE.Group();
  private readonly groundRoute:THREE.Line<THREE.BufferGeometry,THREE.LineDashedMaterial>;
  private readonly groundRoutePositions=new Float32Array(256*3);
  private readonly groundRouteDistances=new Float32Array(256);
  private readonly groundRay=new THREE.Raycaster();
  private readonly groundPoint=new THREE.Vector2();
  private readonly groundFloor:THREE.Object3D;
  private groundGesture:{id:number;x:number;y:number;point:THREE.Vector3;long:boolean;timer:number}|null=null;
  private groundTarget:FloorPoint|null=null;
  private groundFollowup:GroundAction='go';
  private groundIntent:'break'|'pipe'|'boxes'|null=null;
  private mixOnly=false;
  private groundPulse=0;
  private groundRouteClock=0;
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
  private blockedFrom:'breaking'|'construction'|'pipe'|null=null;
  readonly pipeBatch=new ApprenticePipeBatch();
  readonly pipeYard:ApprenticePipeYard;
  private pipeSelection:number|null=null;
  private pipeJob:PipeJob|null=null;
  private readonly crew:ApprenticeCrewMate[]=[];
  crewReady:Promise<void>=Promise.resolve();
  private readonly pipeCutTarget=new THREE.Vector3();
  private message='Έτοιμος για οδηγίες';
  private readonly yellow=new THREE.MeshBasicMaterial({color:0xffdc35,transparent:true,opacity:.72,depthWrite:false});
  private readonly mobileView=matchMedia('(pointer:coarse)').matches;
  private readonly viewFrustum=new THREE.Frustum();
  private readonly viewMatrix=new THREE.Matrix4();
  private readonly workerBounds=new THREE.Sphere(new THREE.Vector3(),1.4);

  constructor(private readonly game:Game,debris:ChasingSystem){
    const scene=game.renderer.scene;
    this.groundFloor=game.room.getObjectByName('Rough unfinished concrete floor')!;
    const routeGeometry=new THREE.BufferGeometry();
    routeGeometry.setAttribute('position',new THREE.BufferAttribute(this.groundRoutePositions,3).setUsage(THREE.DynamicDrawUsage));
    routeGeometry.setAttribute('lineDistance',new THREE.BufferAttribute(this.groundRouteDistances,1).setUsage(THREE.DynamicDrawUsage));
    routeGeometry.setDrawRange(0,0);
    this.groundRoute=new THREE.Line(routeGeometry,new THREE.LineDashedMaterial({color:0xffd452,dashSize:.12,gapSize:.08,linewidth:2,depthTest:true}));
    this.groundRoute.name='Apprentice dashed ground order';this.groundRoute.frustumCulled=false;this.groundRoute.visible=false;scene.add(this.groundRoute);
    const ring=new THREE.Mesh(new THREE.RingGeometry(.20,.235,48,1,0,Math.PI*1.6),new THREE.MeshBasicMaterial({color:0xffd452,side:THREE.DoubleSide,depthWrite:false}));
    ring.rotation.x=-Math.PI/2;ring.position.y=.035;this.groundMarker.add(ring);
    const arrow=new THREE.Mesh(new THREE.ConeGeometry(.075,.19,3),new THREE.MeshBasicMaterial({color:0xffdf72,depthWrite:false}));
    arrow.rotation.z=-Math.PI/2;arrow.position.set(.27,.04,0);this.groundMarker.add(arrow);
    this.groundMarker.name='Apprentice destination arc';this.groundMarker.visible=false;scene.add(this.groundMarker);
    this.pipeYard=new ApprenticePipeYard(game.pvc.stock);scene.add(this.pipeYard);
    this.body=new WorkerBody(scene,{detail:this.mobileView?'apprentice':'full',castShadow:!this.mobileView});this.body.name='Apprentice 1';this.body.overview=true;
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
    this.paper=new THREE.Mesh(new THREE.PlaneGeometry(.62,.465),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(this.paperCanvas),side:THREE.DoubleSide,toneMapped:false}));
    this.paper.name='Electrical instruction drawing';this.paper.position.set(0,-.025,-.48);this.paper.rotation.x=-.08;this.paper.visible=false;game.renderer.camera.add(this.paper);this.drawPlan();
    const label=document.createElement('label');label.className='apprentice-count';label.innerHTML='Apprentices <select id="apprentice-count" aria-label="Apprentices"><option value="0">0</option><option value="1" selected>1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select>';
    document.querySelector('#start-button')!.after(label);
    label.querySelector('select')!.addEventListener('change',e=>{void this.prepareCrew(Number((e.target as HTMLSelectElement).value));});
    this.toolbar.id='apprentice-controls';this.toolbar.setAttribute('aria-label','Οδηγίες Apprentice');
    this.toolbar.innerHTML=`<div class="apprentice-actions">${[
      navButton('point','ΔΕΙΞΕ','Δείξε με το δάχτυλο · T'),navButton('layout','ΚΟΥΤΙΑ','Προεπισκόπηση κουτιών στον τοίχο · E'),
      navButton('break-now','ΣΠΑΣΕ','Σπάσε τη σημαδεμένη περιοχή'),navButton('confirm','OK','Επιβεβαίωσε τα κουτιά'),
      navButton('pipe-socket','ΠΡΙΖΑ','Κόψε 20 σωλήνες πρίζας 50 cm'),navButton('pipe-switch','SWITCH','Κόψε 20 σωλήνες switch 140 cm'),
      navButton('plan','ΣΧΕΔΙΟ','Ηλεκτρολογικό σχέδιο · V'),navButton('resume','ΣΥΝΕΧΕΙΑ','Συνέχισε την εργασία'),navButton('cancel','ΕΞΟΔΟΣ','Έξοδος από τις οδηγίες')
    ].join('')}</div>`;
    this.status.className='apprentice-status';this.status.setAttribute('role','status');this.toolbar.prepend(this.status);game.hud.shell.append(this.toolbar);
    const returnButton=document.createElement('button');returnButton.id='apprentice-return';returnButton.type='button';returnButton.setAttribute('aria-label','Επιστροφή στον Apprentice');
    returnButton.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${NAV_ICONS.point}"/></svg><span>ΒΟΗΘΟΣ</span>`;
    returnButton.addEventListener('click',()=>this.command('point'));game.hud.shell.querySelector('#mobile-tool-slider')?.append(returnButton);
    this.groundMenu.id='apprentice-ground-menu';this.groundMenu.setAttribute('aria-label','Εντολή Apprentice στο έδαφος');
    this.groundMenu.innerHTML=[groundButton('go','ΠΗΓΑΙΝΕ','point','Πήγαινε στο σημείο'),groundButton('mix','ΠΗΛΟΣ','mix','Φτιάξε πηλό'),groundButton('break','ΣΠΑΣΕ','break-now','Σπάσε τοίχο'),groundButton('pipe','ΣΩΛΗΝΕΣ','pipe-socket','Κόψε σωλήνες'),groundButton('boxes','ΚΟΥΤΙΑ','layout','Βάλε κουτιά')].join('');
    this.groundMenu.hidden=true;game.hud.shell.append(this.groundMenu);
    this.groundMenu.addEventListener('click',event=>{const action=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-ground]')?.dataset.ground as GroundAction|undefined;if(!action||!this.groundGesture)return;this.issueGroundOrder(this.groundGesture.point,action);this.closeGroundMenu();});
    this.mobilePlan.id='apprentice-mobile-plan';this.mobilePlan.setAttribute('aria-label','Ηλεκτρολογικό σχέδιο');this.mobilePlan.hidden=true;game.hud.shell.append(this.mobilePlan);
    this.mobilePlan.addEventListener('click',event=>{const target=event.target as HTMLElement,tab=target.closest<HTMLButtonElement>('[data-drawing-tab]')?.dataset.drawingTab;if(tab==='electrical'||tab==='ground'||tab==='section'){this.drawingTab=tab;this.drawPlan();}else if(target.closest('[data-drawing-zoom]')){this.drawingFit=!this.drawingFit;this.mobilePlan.classList.toggle('drawing-fit',this.drawingFit);this.mobilePlan.querySelector('[data-drawing-zoom]')!.textContent=this.drawingFit?'ΜΕΓΕΘΥΝΣΗ':'ΣΥΝΟΛΟ';}else if(target.closest('[data-drawing-close]'))this.command('cancel');});
    this.drawingPrompt.id='apprentice-drawing-prompt';this.drawingPrompt.textContent=matchMedia('(pointer:coarse)').matches?'ΣΧΕΔΙΑ':'E · ΣΧΕΔΙΑ';this.drawingPrompt.hidden=true;game.hud.shell.append(this.drawingPrompt);
    this.toolbar.addEventListener('click',e=>{const action=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-apprentice]')?.dataset.apprentice;if(action)this.command(action);});
    this.bindGroundGesture(game.renderer.webgl.domElement);
    addEventListener('keydown',e=>{
      if(!game.started||e.repeat||e.target instanceof Element&&e.target.closest('input,textarea,select,[contenteditable="true"]')||game.hud.shell.classList.contains('settings-open')||game.modelInspector?.active)return;
      const action=e.code==='KeyT'&&!e.shiftKey?'point':e.code==='KeyV'&&!e.shiftKey?'plan':e.code==='KeyE'&&this.mode==='point'&&!this.aimedAtApprentice()?'layout':e.code==='Digit1'&&this.mode==='pipe-choice'?'pipe-socket':e.code==='Digit2'&&this.mode==='pipe-choice'?'pipe-switch':e.code==='Enter'&&this.mode==='layout'?'confirm':e.code==='Enter'&&this.groundIntent==='break'?'break-now':e.code==='Escape'&&this.mode!=='off'?'cancel':null;
      if(action){e.preventDefault();e.stopImmediatePropagation();game.input.resetTransientInput();this.command(action);}
    },{capture:true});
    addEventListener('wirehouse:select-tool',()=>{this.mode='off';this.paper.visible=false;this.ghost.visible=false;});
    addEventListener('wirehouse:coordinator-open',()=>this.command('point'));
    addEventListener('wirehouse:cycle-tool',()=>{if(this.mode!=='layout'){this.mode='off';this.paper.visible=false;}});
    this.presentUI();
  }
  get ownsInput():boolean{return this.mode!=='off';}
  private async prepareCrew(count:number):Promise<void>{
    this.count=count;
    const start=document.querySelector<HTMLButtonElement>('#start-button')!;
    if(count>this.crew.length+1){
      start.disabled=true;start.textContent='PREPARING APPRENTICES…';
      for(let index=this.crew.length+2;index<=count;index++)this.crew.push(new ApprenticeCrewMate(this.game,index,this.pipeBatch,this.pipeYard));
    }
    this.crewReady=Promise.all(this.crew.slice(0,Math.max(0,count-1)).map(worker=>worker.ready)).then(()=>{});
    await this.crewReady;
    if(this.game.isReadyForStart){start.disabled=false;start.textContent='START';}
  }
  collisionObstacles(){return !this.game.started||this.count===0?[]:[{id:'apprentice-1',minX:this.camera.position.x-.18,maxX:this.camera.position.x+.18,minZ:this.camera.position.z-.08,maxZ:this.camera.position.z+.28},...this.crew.slice(0,this.count-1).map(worker=>worker.obstacle)];}
  get bareHands():boolean{return this.mode==='point'||this.mode==='pipe-choice'||this.mode==='plan';}
  private aimedAtApprentice():boolean {
    if(!this.game.started||this.count===0||!this.body.visible||!this.body.loaded)return false;
    const camera=this.game.renderer.camera;
    camera.getWorldDirection(this.aimDirection);
    this.aimRay.set(camera.position,this.aimDirection);
    this.apprenticeAimCenter.set(this.camera.position.x,1.35,this.camera.position.z);
    const distance=camera.position.distanceTo(this.apprenticeAimCenter);
    if(distance>=3.5||this.aimRay.distanceSqToPoint(this.apprenticeAimCenter)>=.42*.42)return false;
    camera.updateMatrixWorld();
    this.aimRaycaster.setFromCamera(this.aimScreenCenter,camera);
    this.aimRaycaster.far=3.5;
    const visibleHit=(root:THREE.Object3D,hits:THREE.Intersection[])=>hits.find(hit=>{
      let object:THREE.Object3D|null=hit.object;
      while(object){if(!object.visible)return false;if(object===root)return true;object=object.parent;}
      return false;
    });
    // Raycasting the animated skinned mesh costs tens of milliseconds on the
    // desktop and mobile profiles. Two tight body-space capsules follow the
    // worker's actual root position without skinning every vertex on the CPU.
    let workerDistance=Infinity;
    const capsule=(low:number,high:number,radius:number)=>{
      this.aimCapsuleStart.set(this.body.position.x,low,this.body.position.z);
      this.aimCapsuleEnd.set(this.body.position.x,high,this.body.position.z);
      if(this.aimRay.distanceSqToSegment(this.aimCapsuleStart,this.aimCapsuleEnd,this.aimClosestPoint)<=radius*radius)
        workerDistance=Math.min(workerDistance,camera.position.distanceTo(this.aimClosestPoint));
    };
    capsule(.78,1.52,.21);
    capsule(1.55,1.75,.145);
    if(workerDistance===Infinity)return false;
    const wallHit=this.game.room.brickWall.aim(camera,workerDistance);
    if(wallHit&&camera.position.distanceTo(wallHit.point)<workerDistance-.02)return false;
    const equipment=this.game.mixing.models;
    for(const root of [equipment.group,equipment.wheelbarrow.group]){
      const nearer=visibleHit(root,this.aimRaycaster.intersectObject(root,true));
      if(nearer&&nearer.distance<workerDistance-.02)return false;
    }
    return true;
  }
  tryOpenDrawingsOnAim():boolean {
    if((this.mode!=='off'&&this.mode!=='point')||!this.aimedAtApprentice())return false;
    this.drawingTab='electrical';this.drawingFit=false;this.mobilePlan.classList.remove('drawing-fit');this.command('plan');return this.ownsInput;
  }
  get telemetry(){return{count:this.count,mode:this.mode,phase:this.phase,groundTarget:this.groundTarget,groundFollowup:this.groundTarget?this.groundFollowup:null,groundIntent:this.groundIntent,groundMenuOpen:!this.groundMenu.hidden,blockedFrom:this.blockedFrom,workStep:this.phase==='construction'?this.workStep:null,workCursor:this.workCursor,workTargets:this.workTargets.length,workContactReady:this.workContactReady,workGripReachM:this.workGripReachM,workTargetRangeM:this.workTargetRangeM,wallApproach:this.wallApproach,batchCycle:this.batchCycle,cementDone:this.cementDone,sandDone:this.sandDone,carriedKg:this.carriedKg,workFailure:this.workFailure,waiting:this.waiting,message:this.message,position:this.camera.position.toArray(),highlightSamples:this.lines.length,strikes:this.strikes,removedVolume:this.removedVolume,job:this.job?{anchor:this.job.anchor.toArray(),modules:this.job.modules,cursor:this.job.cursor,targets:this.job.targets.length,fitRefinements:this.job.fitRefinements}:null,pipeSelection:this.pipeSelection,pipeJob:this.pipeJob?{...this.pipeJob}:null,crew:this.crew.slice(0,this.count-1).map(worker=>({index:worker.index,active:worker.active,done:worker.done,position:worker.camera.position.toArray()})),pipeBatch:this.pipeBatch.telemetry,pipeYard:this.pipeYard.telemetry,bundles:[...this.game.pvc.stock.bundleRemaining]};}

  command(action:string):void {
    const g=this.game;if(!g.started)return;
    this.closeGroundMenu();
    if(action==='resume'&&this.phase==='blocked'&&(this.job||this.pipeJob)){
      if(g.mixing.wheelbarrow.busy||g.pvc.blocksWork){this.message='Άφησε πρώτα τον εξοπλισμό για να συνεχίσω';return;}
      this.phase=this.blockedFrom??'breaking';if(this.phase==='pipe')for(const mate of this.crew)mate.resume();this.blockedFrom=null;this.workFailure='';this.stall=0;this.wallReachWait=0;this.path=[];this.workDestination=null;this.message='Συνεχίζω την επιβεβαιωμένη εργασία';return;
    }
    if(g.mixing.wheelbarrow.busy||g.mixing.blocksWork||g.pvc.blocksWork){g.hud.notify('Άφησε πρώτα τον εξοπλισμό που κρατάς.',false,1500);return;}
    if(action==='confirm'){this.confirm();return;}
    if(action==='break-now'){this.confirmBreakOnly();return;}
    if(action==='pipe-socket'||action==='pipe-switch'){
      if(this.pipeSelection===null||!['idle','done'].includes(this.phase)){this.message='Δείξε πρώτα μία διαθέσιμη μάτσα με το T';return;}
      if(this.count===0){this.message='Δεν έχει επιλεγεί Apprentice στην αρχική οθόνη';return;}
      const kind:ApprenticePipeKind=action==='pipe-socket'?'socket':'switch';
      const finished=this.pipeBatch.telemetry[kind==='socket'?'finishedSocket':'finishedSwitch'];
      if(finished>=APPRENTICE_PIPE_TARGET){this.message=`Η παρτίδα ${kind==='socket'?'πρίζας':'switch'} είναι ήδη έτοιμη · 20 τεμάχια`;return;}
      const remaining=APPRENTICE_PIPE_TARGET-finished,workerCount=Math.min(this.count,remaining),share=Math.ceil(remaining/workerCount);
      let assigned=0;for(let index=0;index<workerCount-1;index++){
        const target=Math.min(share,remaining-assigned-share);this.crew[index].assign((this.pipeSelection+index+1)%5,kind,target);assigned+=target;
      }
      this.pipeJob={bundle:this.pipeSelection,kind,produced:0,target:remaining-assigned,step:'claim',elapsed:0};this.phase='pipe';this.mode='point';this.path=[];this.pipeCutTarget.copy(this.pipeYard.cuttingPoint(this.pipeSelection,kind));
      this.message=`Μάτσα ${this.pipeSelection+1} · κόβω ${APPRENTICE_PIPE_TARGET} σωλήνες ${Math.round(APPRENTICE_PIPE_LENGTH_M[kind]*100)} cm`;this.drawPlan();return;
    }
    if(action==='layout'){
      if(!this.anchor){
        const hit=this.game.room.brickWall.aim(this.game.renderer.camera,4);
        if(hit&&Math.abs(hit.point.x)<2.48&&hit.point.y>.13&&hit.point.y<2.5){this.anchor=hit.point.clone().setZ(FRONT+.025);this.addLine(this.anchor.clone().add(new THREE.Vector3(-.025,0,0)),this.anchor.clone().add(new THREE.Vector3(.025,0,0)),this.highlight,this.yellow);this.lines.push(this.anchor.clone());}
        else{this.message='Κοίταξε τον τοίχο και πάτησε ΚΟΥΤΙΑ';g.hud.notify(this.message,false,1800);return;}
      }
      if(!['idle','done'].includes(this.phase)){this.message='Η προηγούμενη εργασία παραμένει ενεργή · ΣΥΝΕΧΕΙΑ ή ΑΚΥΡΩΣΗ';return;}
      this.groundIntent=null;
      window.dispatchEvent(new CustomEvent('wirehouse:select-tool',{detail:'fitting'}));
      window.dispatchEvent(new CustomEvent('wirehouse:box-enter-assembly'));this.mode='layout';this.previewKey='';this.message='1–4 σύνδεση · τροχός 1G/2G · R περιστροφή · OK επιβεβαίωση';return;
    }
    if(action==='cancel'){
      this.closeGroundMenu();
      if(this.phase==='directed'){this.phase='idle';this.groundTarget=null;this.groundRoute.visible=false;this.groundMarker.visible=false;this.path=[];this.message='Η μετακίνηση ακυρώθηκε';}
      if(this.phase==='blocked'){
        if(this.blockedFrom==='pipe'){
          g.pvc.releaseApprentice();for(const mate of this.crew)mate.cancel();this.holdWorkTool(null);this.pipeJob=null;this.phase='idle';this.blockedFrom=null;this.message='Η κοπή σταμάτησε · τα έτοιμα τεμάχια και τα ρετάλια παραμένουν';
          this.mode='off';this.paper.visible=false;this.mixOnly=false;return;
        }
        if(this.carriedKg>0){const returned=g.mixing.wheelbarrow.receiveCarried(this.carriedKg);this.carriedKg-=returned;if(this.carriedKg>1e-6){this.message='Δεν χωρά η ποσότητα που κρατώ · άδειασε το αμαξάκι';return;}}
        g.mixing.drum.running=false;g.mixing.releaseApprentice();this.holdWorkTool(null);
        if(this.stagedBoxes){this.stagedBoxes.position.copy(this.stagedBoxPosition);this.stagedBoxes.visible=true;}
        g.renderer.scene.attach(this.hammer);this.hammer.position.set(.8,.2,.5);this.hammer.rotation.set(0,0,Math.PI/2);this.hasHammer=false;this.hammer.visible=true;
        this.job=null;this.mixOnly=false;this.phase='idle';this.blockedFrom=null;this.workFailure='';this.message='Η εργασία ακυρώθηκε · τα υλικά παραμένουν στη σκηνή';
      }
      this.mode='off';this.ghost.visible=false;this.paper.visible=false;
      if(this.phase!=='pipe')g.pvc.stock.highlightBundle(null);
      window.dispatchEvent(new CustomEvent('wirehouse:box-exit-assembly'));return;
    }
    if(action==='point'||action==='plan'){
      window.dispatchEvent(new CustomEvent('wirehouse:box-exit-assembly'));
      this.mode=action;this.ghost.visible=false;this.paper.visible=false;g.input.resetTransientInput();
      if(action==='point'){this.pipeSelection=null;g.pvc.stock.highlightBundle(null);}
      if(action==='plan')this.drawPlan();
      this.message=action==='point'?'Έδαφος: πάτημα για μετακίνηση · κράτημα για εντολές · τοίχος: USE':'Ηλεκτρολογικό σχέδιο · T επιστροφή στις οδηγίες';
    }
  }
  handleInput(requested:boolean):boolean {
    if(!this.ownsInput)return false;
    if(this.mode==='point'&&(requested||this.game.input.actionHeld)&&['idle','done'].includes(this.phase)){
      const bundle=this.game.pvc.stock.bundleAt(this.game.renderer.camera);
      if(bundle){this.pipeSelection=bundle.index;this.groundIntent=null;this.game.pvc.stock.highlightBundle(bundle.index);this.mode='pipe-choice';this.message=`Μάτσα ${bundle.index+1} · διάλεξε ΠΡΙΖΑ (50 cm) ή SWITCH (140 cm)`;this.lines.length=0;this.clear(this.highlight);return true;}
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
  private bindGroundGesture(canvas:HTMLCanvasElement):void {
    this.game.hud.shell.addEventListener('pointerdown',event=>{
      if(!this.game.started||this.count===0||this.mode!=='point'||this.game.hud.shell.classList.contains('settings-open')||this.game.modelInspector?.active)return;
      if(!(event.target as Element).closest('#game-stage,#reticle'))return;
      if(event.pointerType==='mouse'&&event.button!==1)return;
      if(event.pointerType!=='mouse'&&event.pointerType!=='touch'&&event.pointerType!=='pen')return;
      const point=this.groundAt(canvas,event.clientX,event.clientY);
      if(!point)return;
      this.closeGroundMenu();
      const gesture={id:event.pointerId,x:event.clientX,y:event.clientY,point,long:false,timer:0};
      gesture.timer=window.setTimeout(()=>{if(this.groundGesture!==gesture)return;gesture.long=true;this.openGroundMenu(gesture);},550);
      this.groundGesture=gesture;
      if(event.pointerType==='mouse')event.preventDefault();
    },{capture:true});
    addEventListener('pointermove',event=>{
      const gesture=this.groundGesture;
      if(!gesture||gesture.id!==event.pointerId||gesture.long)return;
      if(Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>12){clearTimeout(gesture.timer);this.groundGesture=null;}
    });
    addEventListener('pointerup',event=>{
      const gesture=this.groundGesture;
      if(!gesture||gesture.id!==event.pointerId)return;
      clearTimeout(gesture.timer);
      if(!gesture.long){this.groundGesture=null;this.issueGroundOrder(gesture.point,'go');}
    });
    addEventListener('pointercancel',event=>{if(this.groundGesture?.id===event.pointerId)this.closeGroundMenu();});
    addEventListener('blur',()=>this.closeGroundMenu());
    canvas.addEventListener('auxclick',event=>{if(event.button===1&&this.mode==='point')event.preventDefault();});
  }
  private groundAt(canvas:HTMLCanvasElement,x:number,y:number):THREE.Vector3|null {
    const rect=canvas.getBoundingClientRect();
    this.groundPoint.set((x-rect.left)/rect.width*2-1,-((y-rect.top)/rect.height*2-1));
    this.game.renderer.camera.updateMatrixWorld();
    this.groundRay.setFromCamera(this.groundPoint,this.game.renderer.camera);
    const hit=this.groundRay.intersectObject(this.groundFloor,false)[0];
    return hit?.point.clone()??null;
  }
  private openGroundMenu(gesture:NonNullable<ApprenticeSystem['groundGesture']>):void {
    this.groundMenu.hidden=false;
    this.groundMarker.position.set(gesture.point.x,0,gesture.point.z);this.groundMarker.visible=true;
    const shell=this.game.hud.shell.getBoundingClientRect(),width=this.groundMenu.offsetWidth,height=this.groundMenu.offsetHeight;
    this.groundMenu.style.left=`${THREE.MathUtils.clamp(gesture.x-shell.left-width/2,8,Math.max(8,shell.width-width-8))}px`;
    this.groundMenu.style.top=`${THREE.MathUtils.clamp(gesture.y-shell.top-height-16,8,Math.max(8,shell.height-height-8))}px`;
  }
  private closeGroundMenu():void {
    if(this.groundGesture)clearTimeout(this.groundGesture.timer);
    this.groundGesture=null;this.groundMenu.hidden=true;
    if(!this.groundTarget&&this.phase!=='directed')this.groundMarker.visible=false;
  }
  private issueGroundOrder(point:THREE.Vector3,action:GroundAction):void {
    if(!['idle','done','directed'].includes(this.phase)){
      this.message='Ο Apprentice ολοκληρώνει προηγούμενη εργασία · περίμενε ή ακύρωσέ την';this.game.hud.notify(this.message,false,1800);return;
    }
    if(action==='mix'&&this.game.mixing.wheelbarrow.massKg>=this.game.mixing.wheelbarrow.capacityKg-.01){this.message='Το αμαξάκι είναι ήδη γεμάτο πηλό';this.game.hud.notify(this.message,false,1800);return;}
    const destination={x:point.x,z:point.z},route=apprenticePath(this.camera.position,destination,this.game.mixing.collisionObstacles());
    if(!route){this.message='Δεν υπάρχει ελεύθερη διαδρομή έως εκεί · δείξε άλλο σημείο στο έδαφος';this.game.hud.notify(this.message,false,1800);return;}
    this.groundTarget=destination;this.groundFollowup=action;this.groundIntent=null;this.path=route;this.phase='directed';
    this.groundMarker.position.set(point.x,0,point.z);this.groundMarker.visible=true;this.groundRoute.visible=true;this.groundRouteClock=0;
    this.updateGroundRoute();
    this.message=action==='go'?'Πηγαίνω στο σημείο που έδειξες':`Πηγαίνω στο σημείο · ${({mix:'θα φτιάξω πηλό',break:'περιμένω σήμανση τοίχου',pipe:'θα κόψω σωλήνες',boxes:'περιμένω διάταξη κουτιών'} as Record<string,string>)[action]}`;
  }
  private finishGroundOrder():void {
    const action=this.groundFollowup,where=this.groundTarget;
    this.groundTarget=null;this.groundRoute.visible=false;this.path=[];this.phase='done';
    if(action==='mix'){
      this.job=null;this.mixOnly=true;this.phase='construction';this.nextWork('claim');this.message='Πηγαίνω στη μπετονιέρα για πραγματική ανάμιξη';return;
    }
    if(action==='break'){this.anchor=null;this.lines.length=0;this.clear(this.highlight);this.groundIntent='break';this.message='Δείξε με κίτρινη γραμμή τον τοίχο και πάτησε ΣΠΑΣΕ';return;}
    if(action==='boxes'){this.anchor=null;this.lines.length=0;this.clear(this.highlight);this.groundIntent='boxes';this.message='Κοίταξε τον τοίχο και πάτησε ΚΟΥΤΙΑ για ζωντανή προεπισκόπηση';return;}
    if(action==='pipe'&&where){
      let best=-1,distance=Infinity;
      for(let index=0;index<5;index++){
        if(this.game.pvc.stock.bundleRemaining[index]<=0)continue;
        const center=this.game.pvc.stock.bundleCenter(index),d=Math.hypot(where.x-center.x,where.z-center.z);
        if(d<distance){best=index;distance=d;}
      }
      if(best>=0&&distance<1.25){this.pipeSelection=best;this.game.pvc.stock.highlightBundle(best);this.mode='pipe-choice';this.message=`Μάτσα ${best+1} · διάλεξε ΠΡΙΖΑ ή SWITCH`;}
      else{this.groundIntent='pipe';this.message='Δείξε τη μάτσα PVC με USE και διάλεξε ΠΡΙΖΑ ή SWITCH';}
      return;
    }
    this.message='Έφτασα στο σημείο της εντολής';
  }
  private updateGroundRoute():void {
    const positions=this.groundRoutePositions,distances=this.groundRouteDistances;
    const points=[{x:this.camera.position.x,z:this.camera.position.z},...this.path];
    if(this.groundTarget&&!points.some(p=>Math.hypot(p.x-this.groundTarget!.x,p.z-this.groundTarget!.z)<.01))points.push(this.groundTarget);
    let length=0,count=0;
    for(const point of points.slice(0,256)){
      if(count)length+=Math.hypot(point.x-positions[(count-1)*3],point.z-positions[(count-1)*3+2]);
      positions[count*3]=point.x;positions[count*3+1]=.045;positions[count*3+2]=point.z;distances[count]=length;count++;
    }
    this.groundRoute.geometry.setDrawRange(0,count);
    this.groundRoute.geometry.attributes.position.needsUpdate=true;
    this.groundRoute.geometry.attributes.lineDistance.needsUpdate=true;
  }
  private confirmBreakOnly():void {
    if(this.groundIntent!=='break'||!['idle','done'].includes(this.phase))return;
    if(!this.anchor||this.lines.length===0){this.message='Σημάδεψε πρώτα στον τοίχο την κίτρινη περιοχή';return;}
    const targets:THREE.Vector3[]=[];
    for(let i=0;i<this.lines.length;i++){
      const end=this.lines[i],start=i>0&&end.distanceTo(this.lines[i-1])<.17?this.lines[i-1]:end;
      const count=Math.max(1,Math.ceil(start.distanceTo(end)/.015));
      for(let n=0;n<=count;n++)targets.push(start.clone().lerp(end,n/count).setZ(FRONT));
    }
    this.job={anchor:this.anchor.clone(),modules:[],targets,cursor:0,refinements:0,fitRefinements:0};
    this.workWallMarker.position.copy(this.anchor).setZ(FRONT);this.strikes=0;this.removedVolume=0;this.stall=0;this.groundIntent=null;
    this.clear(this.highlight);this.lines.length=0;this.phase=this.hasHammer?'walking':'fetching';this.elapsed=0;this.path=[];
    this.message='Επιβεβαιώθηκε · παίρνω το κάγκο και σπάζω μόνο τη σημαδεμένη περιοχή';
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
    if(!this.path.length){const path=apprenticePath(pos,destination,this.game.mixing.collisionObstacles());if(!path){this.blockedFrom=this.phase==='construction'?'construction':this.phase==='pipe'?'pipe':'breaking';this.phase='blocked';this.message='Δεν υπάρχει ελεύθερη διαδρομή · μετακίνησε τον εξοπλισμό';return false;}this.path=path;}
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
    for(const mate of this.crew)if(this.phase!=='blocked'||this.blockedFrom!=='pipe')mate.update(dt,this.game.started&&mate.index<=this.count);
    this.body.visible=this.game.started&&this.count>=1;this.hammer.visible=this.count>=1;this.camera.visible=this.game.started&&this.count>=1;
    if(!this.game.started||this.count===0||!this.body.loaded){this.presentUI();return;}
    dt=Math.min(dt,.05);this.elapsed+=dt;this.waiting=false;this.velocity.set(0,0,0);
    if(this.phase==='directed'&&this.groundTarget){
      if(this.moveTo(this.groundTarget,dt))this.finishGroundOrder();
      else if((this.phase as Phase)==='blocked'){this.phase='idle';this.groundTarget=null;this.groundRoute.visible=false;this.message='Η διαδρομή κόπηκε · δείξε άλλο σημείο στο έδαφος';}
      else{this.camera.position.y=THREE.MathUtils.damp(this.camera.position.y,1.65,6,dt);this.groundRouteClock+=dt;if(this.groundRouteClock>.12){this.groundRouteClock=0;this.updateGroundRoute();}}
    }
    if(this.groundMarker.visible){this.groundPulse+=dt;this.groundMarker.rotation.y+=dt*1.8;this.groundMarker.scale.setScalar(1+Math.sin(this.groundPulse*5)*.045);}
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
    if(this.phase==='pipe')this.updatePipe(dt);
    else if(this.phase!=='breaking'&&this.hasHammer){
      this.rig.restHammer(this.camera);
      const target=this.hammer.getWorldPosition(new THREE.Vector3()),rotation=this.hammer.getWorldQuaternion(new THREE.Quaternion()),alpha=1-Math.exp(-8*dt);
      this.carriedPosition.lerp(target,alpha);this.carriedRotation.slerp(rotation,alpha);
      this.hammer.position.copy(this.hammer.parent!.worldToLocal(this.carriedPosition.clone()));
      this.hammer.quaternion.copy(this.hammer.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(this.carriedRotation));this.hammer.updateWorldMatrix(false,true);this.rig.poseArms(this.camera);
    }
    this.camera.updateMatrixWorld(true);
    const grips=this.phase==='construction'||this.phase==='pipe'||this.phase==='blocked'&&this.workTool?this.poseWorkTool():[];
    this.body.update(dt,this.camera,{eyeHeight:this.camera.position.y,velocity:this.velocity,yaw:this.camera.rotation.y,pitch:this.camera.rotation.x},this.rig,'hammer',this.phase==='breaking',grips.length>0,grips);
    this.body.overview=true;this.cullMobileBodies();this.presentUI();
  }
  private cullMobileBodies():void {
    if(!this.mobileView)return;
    const camera=this.game.renderer.camera;
    camera.updateMatrixWorld();
    this.viewFrustum.setFromProjectionMatrix(this.viewMatrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    for(const mate of this.crew.slice(0,this.count-1))mate.body.visible=this.game.started&&mate.body.loaded;
    for(const body of [this.body,...this.crew.slice(0,this.count-1).map(mate=>mate.body)]){
      if(!body.visible)continue;
      this.workerBounds.center.set(body.position.x,body.position.y+1,body.position.z);
      body.visible=this.viewFrustum.intersectsSphere(this.workerBounds);
    }
  }
  private updatePipe(dt:number):void{
    const job=this.pipeJob;if(!job)return;
    if(this.crew.slice(0,this.count-1).some(mate=>mate.isBlocked)){
      this.phase='blocked';this.blockedFrom='pipe';this.message='Μία μάτσα δεν έχει αρκετό PVC ή η διαδρομή κόπηκε · ΣΥΝΕΧΕΙΑ ή ΑΚΥΡΩΣΗ';return;
    }
    const pvc=this.game.pvc,centre=pvc.stock.bundleCenter(job.bundle);
    if(job.step==='claim'){
      if(!pvc.claimForApprentice()){this.waiting=true;this.message='Περιμένω να ελευθερωθεί η μάτσα PVC';return;}
      job.step='approach';job.elapsed=0;this.path=[];
    }
    if(job.step==='approach'){
      this.camera.position.y=THREE.MathUtils.damp(this.camera.position.y,job.kind==='socket'?.95:1.70,5,dt);
      if(!this.moveTo({x:3.15,z:centre.z-.10},dt))return;
      job.step='cut';job.elapsed=0;this.holdWorkTool('cutter');
    }
    if(job.step==='wait-crew'){
      if(this.crew.slice(0,this.count-1).some(mate=>mate.active)){this.message='Περιμένω τους άλλους βοηθούς να τελειώσουν την παρτίδα';return;}
      pvc.releaseApprentice();this.holdWorkTool(null);this.phase='done';this.pipeSelection=null;pvc.stock.highlightBundle(null);this.message=`Έτοιμα ${APPRENTICE_PIPE_TARGET} τεμάχια ${Math.round(APPRENTICE_PIPE_LENGTH_M[job.kind]*100)} cm`;this.pipeJob=null;this.drawPlan();return;
    }
    const needed=APPRENTICE_PIPE_LENGTH_M[job.kind]+.003;
    const source=this.pipeBatch.remnants[job.bundle].findIndex(length=>length+1e-9>=needed);
    this.pipeCutTarget.set(source<0?centre.x-.025:centre.x-.14,APPRENTICE_PIPE_LENGTH_M[job.kind],source<0?centre.z:centre.z-.085-source*.022);
    this.camera.position.y=THREE.MathUtils.damp(this.camera.position.y,job.kind==='socket'?.95:1.70,7,dt);
    this.camera.lookAt(this.pipeCutTarget);this.camera.updateMatrixWorld(true);
    if(job.step==='cut'){
      this.holdWorkTool('cutter');
      if(!this.workContactReady){job.elapsed=Math.max(0,job.elapsed-dt*.3);this.waiting=true;this.message='Ρυθμίζω την επαφή του κόφτη στον σωλήνα';return;}
      job.elapsed+=dt;
      const moving=this.workTools.get('cutter')?.getObjectByName('cutter-moving-handle');if(moving)moving.rotation.z=.13+Math.sin(Math.min(1,job.elapsed/1.25)*Math.PI)*.48;
      this.message=`Κόβω ${job.produced+1}/${job.target} · ${Math.round(APPRENTICE_PIPE_LENGTH_M[job.kind]*100)} cm`;
      if(job.elapsed<1.25)return;
      const receipt=this.pipeBatch.cut(job.bundle,job.kind,()=>pvc.consumeRawForApprentice(job.bundle));
      if(!receipt){this.phase='blocked';this.blockedFrom='pipe';this.message='Η επιλεγμένη μάτσα δεν έχει αρκετό σωλήνα · διάλεξε άλλη ή συμπλήρωσε απόθεμα';return;}
      this.pipeYard.addCut(receipt);job.produced++;job.step='store';job.elapsed=0;this.drawPlan();
    }else if(job.step==='store'){
      job.elapsed+=dt;
      if(job.elapsed<.35)return;
      if(job.produced>=job.target){job.step='wait-crew';this.holdWorkTool(null);return;}
      job.step='cut';job.elapsed=0;
    }
  }
  private breakWall(dt:number):void{
    const job=this.job!,wall=this.game.room.brickWall;
    let target=job.targets[job.cursor];
    while(target&&!this.columnOccupied(target)){job.cursor++;target=job.targets[job.cursor];this.stall=0;}
    if(!target){
      if(job.modules.length===0){this.phase='done';this.job=null;this.message=this.strikes?'Η σημαδεμένη περιοχή του τοίχου έσπασε':'Η σημαδεμένη περιοχή ήταν ήδη ανοιχτή';return;}
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
      tool=kind==='box'?this.stagedBoxes!:kind==='trowel'?buildToolModel('trowel'):kind==='cutter'?buildToolModel('cutter'):kind==='shovel'?createShovelModel():kind==='mixer'?createMixerModel():kind==='water'?models.water.clone(true):models.bucket.clone(true);
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
    if(kind==='trowel'&&this.workStep==='wall-mortar'||kind==='cutter'&&this.phase==='pipe'){
      const target=kind==='cutter'?this.pipeCutTarget:this.workTargets[this.workCursor],tipArray=model.userData.tipPoint as number[]|undefined;
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
      this.batchCycle=this.mixOnly?(cart.massKg>=cart.capacityKg-5?1:0):cart.massKg>0?1:0;
      this.nextWork('return-hammer');
    }
    else if(this.workStep==='return-hammer'){
      if(!near('κάγκο',this.hammerRestMarker,.6))return;
      if(wait(.6)){
        if(this.hasHammer){this.game.renderer.scene.attach(this.hammer);this.hammer.position.set(.8,.2,.5);this.hammer.rotation.set(0,0,Math.PI/2);this.hasHammer=false;this.rig.visible=false;}
        if(this.mixOnly&&cart.massKg>=cart.capacityKg-.01){this.finishMixOnly();return;}
        if(cart.massKg>=Math.max(4,(this.job?.modules.length??1)*4)){
          if(!this.mixOnly){this.message='Υπάρχει έτοιμος πηλός στο αμαξάκι · παίρνω το μιστρί';this.nextWork('trowel-source');}
          else{this.message='Συμπληρώνω το αμαξάκι με φρέσκο πηλό';this.nextWork(drum.batch.ready?'bucket-source':'water-source');}
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
          if(cart.massKg>=cart.capacityKg-.01){if(this.mixOnly)this.finishMixOnly();else this.nextWork('trowel-source');return;}
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
        if(this.mixOnly&&cart.massKg>=cart.capacityKg-.01){this.finishMixOnly();return;}
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
  private finishMixOnly():void {
    this.holdWorkTool(null);this.game.mixing.drum.running=false;this.game.mixing.releaseApprentice();this.mixOnly=false;this.phase='done';
    this.message=`Ο πηλός ετοιμάστηκε · αμαξάκι ${this.game.mixing.wheelbarrow.massKg.toFixed(1)} kg`;
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
    if(this.mode==='off'&&this.game.hud.shell.dataset.bottomRole==='coordinator')
      window.dispatchEvent(new CustomEvent('wirehouse:coordinator-close'));
    else if(this.mode!=='off'&&this.game.hud.shell.dataset.bottomRole!=='coordinator'&&matchMedia('(pointer:coarse)').matches)
      window.dispatchEvent(new CustomEvent('wirehouse:coordinator-entered'));
    this.toolbar.hidden=!this.game.started||this.count===0||this.mode==='off';
    const returnButton=this.game.hud.shell.querySelector<HTMLButtonElement>('#apprentice-return');
    if(returnButton)returnButton.hidden=!this.game.started||this.count===0||this.mode!=='off';
    this.mobilePlan.hidden=!this.game.started||this.mode!=='plan';
    this.drawingPrompt.hidden=(this.mode!=='off'&&this.mode!=='point')||!this.aimedAtApprentice();
    this.game.hud.shell.dataset.apprenticeMode=this.mode;
    const tool=this.game.hud.shell.querySelector<HTMLElement>('#tool-status')!;
    tool.dataset.directive=this.mode==='point'||this.mode==='pipe-choice'?'ΔΑΧΤΥΛΟ · ΚΙΤΡΙΝΗ ΕΠΙΣΗΜΑΝΣΗ':this.mode==='plan'?'ΗΛΕΚΤΡΟΛΟΓΙΚΟ ΣΧΕΔΙΟ':'';
    const touch=matchMedia('(pointer:coarse)').matches;
    const instruction=touch&&this.mode==='layout'?'Σύνδεσε τα κουτιά · OK για ανάθεση':this.message;
    const text=this.count===0?'Apprentices: 0':`${this.count===1?'Apprentice 1':`Apprentices ${this.count}`} · ${instruction}`;if(this.status.textContent!==text)this.status.textContent=text;
    this.status.title=text;
    this.toolbar.dataset.quiet=String(this.mode==='point'&&['idle','done'].includes(this.phase)&&this.message.startsWith('Έδαφος:'));
    for(const b of this.toolbar.querySelectorAll<HTMLButtonElement>('button')){
      const action=b.dataset.apprentice;
      b.hidden=this.phase==='blocked'?action!=='resume'&&action!=='cancel':
        action==='layout'&&this.mode!=='point'||
        action==='break-now'&&!(this.mode==='point'&&this.groundIntent==='break'&&this.lines.length>0)||
        action==='confirm'&&this.mode!=='layout'||
        (action==='pipe-socket'||action==='pipe-switch')&&this.mode!=='pipe-choice'||
        action==='plan'&&this.mode!=='point'&&this.mode!=='plan'||
        action==='resume'||
        action==='point'&&this.mode==='layout';
      b.classList.toggle('selected',action===this.mode);
      const label=action==='cancel'&&this.phase==='blocked'?'ΑΚΥΡΩΣΗ':null;
      if(label&&b.querySelector('span')?.textContent!==label)b.querySelector('span')!.textContent=label;
    }
  }
  private drawPlan():void{
    const ctx=this.paperCanvas.getContext('2d')!,w=1024,h=768;
    ctx.fillStyle='#f4f1e5';ctx.fillRect(0,0,w,h);
    ctx.strokeStyle='#dce3e0';ctx.lineWidth=1;
    for(let x=32;x<w;x+=32){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
    for(let y=32;y<h;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    ctx.fillStyle='#071c27';ctx.font='bold 43px sans-serif';ctx.fillText('ΗΛΕΚΤΡΟΛΟΓΙΚΟ ΣΧΕΔΙΟ',45,61);
    ctx.font='26px sans-serif';ctx.fillText('ΜΠΡΟΣΤΙΝΟΣ ΤΟΙΧΟΣ · ΠΡΩΤΗ ΕΓΚΑΤΑΣΤΑΣΗ · PVC Ø20 mm',47,105);
    const left=64,right=960,top=144,floor=546,mapX=(x:number)=>512+x*168,mapY=(y:number)=>floor-y*150;
    ctx.fillStyle='#faf9f1';ctx.fillRect(left,top,right-left,floor-top);
    ctx.strokeStyle='#456171';ctx.lineWidth=4;ctx.strokeRect(left,top,right-left,floor-top);
    ctx.strokeStyle='#b3c4c8';ctx.lineWidth=2;
    for(const height of [.3,1.2]){const y=mapY(height);ctx.setLineDash([7,9]);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#456171';ctx.font='24px sans-serif';ctx.fillText(`${Math.round(height*100)} cm`,left+8,y-9);}
    for(const point of this.game.mission.points){
      if(point.definition.id.startsWith('extra-')&&!point.boxGroup.visible)continue;
      const x=mapX(point.position.x),bottom=point.definition.bottom,boxWidth=Math.max(.074,point.boxGroup.groupWidth),boxHeight=point.boxGroup.groupHeight,y=mapY(bottom+boxHeight),installed=point.boxGroup.visible;
      ctx.strokeStyle=installed?'#116995':'#6c8792';ctx.lineWidth=installed?4:3;ctx.setLineDash(installed?[]:[6,5]);ctx.strokeRect(x-boxWidth*75,y,boxWidth*150,boxHeight*150);ctx.setLineDash([]);
      ctx.fillStyle='#173c4f';ctx.font='bold 25px sans-serif';ctx.textAlign='center';ctx.fillText(`${point.definition.id} · ${point.definition.kind==='switch'?'SW':'ΠΡ'}`,x,y-13);
      ctx.font='22px sans-serif';ctx.fillText(`${Math.round(bottom*100)} cm`,x,y+boxHeight*150+27);
      ctx.strokeStyle=point.conduit?'#116995':'#90aeb4';ctx.lineWidth=4;ctx.setLineDash(point.conduit?[]:[8,7]);ctx.beginPath();ctx.moveTo(x,mapY(bottom));ctx.lineTo(x,floor);ctx.stroke();ctx.setLineDash([]);
    }
    ctx.textAlign='left';
    if(this.job){
      const x=mapX(this.job.anchor.x),y=mapY(this.job.anchor.y);ctx.strokeStyle='#d19d12';ctx.lineWidth=5;ctx.strokeRect(x-29,y-29,58,58);ctx.fillStyle='#8b6412';ctx.font='bold 22px sans-serif';ctx.fillText(`ΕΝΤΟΛΗ: ${this.job.modules.map(m=>m.kind).join('+')}`,Math.min(x+35,695),Math.max(top+36,y-22));
    }
    ctx.fillStyle='#071c27';ctx.font='bold 29px sans-serif';ctx.fillText('ΚΟΠΕΣ ΓΙΑ ΤΟΝ ΒΟΗΘΟ',47,610);
    ctx.font='26px sans-serif';ctx.fillText(`ΠΡΙΖΑ  ·  20 × 50 cm   |   έτοιμα ${this.pipeBatch.telemetry.finishedSocket}/20`,47,655);
    ctx.fillText(`SWITCH · 20 × 140 cm  |   έτοιμα ${this.pipeBatch.telemetry.finishedSwitch}/20`,47,697);
    ctx.fillStyle='#122f39';ctx.font='23px sans-serif';ctx.fillText('T: δείξε τοίχο ή μάτσα PVC   ·   E: διάταξη κουτιών   ·   OK: ανάθεση',47,739);
    this.paper.material.map!.needsUpdate=true;
    const points=this.game.mission.points.filter(point=>!point.definition.id.startsWith('extra-')||point.boxGroup.visible);
    const drawings={electrical:{label:'Ηλεκτρολογικό',url:electricalDrawingUrl},ground:{label:'Ισόγειο',url:groundFloorDrawingUrl},section:{label:'Τομή ορόφων',url:buildingSectionDrawingUrl}};
    const active=drawings[this.drawingTab];
    this.mobilePlan.innerHTML=`<div class="drawing-header"><strong>ΣΧΕΔΙΑ ΕΡΓΟΤΑΞΙΟΥ</strong><div class="drawing-header-actions"><button type="button" data-drawing-zoom aria-label="Εναλλαγή μεγέθυνσης σχεδίου">${this.drawingFit?'ΜΕΓΕΘΥΝΣΗ':'ΣΥΝΟΛΟ'}</button><button type="button" data-drawing-close aria-label="Κλείσιμο σχεδίων">ΚΛΕΙΣΕ ×</button></div></div><div class="drawing-tabs" role="tablist" aria-label="Επιλογή σχεδίου">${Object.entries(drawings).map(([key,drawing])=>`<button type="button" role="tab" data-drawing-tab="${key}" aria-selected="${key===this.drawingTab}">${drawing.label}</button>`).join('')}</div><div class="drawing-scroll"><img src="${active.url}" alt="${active.label} κατοικίας Site Pro 04" draggable="false"/></div><div class="drawing-live"><b>Ζωντανή εργασία:</b> ${points.map(point=>`${point.definition.id}: ${point.definition.kind==='switch'?'διακόπτης':'πρίζα'} ${Math.round(point.definition.bottom*100)} cm`).join(' · ')}<br>Κοπές PVC: πρίζα ${this.pipeBatch.telemetry.finishedSocket}/20 · switch ${this.pipeBatch.telemetry.finishedSwitch}/20${this.job?` · εντολή ${this.job.modules.map(m=>m.kind).join('+')}`:''}</div>`;
  }
}
