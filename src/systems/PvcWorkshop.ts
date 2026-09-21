import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { RigTool } from '../player/FPSRig';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import { buildToolModel } from '../player/ToolModels';
import { workerHand,workerArm,poseWorkerArm,workerGripTarget,hideLegacyWorkerArm,type WorkerArm,type WorkerGripTarget } from '../player/WorkerArm';
import { PvcBend,PVC,type PipeRecipe } from './PvcBend';
import { PvcStock,PvcTube,part,pvcMaterial } from './PvcModels';
import { springLeadPoint } from './PvcLead';
import {DEFAULT_PVC_PRESETS,PVC_PRESET_KEY,readPvcPresets,type PvcPreset} from './PvcPresets';
import {buildHeldRebar,buildPvcDrill12,buildRebarHug,buildRebarPliers} from './PvcSecuringModels';
import '../ui/PvcWorkshop.css';

type Phase='sealed'|'opening'|'loose'|'spreading'|'marking'|'spring'|'inserting'|'bending'|'review'|'extracting'|'batch'|'carrying'|'fitting'|'cutting'|'cut'|'pipe-install-ready'|'installing'|'fastener-marking'|'fastener-drilling'|'fastener-insert-ready'|'fastener-inserting'|'fastener-tighten-ready'|'fastener-tightening';
interface StockPipe{recipe:PipeRecipe;mesh:PvcTube;cutFrom:number}
interface FastenerHole{side:-1|1;y:number;marker:THREE.Group;drilled:boolean;paired:boolean}
interface FastenerPair{left:FastenerHole;right:FastenerHole;rebar:THREE.Mesh}
const v=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const BOX_ENTRY_ALLOWANCE_MM=30;
const SHORT_PIPE_TOLERANCE_MM=3;
const workPhases:Phase[]=['opening','spreading','marking','spring','inserting','bending','review','extracting','fitting','cutting','cut','pipe-install-ready','installing','fastener-marking','fastener-drilling','fastener-insert-ready','fastener-inserting','fastener-tighten-ready','fastener-tightening'];
const animated:Phase[]=['opening','spreading','inserting','extracting','cutting','installing','fastener-drilling','fastener-inserting','fastener-tightening'];
export class PvcWorkshop {
  readonly stock=new PvcStock();
  readonly work=new THREE.Group();
  readonly pipe=new PvcTube(pvcMaterial.clone());
  readonly preparedRoot=new THREE.Group();
  private readonly targetGuideBounds=new THREE.Box3();
  private readonly targetGuide=new THREE.Box3Helper(this.targetGuideBounds,0xffa52f);
  private guideTarget:InstallationPoint|null=null;
  readonly prepared:StockPipe[]=[];
  readonly cutter=buildToolModel('cutter');
  readonly marker=new THREE.Group();
  readonly spring=new THREE.InstancedMesh(new THREE.TorusGeometry(.0069,.0011,4,10),new THREE.MeshStandardMaterial({color:0x929ea4,metalness:.8,roughness:.25}),135);
  readonly cable:THREE.Mesh;
  readonly arms:WorkerArm[]=[];
  readonly controls:HTMLElement;
  readonly markConfirm:HTMLButtonElement;
  readonly zoomControl:HTMLButtonElement;
  readonly drillControl:HTMLButtonElement;
  readonly securingRoot=new THREE.Group();
  readonly securingCursor=new THREE.Group();
  readonly drill=buildPvcDrill12();
  readonly heldRebar=buildHeldRebar();
  readonly rebarPliers=buildRebarPliers();
  customPresets:PvcPreset[]=[];
  transparent=false;
  readonly prompt:HTMLButtonElement;
  readonly liveMeasure:HTMLOutputElement;
  bend=new PvcBend();
  phase:Phase='sealed';
  focused=false;
  rawCount:number=PVC.count;
  installedCount=0;
  quantity=1;
  markingProgress=0;
  insertion=0;
  cutFrom=0;
  cutS=0;
  cutErrorMm=0;
  private target:InstallationPoint|null=null;
  private carried:StockPipe|null=null;
  private elapsed=0;
  private feedTime=0;
  private pressHeld=false;
  private toolbarHold=false;
  private canvasHold=false;
  private markingActive=false;
  private fitZoomed=false;
  private fastenerAim={x:-.72,y:.72};
  private fastenerHoles:FastenerHole[]=[];
  private fastenerPairs:FastenerPair[]=[];
  private fastenerIndex=0;
  private fastenerProgress=0;
  private shapeKey='';
  private message='';
  private readonly cameraDestination=v();
  private readonly cameraFocus=v();
  private readonly targetRotation=new THREE.Quaternion();
  private readonly turnDummy=new THREE.Object3D();
  private readonly ray=new THREE.Raycaster();
  private readonly previewRoot=new THREE.Group();
  private readonly cutRing:THREE.Mesh;
  private readonly markRing:THREE.Mesh;
  private cableKey='';
  private readonly offcuts:THREE.Mesh[]=[];
  private readonly queue:Array<()=>void>=[];

  private get touch():boolean{return matchMedia('(pointer:coarse)').matches;}
  private instruction(desktop:string,touch:string):string{return this.touch?touch:desktop;}

