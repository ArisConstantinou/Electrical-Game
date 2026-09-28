import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { RigTool } from '../player/FPSRig';
import type { InstallationPoint } from '../electrical/InstallationPoint';
import type { BoxConduitEntry } from '../electrical/BoxGroup';
import { buildToolModel } from '../player/ToolModels';
import { workerHand,workerArm,poseWorkerArm,workerGripTarget,hideLegacyWorkerArm,type WorkerArm,type WorkerGripTarget } from '../player/WorkerArm';
import { PvcBend,PVC,type PipeRecipe } from './PvcBend';
import { PvcOffcuts } from './PvcOffcuts';
import { PvcBendHighlight } from './PvcBendHighlight';
import { PvcBendHUD } from '../ui/PvcBendHUD';
import { PvcStock,PvcTube,part,pvcMaterial,pvcStockMaterial } from './PvcModels';
import { springLeadPoint } from './PvcLead';
import {DEFAULT_PVC_PRESETS,PVC_PRESET_KEY,readPvcPresets,type PvcPreset} from './PvcPresets';
import {buildHeldRebar,buildPvcDrill12,buildRebarHug,buildRebarPliers,setRebarPliersClosed,setTieWireProgress,setTieWireTarget} from './PvcSecuringModels';
import {REBAR_TYING_ROLL} from './RebarTyingModels';
import '../ui/PvcWorkshop.css';

type Phase='sealed'|'opening'|'loose'|'spreading'|'marking'|'spring'|'inserting'|'bending'|'review'|'extracting'|'batch'|'carrying'|'fitting'|'cutting'|'cut'|'pipe-install-ready'|'installing'|'fastener-marking'|'fastener-drilling'|'fastener-insert-ready'|'fastener-inserting'|'fastener-tighten-ready'|'fastener-tightening';
interface StockPipe{recipe:PipeRecipe;mesh:PvcTube;cutFrom:number;bundle:number;originBundle:number;highlight?:THREE.Mesh}
interface BundleWork{phase:Phase;bend:PvcBend;markingProgress:number;markingActive:boolean;insertion:number;quantity:number;cutFrom:number;elapsed:number}
type StockTarget={bundle:number;prepared:StockPipe|null};
interface FastenerHole{side:-1|1;y:number;marker:THREE.Group;drilled:boolean;paired:boolean}
interface FastenerPair{left:FastenerHole;right:FastenerHole;rebar:THREE.Group}
const v=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const BOX_ENTRY_ALLOWANCE_MM=30;
const SHORT_PIPE_TOLERANCE_MM=3;
const workPhases:Phase[]=['opening','spreading','marking','spring','inserting','bending','review','extracting','fitting','cutting','cut','pipe-install-ready','installing','fastener-marking','fastener-drilling','fastener-insert-ready','fastener-inserting','fastener-tighten-ready','fastener-tightening'];
const animated:Phase[]=['opening','spreading','inserting','extracting','cutting','installing','fastener-drilling','fastener-inserting','fastener-tightening'];
export class PvcWorkshop {
  readonly stock=new PvcStock();
  readonly work=new THREE.Group();
  readonly pipe=new PvcTube(pvcMaterial.clone());
  readonly bendHighlight=new PvcBendHighlight();
  readonly bendHud:PvcBendHUD;
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
  readonly fitControls:HTMLElement;
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
  activeBundle=0;
  private readonly bundleWork=new Map<number,BundleWork>();
  private readonly installedByBundle=Array<number>(this.stock.bundleRoots.length).fill(0);
  get rawCount():number{return this.stock.bundleRemaining[this.activeBundle];}
  set rawCount(count:number){this.stock.setBundleRemaining(this.activeBundle,count);}
  apprenticeLease=false;
  installedCount=0;
  quantity=1;
  markingProgress=0;
  insertion=0;
  cutFrom=0;
  cutS=0;
  cutErrorMm=0;
  private entryIndex=0;
  private cutSnapped=false;
  private target:InstallationPoint|null=null;
  private carried:StockPipe|null=null;
  private elapsed=0;
  private feedTime=0;
  private pressHeld=false;
  private toolbarHold=false;
  private canvasHold=false;
  private markingActive=false;
  private fitZoomed=false;
  private supportS:number|null=null;
  private cutterRetreat=0;
  private fastenerAim={x:-.72,y:.72};
  private fastenerHoles:FastenerHole[]=[];
  private fastenerPairs:FastenerPair[]=[];
  private readonly stagedFasteners=new Map<InstallationPoint,{holes:FastenerHole[];pairs:FastenerPair[]}>();
  private fastenerReturnPhase:Phase='batch';
  private fastenerIndex=0;
  private fastenerProgress=0;
  private fastenerDirectIndex:number|null=null;
  private shapeKey='';
  private message='';
  private readonly cameraDestination=v();
  private readonly cameraFocus=v();
  private readonly targetRotation=new THREE.Quaternion();
  private readonly turnDummy=new THREE.Object3D();
  private readonly ray=new THREE.Raycaster();
  private readonly occlusionBounds=new WeakMap<THREE.Object3D,{box:THREE.Box3;matrix:THREE.Matrix4}>();
  private readonly occlusionHit=v();
  private stockAimCache:{key:string;at:number;target:StockTarget|null}|null=null;
  private idleUiPresented=false;
  private readonly previewRoot=new THREE.Group();
  private readonly cutRing:THREE.Mesh;
  private readonly markRing:THREE.Mesh;
  private cableKey='';
  private readonly offcuts:THREE.Mesh[]=[];
  private readonly offcutMotion=new PvcOffcuts();
  private readonly queue:Array<()=>void>=[];

  private get touch():boolean{return matchMedia('(pointer:coarse)').matches;}
  private instruction(desktop:string,touch:string):string{return this.touch?touch:desktop;}
  claimForApprentice():boolean{
    if(this.apprenticeLease)return true;
    if(this.blocksWork||this.focused||!['sealed','loose','batch'].includes(this.phase))return false;
    this.apprenticeLease=true;return true;
  }
  releaseApprentice():void{this.apprenticeLease=false;}
  consumeRawForApprentice(bundle:number):boolean{
    if(!this.apprenticeLease||bundle<0||bundle>=this.stock.bundleRemaining.length)return false;
    const available=this.stock.bundleRemaining[bundle];if(available<=0)return false;
    this.stock.setBundleRemaining(bundle,available-1);return true;
  }