  constructor(private readonly game:Game){
    game.renderer.scene.add(this.stock,this.preparedRoot,this.previewRoot,this.targetGuide,this.securingRoot);
    this.targetGuide.name='PVC eligible box guide';this.targetGuide.visible=false;this.targetGuide.renderOrder=30;this.targetGuide.raycast=()=>{};
    const guideMaterial=this.targetGuide.material as THREE.LineBasicMaterial;guideMaterial.depthTest=false;guideMaterial.transparent=true;guideMaterial.opacity=.95;
    game.room.traverse(o=>{if(o.userData.studioEntityId==='world:site-spare-pvc')o.visible=false;});
    this.work.name='PVC physical working piece';this.work.userData.studioEntityId='pvc:held-work';
    game.renderer.scene.add(this.work);this.work.add(this.pipe,this.spring,this.cutter,this.marker,this.drill,this.heldRebar,this.rebarPliers);
    this.securingRoot.name='PVC drilled rebar fasteners';this.securingCursor.name='Fastener hole aiming cursor';this.securingRoot.add(this.securingCursor);
    for(const side of [-1,1]){const ring=new THREE.Mesh(new THREE.TorusGeometry(.011,.0018,5,24),new THREE.MeshBasicMaterial({color:0xff453a,depthTest:false}));ring.name='Valid 12 mm hole cursor';ring.rotation.y=Math.PI/2;ring.position.x=side*.002;ring.renderOrder=40;this.securingCursor.add(ring);}
    this.spring.name='135 galvanized spring turns · 400 mm';this.spring.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cable=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([v(),v(-.12,-.12),v(-.3,-.22),v(-.45,-.24)]),32,.003,6,false),new THREE.MeshStandardMaterial({color:0x252c30,roughness:.66}));
    this.cable.name='Spring retrieval cable · 2 m · 6 mm';this.work.add(this.cable);
    const body=part(this.marker,new THREE.CylinderGeometry(.007,.008,.125,12),new THREE.MeshStandardMaterial({color:0x242a2c,roughness:.5}),'Black permanent marker',[0,.062,0]);
    body.rotation.z=0;part(this.marker,new THREE.ConeGeometry(.0035,.014,8),new THREE.MeshStandardMaterial({color:0x101212}),'Marker felt tip',[0,-.007,0]);
    this.cutRing=new THREE.Mesh(new THREE.TorusGeometry(.011,.0008,4,24),new THREE.MeshBasicMaterial({color:0xeaa34c}));this.previewRoot.add(this.cutRing);
    this.markRing=new THREE.Mesh(new THREE.TorusGeometry(.0103,.0015,4,24),new THREE.MeshBasicMaterial({color:0x13171a}));this.markRing.name='Actual black marker at spring centre';this.work.add(this.markRing);
    for(const side of [-1,1]){const hand=workerHand(side,'spring'),arm=workerArm(side,hand,v());this.arms.push(arm);game.renderer.scene.add(arm.group,hand);}
    this.controls=document.createElement('div');this.controls.id='pvc-touch-controls';this.controls.hidden=true;
    this.controls.innerHTML='<button data-pvc="back" aria-label="Προηγούμενη θέση χεριών">← ΧΕΡΙΑ</button><button data-pvc="forward" aria-label="Επόμενη θέση χεριών">ΧΕΡΙΑ →</button><button id="pvc-use">ΚΡΑΤΑ</button><button data-pvc="confirm">ΕΛΕΓΧΟΣ</button><button data-pvc="undo">ΑΝΑΙΡΕΣΗ</button><button data-pvc="save">PRESET</button><button data-pvc="transparent">ΔΙΑΦΑΝΕΙΑ</button><button data-pvc="qty-1" aria-label="Ετοίμασε μία σωλήνα">1</button><button data-pvc="qty-5" aria-label="Ετοίμασε πέντε σωλήνες">5</button><button data-pvc="qty-all" aria-label="Ετοίμασε όλες τις σωλήνες">ΟΛΕΣ</button><button data-pvc="pause">ΠΙΣΩ</button>';
    this.prompt=document.createElement('button');this.prompt.id='pvc-prompt';this.prompt.hidden=true;
    this.liveMeasure=document.createElement('output');this.liveMeasure.id='pvc-live-measure';this.liveMeasure.hidden=true;this.liveMeasure.setAttribute('aria-label','Ζωντανή μέτρηση σωλήνας');
    this.markConfirm=document.createElement('button');this.markConfirm.id='pvc-mark-confirm';this.markConfirm.setAttribute('aria-label','Σημάδεψε τις σωλήνες με τον μαρκαδόρο');this.markConfirm.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m8 24 3-8L23 4l5 5-12 12-8 3zM19 8l5 5M8 24l6-2-4-4-2 6z"/></svg>';this.markConfirm.hidden=true;
    this.zoomControl=document.createElement('button');this.zoomControl.id='pvc-fit-zoom';this.zoomControl.setAttribute('aria-label','Μεγέθυνση κάμερας κοπής');this.zoomControl.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="14" cy="14" r="8"/><path d="m20 20 8 8M10 14h8"/><path class="zoom-plus" d="M14 10v8"/></svg>';this.zoomControl.hidden=true;
    this.drillControl=document.createElement('button');this.drillControl.id='pvc-drill-holes';this.drillControl.setAttribute('aria-label','Τρύπησε διαδοχικά τις σημειωμένες οπές με τρυπάνι 12 χιλιοστών');this.drillControl.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 7h15v10H3zM18 10h7M25 9v4M6 17v10h9v-4l-3-6M5 27"/><path d="M25 11h5"/></svg>';this.drillControl.hidden=true;
    game.hud.shell.append(this.prompt,this.liveMeasure,this.markConfirm,this.zoomControl,this.drillControl,this.controls);
    try{this.customPresets=readPvcPresets(localStorage);}catch{/* Storage can be unavailable in private/embedded contexts. */}
    this.stock.setPresets(this.presets);
    this.prompt.addEventListener('click',()=>this.queue.push(()=>this.interact()));
    this.markConfirm.addEventListener('click',()=>this.queue.push(()=>this.interact()));
    this.zoomControl.addEventListener('click',()=>this.queue.push(()=>{if(!this.target||!['fitting','cut'].includes(this.phase))return;this.fitZoomed=!this.fitZoomed;this.setFitCamera();}));
    this.drillControl.addEventListener('click',()=>this.queue.push(()=>this.startFastenerDrilling()));
    this.controls.querySelectorAll<HTMLButtonElement>('[data-pvc]').forEach(button=>{
      let touchHandled=false;
      button.addEventListener('pointerdown',e=>{touchHandled=e.pointerType!=='mouse';});
      button.addEventListener('pointerup',e=>{if(e.pointerType==='mouse')return;e.preventDefault();this.queue.push(()=>this.command(button.dataset.pvc!));});
      button.addEventListener('click',()=>{if(!touchHandled)this.queue.push(()=>this.command(button.dataset.pvc!));});
    });
    const use=this.controls.querySelector<HTMLButtonElement>('#pvc-use')!;
    use.addEventListener('pointerdown',e=>{e.preventDefault();use.setPointerCapture(e.pointerId);this.toolbarHold=true;this.queue.push(()=>this.use());});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])use.addEventListener(event,()=>this.toolbarHold=false);
    game.hud.shell.addEventListener('wheel',e=>{
      if(!this.focused)return;e.preventDefault();e.stopImmediatePropagation();
      if(this.phase==='review')this.queue.push(()=>this.changeQuantity(e.deltaY<0?1:-1));
    },{capture:true,passive:false});
    let touchY:number|null=null;
    game.renderer.webgl.domElement.addEventListener('pointerdown',e=>{
      if(e.pointerType==='mouse'&&e.button===0&&this.focused)this.canvasHold=true;
      if(e.pointerType==='touch'&&this.focused){e.stopPropagation();touchY=e.clientY;(e.target as Element).setPointerCapture(e.pointerId);}
    });
    game.renderer.webgl.domElement.addEventListener('pointermove',e=>{if(e.pointerType!=='touch'||touchY===null)return;e.stopPropagation();game.player.lookHandler?.(0,e.clientY-touchY);touchY=e.clientY;});
    for(const event of ['pointerup','pointercancel'])addEventListener(event,e=>{if((e as PointerEvent).pointerType==='mouse')this.canvasHold=false;touchY=null;});
    addEventListener('blur',()=>this.pause());document.addEventListener('visibilitychange',()=>{if(document.hidden)this.pause();});
    addEventListener('keydown',e=>{
      if(e.target instanceof Element&&e.target.closest('input,textarea,select,[contenteditable="true"]')||!this.game.started)return;
      if(e.code==='KeyR'&&(this.blocksWork||['spring','cutter'].includes(this.game.selectedTool)||this.aimsInstalledPipe())){
        e.preventDefault();if(!e.repeat)this.queue.push(()=>this.toggleTransparent());return;
      }
      if(!this.focused)return;
      if(e.code==='Escape'){this.queue.push(()=>this.pause());return;}
      if(e.repeat)return;
      if(e.code==='KeyZ')this.queue.push(()=>this.command('undo'));
      if(e.code==='KeyP'){e.preventDefault();this.queue.push(()=>this.savePreset(e.shiftKey));}
      if(e.code==='Tab'&&this.phase==='marking'){e.preventDefault();this.queue.push(()=>{const next=this.presets.find(p=>p.cm>this.bend.mark*100+.05)??this.presets[0];this.setMark(next.cm/100);});}
      if(this.phase==='review'&&['Equal','NumpadAdd','Minus','NumpadSubtract'].includes(e.code)){e.preventDefault();this.queue.push(()=>this.changeQuantity(['Equal','NumpadAdd'].includes(e.code)?1:-1));}
    },{capture:true});
    game.hud.shell.addEventListener('contextmenu',()=>{if(this.focused)this.queue.push(()=>this.pause());});
    game.player.lookHandler=(dx,dy)=>{
      if(!this.focused)return false;
      if(this.phase==='marking')this.setMark(this.bend.mark+dy*.0015);
      if(this.phase==='fitting')this.setCut(this.cutS+dy*.0006);
      if(this.phase==='fastener-marking'){
        this.fastenerAim.x=THREE.MathUtils.clamp(this.fastenerAim.x+dx*.0045,-1,1);
        this.fastenerAim.y=THREE.MathUtils.clamp(this.fastenerAim.y-dy*.0045,0,1);
      }
      return true;
    };
    // Mouse adjustment while unlocked uses the same surface and never requests
    // OS pointer control in tests. Locked movement is routed by PlayerController.
    game.hud.shell.addEventListener('pointermove',e=>{
      if(!this.focused||document.pointerLockElement||e.pointerType!=='mouse'||(e.target as Element).closest('button,input,select'))return;
      game.player.lookHandler?.(e.movementX,e.movementY);
    });
  }
  get blocksWork():boolean{return this.focused||this.phase==='carrying';}
  get presets():PvcPreset[]{return [...DEFAULT_PVC_PRESETS,...this.customPresets].sort((a,b)=>a.cm-b.cm);}
  private changeQuantity(delta:number):void{this.quantity=THREE.MathUtils.clamp(this.quantity+delta,1,this.rawCount);}
  private savePreset(remove=false):void{
    if(this.phase!=='marking')return;
    const cm=Math.round(this.bend.mark*1000)/10,index=this.customPresets.findIndex(p=>Math.abs(p.cm-cm)<.05);
    if(remove){if(index<0)return;this.customPresets.splice(index,1);}
    else{if(this.presets.some(p=>Math.abs(p.cm-cm)<.05)){this.message='Το preset υπάρχει ήδη.';return;}if(this.customPresets.length===20){this.message=this.instruction('Έως 20 δικά σου presets. Shift+P διαγράφει αυτό στη γωνία.','Έως 20 δικά σου presets.');return;}this.customPresets.push({cm,name:'ΔΙΚΟ ΜΟΥ'});}
    this.stock.setPresets(this.presets);
    try{localStorage.setItem(PVC_PRESET_KEY,JSON.stringify(this.customPresets));this.message=remove?'Το δικό σου preset διαγράφηκε.':this.instruction(`Αποθηκεύτηκε preset ${cm} cm · Shift+P για διαγραφή.`,`Αποθηκεύτηκε preset ${cm} cm.`);}
    catch{this.message='Το preset ισχύει προσωρινά· ο browser δεν επέτρεψε αποθήκευση.';}
  }
  private aimsInstalledPipe():boolean{
    const c=this.game.renderer.camera;c.updateMatrixWorld(true);this.ray.setFromCamera(new THREE.Vector2(),c);
    return this.ray.intersectObjects(this.game.mission.points.flatMap(p=>p.conduit?[p.conduit]:[]),true).some(h=>h.distance<2.5);
  }
  private toggleTransparent():void{
    this.transparent=!this.transparent;
    for(const material of [pvcMaterial,this.pipe.material]){material.transparent=this.transparent;material.opacity=this.transparent?.40:1;material.depthWrite=!this.transparent;material.needsUpdate=true;}
  }
  allowTool(tool:RigTool):boolean{
    if(!this.blocksWork)return true;
    if(this.phase==='carrying'&&tool==='cutter'){this.interact();return false;}
    this.message=this.instruction('Άφησε τη σωλήνα στη μάτσα ή πάτησε ESC για παύση.','Άφησε τη σωλήνα στη μάτσα ή πάτησε ΠΙΣΩ για παύση.');return false;
  }
  private transition(phase:Phase):void{this.phase=phase;this.elapsed=0;this.message='';this.shapeKey='';if(phase!=='marking')this.markingActive=false;}
  private setFocus(preserveInput=false):void{
    this.focused=true;this.game.mixing.setActive(false);this.game.mixing.releaseAutomaticStance();if(!preserveInput)this.game.input.resetTransientInput();
    const c=this.game.renderer.camera;
    if(this.target){
      if(this.phase.startsWith('fastener-'))this.setFastenerCamera();else this.setFitCamera();
    }else if(['marking','spreading'].includes(this.phase)){
      this.cameraDestination.set(2.20,.95,this.bend.mark-.35+.31);this.cameraFocus.set(2.20,.025,this.bend.mark-.35+(innerWidth<700?.20:0));
    }else{
      this.cameraDestination.copy(c.position);this.cameraDestination.y=1.65;
      this.cameraFocus.copy(this.cameraDestination).add(v(0,0,-2).applyAxisAngle(v(0,1,0),this.game.player.yaw));this.cameraFocus.y=.75;
    }
    const camera=new THREE.PerspectiveCamera();camera.position.copy(this.cameraDestination);camera.lookAt(this.cameraFocus);this.targetRotation.copy(camera.quaternion);
  }
  private setFitCamera():void{
    if(!this.target)return;const p=this.target.boxGroup.getWorldPosition(v());
    // Both zoom levels remain perfectly square and level to the wall.
    this.cameraDestination.set(p.x,p.y,p.z+(this.fitZoomed?.50:.68));this.cameraFocus.set(p.x,p.y,p.z+.02);
    const camera=new THREE.PerspectiveCamera();camera.position.copy(this.cameraDestination);camera.lookAt(this.cameraFocus);this.targetRotation.copy(camera.quaternion);
  }
  private setFastenerCamera():void{
    if(!this.target)return;const p=this.target.boxGroup.getWorldPosition(v()),bottom=p.y-this.target.boxGroup.groupHeight/2;
    const y=Math.max(.34,(bottom+.08)/2);this.cameraDestination.set(p.x,y,p.z+.72);this.cameraFocus.set(p.x,y,p.z+.015);
    const camera=new THREE.PerspectiveCamera();camera.position.copy(this.cameraDestination);camera.lookAt(this.cameraFocus);this.targetRotation.copy(camera.quaternion);
  }
  pause():void{
    if(!this.focused)return;this.focused=false;this.pressHeld=this.toolbarHold=this.canvasHold=false;this.game.input.resetTransientInput();
    if(this.target&&['fitting','cut'].includes(this.phase)){this.target=null;this.transition('carrying');}
    this.message=this.instruction('Η εργασία κρατήθηκε. Στόχευσε τη μάτσα ή το κουτί και πάτησε E για συνέχεια.','Η εργασία κρατήθηκε. Στόχευσε τη μάτσα ή το κουτί και άγγιξε την οδηγία για συνέχεια.');
  }
  private stockAimed():boolean{
    const c=this.game.renderer.camera;c.updateMatrixWorld(true);this.stock.updateMatrixWorld(true);this.preparedRoot.updateMatrixWorld(true);
    this.ray.setFromCamera(new THREE.Vector2(),c);
    const hits=this.ray.intersectObjects([...this.stock.pipes.filter(p=>p.visible),...this.preparedRoot.children],true);
    const hit=hits.find(h=>h.distance<3&&h.object.visible);
    if(!hit)return false;
    const wall=this.game.room.brickWall.aim(c);
    return !wall||c.position.distanceTo(v(wall.point.x,wall.point.y,wall.point.z))>=hit.distance-.01;
  }
  handleInput(dt:number,action:boolean,interaction:boolean):boolean{
    if(!this.game.started)return false;
    for(const command of this.queue.splice(0))command();
    const wasBlocking=this.blocksWork;
    if(interaction&&(wasBlocking||this.stockAimed()||this.target&&this.game.boxPlacement.target(this.game.renderer.camera)===this.target)){this.interact();action=false;interaction=false;}
    // Mobile has one consistent primary control: the ordinary USE joystick.
    // It advances every PVC work phase and also performs the contextual stock /
    // box action while carrying, instead of replacing the joysticks with a row
    // of text-labelled buttons.
    if(action){
      const contextual=!this.focused&&(this.stockAimed()||this.phase==='carrying'&&Boolean(this.game.boxPlacement.targetNear(this.game.renderer.camera)));
      if(this.focused&&!(this.touch&&this.phase==='marking'))this.use();
      else if(contextual)this.interact();
    }
    // Desktop E intentionally sets actionHeld, so desktop work still follows
    // the captured mouse surfaces. On touch, actionHeld belongs to the visible
    // USE joystick and is the canonical spring / bend hold.
    this.pressHeld=this.focused&&(this.toolbarHold||this.canvasHold||this.touch&&this.game.input.actionHeld);
    if(this.focused){
      const c=this.game.renderer.camera,t=1-Math.exp(-8*dt);c.position.lerp(this.cameraDestination,t);c.quaternion.slerp(this.targetRotation,t);
      this.game.player.yaw=c.rotation.y;this.game.player.pitch=c.rotation.x;this.game.player.velocity.set(0,0,0);
      const direction=Number(this.game.input.pressed('KeyD'))-Number(this.game.input.pressed('KeyA'));
      this.feedTime-=dt;
      if(this.phase==='bending'&&direction&&this.feedTime<=0){this.bend.move(direction);this.feedTime=.16;}
      if(!direction)this.feedTime=0;
      if(this.phase==='bending'&&this.pressHeld)this.bend.press(dt);
      if(this.phase==='marking'&&this.markingActive){
        this.markingProgress=Math.min(1,this.markingProgress+dt/.85);
        if(this.markingProgress===1){this.transition('spring');this.setFocus(true);this.message=this.instruction('Οι σωλήνες σημαδεύτηκαν. Βάλε τώρα το spring με LMB.','Οι σωλήνες σημαδεύτηκαν. Κράτα το SPRING για εισαγωγή.');}
      }
      if(this.phase==='spring'&&this.pressHeld)this.transition('inserting');
      if(animated.includes(this.phase))this.animate(dt);
    }
    return wasBlocking||this.blocksWork;
  }
  private command(command:string):void{
    if(command==='save'){this.savePreset();return;}
    if(command==='transparent'){this.toggleTransparent();return;}
    if(this.phase==='review'&&command.startsWith('qty-')){this.quantity=command==='qty-all'?this.rawCount:Math.min(this.rawCount,Number(command.slice(4)));return;}
    if(command==='pause'){this.pause();return;}
    if(command==='confirm'){this.interact();return;}
    if(command==='socket')this.setMark(.5);
    if(command==='switch')this.setMark(1.4);
    if(this.phase==='bending'){
      if(command==='back')this.bend.move(-1);if(command==='forward')this.bend.move(1);if(command==='undo')this.bend.undo();
    }
  }
  private setMark(value:number):void{
    if(this.phase!=='marking'||this.markingProgress>0)return;
    if(!Number.isFinite(value))return;
    this.bend=new PvcBend(Math.round(THREE.MathUtils.clamp(value,.25,2.6)*1000)/1000);
    this.cameraDestination.z=this.bend.mark-.35+.31;this.cameraFocus.z=this.bend.mark-.35;
  }
  private setCut(value:number):void{
    if(this.phase!=='fitting'||!Number.isFinite(value))return;
    this.cutS=THREE.MathUtils.clamp(value,this.cutFrom,Math.max(this.cutFrom,this.bend.mark-.22));
  }
  private use():void{
    if(!this.focused)return;
    if(this.phase==='fastener-marking'){this.markFastenerHole();return;}
    if(this.phase==='fastener-insert-ready'){this.fastenerIndex=0;this.fastenerProgress=0;this.transition('fastener-inserting');return;}
    if(this.phase==='pipe-install-ready'){if(!this.installClear()){this.message='Η σωλήνα δεν περνά ελεύθερα στο κανάλι. Διόρθωσε πρώτα το άνοιγμα.';return;}this.transition('installing');return;}
    if(this.phase==='fastener-tighten-ready'){this.fastenerIndex=0;this.fastenerProgress=0;this.transition('fastener-tightening');return;}
    if(this.touch&&['review','cut'].includes(this.phase)){this.interact();return;}
    if(this.phase==='spring')this.transition('inserting');
    if(this.touch&&this.phase==='bending'&&this.bend.ready){this.transition('review');return;}
    if(this.phase==='fitting'){
      if(this.cutS<=this.cutFrom+.001){this.message='Μετακίνησε το cutter στο σημείο που θέλεις να κόψεις.';return;}
      this.transition('cutting');this.game.audio.play('cutter');
    }
  }
  private interact():void{
    if(!this.game.started)return;
    if(!this.blocksWork&&workPhases.includes(this.phase)){
      if(!this.stockAimed()&&!(this.target&&this.game.boxPlacement.target(this.game.renderer.camera)===this.target))return;
      this.setFocus();return;
    }
    if(this.phase==='fastener-marking'){this.markFastenerHole();return;}
    if(this.phase==='fastener-insert-ready'||this.phase==='pipe-install-ready'||this.phase==='fastener-tighten-ready'){this.use();return;}
    if(this.phase==='sealed'&&this.stockAimed()){this.transition('opening');this.setFocus();return;}
    if(this.phase==='loose'&&this.stockAimed()){this.transition('spreading');this.setFocus();return;}
    if(this.phase==='marking'){
      if(this.markingActive)return;
      this.markingActive=true;this.message='Μαρκάρισμα όλων των σωλήνων…';return;
    }
    if(this.phase==='spring'){this.message=this.instruction('Κράτα αριστερό mouse για να βάλεις το spring μέσα στη σωλήνα.','Κράτα το SPRING για να το βάλεις μέσα στη σωλήνα.');return;}
    if(this.phase==='bending'){
      if(!this.bend.ready){this.message=this.instruction('Χρειάζεται ομαλή γωνία 90°. Προχώρα με D και λύγισε λίγο σε κάθε θέση.','Χρειάζεται ομαλή γωνία 90°. Μετακίνησε τα ΧΕΡΙΑ → και λύγισε λίγο σε κάθε θέση.');return;}
      this.transition('review');return;
    }
    if(this.phase==='review'){this.transition('extracting');return;}
    if(this.phase==='batch'&&this.stockAimed()){
      if(this.prepared.length){this.carried=this.prepared.shift()!;this.carried.mesh.removeFromParent();this.bend=PvcBend.from(this.carried.recipe);this.cutFrom=this.carried.cutFrom;this.transition('carrying');return;}
      if(this.rawCount){this.bend=new PvcBend();this.markingProgress=0;this.transition('marking');this.setFocus();}return;
    }
    if(this.phase==='carrying'){
      if(this.stockAimed()){if(this.carried){this.prepared.unshift(this.carried);this.preparedRoot.add(this.carried.mesh);this.carried=null;this.arrangePrepared();}this.transition('batch');return;}
      const p=this.game.boxPlacement.targetNear(this.game.renderer.camera);
      if(!p){this.message=this.instruction('Στόχευσε το κουτί όπου θα εφαρμόσεις τη σωλήνα.','Βρες το κουτί με το πορτοκαλί περίγραμμα και φέρε το στο κέντρο.');return;}
      if(p.conduit||p.stage==='complete'){this.message='Αυτό το κουτί έχει ήδη σωλήνα.';return;}
      if(!['leveled','conduit'].includes(p.stage)||!this.game.mortar.ready(p)||p.boxGroup.userData.placement&&!p.boxGroup.userData.placement.secured){this.message='Στερέωσε και αλφάδιασε το κουτί πριν εφαρμόσεις PVC.';return;}
      const pos=p.boxGroup.getWorldPosition(v());
      if(pos.distanceTo(this.game.renderer.camera.position)>1.6){this.message='Πλησίασε το κουτί για εργασία με τα χέρια.';return;}
      if(this.bend.topHeight-this.cutFrom<pos.y-p.boxGroup.groupHeight/2+.01){this.message='Η μικρή πλευρά δεν φτάνει στην είσοδο. Επίστρεψέ τη και ετοίμασε ψηλότερο σημάδι.';return;}
      this.target=p;
      // Begin at the measured box-entry cut. The player may still fine-adjust
      // it, but a direct CUT now produces a pipe that can actually be seated.
      const boxBottom=pos.y-p.boxGroup.groupHeight/2;
      this.cutS=THREE.MathUtils.clamp(this.bend.topHeight-(boxBottom+.015),this.cutFrom,Math.max(this.cutFrom,this.bend.mark-.22));
      this.fitZoomed=false;this.transition('fitting');this.setFocus();return;
    }
    if(this.phase==='fitting'){this.message=this.instruction('Mouse πάνω/κάτω για μήκος, αριστερό click για πραγματική κοπή.','Σύρε πάνω/κάτω για μήκος και κράτα ΚΟΨΕ για πραγματική κοπή.');return;}
    if(this.phase==='cut'){
      const error=this.fitError();
      // A conduit does not need a laboratory-perfect flush cut: up to 30 mm
      // of extra length seats safely inside the 37 mm deep box entry. Only a
      // genuinely excessive or short cut must be corrected/replaced.
      if(error>BOX_ENTRY_ALLOWANCE_MM){this.transition('fitting');this.message=`Περισσεύουν ${Math.round(error)} mm. Κόψε λίγο ακόμη· έως ${BOX_ENTRY_ALLOWANCE_MM} mm μπαίνουν μέσα στο κουτί.`;return;}
      if(error< -SHORT_PIPE_TOLERANCE_MM){this.message=this.instruction('Κόπηκε κοντή και δεν φτάνει στο κουτί. ESC, μετά επιστροφή στη μάτσα με E.','Κόπηκε κοντή και δεν φτάνει στο κουτί. ΠΙΣΩ, μετά στόχευσε τη μάτσα για επιστροφή.');return;}
      if(!this.installClear()){this.message=this.instruction('Η σωλήνα ακουμπά τούβλο ή δεν κάθεται στο δάπεδο. ESC για διόρθωση του καναλιού.','Η σωλήνα ακουμπά τούβλο ή δεν κάθεται στο δάπεδο. ΠΙΣΩ για διόρθωση του καναλιού.');return;}
      // Prepare the wall first. The cut conduit stays in the player's stock
      // until the holes are drilled and open rebar straps are anchored.
      this.fastenerHoles=[];this.fastenerPairs=[];this.fastenerIndex=0;this.fastenerProgress=0;this.fastenerAim={x:-.72,y:.72};
      this.transition('fastener-marking');this.setFastenerCamera();return;
    }
  }
  private animate(dt:number):void{
    this.elapsed+=dt;
    if(this.phase==='opening'){
      this.stock.straps.forEach((s,i)=>s.visible=this.elapsed<(i+1)*.65);
      if(this.elapsed>1.95){this.transition('loose');this.focused=false;this.game.audio.play('cutter');}
    }else if(this.phase==='spreading'){
      this.stock.layout(THREE.MathUtils.smoothstep(this.elapsed,0,1.6));
      if(this.elapsed>=1.6){this.stock.layout(1);this.transition('marking');this.setFocus();}
    }else if(this.phase==='inserting'){
      this.insertion=Math.min(1,this.elapsed/1.6);
      if(this.insertion===1){this.transition('bending');this.game.audio.play('spring');}
    }else if(this.phase==='extracting'){
      this.insertion=1-Math.min(1,this.elapsed/1.5);
      if(this.insertion===0){
        const count=Math.min(this.rawCount,Math.max(1,this.quantity));
        for(let i=0;i<count;i++){const mesh=new PvcTube();mesh.update(this.bend);this.prepared.push({recipe:this.bend.recipe(),mesh,cutFrom:0});this.preparedRoot.add(mesh);}
        this.rawCount-=count;this.stock.pipes.forEach((p,i)=>p.visible=i<this.rawCount);
        // Production completes in the player's hand. One bent pipe continues
        // directly to installation; only the remainder is laid on the stack.
        this.carried=this.prepared.shift()??null;
        if(this.carried){this.carried.mesh.removeFromParent();this.bend=PvcBend.from(this.carried.recipe);this.cutFrom=this.carried.cutFrom;}
        this.arrangePrepared();this.focused=false;this.transition(this.carried?'carrying':'batch');
      }
    }else if(this.phase==='cutting'&&this.elapsed>=.45){
      const offcut=new PvcTube();offcut.update(this.bend,this.cutFrom,this.cutS);const p=this.target!.boxGroup.getWorldPosition(v());
      offcut.position.set(p.x+.16+this.offcuts.length*.025,.015,p.z+.27);offcut.rotation.y=.3;this.game.renderer.scene.add(offcut);this.offcuts.push(offcut);
      this.cutFrom=this.cutS;this.cutErrorMm=this.fitError();this.transition('cut');
      if(this.carried){this.carried.cutFrom=this.cutFrom;this.carried.mesh.update(this.bend,this.cutFrom);}
    }else if(this.phase==='installing'&&this.elapsed>=.6){
      if(!this.installClear()){this.transition('cut');this.message='Η θέση άλλαξε. Έλεγξε ξανά τη στήριξη και το κανάλι.';return;}
      const installed=new THREE.Group(),mesh=new PvcTube();mesh.update(this.bend,this.cutFrom);installed.add(mesh);this.orientAtBox(installed,0);
      installed.name=`Hand-formed PVC · ${this.target!.definition.id}`;installed.userData.studioEntityId=`point-${this.target!.definition.id}:rigid-pvc`;installed.userData.pvcRecipe={...this.bend.recipe(),cutFrom:this.cutFrom};
      this.game.renderer.scene.add(installed);this.target!.conduit=installed;this.target!.pipeStep='install';this.target!.setStage('conduit');
      this.transition('fastener-tighten-ready');this.setFastenerCamera();this.message='Η σωλήνα μπήκε μέσα στα ανοικτά rebar. USE: σφίξε τα ένα-ένα.';this.game.audio.play('box');
    }else if(this.phase==='fastener-drilling'){
      const duration=.85,completed=Math.min(this.fastenerHoles.length,Math.floor(this.elapsed/duration)),index=Math.min(this.fastenerHoles.length-1,completed);this.fastenerIndex=index;this.fastenerProgress=THREE.MathUtils.clamp((this.elapsed-completed*duration)/duration,0,1);
      this.drill.getObjectByName('reference-motor')!.rotation.z=this.elapsed*26;
      for(let drilled=0;drilled<completed;drilled++)if(!this.fastenerHoles[drilled].drilled){
        const hole=this.fastenerHoles[drilled];hole.drilled=true;const point=hole.marker.position,depthEnd=point.z-.045;
        this.game.room.brickWall.volume.carveBox({x:point.x-.006,y:point.y-.006,z:depthEnd},{x:point.x+.006,y:point.y+.006,z:point.z});
        const centre=hole.marker.getObjectByName('Undrilled red hole mark') as THREE.Mesh;centre.material=new THREE.MeshStandardMaterial({color:0x171819,roughness:1});centre.name='Drilled 12 mm masonry hole';
      }
      if(this.elapsed>=this.fastenerHoles.length*duration){this.fastenerIndex=0;this.fastenerProgress=0;this.transition('fastener-insert-ready');this.message='Και οι οπές ανοίχτηκαν. USE: πέρασε τα rebar ένα-ένα.';}
    }else if(this.phase==='fastener-inserting'){
      const duration=1.05,index=Math.min(this.fastenerPairs.length-1,Math.floor(this.elapsed/duration));this.fastenerIndex=index;this.fastenerProgress=THREE.MathUtils.clamp((this.elapsed-index*duration)/duration,0,1);
      const pair=this.fastenerPairs[index];pair.rebar.visible=true;pair.rebar.scale.x=THREE.MathUtils.smoothstep(this.fastenerProgress,0,1);
      if(this.elapsed>=this.fastenerPairs.length*duration){this.fastenerPairs.forEach(p=>p.rebar.scale.x=1);this.fastenerIndex=0;this.fastenerProgress=0;this.transition('pipe-install-ready');this.message='Τα rebar μπήκαν στις οπές και μένουν ανοικτά. USE: εφάρμοσε τώρα τη σωλήνα.';}
    }else if(this.phase==='fastener-tightening'){
      const duration=1.15,index=Math.min(this.fastenerPairs.length-1,Math.floor(this.elapsed/duration));this.fastenerIndex=index;this.fastenerProgress=THREE.MathUtils.clamp((this.elapsed-index*duration)/duration,0,1);
      const jaw=this.rebarPliers.getObjectByName('rebar-plier-moving-jaw');if(jaw)jaw.rotation.z=-this.fastenerProgress*.30;
      const pair=this.fastenerPairs[index];pair.rebar.scale.z=1-THREE.MathUtils.smoothstep(this.fastenerProgress,0,1)*.90;
      if(this.elapsed>=this.fastenerPairs.length*duration)this.finishFasteners();
    }
  }
  private arrangePrepared():void{
    this.prepared.forEach((p,i)=>{p.mesh.position.set(2.65+i*.03,.026,-.35);p.mesh.rotation.set(Math.PI/2,0,Math.PI/2);});
  }
  private fitError():number{
    return this.fitErrorAt(this.cutFrom);
  }
  private fitErrorAt(cut:number):number{
    if(!this.target)return 0;const p=this.target.boxGroup.getWorldPosition(v());return(this.bend.topHeight-cut-(p.y-this.target.boxGroup.groupHeight/2+.015))*1000;
  }
  private fastenerArea():{centreX:number;innerX:number;outerX:number;minY:number;maxY:number;z:number}|null{
    if(!this.target)return null;const p=this.target.boxGroup.getWorldPosition(v()),bottom=p.y-this.target.boxGroup.groupHeight/2;
    // Free aiming is confined to the exposed brick inside the 200 mm chased
    // channel. The centre gap excludes the conduit; nothing can be marked on
    // the untouched wall outside the chase.
    return{centreX:p.x,innerX:.030,outerX:.086,minY:.09,maxY:Math.max(.13,bottom-.065),z:p.z-.030};
  }
  private fastenerCursorPoint():{side:-1|1;point:THREE.Vector3}|null{
    const area=this.fastenerArea();if(!area)return null;const side: -1|1=this.fastenerAim.x<0?-1:1;
    const rawY=THREE.MathUtils.lerp(area.minY,area.maxY,this.fastenerAim.y),pitch=this.game.room.brickWall.volume.height/23,row=Math.floor(rawY/pitch);
    // Preserve free aiming, nudging only marks that would land in a horizontal
    // mortar joint back onto the clay face of that same brick course.
    const y=THREE.MathUtils.clamp(row*pitch+THREE.MathUtils.clamp(rawY-row*pitch,.018,pitch-.018),area.minY,area.maxY);
    const distance=THREE.MathUtils.lerp(area.innerX,area.outerX,Math.abs(this.fastenerAim.x));
    return{side,point:v(area.centreX+side*distance,y,area.z)};
  }
  private markerAt(point:THREE.Vector3,side:-1|1):THREE.Group{
    const marker=new THREE.Group();marker.position.copy(point);marker.name=`Marked ${side<0?'left':'right'} 12 mm rebar hole`;
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.009,.0018,5,24),new THREE.MeshStandardMaterial({color:0xd3322d,roughness:.7,emissive:0x390000}));marker.add(ring);
    const centre=new THREE.Mesh(new THREE.CircleGeometry(.006,16),new THREE.MeshBasicMaterial({color:0x5c1714,side:THREE.DoubleSide}));centre.name='Undrilled red hole mark';marker.add(centre);this.securingRoot.add(marker);return marker;
  }
  private markFastenerHole():void{
    const cursor=this.fastenerCursorPoint();if(!cursor)return;
    const sameSide=this.fastenerHoles.filter(h=>h.side===cursor.side),otherSide=this.fastenerHoles.filter(h=>h.side!==cursor.side);
    if(sameSide.some(h=>h.marker.position.distanceTo(cursor.point)<.035)){this.message='Μετακίνησε το σημάδι σε άλλο σημείο του τούβλου.';return;}
    // Each strap still needs one endpoint on either side, but both coordinates
    // are now selected by the player instead of being snapped to fixed slots.
    if(sameSide.length>otherSide.length){this.message='Σημάδεψε τώρα την απέναντι πλευρά.';return;}
    const hole:FastenerHole={side:cursor.side,y:cursor.point.y,marker:this.markerAt(cursor.point,cursor.side),drilled:false,paired:false};this.fastenerHoles.push(hole);
    const mate=otherSide.find(h=>!h.paired);
    if(mate){hole.paired=mate.paired=true;const left=hole.side<0?hole:mate,right=hole.side>0?hole:mate,area=this.fastenerArea()!;const rebar=buildRebarHug(left.marker.position,right.marker.position,area.z+.085);rebar.visible=false;this.securingRoot.add(rebar);this.fastenerPairs.push({left,right,rebar});this.fastenerAim.y=THREE.MathUtils.clamp(this.fastenerAim.y-.34,0,1);}
    this.fastenerAim.x=cursor.side<0?.72:-.72;this.message=`${this.fastenerHoles.length} οπές σημειωμένες${this.fastenerPairs.length?' · πάτησε το εικονίδιο τρυπανιού όταν τελειώσεις':''}.`;
  }
  private startFastenerDrilling():void{
    if(this.phase!=='fastener-marking'||this.fastenerPairs.length<1||this.fastenerPairs.length*2!==this.fastenerHoles.length)return;
    this.fastenerIndex=0;this.fastenerProgress=0;this.transition('fastener-drilling');this.message='Τρύπημα 12 mm · μία οπή τη φορά.';
  }
  private finishFasteners():void{
    if(!this.target)return;this.target.pipeStep='done';this.target.setStage('complete');this.target.userData.pvcFasteners={holeCount:this.fastenerHoles.length,pairCount:this.fastenerPairs.length,drillBitMm:12,sequence:'marked-drilled-open-rebar-pipe-inserted-tightened'};
    this.installedCount++;this.carried?.mesh.geometry.dispose();this.carried=null;this.target=null;this.focused=false;this.transition('batch');this.game.audio.play('box');
  }
  private boxBottomHeight():number|null{
    if(!this.target)return null;const p=this.target.boxGroup.getWorldPosition(v());return Math.max(0,p.y-this.target.boxGroup.groupHeight/2);
  }
  private orientAtBox(object:THREE.Object3D,gap:number):void{
    const p=this.target!.boxGroup.getWorldPosition(v());
    // Material +X points down the wall; the bent +Y tail points into the room.
    object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(v(0,-1,0),v(0,0,1),v(-1,0,0)));
    object.position.set(p.x,this.bend.topHeight,p.z-.021+gap);
  }
  private installClear():boolean{
    if(!this.target||!this.game.mortar.ready(this.target)||!['leveled','conduit'].includes(this.target.stage))return false;
    const p=this.target.boxGroup.getWorldPosition(v()),end=this.bend.at(PVC.length),endY=this.bend.topHeight-end.x;
    if(endY<.01||endY>.10)return false;
    for(let s=this.cutFrom+.025;s<PVC.length;s+=.012){
      const a=this.bend.at(s),w=v(p.x,this.bend.topHeight-a.x,p.z-.021+a.y);
      if(w.y<.01||Math.abs(w.x)>3.55||w.z>3.25)return false;
      if(!this.game.room.brickWall.volume.cavityBox({x:w.x-.01,y:w.y-.006,z:w.z-.01},{x:w.x+.01,y:w.y+.006,z:w.z+.01}).clear)return false;
    }
    return true;
  }
  present():void{
    const active=this.blocksWork;
    this.work.visible=active&&this.phase!=='spreading';
    this.arms.forEach(a=>{a.group.visible=a.hand.visible=this.work.visible;});
    this.stock.markAt(this.bend.mark,this.markingProgress);
    this.stock.straightedge.visible=this.focused&&this.phase==='marking';
    this.stock.liveMarks.visible=this.stock.straightedge.visible&&this.markingProgress<1;
    this.previewRoot.visible=this.focused&&Boolean(this.target);
    const cursor=this.fastenerCursorPoint();this.securingCursor.visible=this.focused&&this.phase==='fastener-marking'&&Boolean(cursor);
    if(cursor)this.securingCursor.position.copy(cursor.point);
    if(active){this.game.fpsRig.visible=false;this.pose();}
    this.updateTargetGuide();
    this.renderUI();
  }
  private updateTargetGuide():void{
    this.guideTarget=null;this.targetGuide.visible=false;
    if(this.phase!=='carrying')return;
    const camera=this.game.renderer.camera,eye=camera.getWorldPosition(v());let score=Infinity;
    for(const point of this.game.boxPlacement.installationPoints){
      if(!point.boxGroup.visible||point.conduit||point.stage==='complete'||!['leveled','conduit'].includes(point.stage)||!this.game.mortar.ready(point))continue;
      const placement=point.boxGroup.userData.placement;if(placement&&!placement.secured)continue;
      const world=point.boxGroup.getWorldPosition(v()),distance=world.distanceTo(eye);if(distance>6)continue;
      const projected=world.clone().project(camera);if(projected.z< -1||projected.z>1)continue;
      const candidate=Math.hypot(projected.x,projected.y)+distance*.025;if(candidate<score){score=candidate;this.guideTarget=point;}
    }
    if(!this.guideTarget)return;
    this.targetGuideBounds.setFromObject(this.guideTarget.boxGroup).expandByScalar(.018);this.targetGuide.visible=true;this.targetGuide.updateMatrixWorld(true);
  }
  anatomicalGrips():WorkerGripTarget[]{
    const clearFirstPerson=['carrying','fitting','cutting','cut','installing'].includes(this.phase)||this.phase.startsWith('fastener-');
    return this.arms.map(arm=>({...workerGripTarget(arm,this.work.visible&&this.phase!=='fastener-marking'&&(this.phase!=='carrying'||arm.side>0)),section:(this.phase.startsWith('fastener-')?(arm.side<0?[.005,.005]:[.011,.011]):[.01,.01]) as [number,number],shape:'round' as const,contactLocked:true,surfaceContact:true,firstPersonClearance:clearFirstPerson?.42:undefined}));
  }
  useAnatomicalBody():void{
    // Legacy arm geometry is only a transform driver, never a visible fallback.
    // The current WorkerBody model, materials and animations remain untouched.
    this.arms.forEach(arm=>hideLegacyWorkerArm(arm,true));
  }
  private pose():void{
    const c=this.game.renderer.camera;c.updateMatrixWorld(true);
    this.work.position.copy(c.position);this.work.quaternion.copy(c.quaternion);
    const fit=Boolean(this.target)&&['fitting','cutting','cut','installing'].includes(this.phase);
    const securing=Boolean(this.target)&&this.phase.startsWith('fastener-');
    const bending=['spring','inserting','bending','review','extracting'].includes(this.phase);
    this.pipe.visible=bending||this.phase==='carrying'||fit;
    const mark=this.bend.at(this.bend.mark),key=[this.bend.revision,this.bend.mark,this.cutFrom,this.phase].join(':');
    if(key!==this.shapeKey){this.pipe.update(this.bend,this.cutFrom);this.shapeKey=key;}
    this.pipe.material.transparent=this.transparent;this.pipe.material.opacity=this.transparent?.40:1;this.pipe.material.depthWrite=!this.transparent;
    // Work within arm reach; the original close-up was 78 cm beyond the eyes.
    const support=this.bend.at(this.bend.gripS-.16),working=this.bend.at(this.bend.gripS+.12);
    this.pipe.position.set(bending?-(support.x+working.x)/2:-mark.x,bending?.015+(support.y+working.y)/2:-.23-mark.y,bending?-.46:-.39);this.pipe.rotation.set(bending?Math.PI:0,0,0);
    if(this.phase==='spring'||this.phase==='inserting')this.pipe.position.x=THREE.MathUtils.lerp(-.08,-mark.x,this.insertion);
    if(this.phase==='carrying'){
      this.pipe.rotation.z=-1.2;const grip=this.bend.at(Math.min(this.bend.mark,.6));
      this.pipe.position.copy(v(.19,-.28,-.43).sub(v(grip.x,grip.y).applyQuaternion(this.pipe.quaternion)));
    }
    this.spring.visible=this.cable.visible=bending;
    this.markRing.visible=bending;
    this.markRing.position.copy(v(mark.x,bending?-mark.y:mark.y).add(this.pipe.position));this.markRing.quaternion.setFromUnitVectors(v(0,0,1),v(Math.cos(mark.angle),bending?-Math.sin(mark.angle):Math.sin(mark.angle),0));
    if(bending){
      const springStart=(this.bend.mark-PVC.springLength/2+PVC.springLength)*this.insertion-PVC.springLength;
      for(let i=0;i<135;i++){
        const s=springStart+i/134*PVC.springLength,p=s<0?{x:s,y:0,angle:0}:this.bend.at(s),d=this.turnDummy;
        d.position.set(p.x+this.pipe.position.x,-p.y+this.pipe.position.y,this.pipe.position.z);
        d.quaternion.setFromUnitVectors(v(0,0,1),v(Math.cos(p.angle),-Math.sin(p.angle),0));d.updateMatrix();this.spring.setMatrixAt(i,d.matrix);
      }
      this.spring.instanceMatrix.needsUpdate=true;this.spring.computeBoundingSphere();
      // Full 2 m retrieval lead: the section inside the pipe reaches the eye;
      // remaining slack hangs below the hands. It is visible through the shell.
      this.work.updateMatrixWorld(true);
      const down=v(0,-1,0).applyQuaternion(this.work.quaternion.clone().invert());
      const exitHeight=this.work.localToWorld(this.pipe.position.clone().add(v(Math.min(0,springStart),0,0))).y;
      const cableKey=[this.bend.revision,this.bend.mark,this.insertion,...down.toArray().map(n=>n.toFixed(3)),exitHeight.toFixed(3)].join(':');
      if(cableKey!==this.cableKey){
        const recipe=PvcBend.from(this.bend.recipe());
        const curve=new(class extends THREE.Curve<THREE.Vector3>{
          constructor(){super();}
          getPoint(t:number,target=v()):THREE.Vector3{return target.fromArray(springLeadPoint(t*PVC.cableLength,springStart,s=>recipe.at(s),down,exitHeight));}
        })();
        this.cable.geometry.dispose();this.cable.geometry=new THREE.TubeGeometry(curve,160,.003,6,false);this.cableKey=cableKey;
      }
      this.cable.position.copy(this.pipe.position);
    }
    this.marker.visible=this.phase==='marking';
    this.cutter.visible=['opening','fitting','cutting','cut','installing'].includes(this.phase);
    this.drill.visible=this.phase==='fastener-drilling';
    this.heldRebar.visible=['fastener-insert-ready','fastener-inserting','fastener-tighten-ready','fastener-tightening'].includes(this.phase);
    this.rebarPliers.visible=this.heldRebar.visible;
    const left=v(-.21,-.20,-.43),right=v(.20,-.21,-.43),leftQ=new THREE.Quaternion(),rightQ=new THREE.Quaternion();
    if(bending){
      // Both hands bracket the active spring section while feeding the pipe.
      // Downward pressure stays between the two physical contacts.
      const p=support,q=working;
      left.copy(v(p.x,-p.y).add(this.pipe.position));right.copy(v(q.x,-q.y).add(this.pipe.position));
      leftQ.setFromUnitVectors(v(0,1,0),v(Math.cos(p.angle),-Math.sin(p.angle),0));rightQ.setFromUnitVectors(v(0,1,0),v(-Math.cos(q.angle),Math.sin(q.angle),0));
      if(this.phase==='spring'||this.phase==='inserting'){left.set(-.16,this.pipe.position.y,this.pipe.position.z);right.set(.16,this.pipe.position.y,this.pipe.position.z);}
    }
    if(this.marker.visible){
      const point=v(1.94+Math.min(1,this.markingProgress)*.532,.043,-.35+this.bend.mark);this.marker.position.copy(c.worldToLocal(point));this.marker.rotation.z=-.25;right.copy(this.marker.position).add(v(0,.055,0));
      this.marker.quaternion.copy(c.quaternion).invert().multiply(new THREE.Quaternion().setFromAxisAngle(v(0,0,1),-.25));
      right.copy(this.marker.position).add(v(0,.055,0).applyQuaternion(this.marker.quaternion));rightQ.copy(this.marker.quaternion);
      left.copy(c.worldToLocal(v(1.87,.061,this.bend.mark-.35+.10)));
      leftQ.copy(c.quaternion).invert().multiply(new THREE.Quaternion().setFromUnitVectors(v(0,1,0),v(0,0,1)));
      // Camera is close enough to reach the marked strip; the stroke position
      // remains real world geometry, independent of the marking HUD.
    }
    if(fit){
      const root=new THREE.Object3D();this.orientAtBox(root,this.phase==='installing'?.07*(1-this.elapsed/.6):.07);
      this.pipe.position.copy(c.worldToLocal(root.position.clone()));this.pipe.quaternion.copy(c.quaternion.clone().invert().multiply(root.quaternion));
      const cut=this.bend.at(this.cutS),world=v(cut.x,cut.y,0).applyQuaternion(root.quaternion).add(root.position);
      this.cutRing.position.copy(world);this.cutRing.quaternion.setFromUnitVectors(v(0,0,1),v(0,1,0));this.cutRing.visible=this.phase==='fitting';
      const tip=c.worldToLocal(world);this.cutter.quaternion.identity();this.cutter.position.copy(tip).sub(v().fromArray(this.cutter.userData.tipPoint));
      right.copy(v().fromArray(this.cutter.userData.gripPoint).add(this.cutter.position));left.copy(tip).add(v(-.015,-.13,0));
      rightQ.fromArray(this.cutter.userData.gripQuaternion??[0,0,0,1]);
      this.cutter.getObjectByName('cutter-moving-handle')!.rotation.z=.13-(this.phase==='cutting'?Math.sin(Math.min(1,this.elapsed/.45)*Math.PI)*.55:0);
    }else if(this.phase==='opening'){
      this.cutter.position.set(.02,-.15+Math.sin(this.elapsed*6)*.04,-.41);this.cutter.quaternion.identity();
      right.copy(v().fromArray(this.cutter.userData.gripPoint).add(this.cutter.position));rightQ.fromArray(this.cutter.userData.gripQuaternion);
      this.cutter.getObjectByName('cutter-moving-handle')!.rotation.z=.13-Math.max(0,Math.sin(this.elapsed*9))*.5;
    }else if(securing){
      const holes=this.fastenerHoles,pairs=this.fastenerPairs;
      if(this.phase==='fastener-drilling'&&holes.length){
        const hole=holes[Math.min(this.fastenerIndex,holes.length-1)],tip=c.worldToLocal(hole.marker.position.clone()),direction=v(0,0,-1),q=new THREE.Quaternion();
        const pulse=Math.sin(Math.min(1,this.fastenerProgress)*Math.PI)*.015;this.drill.quaternion.copy(q);this.drill.position.copy(tip).sub(v().fromArray(this.drill.userData.tipPoint).applyQuaternion(q)).addScaledVector(direction,-.05+pulse);
        right.copy(v().fromArray(this.drill.userData.gripPoint).applyQuaternion(q).add(this.drill.position));rightQ.copy(q);left.copy(tip).add(v(-hole.side*.09,-.04,.04));leftQ.copy(q);
      }else{
        const pair=pairs[Math.min(this.fastenerIndex,Math.max(0,pairs.length-1))],world=pair?pair.left.marker.position.clone().add(pair.right.marker.position).multiplyScalar(.5):this.target!.boxGroup.getWorldPosition(v()).add(v(0,-.16,.12)),centre=c.worldToLocal(world);
        this.heldRebar.position.copy(centre).add(v(-.16,-.03,.10));this.heldRebar.rotation.set(0,0,.08);left.copy(this.heldRebar.position).add(v(0,-.02,0));leftQ.identity();
        this.rebarPliers.position.copy(centre).add(v(.10,-.01,.08));this.rebarPliers.rotation.set(0,0,-.18);right.copy(v().fromArray(this.rebarPliers.userData.gripPoint).applyQuaternion(this.rebarPliers.quaternion).add(this.rebarPliers.position));rightQ.copy(this.rebarPliers.quaternion);
        if(this.phase==='fastener-inserting'){const approach=1-THREE.MathUtils.smoothstep(this.fastenerProgress,0,1);this.heldRebar.position.z+=approach*.13;left.z+=approach*.13;}
        if(this.phase==='fastener-tightening'){const approach=1-THREE.MathUtils.smoothstep(this.fastenerProgress,0,.35);this.rebarPliers.position.z+=approach*.10;right.z+=approach*.10;}
      }
    }
    this.work.updateMatrixWorld(true);
    const bodyRight=v(1,0,0).applyQuaternion(c.quaternion);
    for(const arm of this.arms){
      const pos=(arm.side<0?left:right).clone(),q=arm.side<0?leftQ:rightQ;
      const shoulder=c.localToWorld(v(arm.side*.18,-.30,.08));
      arm.hand.position.copy(c.localToWorld(pos));arm.hand.quaternion.copy(c.quaternion).multiply(q);arm.hand.updateMatrixWorld(true);
      const wrist=arm.hand.localToWorld(v().fromArray(arm.hand.userData.wristPoint));
      poseWorkerArm(arm,shoulder,wrist,bodyRight);arm.upper.visible=false;
    }
  }
  private renderUI():void{
    const near=this.game.started&&this.stockAimed(),show=this.focused,nearBox=this.phase==='carrying'?this.game.boxPlacement.targetNear(this.game.renderer.camera):null;
    const touchModifiers=this.touch&&['bending','review'].includes(this.phase);
    this.controls.hidden=!show||(this.touch&&!touchModifiers);this.controls.dataset.phase=this.phase;
    this.game.hud.shell.classList.toggle('pvc-working',this.blocksWork);
    this.game.hud.shell.classList.toggle('pvc-focused',this.focused);
    this.prompt.hidden=!this.game.started||this.touch||(!show&&!near&&this.phase!=='carrying')||(this.phase==='carrying'&&!near&&!nearBox);
    const tips:Partial<Record<Phase,string>>={
      marking:'Mouse: γωνία · E: σημάδεψε όλες τις σωλήνες · P: preset · Tab: επόμενο',
      spring:'LMB: βάλε το spring · R: διαφάνεια · ESC: πίσω',
      bending:'A / D: χέρι · LMB: λύγισε εδώ · 8 θέσεις για 90° · Z: διόρθωση · E: έλεγχος · R: διαφάνεια',
      review:'Ροδέλα ή − / +: ποσότητα · E: παραγωγή · R: διαφάνεια',
      fitting:'Mouse πάνω/κάτω: cutter · LMB: κόψε · E: προετοιμασία στερέωσης · R: διαφάνεια',
      cut:'E: εφάρμοσε · R: διαφάνεια · ESC: πίσω',
      'pipe-install-ready':'USE: πέρασε τη σωλήνα μέσα από τα ανοικτά rebar και εφάρμοσέ τη στο κουτί',
      opening:'Κοπή πλαστικών δεσιμάτων',spreading:'Ευθυγράμμιση σωλήνων',
      inserting:'Εισαγωγή spring στο σημάδι',extracting:'Τράβηγμα spring από το καλώδιο',
      cutting:'Κοπή PVC',installing:'Εισαγωγή στο κουτί',
      'fastener-marking':'Μετακίνησε ελεύθερα τον στόχο πάνω στο τούβλο · USE: σημάδεψε οπή · ελάχιστο ένα αντικριστό ζεύγος',
      'fastener-drilling':'Τρύπημα 12 mm · οι σημειωμένες οπές ανοίγουν μία-μία',
      'fastener-insert-ready':'USE: πέρασε τα rebar ένα-ένα στις οπές, ανοικτά για τη σωλήνα',
      'fastener-inserting':'Εισαγωγή ανοικτών rebar · ένα ζεύγος τη φορά',
      'fastener-tighten-ready':'USE: ξεκίνα το τελικό σφίξιμο με την πένσα',
      'fastener-tightening':'Σύσφιξη rebar · ένα ζεύγος τη φορά',
    };
    if(this.touch)Object.assign(tips,{
      marking:'Σύρε πάνω/κάτω για μήκος · ΣΗΜΑΔΕΨΕ για μαρκάρισμα',
      spring:'Κράτα SPRING για εισαγωγή',
      bending:'8 ΘΕΣΕΙΣ ΧΕΡΙΩΝ · Κράτα ΛΥΓΙΣΕ · ΕΛΕΓΧΟΣ στις 90°',
      review:'Διάλεξε 1, 5 ή ΟΛΕΣ · μετά ΕΤΟΙΜΑΣΕ ΚΑΙ ΚΡΑΤΑ',
      fitting:'Σύρε πάνω/κάτω το cutter · Κράτα ΚΟΨΕ',cut:'ΠΡΟΕΤΟΙΜΑΣΕ ΟΠΕΣ ή ΠΙΣΩ','pipe-install-ready':'USE · ΕΦΑΡΜΟΣΕ ΣΩΛΗΝΑ',
      'fastener-marking':'Σύρε το στόχο · USE για κάθε οπή · μετά πάτησε το εικονίδιο τρυπανιού',
      'fastener-drilling':'Τρύπημα 12 mm · μία οπή τη φορά','fastener-insert-ready':'USE · ΠΕΡΑΣΕ ΑΝΟΙΚΤΑ REBAR','fastener-inserting':'Πέρασμα ανοικτών rebar ένα-ένα','fastener-tighten-ready':'USE · ΣΦΙΞΕ ΜΕ ΠΕΝΣΑ','fastener-tightening':'Σύσφιξη ένα-ένα',
    });
    const key=this.touch?'ΑΓΓΙΞΕ':'E';
    const hint=show?(this.message||tips[this.phase]||`${key}: συνέχεια`):
      this.phase==='sealed'?`${key} · ΚΟΨΕ ΤΑ ΔΕΣΙΜΑΤΑ · 20 × 3 m`:this.phase==='loose'?`${key} · ΑΠΛΩΣΕ ΤΙΣ ΣΩΛΗΝΕΣ`:
      this.phase==='batch'?`${key} · ${this.prepared.length?'ΠΑΡΕ ΣΩΛΗΝΑ':'ΝΕΑ ΠΡΟΕΤΟΙΜΑΣΙΑ'} · ${this.prepared.length} έτοιμες / ${this.rawCount} άκοπες`:
      this.phase==='carrying'?(this.message||(near?`${key} · ΕΠΙΣΤΡΟΦΗ ΣΤΗ ΜΑΤΣΑ`:nearBox?`${key} · ΕΦΑΡΜΟΣΕ ΣΤΟ ΚΟΥΤΙ`:'')):`${key} · ΣΥΝΕΧΙΣΕ`;
    this.prompt.dataset.phase=this.phase;
    this.prompt.classList.toggle('pvc-primary-action',this.touch&&!show&&['sealed','loose','batch','carrying'].includes(this.phase));
    if(!this.touch)this.markConfirm.textContent='E · ΣΗΜΑΔΕΨΕ ΤΙΣ ΣΩΛΗΝΕΣ';
    this.controls.querySelector('[data-pvc="confirm"]')!.textContent=this.phase==='review'?`ΕΤΟΙΜΑΣΕ ×${this.quantity} ΚΑΙ ΚΡΑΤΑ 1`:this.phase==='cut'?'ΕΦΑΡΜΟΣΕ':'ΕΛΕΓΧΟΣ';
    if(this.prompt.textContent!==hint)this.prompt.textContent=hint;
    this.markConfirm.hidden=!show||this.phase!=='marking'||this.markingActive;
    this.zoomControl.hidden=!this.touch||!show||!['fitting','cut'].includes(this.phase);
    this.drillControl.hidden=!show||this.phase!=='fastener-marking'||this.fastenerPairs.length<1||this.fastenerPairs.length*2!==this.fastenerHoles.length;
    this.zoomControl.setAttribute('aria-pressed',String(this.fitZoomed));this.zoomControl.dataset.zoom=String(this.fitZoomed);
    this.liveMeasure.hidden=!show||!['marking','bending','review','fitting','cut'].includes(this.phase);
    if(!this.liveMeasure.hidden){
      const marking=this.phase==='marking',fit=Boolean(this.target);
      let point:THREE.Vector3;
      if(marking)point=v(2.64,.055,this.bend.mark-.35);
      else if(fit)point=this.target!.boxGroup.getWorldPosition(v()).add(v(.17,-.06,.10));
      else point=this.pipe.localToWorld(v(this.bend.at(this.bend.mark).x+.20,this.bend.at(this.bend.mark).y,0));
      point.project(this.game.renderer.camera);
      const rect=this.game.renderer.webgl.domElement.getBoundingClientRect(),shell=this.game.hud.shell.getBoundingClientRect();
      this.liveMeasure.textContent=marking?`${(this.bend.mark*100).toFixed(1)} cm · από την αρχή`:
        fit?`Δάπεδο → κάτω κουτιού ${(this.boxBottomHeight()!*100).toFixed(1)} cm\nΚοπή ${(this.cutS*100).toFixed(1)} cm · ${this.fitErrorAt(this.phase==='fitting'?this.cutS:this.cutFrom).toFixed(0)} mm διαφορά`:
        `${this.bend.angle.toFixed(1)}° · R ${this.bend.radius?Math.round(this.bend.radius*1000)+' mm':'—'}${this.phase==='review'?'\nΠοσότητα × '+this.quantity:''}`;
      const width=this.liveMeasure.offsetWidth,x=rect.left-shell.left+(point.x+1)*rect.width/2+12,y=rect.top-shell.top+(1-point.y)*rect.height/2;
      this.liveMeasure.style.left=`${THREE.MathUtils.clamp(x,10,rect.width-width-10)}px`;
      this.liveMeasure.style.top=`${THREE.MathUtils.clamp(y,70,rect.height-160)}px`;
    }
    for(const button of this.controls.querySelectorAll<HTMLButtonElement>('[data-pvc]')){
      const action=button.dataset.pvc;
      button.hidden=this.touch
        ? !(['back','forward','undo'].includes(action!)&&this.phase==='bending'||Boolean(action?.startsWith('qty-'))&&this.phase==='review')
        : action==='save'?this.phase!=='marking':['back','forward','undo'].includes(action!)?this.phase!=='bending':action?.startsWith('qty-')?this.phase!=='review':false;
      if(action?.startsWith('qty-')){const value=action==='qty-all'?this.rawCount:Number(action.slice(4));button.setAttribute('aria-pressed',String(this.quantity===Math.min(this.rawCount,value)));}
    }
    const use=this.controls.querySelector<HTMLButtonElement>('#pvc-use')!;
    use.hidden=this.touch||!['spring','bending','fitting'].includes(this.phase);
    use.textContent=this.phase==='fitting'?'ΚΟΨΕ':this.phase==='bending'?'ΛΥΓΙΣΕ':'SPRING';
    if(this.touch){
      const action=this.focused
        ? this.phase==='marking'?'AIM':this.phase==='fastener-marking'?'ΣΗΜΑΔΙ':this.phase==='fastener-insert-ready'?'REBAR':this.phase==='pipe-install-ready'?'ΣΩΛΗΝΑ':this.phase==='fastener-tighten-ready'?'ΣΦΙΞΕ':this.phase==='spring'?'SPRING':this.phase==='bending'?(this.bend.ready?'ΕΛΕΓΧΟΣ':'ΛΥΓΙΣΕ'):this.phase==='review'?'ΕΤΟΙΜΑΣΕ':this.phase==='fitting'?'ΚΟΨΕ':this.phase==='cut'?'ΟΠΕΣ':'USE'
        : this.phase==='sealed'&&near?'ΚΟΨΕ':this.phase==='loose'&&near?'ΑΠΛΩΣΕ':this.phase==='batch'&&near?(this.prepared.length?'ΠΑΡΕ':'ΝΕΑ'):this.phase==='carrying'&&near?'ΕΠΙΣΤΡΕΨΕ':this.phase==='carrying'&&nearBox?'ΕΦΑΡΜΟΣΕ':'USE';
      const mobileAction=this.game.hud.shell.querySelector<HTMLElement>('#mobile-action')!,mobileDetail=this.game.hud.shell.querySelector<HTMLElement>('#look-joystick-thumb small')!,joystick=this.game.hud.shell.querySelector<HTMLElement>('#look-joystick')!;
      mobileAction.textContent=action;mobileDetail.textContent=['AIM','ΣΗΜΑΔΙ'].includes(action)?'DRAG':action==='USE'?'+ AIM':'USE';joystick.setAttribute('aria-label',action==='AIM'?'Σύρε για να ρυθμίσεις το σημάδι σωλήνας':action==='ΣΗΜΑΔΙ'?'Σύρε για επιλογή οπής και πάτησε για σημάδεμα':action==='USE'?'Hold to use selected tool; drag to aim':`${action} με το USE joystick`);
    }
  }
  get telemetry(){const fitError=this.fitErrorAt(this.phase==='fitting'?this.cutS:this.cutFrom);return{phase:this.phase,focused:this.focused,raw:this.rawCount,prepared:this.prepared.length,carrying:Boolean(this.carried),installed:this.installedCount,total:this.rawCount+this.prepared.length+Number(Boolean(this.carried))+this.installedCount,markCm:this.bend.mark*100,markingProgress:this.markingProgress,markingActive:this.markingActive,springInsertion:this.insertion,springCentreM:this.bend.mark,springLengthM:PVC.springLength,retrievalCableM:PVC.cableLength,grip:this.bend.grip,angle:this.bend.angle,radiusMm:this.bend.radius?this.bend.radius*1000:null,ready:this.bend.ready,angles:[...this.bend.angles],quantity:this.quantity,target:this.target?.definition.id??null,guideTarget:this.guideTarget?.definition.id??null,boxBottomCm:this.boxBottomHeight()===null?null:this.boxBottomHeight()!*100,cutCm:this.cutS*100,cutFromCm:this.cutFrom*100,fitErrorMm:fitError,fitReady:fitError>=-SHORT_PIPE_TOLERANCE_MM&&fitError<=BOX_ENTRY_ALLOWANCE_MM,boxEntryAllowanceMm:BOX_ENTRY_ALLOWANCE_MM,offcuts:this.offcuts.length,message:this.message,preview:this.pipe.visible,fasteners:{holes:this.fastenerHoles.length,pairs:this.fastenerPairs.length,drilled:this.fastenerHoles.filter(h=>h.drilled).length,index:this.fastenerIndex,progress:this.fastenerProgress,bitDiameterMm:12,aim:{...this.fastenerAim},positions:this.fastenerHoles.map(h=>({side:h.side,x:h.marker.position.x,y:h.y,z:h.marker.position.z})),rebars:this.fastenerPairs.map(p=>({visible:p.rebar.visible,position:p.rebar.position.toArray(),scale:p.rebar.scale.toArray(),left:p.rebar.userData.leftHole,right:p.rebar.userData.rightHole}))},arms:this.arms.map(a=>({side:a.side,reach:a.shoulder.distanceTo(a.wrist)}))};}
}