  constructor(private readonly game:Game){
    game.renderer.scene.add(this.stock,this.previewRoot,this.targetGuide,this.securingRoot);
    this.stock.addSiteObject(this.preparedRoot);
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
    this.pipe.add(this.bendHighlight);
    for(const side of [-1,1]){const hand=workerHand(side,'spring'),arm=workerArm(side,hand,v());this.arms.push(arm);game.renderer.scene.add(arm.group,hand);}
    this.controls=document.createElement('div');this.controls.id='pvc-touch-controls';this.controls.hidden=true;
    this.controls.innerHTML='<button data-pvc="back" aria-label="Προηγούμενη θέση χεριών">← ΧΕΡΙΑ</button><button data-pvc="forward" aria-label="Επόμενη θέση χεριών">ΧΕΡΙΑ →</button><button id="pvc-use">ΚΡΑΤΑ</button><button data-pvc="confirm">ΕΛΕΓΧΟΣ</button><button data-pvc="undo">ΑΝΑΙΡΕΣΗ</button><button data-pvc="save">PRESET</button><button data-pvc="transparent">ΔΙΑΦΑΝΕΙΑ</button><button data-pvc="qty-1" aria-label="Ετοίμασε μία σωλήνα">1</button><button data-pvc="qty-5" aria-label="Ετοίμασε πέντε σωλήνες">5</button><button data-pvc="qty-all" aria-label="Ετοίμασε όλες τις σωλήνες">ΟΛΕΣ</button><button data-pvc="pause">ΠΙΣΩ</button>';
    this.prompt=document.createElement('button');this.prompt.id='pvc-prompt';this.prompt.hidden=true;
    this.liveMeasure=document.createElement('output');this.liveMeasure.id='pvc-live-measure';this.liveMeasure.hidden=true;this.liveMeasure.setAttribute('aria-label','Ζωντανή μέτρηση σωλήνας');
    this.markConfirm=document.createElement('button');this.markConfirm.id='pvc-mark-confirm';this.markConfirm.setAttribute('aria-label','Σημάδεψε τις σωλήνες με τον μαρκαδόρο');this.markConfirm.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m8 24 3-8L23 4l5 5-12 12-8 3zM19 8l5 5M8 24l6-2-4-4-2 6z"/></svg>';this.markConfirm.hidden=true;
    this.zoomControl=document.createElement('button');this.zoomControl.id='pvc-fit-zoom';this.zoomControl.setAttribute('aria-label','Μεγέθυνση κάμερας κοπής');this.zoomControl.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="14" cy="14" r="8"/><path d="m20 20 8 8M10 14h8"/><path class="zoom-plus" d="M14 10v8"/></svg>';this.zoomControl.hidden=true;
    this.drillControl=document.createElement('button');this.drillControl.id='pvc-drill-holes';this.drillControl.setAttribute('aria-label','Τρύπησε διαδοχικά τις σημειωμένες οπές με τρυπάνι 12 χιλιοστών');this.drillControl.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 7h15v10H3zM18 10h7M25 9v4M6 17v10h9v-4l-3-6M5 27"/><path d="M25 11h5"/></svg>';this.drillControl.hidden=true;
    this.fitControls=document.createElement('div');this.fitControls.id='pvc-fit-controls';this.fitControls.hidden=true;
    this.fitControls.innerHTML='<button id="pvc-entry-previous" aria-label="Προηγούμενη κάτω είσοδος">←</button><button id="pvc-cut-flush" aria-label="Κοπή πρόσωπο με το κάτω χείλος του κουτιού">ΠΡΟΣΩΠΟ</button><button id="pvc-cut-confirm" aria-label="Κόψε πλήρως τη σωλήνα στο επιλεγμένο ύψος">ΚΟΨΕ</button><button id="pvc-entry-next" aria-label="Επόμενη κάτω είσοδος">→</button>';
    this.fitControls.querySelector('#pvc-cut-confirm')!.addEventListener('click',()=>this.queue.push(()=>this.use()));
    this.fitControls.querySelector('#pvc-cut-flush')!.addEventListener('click',()=>this.queue.push(()=>this.snapCutFlush()));
    this.fitControls.querySelector('#pvc-entry-previous')!.addEventListener('click',()=>this.queue.push(()=>this.selectEntry(-1)));
    this.fitControls.querySelector('#pvc-entry-next')!.addEventListener('click',()=>this.queue.push(()=>this.selectEntry(1)));
    game.hud.shell.append(this.prompt,this.liveMeasure,this.markConfirm,this.zoomControl,this.drillControl,this.controls,this.fitControls);
    const handArrows=document.createElement('span');handArrows.className='pvc-hand-arrows';handArrows.setAttribute('aria-hidden','true');handArrows.innerHTML='<span>↑</span><span>↓</span>';game.hud.shell.querySelector('#joystick-thumb')!.append(handArrows);
    this.bendHud=new PvcBendHUD(game.hud.shell,action=>this.queue.push(()=>action==='use'?this.use():this.command(action)),held=>this.toolbarHold=held);
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
      if(['fitting','cut'].includes(this.phase)){
        if(e.code==='KeyV'){e.preventDefault();this.queue.push(()=>this.snapCutFlush());}
        if(e.code==='BracketLeft'||e.code==='BracketRight'){e.preventDefault();this.queue.push(()=>this.selectEntry(e.code==='BracketLeft'?-1:1));}
      }
      if(e.code==='KeyZ')this.queue.push(()=>this.command('undo'));
      if(e.code==='KeyP'){e.preventDefault();this.queue.push(()=>this.savePreset(e.shiftKey));}
      if(e.code==='Tab'&&this.phase==='marking'){e.preventDefault();this.queue.push(()=>{const next=this.presets.find(p=>p.cm>this.bend.mark*100+.05)??this.presets[0];this.setMark(next.cm/100);});}
      if(this.phase==='review'&&['Equal','NumpadAdd','Minus','NumpadSubtract'].includes(e.code)){e.preventDefault();this.queue.push(()=>this.changeQuantity(['Equal','NumpadAdd'].includes(e.code)?1:-1));}
    },{capture:true});
    game.hud.shell.addEventListener('contextmenu',()=>{if(this.focused)this.queue.push(()=>this.pause());});
    game.player.lookHandler=(_dx,dy)=>{
      if(!this.focused)return false;
      if(this.phase.startsWith('fastener-'))return false;
      if(this.phase==='marking')this.setMark(this.bend.mark+dy*.0015);
      if(['fitting','cut'].includes(this.phase)&&dy!==0)this.setCut(this.cutS+dy*.0006);
      return true;
    };
    // Mouse adjustment while unlocked uses the same surface and never requests
    // OS pointer control in tests. Locked movement is routed by PlayerController.
    game.hud.shell.addEventListener('pointermove',e=>{
      if(!this.focused||document.pointerLockElement||e.pointerType!=='mouse'||(e.target as Element).closest('button,input,select'))return;
      game.player.look(e.movementX,e.movementY);
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
    const c=this.game.renderer.camera;c.updateMatrixWorld(true);this.ray.setFromCamera(new THREE.Vector2(),c);this.ray.far=2.5;
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
  private transition(phase:Phase):void{this.phase=phase;this.elapsed=0;this.message='';this.shapeKey='';if(phase!=='marking')this.markingActive=false;if(!['fitting','cutting','cut'].includes(phase)){this.supportS=null;this.cutterRetreat=0;}if(phase==='fastener-inserting'||phase==='fastener-tighten-ready')this.focusTyingWork();}
  private focusTyingWork():void{
    const pair=this.fastenerPairs[0];if(!pair)return;
    const p=pair.rebar.getWorldPosition(v()),c=this.game.renderer.camera;
    this.cameraDestination.set(p.x,Math.max(.34,p.y+.09),p.z+.40);this.cameraFocus.set(p.x,p.y+.055,p.z+.025);
    c.position.copy(this.cameraDestination);c.lookAt(this.cameraFocus);c.updateMatrixWorld(true);
    this.targetRotation.copy(c.quaternion);this.game.player.pitch=c.rotation.x;this.game.player.yaw=c.rotation.y;
  }
  private stockPoint(x:number,y:number,z:number):THREE.Vector3{return this.stock.markingPoint(this.activeBundle,x,y,z);}
  private selectBundle(index:number):void{
    if(index===this.activeBundle)return;
    this.bundleWork.set(this.activeBundle,{phase:this.phase,bend:this.bend,markingProgress:this.markingProgress,markingActive:this.markingActive,insertion:this.insertion,quantity:this.quantity,cutFrom:this.cutFrom,elapsed:this.elapsed});
    this.activeBundle=index;const work=this.bundleWork.get(index);
    this.transition(work?.phase??'sealed');this.bend=work?.bend??new PvcBend();this.markingProgress=work?.markingProgress??0;this.markingActive=work?.markingActive??false;this.insertion=work?.insertion??0;this.quantity=work?.quantity??1;this.cutFrom=work?.cutFrom??0;this.elapsed=work?.elapsed??0;
  }
  private bundlePhase(index:number):Phase{return index===this.activeBundle?this.phase:this.bundleWork.get(index)?.phase??'sealed';}
  private setStockCamera():void{
    this.cameraDestination.copy(this.stockPoint(2.20,.95,this.bend.mark-.35+.31));
    this.cameraFocus.copy(this.stockPoint(2.20,.025,this.bend.mark-.35+(innerWidth<700?.20:0)));
  }
  private setFocus(preserveInput=false):void{
    this.focused=true;this.game.mixing.setActive(false);this.game.mixing.releaseAutomaticStance();if(!preserveInput)this.game.input.resetTransientInput();
    const c=this.game.renderer.camera;
    if(this.target){
      if(this.phase.startsWith('fastener-'))this.setFastenerCamera();else this.setFitCamera();
    }else if(['marking','spreading'].includes(this.phase)){
      this.setStockCamera();
    }else{
      this.cameraDestination.copy(c.position);this.cameraDestination.y=1.65;
      this.cameraFocus.copy(this.cameraDestination).add(v(0,0,-2).applyAxisAngle(v(0,1,0),this.game.player.yaw));this.cameraFocus.y=.75;
    }
    const camera=new THREE.PerspectiveCamera();camera.position.copy(this.cameraDestination);camera.lookAt(this.cameraFocus);this.targetRotation.copy(camera.quaternion);
  }
  private setFitCamera():void{
    if(!this.target)return;const p=this.target.boxGroup.getWorldPosition(v());
    // Flush work keeps the original square, level box view. Free trimming
    // follows the cutter; floor work keeps the eye above the supporting hand.
    const cutY=this.bend.topHeight-this.bend.at(this.cutS).x,focusY=cutY+p.y-(this.entry()?.position.y??p.y-this.target.boxGroup.groupHeight/2);
    const distance=THREE.MathUtils.lerp(this.fitZoomed?.38:.50,.33,THREE.MathUtils.smoothstep(cutY,.45,.95));
    this.cameraDestination.set(p.x,Math.max(.30,focusY),p.z+distance);this.cameraFocus.set(p.x,focusY,p.z+.02);
    const camera=new THREE.PerspectiveCamera();camera.position.copy(this.cameraDestination);camera.lookAt(this.cameraFocus);this.targetRotation.copy(camera.quaternion);
  }
  private setFastenerCamera():void{
    const c=this.game.renderer.camera;this.cameraDestination.copy(c.position);this.cameraFocus.copy(c.position).add(c.getWorldDirection(v()));this.targetRotation.copy(c.quaternion);
  }
  pause():void{
    if(!this.focused)return;this.focused=false;this.pressHeld=this.toolbarHold=this.canvasHold=false;this.game.input.resetTransientInput();
    if(this.target&&['fitting','cut'].includes(this.phase)){this.target=null;this.transition('carrying');}
    this.message=this.instruction('Η εργασία κρατήθηκε. Στόχευσε τη μάτσα ή το κουτί και πάτησε E για συνέχεια.','Η εργασία κρατήθηκε. Στόχευσε τη μάτσα ή το κουτί και άγγιξε την οδηγία για συνέχεια.');
  }
  private stockTarget():StockTarget|null{
    const c=this.game.renderer.camera;c.updateMatrixWorld(true);const eye=c.getWorldPosition(v());
    this.stock.updateWorldMatrix(true,false);
    const now=performance.now(),key=[...c.matrixWorld.elements,...this.stock.matrixWorld.elements,this.phase,this.activeBundle,this.prepared.length,this.game.room.children.length,...this.stock.bundleRemaining,...this.stock.bundleSpread,...this.stock.bundleRoots.flatMap(root=>[root.visible,...root.position.toArray(),...root.quaternion.toArray(),...root.scale.toArray()]),...this.game.mixing.models.group.children.flatMap(root=>[root.visible,...root.position.toArray(),...root.quaternion.toArray()])].join(',');
    if(this.stockAimCache?.target&&this.stockAimCache.key===key&&now-this.stockAimCache.at<100&&!this.game.mixing.blocksWork)return this.stockAimCache.target;
    const remember=(target:StockTarget|null)=>{this.stockAimCache={key,at:now,target};return target;};
    // One coarse gate covers the standing bundles and laid rows, also after
    // editor transforms. Distant wall work never pays for pipe/room raycasts.
    if(this.stock.sitePoint(1.8,1.2,1.15).distanceTo(eye)>6*this.stock.getWorldScale(v()).length()/Math.sqrt(3))return remember(null);
    this.stock.updateMatrixWorld(true);this.preparedRoot.updateMatrixWorld(true);this.ray.setFromCamera(new THREE.Vector2(),c);this.ray.far=3;
    const visible=(object:THREE.Object3D)=>{for(let node:THREE.Object3D|null=object;node;node=node.parent)if(!node.visible)return false;return true;};
    const bundle=this.stock.bundleAt(c,3),preparedHit=this.ray.intersectObject(this.preparedRoot,true).find(h=>h.distance<3&&visible(h.object));
    const prepared=preparedHit?this.prepared.find(p=>p.mesh===preparedHit.object)??null:null;
    const preparedWins=prepared&&(!bundle||preparedHit!.distance<eye.distanceTo(bundle.point));
    const distance=preparedWins?preparedHit!.distance:bundle?eye.distanceTo(bundle.point):Infinity;
    if(!Number.isFinite(distance))return remember(null);
    this.ray.far=distance-.001;
    // Broad-phase each independent room/equipment root before detailed hits.
    // Unchanged roots reuse world bounds; editor translations invalidate them.
    const roots=[...this.game.room.children,...this.game.mixing.models.group.children].filter(root=>{
      if(!visible(root))return false;
      let bounds=this.occlusionBounds.get(root);
      if(!bounds||root.parent===this.game.mixing.models.group||!bounds.matrix.equals(root.matrixWorld)){
        // Some editor groups expose a semantic `geometry` descriptor. Bound
        // actual render meshes only, rather than treating that descriptor as
        // a Three.js BufferGeometry in Box3.setFromObject().
        const box=new THREE.Box3();root.traverse(object=>{
          if(!(object instanceof THREE.Mesh)||!object.geometry?.isBufferGeometry)return;
          if(object instanceof THREE.InstancedMesh){if(!object.boundingBox)object.computeBoundingBox();if(object.boundingBox)box.union(object.boundingBox.clone().applyMatrix4(object.matrixWorld));}
          else{if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();if(object.geometry.boundingBox)box.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));}
        });
        bounds={box,matrix:root.matrixWorld.clone()};this.occlusionBounds.set(root,bounds);
      }
      return bounds.box.containsPoint(eye)||Boolean(this.ray.ray.intersectBox(bounds.box,this.occlusionHit)&&eye.distanceTo(this.occlusionHit)<=this.ray.far);
    });
    const blocker=this.ray.intersectObjects(roots,true).find(h=>visible(h.object));if(blocker)return remember(null);
    return remember(preparedWins?{bundle:prepared.bundle,prepared}:bundle?{bundle:bundle.index,prepared:null}:null);
  }
  private stockAimed():boolean{return this.stockTarget()!==null;}
  private addPreparedHighlight(pipe:StockPipe):void{
    const geometry=pipe.mesh.geometry.clone();geometry.scale(1.035,1.035,1.035);
    const shell=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0xffd43b,side:THREE.BackSide,depthTest:true,depthWrite:false,transparent:true,opacity:.94,toneMapped:false}));
    shell.name='Prepared PVC interaction highlight';shell.renderOrder=20;shell.raycast=()=>{};pipe.mesh.add(shell);pipe.highlight=shell;
  }
  private takePrepared(pipe:StockPipe):void{
    this.selectBundle(pipe.originBundle);this.prepared.splice(this.prepared.indexOf(pipe),1);this.carried=pipe;pipe.mesh.removeFromParent();
    if(pipe.highlight)pipe.highlight.visible=false;
    this.bend=PvcBend.from(pipe.recipe);this.cutFrom=pipe.cutFrom;this.transition('carrying');
  }
  private fastenerPrepTarget():InstallationPoint|null{
    if(this.focused||this.game.selectedTool!=='drill')return null;
    const camera=this.game.renderer.camera,origin=camera.getWorldPosition(v()),direction=camera.getWorldDirection(v());if(direction.z>=-.01)return null;
    const eligible=(point:InstallationPoint|null):point is InstallationPoint=>Boolean(point&&point.boxGroup.visible&&(!point.conduit&&point.stage==='leveled'||point===this.target&&point.conduit&&point.stage==='conduit'&&this.phase.startsWith('fastener-'))&&!this.stagedFasteners.has(point)&&this.game.mortar.ready(point)&&(!point.boxGroup.userData.placement||point.boxGroup.userData.placement.secured));
    const surface=this.game.room.brickWall.volume.raycast(origin,direction,1.8);
    for(const point of this.game.mission.points){
      if(!eligible(point))continue;
      const p=point.boxGroup.getWorldPosition(v()),bottom=p.y-point.boxGroup.groupHeight/2;
      if(surface&&Math.abs(surface.point.x-p.x)<=.105&&surface.point.y>=.075&&surface.point.y<=Math.max(.13,bottom-.035))return point;
    }
    const near=this.game.boxPlacement.targetNear(camera,1.6,.34,.34);return eligible(near)?near:null;
  }
  get fastenerPrepAvailable():boolean{return Boolean(this.fastenerPrepTarget());}
  private startIndependentFastening(point:InstallationPoint):void{
    if(point===this.target&&this.phase.startsWith('fastener-')){this.setFocus();return;}
    this.target=point;this.fastenerHoles=[];this.fastenerPairs=[];this.fastenerIndex=0;this.fastenerProgress=0;this.fastenerAim={x:-.72,y:.72};
    this.fastenerDirectIndex=null;this.fastenerReturnPhase=['sealed','loose','batch'].includes(this.phase)?this.phase:'batch';this.transition('fastener-marking');this.setFocus();this.message=this.instruction('Στόχευσε το τούβλο δίπλα στη σωλήνα · LMB: τρύπησε.','Στόχευσε με το δεξί joystick · πάτησε το κέντρο για οπή.');
  }
  handleInput(dt:number,action:boolean,interaction:boolean):boolean{
    this.offcutMotion.update(dt);
    if(!this.game.started)return false;
    if(this.apprenticeLease&&!this.focused)return false;
    if(action||interaction||this.queue.length)this.stockAimCache=null;
    for(const command of this.queue.splice(0))command();
    const wasBlocking=this.blocksWork;
    let startedFasteners=false;
    if(action&&!this.focused&&this.game.selectedTool==='drill'){
      const point=this.fastenerPrepTarget();if(point){this.startIndependentFastening(point);if(!interaction&&this.phase==='fastener-marking')this.drillFastenerAtAim();action=false;startedFasteners=true;}
    }
    if(interaction&&(wasBlocking||this.stockAimed()||this.target&&this.game.boxPlacement.target(this.game.renderer.camera)===this.target)){this.interact();action=false;interaction=false;}
    // A short mobile AIM tap supplies the ordinary primary action.
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
    // tapped AIM toggle and supplies duration-based bending.
    this.pressHeld=this.focused&&(this.toolbarHold||this.canvasHold||this.touch&&this.game.input.actionHeld);
    if(this.focused){
      if(['fitting','cutting','cut'].includes(this.phase)){
        // Up raises the support toward the free end; down follows the pipe
        // through its radius. This focused action never moves the player.
        const input=this.game.input,move=this.touch?input.mobileMove.y:Number(input.pressed('KeyS'))-Number(input.pressed('KeyW'));
        const old=this.supportS??this.initialSupportS(),next=THREE.MathUtils.clamp(old+move*.24*dt,Math.min(this.cutLimit(),this.cutFrom+.025),this.cutLimit());
        // During a cut the loaded support stops before the blade. During
        // adjustment the shears pull aside so the hand can pass either side.
        this.supportS=this.phase==='cutting'&&Math.abs(this.supportPlaneGap(next))<.115?old:next;
        const gap=Math.abs(this.supportPlaneGap(this.supportS)),approaching=gap<Math.abs(this.supportPlaneGap(old))-.00001;
        const retreat=this.phase!=='cutting'&&(gap<.105||approaching&&gap<.145)?1:0;
        this.cutterRetreat=THREE.MathUtils.damp(this.cutterRetreat,retreat,25,dt);
        if(retreat===0&&this.cutterRetreat<.004)this.cutterRetreat=0;
        if(this.cutterReady&&this.message==='Μετακίνησε το αριστερό χέρι πιο μακριά από τον κόφτη.')this.message='';
      }
      const c=this.game.renderer.camera,t=1-Math.exp(-8*dt);if(this.phase.startsWith('fastener-'))this.game.player.updateLook(dt);else{c.position.lerp(this.cameraDestination,t);c.quaternion.slerp(this.targetRotation,t);}
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
    return wasBlocking||this.blocksWork||startedFasteners;
  }
  private command(command:string):void{
    if(command==='save'){this.savePreset();return;}
    if(command==='transparent'){this.toggleTransparent();return;}
    if(this.phase==='review'&&['qty-less','qty-more'].includes(command)){this.changeQuantity(command==='qty-more'?1:-1);return;}
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
    this.setStockCamera();
    const camera=new THREE.PerspectiveCamera();camera.position.copy(this.cameraDestination);camera.lookAt(this.cameraFocus);this.targetRotation.copy(camera.quaternion);
  }
  private setCut(value:number):void{
    if(!['fitting','cut'].includes(this.phase)||!Number.isFinite(value))return;
    let next=THREE.MathUtils.clamp(value,this.cutFrom,this.cutLimit());
    const support=this.supportS??this.initialSupportS(),before=this.supportPlaneGap(support),after=this.supportPlaneGap(support,next);
    // The only occupied band is the independently positioned support hand.
    // Stop before its blade plane; moving W/S can free either side again.
    if(Math.abs(before)>=.105&&(Math.abs(after)<.105||before*after<=0)){
      let low=0,high=1;for(let i=0;i<24;i++){const t=(low+high)/2,gap=this.supportPlaneGap(support,THREE.MathUtils.lerp(this.cutS,next,t));if(Math.abs(gap)<.105||before*gap<=0)high=t;else low=t;}
      next=THREE.MathUtils.lerp(this.cutS,next,low);
    }
    if(this.phase==='cut'&&next>this.cutFrom+.001)this.transition('fitting');
    this.cutS=next;this.cutSnapped=false;this.message='';this.setFitCamera();
  }
  private cutLimit():number{
    // The whole upright piece, including the curve, can be trimmed after
    // spring extraction. Leave a real retained piece at the floor tail.
    return Math.max(this.cutFrom,Math.min(PVC.length-.002,this.bend.mark+PVC.springLength/2-.002));
  }
  private entries():BoxConduitEntry[]{return this.target?.boxGroup.getBottomConduitEntries()??[];}
  private entry():BoxConduitEntry|null{return this.entries()[this.entryIndex]??null;}
  private selectEntry(direction:number):void{
    if(!this.target||!['fitting','cut'].includes(this.phase))return;
    this.entryIndex=THREE.MathUtils.clamp(this.entryIndex+direction,0,this.entries().length-1);
    if(this.cutSnapped){this.cutSnapped=false;this.snapCutFlush();}
  }
  private flushCut():number|null{
    const entry=this.entry();if(!entry)return null;
    const desiredX=this.bend.topHeight-entry.position.y;
    if(desiredX<this.bend.at(this.cutFrom).x-.00001||desiredX>this.bend.at(this.cutLimit()).x+.00001)return null;
    let low=this.cutFrom,high=this.cutLimit();
    for(let i=0;i<30;i++){const mid=(low+high)/2;if(this.bend.at(mid).x<desiredX)low=mid;else high=mid;}
    return(low+high)/2;
  }
  private snapCutFlush():void{
    if(!this.target||!['fitting','cut'].includes(this.phase))return;
    const cut=this.flushCut();
    if(cut===null){this.message='Η κομμένη σωλήνα δεν φτάνει στο κάτω χείλος του κουτιού.';return;}
    if(this.phase==='cut'&&cut>this.cutFrom+.001)this.transition('fitting');
    this.cutS=cut;this.cutSnapped=true;this.setFitCamera();this.message='ΠΡΟΣΩΠΟ · ελεύθερη μετακίνηση για άλλο ύψος.';
  }
  private supportPlaneGap(s:number,cutS=this.cutS):number{
    const hand=this.bend.at(s),cut=this.bend.at(cutS);
    return (hand.x-cut.x)*Math.cos(cut.angle)+(hand.y-cut.y)*Math.sin(cut.angle);
  }
  private initialSupportS():number{
    const max=this.bend.mark+.04;let s=Math.max(this.cutFrom+.025,this.bend.mark-PVC.springLength/2-.025);
    while(s<max&&this.supportPlaneGap(s)<.125)s=Math.min(max,s+.005);
    return s;
  }
  private get cutterReady():boolean{
    return Math.abs(this.supportPlaneGap(this.supportS??this.initialSupportS()))>=.105&&this.cutterRetreat===0;
  }
  private use():void{
    if(!this.focused)return;
    if(this.phase==='fastener-marking'){this.drillFastenerAtAim();return;}
    if(this.phase==='fastener-insert-ready'){
      const cursor=this.fastenerCursorPoint();
      if(cursor&&!this.fastenerHoles.some(h=>Math.hypot(h.marker.position.x-cursor.point.x,h.y-cursor.point.y)<.035)){this.drillFastenerAtAim();return;}
      this.fastenerIndex=0;this.fastenerProgress=0;this.transition('fastener-inserting');return;
    }
    if(this.phase==='pipe-install-ready'){if(!this.installClear()){this.message='Η σωλήνα δεν περνά ελεύθερα στο κανάλι. Διόρθωσε πρώτα το άνοιγμα.';return;}this.transition('installing');return;}
    if(this.phase==='fastener-tighten-ready'){this.fastenerIndex=0;this.fastenerProgress=0;this.transition('fastener-tightening');return;}
    if(this.touch&&['review','cut'].includes(this.phase)){this.interact();return;}
    if(this.phase==='spring')this.transition('inserting');
    if(this.touch&&this.phase==='bending'&&this.bend.ready){this.transition('review');return;}
    if(this.phase==='fitting'){
      if(this.cutS<=this.cutFrom+.001){this.message='Μετακίνησε το cutter στο σημείο που θέλεις να κόψεις.';return;}
      if(!this.cutterReady){this.message='Μετακίνησε το αριστερό χέρι πιο μακριά από τον κόφτη.';return;}
      this.transition('cutting');this.game.audio.play('cutter');
    }
  }
  private interact():void{
    if(!this.game.started)return;
    const stockTarget=this.stockTarget();
    if(!this.focused&&this.phase!=='carrying'&&stockTarget){
      if(stockTarget.prepared){this.takePrepared(stockTarget.prepared);return;}
      this.selectBundle(stockTarget.bundle);
    }
    if(!this.blocksWork&&workPhases.includes(this.phase)){
      if(!this.stockAimed()&&!(this.target&&this.game.boxPlacement.target(this.game.renderer.camera)===this.target))return;
      this.setFocus();return;
    }
    if(this.phase==='fastener-marking'){this.use();return;}
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
      const prepared=this.prepared.find(p=>p.bundle===this.activeBundle);if(prepared){this.takePrepared(prepared);return;}
      if(this.rawCount){this.bend=new PvcBend();this.markingProgress=0;this.transition('marking');this.setFocus();}return;
    }
    if(this.phase==='carrying'){
      if(stockTarget){
        if(this.carried){const pipe=this.carried;pipe.bundle=stockTarget.bundle;this.prepared.unshift(pipe);this.preparedRoot.add(pipe.mesh);if(pipe.highlight){pipe.highlight.geometry.dispose();pipe.highlight.geometry=pipe.mesh.geometry.clone();pipe.highlight.geometry.scale(1.035,1.035,1.035);pipe.highlight.visible=true;}this.carried=null;this.arrangePrepared();}
        this.transition('batch');return;
      }
      const p=this.game.boxPlacement.targetNear(this.game.renderer.camera);
      if(!p){this.message=this.instruction('Στόχευσε το κουτί όπου θα εφαρμόσεις τη σωλήνα.','Βρες το κουτί με το πορτοκαλί περίγραμμα και φέρε το στο κέντρο.');return;}
      if(p.conduit||p.stage==='complete'){this.message='Αυτό το κουτί έχει ήδη σωλήνα.';return;}
      if(!['leveled','conduit'].includes(p.stage)||!this.game.mortar.ready(p)||p.boxGroup.userData.placement&&!p.boxGroup.userData.placement.secured){this.message='Στερέωσε και αλφάδιασε το κουτί πριν εφαρμόσεις PVC.';return;}
      const pos=p.boxGroup.getWorldPosition(v());
      if(pos.distanceTo(this.game.renderer.camera.position)>1.6){this.message='Πλησίασε το κουτί για εργασία με τα χέρια.';return;}
      if(this.bend.topHeight-this.cutFrom<pos.y-p.boxGroup.groupHeight/2+.01){this.message='Η μικρή πλευρά δεν φτάνει στην είσοδο. Επίστρεψέ τη και ετοίμασε ψηλότερο σημάδι.';return;}
      this.target=p;
      const entries=this.entries();
      if(!entries.length){this.target=null;this.message='Αυτός ο προσανατολισμός δεν έχει διαθέσιμη κάτω είσοδο.';return;}
      const camera=this.game.renderer.camera;this.ray.setFromCamera(new THREE.Vector2(),camera);
      this.entryIndex=entries.reduce((best,entry,i)=>this.ray.ray.distanceSqToPoint(entry.position)<this.ray.ray.distanceSqToPoint(entries[best].position)?i:best,0);
      // Near-box assistance may aim outside the casing entirely. Use a real
      // central port then; an actual aimed entrance still takes priority.
      if(this.ray.ray.distanceSqToPoint(entries[this.entryIndex].position)>.025**2)this.entryIndex=entries.reduce((best,entry,i)=>Math.abs(entry.position.x-pos.x)<Math.abs(entries[best].position.x-pos.x)?i:best,0);
      this.cutS=this.cutFrom;this.cutSnapped=false;
      this.fitZoomed=false;this.transition('fitting');this.snapCutFlush();this.setFocus();return;
    }
    if(this.phase==='fitting'){this.message=this.instruction('Mouse πάνω/κάτω για μήκος, αριστερό click για πραγματική κοπή.','Σύρε πάνω/κάτω για μήκος και κράτα ΚΟΨΕ για πραγματική κοπή.');return;}
    if(this.phase==='cut'){
      const error=this.fitError();
      // Free cutting is independent of seating. The lower casing lip is the
      // flush reference; a little extra length can still enter the enclosure.
      if(error>BOX_ENTRY_ALLOWANCE_MM){this.transition('fitting');this.message=`Περισσεύουν ${Math.round(error)} mm. Κόψε λίγο ακόμη· έως ${BOX_ENTRY_ALLOWANCE_MM} mm μπαίνουν μέσα στο κουτί.`;return;}
      if(error< -SHORT_PIPE_TOLERANCE_MM){this.message=this.instruction('Κόπηκε κοντή και δεν φτάνει στο κουτί. ESC, μετά επιστροφή στη μάτσα με E.','Κόπηκε κοντή και δεν φτάνει στο κουτί. ΠΙΣΩ, μετά στόχευσε τη μάτσα για επιστροφή.');return;}
      if(!this.installClear()){this.message=this.instruction('Η σωλήνα ακουμπά τούβλο ή δεν κάθεται στο δάπεδο. ESC για διόρθωση του καναλιού.','Η σωλήνα ακουμπά τούβλο ή δεν κάθεται στο δάπεδο. ΠΙΣΩ για διόρθωση του καναλιού.');return;}
      const staged=this.stagedFasteners.get(this.target!);
      if(staged){
        const entry=this.entry()!;
        if(staged.pairs.some(pair=>entry.position.x<pair.left.marker.position.x+.017||entry.position.x>pair.right.marker.position.x-.017)){this.message='Η είσοδος είναι έξω από τα έτοιμα σύρματα. Επίλεξε άλλη κάτω είσοδο ή ετοίμασε νέο ζεύγος.';return;}
        this.fastenerHoles=staged.holes;this.fastenerPairs=staged.pairs;
        for(const pair of this.fastenerPairs){
          const old=pair.rebar;pair.rebar=this.fastenerWire(pair.left.marker.position,pair.right.marker.position);pair.rebar.visible=old.visible;pair.rebar.scale.copy(old.scale);
          this.securingRoot.add(pair.rebar);old.removeFromParent();old.traverse(object=>{if(object instanceof THREE.Mesh){object.geometry.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose();}});
        }
        this.fastenerIndex=0;this.fastenerProgress=0;this.transition('pipe-install-ready');this.setFastenerCamera();this.message='Τα ανοικτά σύρματα είναι έτοιμα. USE: εφάρμοσε τη σωλήνα.';return;
      }
      const area=this.fastenerArea();
      if(!area||Math.min(area.outerLeft,area.outerRight)<area.innerX){this.message='Δεν χωρά ζεύγος στερέωσης γύρω από αυτή την είσοδο μέσα στο κανάλι. Επίλεξε άλλη κάτω είσοδο με τα βέλη.';return;}
      // Fit the actual pipe before drilling and feeding the tying wire.
      this.fastenerHoles=[];this.fastenerPairs=[];this.fastenerIndex=0;this.fastenerProgress=0;this.fastenerAim={x:-.72,y:.72};
      this.transition('installing');return;
    }
  }
  private animate(dt:number):void{
    this.elapsed+=dt;
    if(this.phase==='opening'){
      this.stock.bundleStraps(this.activeBundle).forEach((s,i)=>s.visible=this.elapsed<(i+1)*.65);
      if(this.elapsed>1.95){this.stock.bundleOpened[this.activeBundle]=true;this.transition('loose');this.focused=false;this.game.audio.play('cutter');}
    }else if(this.phase==='spreading'){
      this.stock.layout(THREE.MathUtils.smoothstep(this.elapsed,0,1.6),this.activeBundle);
      if(this.elapsed>=1.6){this.stock.layout(1,this.activeBundle);this.transition('marking');this.setFocus();}
    }else if(this.phase==='inserting'){
      this.insertion=Math.min(1,this.elapsed/1.6);
      if(this.insertion===1){this.transition('bending');this.game.audio.play('spring');}
    }else if(this.phase==='extracting'){
      this.insertion=1-Math.min(1,this.elapsed/1.5);
      if(this.insertion===0){
        const count=Math.min(this.rawCount,Math.max(1,this.quantity));
        for(let i=0;i<count;i++){const mesh=new PvcTube(pvcStockMaterial);mesh.update(this.bend);const pipe:StockPipe={recipe:this.bend.recipe(),mesh,cutFrom:0,bundle:this.activeBundle,originBundle:this.activeBundle};this.addPreparedHighlight(pipe);this.prepared.push(pipe);this.preparedRoot.add(mesh);}
        this.rawCount-=count;
        // Production completes in the player's hand. One bent pipe continues
        // directly to installation; only the remainder is laid on the stack.
        this.carried=this.prepared.shift()??null;
        if(this.carried){this.carried.mesh.removeFromParent();if(this.carried.highlight)this.carried.highlight.visible=false;this.bend=PvcBend.from(this.carried.recipe);this.cutFrom=this.carried.cutFrom;}
        this.arrangePrepared();this.focused=false;this.transition(this.carried?'carrying':'batch');
      }
    }else if(this.phase==='cutting'&&this.elapsed>=.45){
      const offcut=new PvcTube(pvcStockMaterial);offcut.update(this.bend,this.cutFrom,this.cutS);this.orientAtBox(offcut,.07);
      this.offcutMotion.release(offcut);this.game.renderer.scene.add(offcut);this.offcuts.push(offcut);
      this.cutFrom=this.cutS;this.cutErrorMm=this.fitError();this.transition('cut');
      if(this.carried){this.carried.cutFrom=this.cutFrom;this.carried.mesh.update(this.bend,this.cutFrom);}
    }else if(this.phase==='installing'&&this.elapsed>=.6){
      if(!this.installClear()){this.transition('cut');this.message='Η θέση άλλαξε. Έλεγξε ξανά τη στήριξη και το κανάλι.';return;}
      const installed=new THREE.Group(),mesh=new PvcTube();mesh.update(this.bend,this.cutFrom);installed.add(mesh);this.orientAtBox(installed,0);
      installed.name=`Hand-formed PVC · ${this.target!.definition.id}`;installed.userData.studioEntityId=`point-${this.target!.definition.id}:rigid-pvc`;installed.userData.pvcRecipe={...this.bend.recipe(),cutFrom:this.cutFrom,entryIndex:this.entryIndex};
      installed.userData.fittedBeforeFasteners=this.fastenerPairs.length===0;
      this.game.renderer.scene.add(installed);this.target!.conduit=installed;this.target!.pipeStep='install';this.target!.setStage('conduit');
      if(this.fastenerPairs.length){this.transition('fastener-tighten-ready');this.message='Η σωλήνα μπήκε μέσα στα ανοικτά rebar. USE: σφίξε τα ένα-ένα.';}
      else{this.transition('fastener-marking');this.message=this.instruction('Η σωλήνα εφαρμόστηκε · στόχευσε το τούβλο και πάτησε LMB για οπή.','Η σωλήνα εφαρμόστηκε · στόχευσε και πάτησε το κέντρο του δεξιού joystick για οπή.');}
      this.setFastenerCamera();this.game.audio.play('box');
    }else if(this.phase==='fastener-drilling'){
      const duration=.85,single=this.fastenerDirectIndex,count=single===null?this.fastenerHoles.length:1,completed=Math.min(count,Math.floor(this.elapsed/duration)),index=single??Math.min(this.fastenerHoles.length-1,completed);this.fastenerIndex=index;this.fastenerProgress=THREE.MathUtils.clamp((this.elapsed-completed*duration)/duration,0,1);
      this.drill.getObjectByName('reference-motor')!.rotation.z=this.elapsed*26;
      for(let drilled=0;drilled<completed;drilled++)if(!this.fastenerHoles[single??drilled].drilled){
        const hole=this.fastenerHoles[single??drilled];hole.drilled=true;const point=hole.marker.position,depthEnd=point.z-.045;
        this.game.room.brickWall.volume.carveBox({x:point.x-.006,y:point.y-.006,z:depthEnd},{x:point.x+.006,y:point.y+.006,z:point.z});
        const centre=hole.marker.getObjectByName('Drilled hole opening') as THREE.Mesh;(centre.material as THREE.MeshBasicMaterial).dispose();centre.material=new THREE.MeshStandardMaterial({color:0x171819,roughness:1});centre.name='Drilled 12 mm masonry hole';centre.visible=true;
      }
      if(this.elapsed>=count*duration){
        this.fastenerDirectIndex=null;this.fastenerIndex=0;this.fastenerProgress=0;
        const ready=this.fastenerPairs.length>0&&this.fastenerPairs.length*2===this.fastenerHoles.length&&this.fastenerHoles.every(h=>h.drilled);
        this.transition(ready?'fastener-insert-ready':'fastener-marking');
        this.message=ready?this.instruction('LMB στην οπή: πέρασε το σύρμα · για άλλη οπή στόχευσε νέο σημείο.','Κέντρο δεξιού joystick στην οπή: πέρασε σύρμα · στόχευσε νέο σημείο για άλλη οπή.'):this.instruction('Η οπή άνοιξε · στόχευσε απέναντι και πάτησε LMB.','Η οπή άνοιξε · στόχευσε απέναντι και πάτησε το κέντρο του δεξιού joystick.');
      }
    }else if(this.phase==='fastener-inserting'){
      const duration=1.05,index=Math.min(this.fastenerPairs.length-1,Math.floor(this.elapsed/duration));this.fastenerIndex=index;this.fastenerProgress=THREE.MathUtils.clamp((this.elapsed-index*duration)/duration,0,1);
      const pair=this.fastenerPairs[index];pair.rebar.visible=true;pair.rebar.scale.x=THREE.MathUtils.smoothstep(this.fastenerProgress,0,1);
      if(this.elapsed>=this.fastenerPairs.length*duration){
        this.fastenerPairs.forEach(p=>p.rebar.scale.x=1);this.fastenerIndex=0;this.fastenerProgress=0;
        if(this.target?.conduit){this.transition('fastener-tighten-ready');this.message='Τα σύρματα πέρασαν γύρω από τη σωλήνα. USE: σφίξε τα ένα-ένα.';}
        else if(!this.carried){const point=this.target!;this.stagedFasteners.set(point,{holes:this.fastenerHoles,pairs:this.fastenerPairs});point.userData.pvcFasteners={holeCount:this.fastenerHoles.length,pairCount:this.fastenerPairs.length,drillBitMm:12,sequence:'marked-drilled-open-wire'};this.target=null;this.focused=false;this.transition(this.fastenerReturnPhase);this.game.hud.notify('Τα ανοικτά σύρματα έμειναν στο chase. Ετοίμασε και φέρε τη σωλήνα.',true,2200);}
        else{this.transition('pipe-install-ready');this.message='Τα σύρματα μπήκαν στις οπές και μένουν ανοικτά. USE: εφάρμοσε τώρα τη σωλήνα.';}
      }
    }else if(this.phase==='fastener-tightening'){
      const duration=1.15,index=Math.min(this.fastenerPairs.length-1,Math.floor(this.elapsed/duration));this.fastenerIndex=index;this.fastenerProgress=THREE.MathUtils.clamp((this.elapsed-index*duration)/duration,0,1);
      for(let i=0;i<index;i++)setTieWireProgress(this.fastenerPairs[i].rebar,1);
      setTieWireProgress(this.fastenerPairs[index].rebar,this.fastenerProgress);
      if(this.elapsed>=this.fastenerPairs.length*duration)this.finishFasteners();
    }
  }
  private arrangePrepared():void{
    const counts=Array<number>(this.stock.bundleRoots.length).fill(0);
    this.prepared.forEach(p=>{const i=counts[p.bundle]++;p.mesh.position.set(2.65+i*.03-p.bundle*.58,.026,-.35);p.mesh.rotation.set(Math.PI/2,0,Math.PI/2);});
  }
  private fitError():number{
    return this.fitErrorAt(this.cutFrom);
  }
  private fitErrorAt(cut:number):number{
    const entry=this.entry();return entry?(this.bend.topHeight-this.bend.at(cut).x-entry.position.y)*1000:0;
  }
  private fastenerArea():{centreX:number;innerX:number;outerLeft:number;outerRight:number;minY:number;maxY:number;z:number}|null{
    if(!this.target)return null;const p=this.target.boxGroup.getWorldPosition(v()),entry=this.carried?this.entry():null,bottom=entry?.position.y??p.y-this.target.boxGroup.groupHeight/2,centreX=entry?.position.x??p.x;
    // Free aiming is confined to the exposed brick inside the 200 mm chased
    // channel. The centre gap excludes the conduit; nothing can be marked on
    // the untouched wall outside the chase.
    return{centreX,innerX:this.carried ? .018 : .030,outerLeft:Math.min(.086,.100+centreX-p.x),outerRight:Math.min(.086,.100+p.x-centreX),minY:.09,maxY:Math.max(.13,bottom-.065),z:p.z-.030};
  }
  private fastenerCursorPoint():{side:-1|1;point:THREE.Vector3}|null{
    const area=this.fastenerArea();if(!area)return null;
    const c=this.game.renderer.camera;c.updateMatrixWorld(true);const origin=c.getWorldPosition(v()),direction=c.getWorldDirection(v());if(direction.z>=-.01)return null;
    const hit=this.game.room.brickWall.volume.raycast(origin,direction,1.8);if(!hit)return null;
    const point=v(hit.point.x,hit.point.y,hit.point.z),offset=point.x-area.centreX;
    if(Math.abs(offset)<area.innerX||Math.abs(offset)>(offset<0?area.outerLeft:area.outerRight)||point.y<area.minY||point.y>area.maxY)return null;
    return{side:offset<0?-1:1,point};
  }
  private markerAt(point:THREE.Vector3,side:-1|1):THREE.Group{
    const marker=new THREE.Group();marker.position.copy(point);marker.name=`Marked ${side<0?'left':'right'} 12 mm rebar hole`;
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.009,.0018,5,24),new THREE.MeshStandardMaterial({color:0xd3322d,roughness:.7,emissive:0x390000}));marker.add(ring);
    const centre=new THREE.Mesh(new THREE.CircleGeometry(.006,16),new THREE.MeshBasicMaterial({color:0x5c1714,side:THREE.DoubleSide}));centre.name='Drilled hole opening';marker.add(centre);ring.visible=centre.visible=false;this.securingRoot.add(marker);return marker;
  }
  private fastenerWire(left:THREE.Vector3,right:THREE.Vector3):THREE.Group{
    const area=this.fastenerArea()!,entry=this.carried?this.entry():null;
    const anchorZ=(left.z+right.z)/2;
    return buildRebarHug(left,right,Math.max(anchorZ+.07,(entry?.position.z??area.z)+.05),entry?.position.x??area.centreX,entry?entry.position.z+PVC.diameter/2+.0008:undefined);
  }
  private markFastenerHole():void{
    const cursor=this.fastenerCursorPoint();if(!cursor)return;
    const sameSide=this.fastenerHoles.filter(h=>h.side===cursor.side),otherSide=this.fastenerHoles.filter(h=>h.side!==cursor.side);
    if(sameSide.some(h=>Math.hypot(h.marker.position.x-cursor.point.x,h.y-cursor.point.y)<.035)){this.message='Στόχευσε άλλο σημείο του τούβλου, πιο μακριά από την προηγούμενη οπή.';return;}
    // Each strap still needs one endpoint on either side, but both coordinates
    // are now selected by the player instead of being snapped to fixed slots.
    if(sameSide.length>otherSide.length){this.message='Τρύπησε τώρα την απέναντι πλευρά.';return;}
    const hole:FastenerHole={side:cursor.side,y:cursor.point.y,marker:this.markerAt(cursor.point,cursor.side),drilled:false,paired:false};this.fastenerHoles.push(hole);
    const mate=otherSide.find(h=>!h.paired);
    if(mate){hole.paired=mate.paired=true;const left=hole.side<0?hole:mate,right=hole.side>0?hole:mate;const rebar=this.fastenerWire(left.marker.position,right.marker.position);rebar.visible=false;this.securingRoot.add(rebar);this.fastenerPairs.push({left,right,rebar});this.fastenerAim.y=THREE.MathUtils.clamp(this.fastenerAim.y-.34,0,1);}
    this.fastenerAim.x=cursor.side<0?.72:-.72;
  }
  private startFastenerDrilling():void{
    if(this.phase!=='fastener-marking'||this.fastenerPairs.length<1||this.fastenerPairs.length*2!==this.fastenerHoles.length)return;
    this.fastenerDirectIndex=null;this.fastenerIndex=0;this.fastenerProgress=0;this.transition('fastener-drilling');this.message='Τρύπημα 12 mm · μία οπή τη φορά.';
  }
  private drillFastenerAtAim():void{
    const cursor=this.fastenerCursorPoint();if(!cursor){this.message='Στόχευσε το τούβλο μέσα στο κανάλι, δίπλα στη σωλήνα.';return;}
    let index=this.fastenerHoles.findIndex(h=>Math.hypot(h.marker.position.x-cursor.point.x,h.y-cursor.point.y)<.035);
    if(index>=0&&this.fastenerHoles[index].drilled){this.message='Η οπή είναι ήδη ανοικτή · στόχευσε άλλο σημείο στην απέναντι πλευρά.';return;}
    if(index<0){const count=this.fastenerHoles.length;this.markFastenerHole();if(this.fastenerHoles.length===count)return;index=count;}
    this.fastenerDirectIndex=this.fastenerIndex=index;this.fastenerProgress=0;this.transition('fastener-drilling');this.message='Τρύπημα 12 mm στο σημείο στόχευσης.';
  }
  private finishFasteners():void{
    this.fastenerPairs.forEach(pair=>setTieWireProgress(pair.rebar,1));
    if(!this.target)return;this.target.pipeStep='done';this.target.setStage('complete');this.target.userData.pvcFasteners={holeCount:this.fastenerHoles.length,pairCount:this.fastenerPairs.length,drillBitMm:12,sequence:this.target.conduit?.userData.fittedBeforeFasteners?'pipe-inserted-marked-drilled-wire-threaded-twisted':'marked-drilled-open-wire-pipe-inserted-twisted'};
    this.stagedFasteners.delete(this.target);this.installedCount++;if(this.carried){this.installedByBundle[this.carried.originBundle]++;this.carried.highlight?.geometry.dispose();(this.carried.highlight?.material as THREE.Material|undefined)?.dispose();this.carried.mesh.geometry.dispose();}this.carried=null;this.target=null;this.focused=false;this.transition('batch');this.game.audio.play('box');
  }
  private boxBottomHeight():number|null{
    if(!this.target)return null;const p=this.target.boxGroup.getWorldPosition(v());return Math.max(0,p.y-this.target.boxGroup.groupHeight/2);
  }
  private orientAtBox(object:THREE.Object3D,gap:number):void{
    const p=this.entry()?.position??this.target!.boxGroup.getWorldPosition(v());
    // Material +X points down the wall; the bent +Y tail points into the room.
    object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(v(0,-1,0),v(0,0,1),v(-1,0,0)));
    object.position.set(p.x,this.bend.topHeight,p.z+gap);
  }
  private installClear():boolean{
    if(!this.target||!this.game.mortar.ready(this.target)||!['leveled','conduit'].includes(this.target.stage))return false;
    const p=this.entry()?.position;if(!p)return false;
    const end=this.bend.at(PVC.length),endY=this.bend.topHeight-end.x;
    if(endY<.01||endY>.10)return false;
    for(let s=this.cutFrom+.025;s<PVC.length;s+=.012){
      const a=this.bend.at(s),w=v(p.x,this.bend.topHeight-a.x,p.z+a.y);
      if(w.y<.01||Math.abs(w.x)>3.55||w.z>3.25)return false;
      if(!this.game.room.brickWall.volume.cavityBox({x:w.x-.01,y:w.y-.006,z:w.z-.01},{x:w.x+.01,y:w.y+.006,z:w.z+.01}).clear)return false;
    }
    return true;
  }
  present():void{
    const active=this.blocksWork;
    if(!active)this.bendHighlight.visible=false;
    this.work.visible=active&&this.phase!=='spreading';
    this.arms.forEach(a=>{a.group.visible=a.hand.visible=this.work.visible;});
    this.stock.markAt(this.bend.mark,this.markingProgress,this.activeBundle);
    this.stock.straightedge.visible=this.focused&&this.phase==='marking';
    this.stock.liveMarks.visible=this.stock.straightedge.visible&&this.markingProgress<1;
    this.previewRoot.visible=this.focused&&Boolean(this.target);
    const cursor=this.fastenerCursorPoint();this.securingCursor.visible=false;
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
    const cutting=this.cutter.visible&&this.work.visible;
    return this.arms.map(arm=>{
      const cutter=cutting&&arm.side>0;
      const pliers=this.rebarPliers.visible&&arm.side>0;
      const releasedWire=arm.side<0&&['fastener-tighten-ready','fastener-tightening'].includes(this.phase);
      return {...workerGripTarget(arm,this.work.visible&&!releasedWire&&this.phase!=='fastener-marking'&&(this.phase!=='carrying'||arm.side>0)),section:(cutter?[.020,.014]:pliers?this.rebarPliers.userData.gripSection:this.phase.startsWith('fastener-')?(arm.side<0?[.003,.003]:[.011,.011]):[.01,.01]) as [number,number],shape:cutter||pliers?'box' as const:'round' as const,contactLocked:true,surfaceContact:true,cutter:cutter?this.cutter:undefined,thumbWrap:this.phase==='carrying',firstPersonClearance:this.phase==='carrying'?.28:cutting?.20:this.rebarPliers.visible?.10:clearFirstPerson?.42:undefined};
    });
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
    this.bendHighlight.update(this.bend,this.focused&&['spring','inserting','bending','review'].includes(this.phase),this.phase==='bending');
    if(this.phase==='spring'||this.phase==='inserting')this.pipe.position.x=THREE.MathUtils.lerp(-.08,-mark.x,this.insertion);
    // A carried pipe is held on a straight section, clear of the elbow and
    // open end. Use this same material point for the tube and anatomical grip.
    let carryGrip:ReturnType<PvcBend['at']>|null=null;
    if(this.phase==='carrying'){
      const before=this.bend.mark-PVC.springLength/2,after=this.bend.mark+PVC.springLength/2;
      const s=PVC.length-Math.max(after,this.cutFrom)>=.18?Math.max(after,this.cutFrom)+.09:before-.09;
      carryGrip=this.bend.at(Math.min(PVC.length-.09,s));
      this.pipe.rotation.z=-1.2;
      this.pipe.position.copy(v(.12,-.10,-.36).sub(v(carryGrip.x,carryGrip.y).applyQuaternion(this.pipe.quaternion)));
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
    this.heldRebar.visible=['fastener-insert-ready','fastener-inserting'].includes(this.phase);
    this.rebarPliers.visible=['fastener-insert-ready','fastener-inserting','fastener-tighten-ready','fastener-tightening'].includes(this.phase);
    const left=v(-.21,-.20,-.43),right=v(.20,-.21,-.43),leftQ=new THREE.Quaternion(),rightQ=new THREE.Quaternion();
    if(carryGrip){
      right.copy(v(carryGrip.x,carryGrip.y).applyQuaternion(this.pipe.quaternion).add(this.pipe.position));
      rightQ.setFromUnitVectors(v(0,1,0),v(Math.cos(carryGrip.angle),Math.sin(carryGrip.angle),0).applyQuaternion(this.pipe.quaternion));
    }
    if(bending){
      // Both hands bracket the active spring section while feeding the pipe.
      // Downward pressure stays between the two physical contacts.
      const p=support,q=working;
      left.copy(v(p.x,-p.y).add(this.pipe.position));right.copy(v(q.x,-q.y).add(this.pipe.position));
      leftQ.setFromUnitVectors(v(0,1,0),v(Math.cos(p.angle),-Math.sin(p.angle),0));rightQ.setFromUnitVectors(v(0,1,0),v(-Math.cos(q.angle),Math.sin(q.angle),0));
      if(this.phase==='spring'||this.phase==='inserting'){left.set(-.16,this.pipe.position.y,this.pipe.position.z);right.set(.16,this.pipe.position.y,this.pipe.position.z);}
    }
    if(this.marker.visible){
      const point=this.stockPoint(1.94+Math.min(1,this.markingProgress)*.532,.043,-.35+this.bend.mark);this.marker.position.copy(c.worldToLocal(point));this.marker.rotation.z=-.25;right.copy(this.marker.position).add(v(0,.055,0));
      this.marker.quaternion.copy(c.quaternion).invert().multiply(new THREE.Quaternion().setFromAxisAngle(v(0,0,1),-.25));
      right.copy(this.marker.position).add(v(0,.055,0).applyQuaternion(this.marker.quaternion));rightQ.copy(this.marker.quaternion);
      left.copy(c.worldToLocal(this.stockPoint(1.87,.061,this.bend.mark-.35+.10)));
      leftQ.copy(c.quaternion).invert().multiply(new THREE.Quaternion().setFromUnitVectors(v(0,1,0),v(0,0,1)));
      // Camera is close enough to reach the marked strip; the stroke position
      // remains real world geometry, independent of the marking HUD.
    }
    if(fit){
      const root=new THREE.Object3D();this.orientAtBox(root,this.phase==='installing'?.07*(1-this.elapsed/.6):.07);
      this.pipe.position.copy(c.worldToLocal(root.position.clone()));this.pipe.quaternion.copy(c.quaternion.clone().invert().multiply(root.quaternion));
      const cut=this.bend.at(this.cutS),world=v(cut.x,cut.y,0).applyQuaternion(root.quaternion).add(root.position);
      this.cutRing.position.copy(world);this.cutRing.visible=this.phase==='fitting';
      // The blade lies in model XY. Its normal follows the pipe's local
      // tangent, so a vertical installed run is cut with horizontal shears.
      const before=this.bend.at(Math.max(0,this.cutS-.001)),after=this.bend.at(this.cutS+.001);
      const normal=v(before.x-after.x,before.y-after.y,0).normalize().applyQuaternion(root.quaternion);
      this.cutRing.quaternion.setFromUnitVectors(v(0,0,1),normal);
      const tip=c.worldToLocal(world.clone()),q=c.quaternion.clone().invert().multiply(new THREE.Quaternion().setFromUnitVectors(v(0,0,1),normal));
      this.cutter.quaternion.copy(q);this.cutter.position.copy(tip).sub(v().fromArray(this.cutter.userData.tipPoint).applyQuaternion(q));
      this.cutter.position.add(v(.23,0,.025).multiplyScalar(this.cutterRetreat));
      // Keep the support hand low on the retained run, just before its bend.
      // The lower fingers straddle the start of the radius as the shears close.
      const lower=this.bend.at(this.supportS??this.initialSupportS());
      left.copy(c.worldToLocal(v(lower.x,lower.y,0).applyQuaternion(root.quaternion).add(root.position)));
      const supportAxis=v(-Math.cos(lower.angle),-Math.sin(lower.angle),0).applyQuaternion(root.quaternion);
      leftQ.copy(c.quaternion).invert().multiply(new THREE.Quaternion().setFromUnitVectors(v(0,1,0),supportAxis));
      rightQ.copy(q).multiply(new THREE.Quaternion().fromArray(this.cutter.userData.gripQuaternion??[0,0,0,1]));
      this.cutter.getObjectByName('cutter-moving-handle')!.rotation.z=.13-(this.phase==='cutting'?Math.sin(Math.min(1,this.elapsed/.45)*Math.PI)*.33:0);
      this.work.updateMatrixWorld(true);
      right.copy(c.worldToLocal(this.cutter.getObjectByName('Moving red moulded handle')!.getWorldPosition(v()).add(this.cutter.getObjectByName('Fixed red moulded handle')!.getWorldPosition(v())).multiplyScalar(.5)));
    }else if(this.phase==='opening'){
      this.cutter.position.set(.02,-.15+Math.sin(this.elapsed*6)*.04,-.41);this.cutter.quaternion.identity();
      right.copy(v().fromArray(this.cutter.userData.gripPoint).add(this.cutter.position));rightQ.fromArray(this.cutter.userData.gripQuaternion);
      this.cutter.getObjectByName('cutter-moving-handle')!.rotation.z=.13-Math.max(0,Math.sin(this.elapsed*9))*.33;
    }else if(securing){
      const holes=this.fastenerHoles,pairs=this.fastenerPairs;
      if(this.phase==='fastener-drilling'&&holes.length){
        const hole=holes[Math.min(this.fastenerIndex,holes.length-1)],tip=c.worldToLocal(hole.marker.position.clone()),direction=v(0,0,-1),q=new THREE.Quaternion();
        const pulse=Math.sin(Math.min(1,this.fastenerProgress)*Math.PI)*.015;this.drill.quaternion.copy(q);this.drill.position.copy(tip).sub(v().fromArray(this.drill.userData.tipPoint).applyQuaternion(q)).addScaledVector(direction,-.05+pulse);
        right.copy(v().fromArray(this.drill.userData.gripPoint).applyQuaternion(q).add(this.drill.position));rightQ.copy(q);left.copy(tip).add(v(-hole.side*.09,-.04,.04));leftQ.copy(q);
      }else{
        const pair=pairs[Math.min(this.fastenerIndex,Math.max(0,pairs.length-1))],world=pair?pair.left.marker.position.clone().add(pair.right.marker.position).multiplyScalar(.5):this.target!.boxGroup.getWorldPosition(v()).add(v(0,-.16,.12)),centre=c.worldToLocal(world.clone());
        this.heldRebar.position.copy(centre).add(v(-.11,-.015,.09));this.heldRebar.rotation.set(0,0,.08);left.copy(v().fromArray(this.heldRebar.userData.gripPoint).applyQuaternion(this.heldRebar.quaternion).add(this.heldRebar.position));leftQ.copy(this.heldRebar.quaternion);
        const tying=['fastener-tighten-ready','fastener-tightening'].includes(this.phase),progress=this.phase==='fastener-tightening'?this.fastenerProgress:0;
        setRebarPliersClosed(this.rebarPliers,tying?THREE.MathUtils.smoothstep(progress,0,.20):.3);
        this.rebarPliers.quaternion.copy(c.quaternion).invert().multiply(new THREE.Quaternion().setFromAxisAngle(v(0,0,1),REBAR_TYING_ROLL)).multiply(new THREE.Quaternion().setFromAxisAngle(v(0,1,0),tying?THREE.MathUtils.smoothstep(progress,.20,.87)*Math.PI*5:0));
        if(tying&&pair){
          const entry=this.target?.conduit?this.entries()[this.target.conduit.userData.pvcRecipe?.entryIndex??this.entryIndex]:this.entry();
          if(entry)this.fastenerPairs.forEach(p=>setTieWireTarget(p.rebar,entry.position.x,entry.position.z+PVC.diameter/2+.0008));
          pair.rebar.updateMatrixWorld(true);
          const contact=c.worldToLocal(pair.rebar.localToWorld(v().fromArray(pair.rebar.userData.toolContact)));
          this.rebarPliers.position.copy(contact).sub(v().fromArray(this.rebarPliers.userData.tipPoint).applyQuaternion(this.rebarPliers.quaternion));
          // Once threaded, release the wire with the free hand. The nippers
          // tighten it one-handed; the free arm keeps its anatomical rest pose.
        }else this.rebarPliers.position.copy(centre).add(v(.10,-.01,.08));
        right.copy(v().fromArray(this.rebarPliers.userData.gripPoint).applyQuaternion(this.rebarPliers.quaternion).add(this.rebarPliers.position));rightQ.copy(this.rebarPliers.quaternion);
        if(this.phase==='fastener-insert-ready'){
          // Hold the next wire/tool within reach while the user remains free
          // to aim and drill additional holes. Focus begins only on feeding.
          this.heldRebar.position.set(-.10,-.14,-.32);this.heldRebar.quaternion.identity();left.copy(v().fromArray(this.heldRebar.userData.gripPoint).add(this.heldRebar.position));leftQ.identity();
          this.rebarPliers.position.set(.08,-.17,-.32);right.copy(v().fromArray(this.rebarPliers.userData.gripPoint).applyQuaternion(this.rebarPliers.quaternion).add(this.rebarPliers.position));
        }
        if(this.phase==='fastener-inserting'){const approach=1-THREE.MathUtils.smoothstep(this.fastenerProgress,0,1);this.heldRebar.position.z+=approach*.13;left.z+=approach*.13;}
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
    const aimed=this.game.started&&!this.focused&&!this.apprenticeLease?this.stockTarget():null;
    const near=Boolean(aimed),show=this.focused,nearBox=this.phase==='carrying'?this.game.boxPlacement.targetNear(this.game.renderer.camera):null;
    this.stock.updateInteractionHighlights(aimed&&!aimed.prepared?aimed.bundle:null);
    for(const pipe of this.prepared){const material=pipe.highlight?.material as THREE.MeshBasicMaterial|undefined;if(material){const color=pipe===aimed?.prepared?0x36a8ff:0xffd43b;if(material.color.getHex()!==color)material.color.setHex(color);}}
    // The idle, out-of-reach bundle has no changing prompt or controls. Run
    // its full DOM update once, then resume immediately when aim/state changes.
    const idleUi=this.game.started&&!show&&!near&&!nearBox&&this.phase==='sealed'&&!this.fastenerPrepAvailable;
    if(idleUi&&this.idleUiPresented)return;
    this.idleUiPresented=idleUi;
    const touchModifiers=this.touch&&['bending','review'].includes(this.phase);
    const bendUi=show&&['spring','inserting','bending','review','extracting'].includes(this.phase);
    this.controls.hidden=bendUi||!show||(this.touch&&!touchModifiers);this.controls.dataset.phase=this.phase;
    this.bendHud.update(show,this.phase,this.bend,this.quantity,this.rawCount,this.transparent,this.pressHeld,this.message);
    this.game.hud.shell.classList.toggle('pvc-bending-ui',bendUi);
    this.game.hud.shell.classList.toggle('pvc-working',this.blocksWork);
    this.game.hud.shell.classList.toggle('pvc-focused',this.focused);
    const handControl=this.touch&&show&&['fitting','cutting','cut'].includes(this.phase),moveStick=this.game.hud.shell.querySelector<HTMLElement>('#joystick')!;
    if(moveStick.classList.contains('pvc-hand-control')!==handControl){
      if(handControl)moveStick.dataset.pvcMoveLabel=moveStick.getAttribute('aria-label')??'Movement joystick';
      moveStick.classList.toggle('pvc-hand-control',handControl);moveStick.setAttribute('aria-label',handControl?'Αριστερό χέρι: πάνω ή κάτω στη σωλήνα':moveStick.dataset.pvcMoveLabel??'Movement joystick');
      if(!handControl)delete moveStick.dataset.pvcMoveLabel;
    }
    this.prompt.hidden=bendUi||!this.game.started||(this.touch&&show)||(!show&&!near&&this.phase!=='carrying')||(this.phase==='carrying'&&!near&&!nearBox);
    const tips:Partial<Record<Phase,string>>={
      marking:'Mouse: γωνία · E: σημάδεψε όλες τις σωλήνες · P: preset · Tab: επόμενο',
      spring:'LMB: βάλε το spring · R: διαφάνεια · ESC: πίσω',
      bending:'A / D: χέρι · LMB: λύγισε εδώ · 8 θέσεις για 90° · Z: διόρθωση · E: έλεγχος · R: διαφάνεια',
      review:'Ροδέλα ή − / +: ποσότητα · E: παραγωγή · R: διαφάνεια',
      fitting:'Mouse πάνω/κάτω: ύψος κοπής · W/S: αριστερό χέρι · LMB: κόψε · V: πρόσωπο · [ / ]: είσοδος · R: διαφάνεια',
      cut:'Mouse πάνω/κάτω: νέα κοπή · W/S: αριστερό χέρι · E: εφάρμοσε · V: πρόσωπο · [ / ]: είσοδος · ESC: πίσω',
      'pipe-install-ready':'USE: πέρασε τη σωλήνα μέσα από τα ανοικτά rebar και εφάρμοσέ τη στο κουτί',
      opening:'Κοπή πλαστικών δεσιμάτων',spreading:'Ευθυγράμμιση σωλήνων',
      inserting:'Εισαγωγή spring στο σημάδι',extracting:'Τράβηγμα spring από το καλώδιο',
      cutting:'Κοπή PVC',installing:'Εισαγωγή στο κουτί',
      'fastener-marking':'Mouse: στόχευση · LMB: άνοιξε οπή στο τούβλο · ένα αντικριστό ζεύγος για κάθε σύρμα',
      'fastener-drilling':'Τρύπημα 12 mm στο σημείο στόχευσης',
      'fastener-insert-ready':this.target?.conduit?'USE: πέρασε τα σύρματα στις οπές γύρω από τη σωλήνα':'USE: πέρασε τα σύρματα ένα-ένα στις οπές, ανοικτά για τη σωλήνα',
      'fastener-inserting':'Εισαγωγή ανοικτών συρμάτων · ένα ζεύγος τη φορά',
      'fastener-tighten-ready':'USE: ξεκίνα το τελικό στρίψιμο με την πένσα',
      'fastener-tightening':'Στρίψιμο σύρματος · ένα ζεύγος τη φορά',
    };
    if(this.touch)Object.assign(tips,{
      marking:'Σύρε πάνω/κάτω για μήκος · ΣΗΜΑΔΕΨΕ για μαρκάρισμα',
      spring:'Tap AIM για εισαγωγή spring',
      bending:'8 ΘΕΣΕΙΣ ΧΕΡΙΩΝ · Tap AIM: έναρξη / διακοπή λυγίσματος · Tap AIM στις 90°: έλεγχος',
      review:'Διάλεξε 1, 5 ή ΟΛΕΣ · μετά ΕΤΟΙΜΑΣΕ ΚΑΙ ΚΡΑΤΑ',
      fitting:'Σύρε πάνω/κάτω για ύψος · ΠΡΟΣΩΠΟ: snap · Tap AIM: κόψε',cut:'Σύρε για νέα κοπή · USE: εφαρμογή ή ΠΙΣΩ','pipe-install-ready':'Tap AIM · ΕΦΑΡΜΟΣΕ ΣΩΛΗΝΑ',
      'fastener-marking':'Δεξί joystick: στόχευση · πάτησε το κέντρο για οπή στο τούβλο',
      'fastener-drilling':'Τρύπημα 12 mm · μία οπή τη φορά','fastener-insert-ready':'Tap AIM · ΠΕΡΑΣΕ ΣΥΡΜΑ','fastener-inserting':'Πέρασμα ανοικτού σύρματος','fastener-tighten-ready':'Tap AIM · ΣΤΡΙΨΕ ΜΕ ΠΕΝΣΑ','fastener-tightening':'Στρίψιμο ένα-ένα',
    });
    const key=this.touch?'ΑΓΓΙΞΕ':'E';
    const aimedPhase=aimed?this.bundlePhase(aimed.bundle):this.phase;
    const ready=aimed?this.prepared.filter(p=>p.bundle===aimed.bundle).length:this.prepared.length;
    const hint=show?(this.message||tips[this.phase]||`${key}: συνέχεια`):
      this.phase==='carrying'?(near?`${key} · ΕΠΙΣΤΡΟΦΗ ΣΤΗ ΜΑΤΣΑ`:this.message||`${key} · ΕΦΑΡΜΟΣΕ ΣΤΟ ΚΟΥΤΙ`):
      aimed?.prepared?`${key} · ΠΑΡΕ ΣΩΛΗΝΑ`:aimedPhase==='sealed'?`${key} · ΚΟΨΕ ΤΑ ΔΕΣΙΜΑΤΑ · ${this.stock.bundleRemaining[aimed?.bundle??this.activeBundle]} × 3 m`:
      aimedPhase==='loose'?`${key} · ΑΠΛΩΣΕ ΤΙΣ ΣΩΛΗΝΕΣ`:
      aimedPhase==='batch'?`${key} · ${ready?'ΠΑΡΕ ΣΩΛΗΝΑ':'ΝΕΑ ΠΡΟΕΤΟΙΜΑΣΙΑ'} · ${ready} έτοιμες / ${this.stock.bundleRemaining[aimed?.bundle??this.activeBundle]} άκοπες`:`${key} · ΣΥΝΕΧΙΣΕ`;
    this.prompt.dataset.phase=this.phase;
    this.prompt.classList.remove('pvc-primary-action');
    this.prompt.classList.toggle('pvc-world-action',!show);
    if(!this.touch)this.markConfirm.textContent='E · ΣΗΜΑΔΕΨΕ ΤΙΣ ΣΩΛΗΝΕΣ';
    this.controls.querySelector('[data-pvc="confirm"]')!.textContent=this.phase==='review'?`ΕΤΟΙΜΑΣΕ ×${this.quantity} ΚΑΙ ΚΡΑΤΑ 1`:this.phase==='cut'?'ΕΦΑΡΜΟΣΕ':'ΕΛΕΓΧΟΣ';
    if(this.prompt.textContent!==hint)this.prompt.textContent=hint;
    this.markConfirm.hidden=!show||this.phase!=='marking'||this.markingActive;
    this.zoomControl.hidden=!this.touch||!show||!['fitting','cut'].includes(this.phase);
    this.drillControl.hidden=true;
    this.fitControls.hidden=!show||!['fitting','cut'].includes(this.phase);
    if(!this.fitControls.hidden){
      const entries=this.entries();
      (this.fitControls.querySelector('#pvc-entry-previous') as HTMLButtonElement).disabled=this.entryIndex<=0;
      (this.fitControls.querySelector('#pvc-entry-next') as HTMLButtonElement).disabled=this.entryIndex>=entries.length-1;
      const flush=this.fitControls.querySelector('#pvc-cut-flush') as HTMLButtonElement;
      flush.disabled=this.flushCut()===null;flush.setAttribute('aria-pressed',String(this.cutSnapped));
      (this.fitControls.querySelector('#pvc-cut-confirm') as HTMLButtonElement).disabled=this.cutS<=this.cutFrom+.001;
    }
    this.zoomControl.setAttribute('aria-pressed',String(this.fitZoomed));this.zoomControl.dataset.zoom=String(this.fitZoomed);
    this.liveMeasure.hidden=bendUi||!show||!['marking','bending','review','fitting','cut'].includes(this.phase);
    if(!this.liveMeasure.hidden){
      const marking=this.phase==='marking',fit=Boolean(this.target);
      let point:THREE.Vector3;
      if(marking)point=this.stockPoint(2.64,.055,this.bend.mark-.35);
      else if(fit)point=this.target!.boxGroup.getWorldPosition(v()).add(v(.17,-.06,.10));
      else point=this.pipe.localToWorld(v(this.bend.at(this.bend.mark).x+.20,this.bend.at(this.bend.mark).y,0));
      point.project(this.game.renderer.camera);
      const rect=this.game.renderer.webgl.domElement.getBoundingClientRect(),shell=this.game.hud.shell.getBoundingClientRect();
      this.liveMeasure.textContent=marking?`${(this.bend.mark*100).toFixed(1)} cm · από την αρχή`:
        fit?`Δάπεδο → κάτω κουτιού ${(this.boxBottomHeight()!*100).toFixed(1)} cm\nΎψος κοπής ${((this.bend.topHeight-this.bend.at(this.phase==='fitting'?this.cutS:this.cutFrom).x)*100).toFixed(1)} cm · ${Math.round(this.fitErrorAt(this.phase==='fitting'?this.cutS:this.cutFrom))} mm διαφορά\nΕίσοδος ${(this.entry()?.boxIndex??0)+1} · ${this.entry()?.side==='left'?'ΑΡΙΣΤΕΡΑ':'ΔΕΞΙΑ'}${this.cutSnapped?' · ΠΡΟΣΩΠΟ':''}`:
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
        ? this.phase==='marking'?'AIM':this.phase==='fastener-marking'?'ΤΡΥΠΗΣΕ':this.phase==='fastener-insert-ready'?'ΣΥΡΜΑ':this.phase==='pipe-install-ready'?'ΣΩΛΗΝΑ':this.phase==='fastener-tighten-ready'?'ΣΤΡΙΨΕ':this.phase==='spring'?'SPRING':this.phase==='bending'?(this.bend.ready?'ΕΛΕΓΧΟΣ':'ΛΥΓΙΣΕ'):this.phase==='review'?'ΕΤΟΙΜΑΣΕ':this.phase==='fitting'?'ΚΟΨΕ':this.phase==='cut'?'ΕΦΑΡΜΟΣΕ':'USE'
        : this.fastenerPrepAvailable?'ΟΠΕΣ':this.phase==='sealed'&&near?'ΚΟΨΕ':this.phase==='loose'&&near?'ΑΠΛΩΣΕ':this.phase==='batch'&&near?(this.prepared.length?'ΠΑΡΕ':'ΝΕΑ'):this.phase==='carrying'&&near?'ΕΠΙΣΤΡΕΨΕ':this.phase==='carrying'&&nearBox?'ΕΦΑΡΜΟΣΕ':'USE';
      const mobileAction=this.game.hud.shell.querySelector<HTMLElement>('#mobile-action')!,mobileDetail=this.game.hud.shell.querySelector<HTMLElement>('#look-joystick-thumb small')!,joystick=this.game.hud.shell.querySelector<HTMLElement>('#look-joystick')!;
      mobileAction.textContent='AIM';mobileDetail.textContent=this.game.input.actionHeld?'STOP':'JUMP';joystick.setAttribute('aria-label',`Drag to aim; tap to ${action==='AIM'?'use':action}; hold still to jump`);
    }
  }
  get telemetry(){const fitError=this.fitErrorAt(this.phase==='fitting'?this.cutS:this.cutFrom);return{phase:this.phase,focused:this.focused,activeBundle:this.activeBundle,aimedBundle:this.game.started&&!this.focused?this.stockTarget()?.bundle??null:null,stockHighlights:this.stock.interactionHighlights.map(h=>(h.material as THREE.MeshBasicMaterial).color.getHex()===0x36a8ff?'blue':'yellow'),bundles:this.stock.bundleRemaining.map((remaining,index)=>({remaining,opened:this.stock.bundleOpened[index],spread:this.stock.bundleSpread[index],phase:this.bundlePhase(index)})),raw:this.rawCount,prepared:this.prepared.length,carrying:Boolean(this.carried),installed:this.installedCount,total:this.rawCount+this.prepared.filter(p=>p.originBundle===this.activeBundle).length+Number(this.carried?.originBundle===this.activeBundle)+this.installedByBundle[this.activeBundle],totalAll:this.stock.bundleRemaining.reduce((a,b)=>a+b,0)+this.prepared.length+Number(Boolean(this.carried))+this.installedCount,markCm:this.bend.mark*100,markingProgress:this.markingProgress,markingActive:this.markingActive,springInsertion:this.insertion,springCentreM:this.bend.mark,springLengthM:PVC.springLength,retrievalCableM:PVC.cableLength,grip:this.bend.grip,angle:this.bend.angle,radiusMm:this.bend.radius?this.bend.radius*1000:null,ready:this.bend.ready,angles:[...this.bend.angles],quantity:this.quantity,target:this.target?.definition.id??null,guideTarget:this.guideTarget?.definition.id??null,boxBottomCm:this.boxBottomHeight()===null?null:this.boxBottomHeight()!*100,cutCm:this.cutS*100,cutFromCm:this.cutFrom*100,cutHeightCm:(this.bend.topHeight-this.bend.at(this.phase==='fitting'?this.cutS:this.cutFrom).x)*100,entryHeightCm:this.entry()?.position.y===undefined?null:this.entry()!.position.y*100,entryPosition:this.entry()?.position.toArray()??null,entryIndex:this.entryIndex,entryCount:this.entries().length,cutSnapped:this.cutSnapped,fitErrorMm:fitError,fitReady:fitError>=-SHORT_PIPE_TOLERANCE_MM&&fitError<=BOX_ENTRY_ALLOWANCE_MM,boxEntryAllowanceMm:BOX_ENTRY_ALLOWANCE_MM,offcuts:this.offcuts.length,message:this.message,preview:this.pipe.visible,bendHighlight:{visible:this.bendHighlight.visible,activeVisible:this.bendHighlight.active.visible,protectedRangeM:this.bendHighlight.userData.range??null,activeRangeM:this.bendHighlight.userData.activeRange??null},fasteners:{holes:this.fastenerHoles.length,pairs:this.fastenerPairs.length,drilled:this.fastenerHoles.filter(h=>h.drilled).length,index:this.fastenerIndex,progress:this.fastenerProgress,bitDiameterMm:12,aim:{...this.fastenerAim},positions:this.fastenerHoles.map(h=>({side:h.side,x:h.marker.position.x,y:h.y,z:h.marker.position.z})),rebars:this.fastenerPairs.map(p=>({visible:p.rebar.visible,position:p.rebar.position.toArray(),scale:p.rebar.scale.toArray(),left:p.rebar.userData.leftHole,right:p.rebar.userData.rightHole}))},arms:this.arms.map(a=>({side:a.side,reach:a.shoulder.distanceTo(a.wrist)}))};}
}
