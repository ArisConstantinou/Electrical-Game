import * as THREE from 'three';
import type { Game } from '../core/Game';
import { MortarBatch } from './MortarBatch';
import { createMixingStationModels, createMixerModel, createShovelModel, setMixingStationFill, setCementSackOpen, setMixerDirty, setShovelLoaded, updateMixingSurface } from '../world/MixingStationModels';
import { buildToolModel } from '../player/ToolModels';
import { workerHand, workerArm, poseWorkerArm, type WorkerArm } from '../player/WorkerArm';
import '../styles/mixing.css';

type MixingTool = 'trowel'|'shovel'|'mixer'|'water'|'hands';
type Action = 'water'|'cement'|'sand'|'pour'|'insert'|'rinse'|'carry'|'place'|'work'|'discard';
type Activity = 'water'|'tear'|'cement'|'sand'|null;
type StationTarget = {kind:'water'|'trowel'|'shovel'|'mixer'|'bucket'|'sand'|'rinse'|'sack';index?:number;object:THREE.Object3D};
const names:Record<MixingTool,string>={trowel:'Μιστρί',shovel:'Φτυάρι',mixer:'Μίκσερ',water:'Νερό',hands:'Χέρια'};
const qualityNames:Record<string,string>={empty:'Άδεια σύκλα',incomplete:'Χρειάζεται νερό, τσιμέντο και άμμο',unmixed:'Χρειάζεται ανάμιξη',balanced:'Έτοιμος πυλός · κοντά στη συνταγή σου',wet:'Αραιό μίγμα · πρόσθεσε άμμο',dry:'Στεγνό μίγμα · πρόσθεσε νερό',weak:'Λίγο τσιμέντο · πρόσθεσε μιστριές'};

/** An optional, physical preparation workflow. Existing site practice stays available
 * until the player adds their first ingredient; custom mortar then has a finite source. */
export class MixingStation {
  readonly batch = new MortarBatch();
  readonly models = createMixingStationModels();
  active=false;
  carrying=false;
  customSupply=false;
  mixerDirty=false;
  inserted=false;
  tool:MixingTool='water';
  message='Νερό πρώτα, μετά τσιμέντο και άμμο. Κάθε δόση τη διαλέγεις εσύ.';
  private readonly panel:HTMLElement;
  private readonly toggle:HTMLButtonElement;
  private readonly prompt:HTMLElement;
  private readonly finish:HTMLButtonElement;
  private readonly toolbelt:HTMLElement;
  private readonly readout:HTMLElement;
  private readonly feedback:HTMLElement;
  private readonly meter:HTMLProgressElement;
  private readonly held=new THREE.Group();
  private readonly heldTools=new Map<MixingTool,THREE.Group>();
  private readonly arms:WorkerArm[]=[];
  private readonly ray=new THREE.Raycaster();
  private readonly bucketHome=new THREE.Vector3();
  private readonly mixerHome=new THREE.Vector3();
  private readonly mixerRotation=new THREE.Euler();
  private readonly actionPoint=new THREE.Vector3();
  private readonly stationPoint=new THREE.Vector3();
  private actionTime=0;
  private mixingNow=false;
  private cleanSeconds=0;
  private uiKey='';
  private elapsed=0;
  private readonly pouring:THREE.Points;
  private pouringTime=0;
  private visited=false;
  private previousCrouched=false;
  private readonly activationDistance=2.8;
  private readonly mobileInteract:HTMLButtonElement|null;
  private readonly stationTrowel:THREE.Group;
  private activity:Activity=null;
  private activityTime=0;
  private activityStep=0;
  private activitySack=0;
  private wasHeldInteraction=false;
  private finished=false;
  private toolbarSelection=false;
  onSound?:(kind:'water-pour'|'sack-tear'|'cement-scrape'|'sand-scoop'|'mixer-insert'|'mixer-rinse',intensity?:number)=>void;

  constructor(private readonly game:Game){
    const m=this.models;
    // The preparation bay lives at the rear perimeter, leaving the full wall
    // approach and side-to-side working lane clear.
    m.group.position.set(-.75,0,2.28);game.renderer.scene.add(m.group);
    this.bucketHome.copy(m.bucket.position);this.mixerHome.copy(m.mixer.position);this.mixerRotation.copy(m.mixer.rotation);
    game.renderer.camera.add(this.held);this.held.name='Mixing tools held in worker hands';
    this.heldTools.set('trowel',buildToolModel('trowel'));
    this.heldTools.set('shovel',createShovelModel());
    this.heldTools.set('mixer',createMixerModel());
    this.heldTools.set('water',m.water.clone(true));
    this.heldTools.forEach((model,key)=>{this.held.add(model);model.visible=false;if(key!=='trowel'){model.rotation.x=.6;const grip=new THREE.Vector3().fromArray(model.userData.gripPoint).applyEuler(model.rotation);model.position.set(.18,-.05,-.1).sub(grip);}});
    this.stationTrowel=buildToolModel('trowel');this.stationTrowel.name='mixing-station-trowel';this.stationTrowel.userData.studioEntityId='mixing:trowel';this.stationTrowel.position.set(.22,.13,.28);this.stationTrowel.rotation.set(.18,0,-1.18);m.group.add(this.stationTrowel);
    const particles=new THREE.BufferGeometry();particles.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(48),3));
    this.pouring=new THREE.Points(particles,new THREE.PointsMaterial({color:0xbda77e,size:.018,transparent:true,opacity:.85}));this.pouring.visible=false;game.renderer.scene.add(this.pouring);
    for(const side of [1,-1]){const hand=workerHand(side,'hose'),arm=workerArm(side,hand,new THREE.Vector3());game.renderer.scene.add(arm.group);this.arms.push(arm);}
    this.toggle=document.createElement('button');this.toggle.id='mixing-toggle';this.toggle.type='button';this.toggle.textContent='ΣΥΚΛΑ · ΦΤΙΑΞΕ ΠΥΛΟ';this.toggle.hidden=true;
    this.mobileInteract=game.hud.shell.querySelector('#mobile-interact');
    this.panel=document.createElement('section');this.panel.id='mixing-panel';this.panel.hidden=true;this.panel.setAttribute('aria-label','Κατάσταση παρασκευής πυλού');
    this.panel.innerHTML=`<b>ΠΑΡΑΣΚΕΥΗ ΠΥΛΟΥ</b><div class="mix-readout"></div><progress max="1" value="0" aria-label="Ανάμιξη"></progress><p class="mix-feedback" role="status" aria-live="polite"></p><input id="mixing-water-step" type="hidden" value="1"><select id="mixing-sack" hidden aria-hidden="true"><option value="0">1</option><option value="1">2</option><option value="2">3</option></select>`;
    this.readout=this.panel.querySelector('.mix-readout')!;this.feedback=this.panel.querySelector('.mix-feedback')!;this.meter=this.panel.querySelector('progress')!;
    this.prompt=document.createElement('div');this.prompt.id='mixing-world-prompt';this.prompt.hidden=true;
    this.finish=document.createElement('button');this.finish.id='mixing-finish';this.finish.type='button';this.finish.innerHTML='<b>FINISH</b><small>Ο ΠΥΛΟΣ ΕΙΝΑΙ ΕΤΟΙΜΟΣ</small>';this.finish.hidden=true;
    this.toolbelt=document.createElement('nav');this.toolbelt.id='mixing-toolbelt';this.toolbelt.setAttribute('aria-label','Εργαλεία παρασκευής πυλού');this.toolbelt.hidden=true;
    this.toolbelt.innerHTML='<button type="button" data-mix-equip="water"><b>💧</b><span>ΝΕΡΟ</span></button><button type="button" data-mix-equip="trowel"><b>◢</b><span>ΜΙΣΤΡΙ ΜΙΞΗΣ</span></button><button type="button" data-mix-equip="shovel"><b>♠</b><span>ΦΤΥΑΡΙ</span></button><button type="button" data-mix-equip="mixer"><b>⚙</b><span>ΜΙΞΕΡ</span></button>';
    game.hud.shell.append(this.toggle,this.panel,this.prompt,this.finish,this.toolbelt);
    this.toggle.hidden=true;
    this.panel.addEventListener('pointerdown',event=>event.stopPropagation());
    this.finish.addEventListener('click',()=>this.finishBatch());
    this.toolbelt.addEventListener('pointerdown',event=>event.stopPropagation());
    this.toolbelt.addEventListener('click',event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-mix-equip]');if(!button||this.activity)return;if(!this.active)this.setActive(true);this.chooseTool(button.dataset.mixEquip as MixingTool,true);});
    addEventListener('blur',()=>this.stop());document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stop();});
  }
  get blocksWork():boolean{return this.active||this.carrying;}
  setActive(value:boolean):void{
    if(!this.game.started)return;
    this.active=value;this.stop();this.game.input.resetTransientInput();this.game.mortar.cancel();
    if(value){
      if(document.pointerLockElement)void document.exitPointerLock();
      this.game.player.workPosition.locked=false;
      if(!this.visited){this.previousCrouched=this.game.player.crouched;this.visited=true;}
    }
    this.panel.hidden=!value;this.game.hud.shell.classList.toggle('mixing-active',value);this.uiKey='';
  }
  private stop():void{this.mixingNow=false;}
  chooseTool(tool:MixingTool,fromToolbar=false):void{
    if(this.carrying&&tool!=='hands'){this.message='Άφησε πρώτα τη σύκλα στο δάπεδο.';return;}
    if(this.inserted&&tool!=='mixer'){this.message='Βγάλε πρώτα το μίκσερ από τη σύκλα.';return;}
    this.tool=tool;this.toolbarSelection=fromToolbar;this.stop();this.game.input.resetTransientInput();this.message=`${names[tool]} στα χέρια. Τα υλικά που έχεις πάρει παραμένουν στο εργαλείο τους.`;
  }
  private bucketPosition():THREE.Vector3{return this.models.bucket.getWorldPosition(new THREE.Vector3());}
  private near(object:THREE.Object3D,range=2.2):boolean{
    const point=object.getWorldPosition(new THREE.Vector3()),eye=this.game.renderer.camera.position;
    return Math.hypot(point.x-eye.x,point.z-eye.z)<=range;
  }
  canOpenFromInteract():boolean{
    return Boolean(this.aimedObject());
  }
  handleInteractionRequest(requested:boolean):boolean{
    if(!requested||this.activity)return false;
    const target=this.aimedObject();
    if(!target){
      if(this.active){this.message=this.guidanceForTool();return true;}
      return false;
    }
    if(!this.active)this.setActive(true);
    const handled=this.useAimedObject(target);
    return handled;
  }
  private preferredTarget():StationTarget|null{
    if(!this.active)return null;
    const m=this.models,state=this.batch.getState();
    if(this.tool==='water')return{kind:'bucket',object:m.bucket};
    if(this.tool==='shovel')return{kind:'sand',object:m.sand};
    if(this.tool==='mixer')return this.mixerDirty&&!this.inserted?{kind:'rinse',object:m.rinse}:{kind:'bucket',object:m.bucket};
    if(this.tool==='trowel'){
      const index=state.sacks.findIndex(sack=>sack.remainingKg>1e-6);
      if(index>=0)return{kind:'sack',index,object:m.sacks[index]};
    }
    return null;
  }
  private targetInWorkCone(target:StationTarget):boolean{
    if(!target.object.visible)return false;
    const camera=this.game.renderer.camera,point=target.object.getWorldPosition(new THREE.Vector3());
    point.y+=target.kind==='bucket'?.3:target.kind==='sand'?.18:target.kind==='sack'?.32:.2;
    const offset=point.sub(camera.position),distance=offset.length();
    if(distance>3.35||distance<.01)return false;
    return camera.getWorldDirection(new THREE.Vector3()).dot(offset.multiplyScalar(1/distance))>.91;
  }
  private aimedObject():StationTarget|null{
    if(!this.game.started||this.carrying)return null;
    const m=this.models,c=this.game.renderer.camera;m.group.updateMatrixWorld(true);
    const preferred=this.preferredTarget();if(this.toolbarSelection&&preferred&&this.targetInWorkCone(preferred))return preferred;
    this.ray.setFromCamera(new THREE.Vector2(),c);
    const roots=[m.bucket,m.sand,...m.sacks,m.rinse,m.water,m.mixer,m.shovel,this.stationTrowel].filter(object=>object.visible);
    const hit=this.ray.intersectObjects(roots,true)[0];if(!hit||hit.distance>3.2)return preferred&&this.targetInWorkCone(preferred)?preferred:null;
    const belongs=(root:THREE.Object3D)=>{let object:THREE.Object3D|null=hit.object;while(object){if(object===root)return true;object=object.parent;}return false;};
    const sack=m.sacks.findIndex(belongs);if(sack>=0)return{kind:'sack',index:sack,object:m.sacks[sack]};
    for(const [kind,object] of [['water',m.water],['trowel',this.stationTrowel],['shovel',m.shovel],['mixer',m.mixer],['bucket',m.bucket],['sand',m.sand],['rinse',m.rinse]] as const)if(belongs(object))return{kind,object};
    return null;
  }
  private beginActivity(activity:Exclude<Activity,null>,object:THREE.Object3D,sackIndex=0):boolean{
    if(this.activity)return false;
    this.activity=activity;this.activityTime=0;this.activityStep=0;this.activitySack=sackIndex;this.actionPoint.copy(object.getWorldPosition(new THREE.Vector3()));this.stop();
    this.message=activity==='water'?'Γέρνεις την κανάτα μέχρι το σημάδι ⅓…':activity==='tear'?'Το μιστρί σκίζει τη σακούλα…':activity==='cement'?'Παίρνεις μία μιστριά τσιμέντο και τη ρίχνεις στη σύκλα…':'Το φτυάρι μπαίνει στην άμμο και αδειάζει στη σύκλα…';
    this.onSound?.(activity==='water'?'water-pour':activity==='tear'?'sack-tear':activity==='cement'?'cement-scrape':'sand-scoop');
    return true;
  }
  private updateActivity(dt:number):void{
    if(!this.activity)return;this.activityTime+=dt;
    const duration=this.activity==='tear'?.85:this.activity==='water'?1.35:1.55,p=this.activityTime/duration;
    if(this.activity==='water'&&this.activityStep===0&&p>=.58){const target=this.batch.getState().capacityLitres/3,amount=Math.max(0,target-this.batch.waterLitres);if(amount>0)this.batch.addWater(amount);this.activityStep=1;this.pouringTime=.65;this.customSupply=false;}
    if(this.activity==='tear'&&this.activityStep===0&&p>=.48){this.batch.openSack(this.activitySack);this.activityStep=1;}
    if(this.activity==='cement'){
      if(this.activityStep===0&&p>=.30){if(this.batch.scoopCement(this.activitySack))this.activityStep=1;else{this.message='Δεν μπορείς να πάρεις άλλη μιστριά από αυτή τη σακούλα.';this.activity=null;return;}}
      if(this.activityStep===1&&p>=.72){if(this.batch.pour('trowel')){this.activityStep=2;this.pouringTime=.6;(this.pouring.material as THREE.PointsMaterial).color.setHex(0xb2aaa0);}else this.message='Η σύκλα γέμισε. Προχώρα στην ανάμιξη.';}
    }
    if(this.activity==='sand'){
      if(this.activityStep===0&&p>=.28){if(this.batch.scoopSand())this.activityStep=1;else{this.message='Δεν μπορείς να πάρεις άλλη φτυαριά.';this.activity=null;return;}}
      if(this.activityStep===1&&p>=.72){if(this.batch.pour('shovel')){this.activityStep=2;this.pouringTime=.6;(this.pouring.material as THREE.PointsMaterial).color.setHex(0xbda77e);}else this.message='Η σύκλα γέμισε. Προχώρα στην ανάμιξη.';}
    }
    if(p>=1){const done=this.activity;this.activity=null;this.activityTime=0;this.activityStep=0;this.message=done==='water'?'Η σύκλα έχει ακριβώς ⅓ νερό. Πιάσε το μιστρί μίξης.':done==='tear'?'Η σακούλα άνοιξε. Πάτησε ξανά πάνω της για μία μιστριά.':done==='cement'?'Η μιστριά τσιμέντου έπεσε στη σύκλα. Βάλε όσες θέλεις.':'Η φτυαριά άμμου έπεσε στη σύκλα. Συνέχισε όσο θέλεις.';}
  }
  private animateAt(object:THREE.Object3D):void{object.getWorldPosition(this.actionPoint);this.actionPoint.y+=object===this.models.bucket?.33:.32;this.actionTime=.65;}
  action(action:Action):boolean{
    if(!this.game.started||!this.active)return false;
    const b=this.batch,m=this.models,state=b.getState(),sackIndex=Number(this.panel.querySelector<HTMLSelectElement>('#mixing-sack')!.value),sack=m.sacks[sackIndex];
    if(action==='work'){if(this.carrying){this.message='Άφησε πρώτα τη σύκλα δίπλα στη δουλειά σου.';return false;}this.game.player.crouched=this.previousCrouched;this.setActive(false);window.dispatchEvent(new CustomEvent('wirehouse:select-tool',{detail:'trowel'}));return true;}
    if(action==='place')return this.placeBucket();
    if(this.carrying){this.message='Άφησε πρώτα τη σύκλα.';return false;}
    const target=action==='cement'?sack:action==='sand'?m.sand:action==='rinse'?m.rinse:m.bucket;
    if(!target||!this.near(target)){this.message='Περπάτησε πιο κοντά στο υλικό ή στη σύκλα.';return false;}
    let ok=false;
    if(action==='discard'){
      if(this.inserted){this.message='Βγάλε πρώτα το μίκσερ.';return false;}
      const discarded=b.discard();this.message=`Άδειασες ${discarded.toFixed(1)} kg. Ξεκίνα νέα παρτίδα.`;ok=discarded>0;
    }else if(action==='water'){
      if(this.tool!=='water'){this.message='Επίλεξε Νερό.';return false;}
      const amount=Number(this.panel.querySelector<HTMLInputElement>('#mixing-water-step')!.value);
      if(!Number.isFinite(amount)||amount<.1||amount>10){this.message='Δόση νερού από 0,1 έως 10 λίτρα.';return false;}
      ok=b.addWater(amount)>0;this.message=ok?`Πρόσθεσες ${amount.toFixed(1)} L νερό.`:'Η σύκλα δεν χωρά αυτή τη δόση.';
    }else if(action==='cement'){
      if(this.tool!=='trowel'){this.message='Χρησιμοποίησε το ίδιο μιστρί για άνοιγμα και τσιμέντο.';return false;}
      if(!state.sacks[sackIndex].open){
        ok=b.openSack(sackIndex);
        if(ok){this.message='Έκοψες το σακούλι με το μιστρί μίξης. Πάτησε ξανά για να πάρεις μία μιστριά.';this.animateAt(target);return true;}
      }
      const took=b.scoopCement(sackIndex);
      if(took)ok=true;
      if(took)this.message='Μία μιστριά τσιμέντο. Ρίξε τη στη σύκλα.';
      else if(!ok)this.message='Άδειασε πρώτα το μιστρί ή επίλεξε άλλο σακούλι.';
    }else if(action==='sand'){
      if(this.tool!=='shovel'){this.message='Επίλεξε το φτυάρι.';return false;}
      ok=b.scoopSand();this.message=ok?'Μία φτυαριά άμμο. Ρίξε τη στη σύκλα.':'Το φτυάρι είναι γεμάτο ή η άμμος τελείωσε.';
    }else if(action==='pour'){
      if(this.tool!=='trowel'&&this.tool!=='shovel'){this.message='Πιάσε το φορτωμένο μιστρί ή φτυάρι.';return false;}
      ok=b.pour(this.tool);this.message=ok?'Η δόση μπήκε στη σύκλα.':'Δεν υπάρχει δόση ή η σύκλα είναι γεμάτη. Το υλικό μένει στο εργαλείο.';
    }else if(action==='insert'){
      if(this.tool!=='mixer'){this.message='Επίλεξε το μίκσερ μπαταρίας.';return false;}
      this.inserted=!this.inserted;this.stop();ok=true;this.message=this.inserted?'Το μίκσερ είναι μέσα. Κράτα πατημένο για ανάμιξη.':'Έβγαλες το μίκσερ. Καθάρισέ το πριν μεταφέρεις τη σύκλα.';
    }else if(action==='rinse'){
      if(this.tool!=='mixer'||this.inserted){this.message='Πιάσε το μίκσερ και βγάλε το από τον πυλό.';return false;}
      this.cleanSeconds=2;ok=true;this.message='Ξέπλυμα της φτερωτής…';
    }else if(action==='carry'){
      if(this.inserted||this.mixerDirty){this.message='Βγάλε και καθάρισε πρώτα το μίκσερ.';return false;}
      this.tool='hands';this.carrying=true;this.stop();ok=true;this.message='Κρατάς τη σύκλα. Περπάτησε και άφησέ τη δίπλα στη δουλειά.';
    }
    if(ok){if(action==='water'||action==='pour'){this.customSupply=true;this.pouringTime=.6;(this.pouring.material as THREE.PointsMaterial).color.setHex(action==='water'?0x85b9c8:this.tool==='trowel'?0xb2aaa0:0xbda77e);}this.animateAt(target);}
    return ok;
  }
  private placeBucket():boolean{
    if(!this.carrying){this.message='Δεν κρατάς τη σύκλα.';return false;}
    const c=this.game.renderer.camera,d=c.getWorldDirection(new THREE.Vector3());d.y=0;if(d.lengthSq()<.001)d.set(0,0,-1);d.normalize();
    const p=c.position.clone().addScaledVector(d,.65);p.y=0;
    if(Math.abs(p.x)>2.55||p.z< -1.93||p.z>2.05||Math.hypot(p.x-this.models.sand.getWorldPosition(new THREE.Vector3()).x,p.z-this.models.sand.getWorldPosition(new THREE.Vector3()).z)<1.0){this.message='Χρειάζεται ελεύθερο δάπεδο, μακριά από τοίχο και άμμο.';return false;}
    this.carrying=false;this.game.input.resetTransientInput();this.models.bucket.position.copy(this.models.group.worldToLocal(p));this.models.bucket.rotation.set(0,0,0);this.message='Η σύκλα έμεινε εδώ. Εργάσου με μιστρί κοντά της.';return true;
  }
  /** Called only when the wrist actually releases; failed or cancelled throws use no mortar. */
  reserveScoop(requested:number):number{
    if(!this.finished||!this.customSupply||!this.batch.ready){this.game.hud.notify('Πρέπει πρώτα να ετοιμάσεις και να κάνεις FINISH τον πυλό.',false,2000);return 0;}
    return this.batch.consumeKg(requested);
  }
  get bondFactor():number{return this.batch.quality==='balanced'?1:this.batch.quality==='wet'?.45:this.batch.quality==='dry'?.55:.65;}
  private promptFor(target:StationTarget|null):string{
    if(!target)return this.active?`${matchMedia('(any-pointer: coarse)').matches?'INTERACT':'E'} · ${this.guidanceForTool()}`:'';
    const key=matchMedia('(any-pointer: coarse)').matches?'INTERACT':'E';
    if(target.kind==='water')return`${key} · ΓΕΜΙΣΕ ΝΕΡΟ ΣΤΟ ⅓`;
    if(target.kind==='trowel')return`${key} · ΠΙΑΣΕ ΜΙΣΤΡΙ ΜΙΞΗΣ`;
    if(target.kind==='shovel')return`${key} · ΠΙΑΣΕ ΦΤΥΑΡΙ`;
    if(target.kind==='mixer')return`${key} · ΠΙΑΣΕ ΜΙΞΕΡ`;
    if(target.kind==='sack')return`${key} · ${this.tool==='trowel'?(this.batch.getState().sacks[target.index??0].open?'ΠΑΡΕ ΜΙΑ ΜΙΣΤΡΙΑ':'ΣΚΙΣΕ ΤΗ ΣΑΚΟΥΛΑ'):'ΧΡΕΙΑΖΕΤΑΙ ΜΙΣΤΡΙ ΜΙΞΗΣ'}`;
    if(target.kind==='sand')return`${key} · ${this.tool==='shovel'?'ΠΑΡΕ ΜΙΑ ΦΤΥΑΡΙΑ':'ΧΡΕΙΑΖΕΤΑΙ ΦΤΥΑΡΙ'}`;
    if(target.kind==='bucket'&&this.tool==='water')return`${key} · ΓΕΜΙΣΕ ΝΕΡΟ ΣΤΟ ⅓`;
    if(target.kind==='bucket'&&this.tool==='mixer')return`${key} · ${this.inserted?'ΚΡΑΤΑ ΓΙΑ ΑΝΑΜΙΞΗ':'ΒΑΛΕ ΤΟ ΜΙΞΕΡ'}`;
    if(target.kind==='rinse')return`${key} · ΞΕΠΛΥΝΕ ΤΟ ΜΙΞΕΡ`;
    return`${key} · ΣΤΟΧΕΥΣΕ ΤΟ ΣΩΣΤΟ ΕΡΓΑΛΕΙΟ`;
  }
  private guidanceForTool():string{
    if(this.carrying)return'ΑΦΗΣΕ ΤΗ ΣΥΚΛΑ';
    if(this.tool==='water')return'ΚΟΙΤΑΞΕ ΤΗ ΣΥΚΛΑ';
    if(this.tool==='trowel')return'ΚΟΙΤΑΞΕ ΤΗ ΣΑΚΟΥΛΑ';
    if(this.tool==='shovel')return'ΚΟΙΤΑΞΕ ΤΗΝ ΑΜΜΟ';
    if(this.tool==='mixer')return this.mixerDirty&&!this.inserted?'ΚΟΙΤΑΞΕ ΤΟ ΝΕΡΟ ΞΕΠΛΥΜΑΤΟΣ':'ΚΟΙΤΑΞΕ ΤΗ ΣΥΚΛΑ';
    return'ΣΤΟΧΕΥΣΕ ΑΝΤΙΚΕΙΜΕΝΟ';
  }
  private finishBatch():void{
    if(!this.batch.ready||this.inserted)return;
    this.finished=true;this.customSupply=true;this.message='Η παρτίδα ολοκληρώθηκε. Το μιστρί τοίχου τροφοδοτείται μόνο από αυτόν τον πυλό.';
    this.setActive(false);window.dispatchEvent(new CustomEvent('wirehouse:select-tool',{detail:'trowel'}));
  }
  update(dt:number,requested:boolean,heldInteraction:boolean):void{
    dt=Number.isFinite(dt)?Math.min(.05,Math.max(0,dt)):0;
    this.updateActivity(dt);
    this.elapsed+=dt;this.pouringTime=Math.max(0,this.pouringTime-dt);
    const station=this.models.group.getWorldPosition(this.stationPoint),camera=this.game.renderer.camera.position;
    const distance=Math.hypot(station.x-camera.x,station.z-camera.z);
    const stageNearby=this.game.started&&distance<2.35&&!this.finished;this.toolbelt.hidden=!stageNearby;this.game.hud.shell.classList.toggle('mixing-stage',stageNearby);
    if(this.active&&distance>this.activationDistance+1.2)this.setActive(false);
    const aimed=this.aimedObject(),interactAvailable=Boolean(aimed)||this.carrying||(this.active&&stageNearby);
    const prompt=this.promptFor(aimed);this.prompt.hidden=!prompt;this.prompt.textContent=prompt;
    if(this.mobileInteract){this.mobileInteract.hidden=!interactAvailable;this.mobileInteract.querySelector('small')!.textContent=this.carrying?'ΑΦΗΣΕ ΣΥΚΛΑ':prompt?.replace(/^.* · /,'')||'ΣΤΟΧΕΥΣΕ ΑΝΤΙΚΕΙΜΕΝΟ';}
    this.toggle.hidden=true;this.actionTime=Math.max(0,this.actionTime-dt);
    if(this.carrying){const c=this.game.renderer.camera,d=c.getWorldDirection(new THREE.Vector3());d.y=0;d.normalize();const p=c.position.clone().addScaledVector(d,.42);p.y=Math.max(.35,c.position.y-.95);this.models.bucket.position.copy(this.models.group.worldToLocal(p));}
    if(this.carrying&&requested)this.placeBucket();
    const held=this.active&&heldInteraction;
    const direction=this.game.renderer.camera.getWorldDirection(new THREE.Vector3());
    const bucketAim=direction.dot(this.bucketPosition().add(new THREE.Vector3(0,.3,0)).sub(this.game.renderer.camera.position).normalize())>.88||direction.dot(this.bucketPosition().add(new THREE.Vector3(0,.75,0)).sub(this.game.renderer.camera.position).normalize())>.96;
    this.mixingNow=held&&this.tool==='mixer'&&this.inserted&&this.near(this.models.bucket,1.35)&&bucketAim&&!document.hidden;
    if(this.mixingNow){const before=this.batch.mixProgress;this.batch.mix(dt);if(this.batch.mixProgress>before||this.batch.ready)this.mixerDirty=true;this.message=qualityNames[this.batch.quality];}
    if(held&&this.tool==='mixer'&&this.inserted&&!this.near(this.models.bucket,1.35))this.message='Πλησίασε τη σύκλα για να ανακατέψεις.';
    if(this.wasHeldInteraction&&!heldInteraction&&this.batch.ready&&this.inserted){this.inserted=false;this.stop();this.message='Ο πηλός είναι έτοιμος. Πάτησε FINISH.';}
    this.wasHeldInteraction=heldInteraction;
    if(this.cleanSeconds>0){if(this.active&&this.tool==='mixer'&&!this.inserted&&this.near(this.models.rinse,1.8)){this.cleanSeconds=Math.max(0,this.cleanSeconds-dt);if(this.cleanSeconds===0){this.mixerDirty=false;this.message='Το μίκσερ καθάρισε. Μπορείς να σηκώσεις τη σύκλα.';}}else{this.cleanSeconds=0;this.message='Το ξέπλυμα διακόπηκε. Πλησίασε ξανά με το μίκσερ.';}}
  }
  private useAimedObject(target:StationTarget):boolean{
    if(this.carrying)return this.placeBucket();
    if(target.kind==='water'){this.chooseTool('water');this.message='Κανάτα στα χέρια. Κοίταξε τη σύκλα και πάτησε INTERACT.';return true;}
    if(target.kind==='trowel'){this.chooseTool('trowel');this.message='Μιστρί μίξης στα χέρια. Κοίταξε μία σακούλα και πάτησε INTERACT.';return true;}
    if(target.kind==='shovel'){this.chooseTool('shovel');this.message='Φτυάρι στα χέρια. Κοίταξε την άμμο και πάτησε INTERACT.';return true;}
    if(target.kind==='mixer'&&!this.inserted){this.chooseTool('mixer');this.message='Μίξερ στα χέρια. Κοίταξε τη σύκλα και πάτησε INTERACT.';return true;}
    if(target.kind==='sack'){
      if(this.tool!=='trowel'){this.message='Πιάσε πρώτα το μιστρί μίξης που βρίσκεται δίπλα στις σακούλες.';return true;}
      const index=target.index??0;return this.beginActivity(this.batch.getState().sacks[index].open?'cement':'tear',target.object,index);
    }
    if(target.kind==='sand'){
      if(this.tool!=='shovel'){this.message='Πιάσε πρώτα το φτυάρι που είναι πάνω στην άμμο.';return true;}
      return this.beginActivity('sand',target.object);
    }
    if(target.kind==='bucket'&&this.tool==='mixer'){
      if(!this.inserted){this.inserted=true;this.stop();this.onSound?.('mixer-insert');this.message='Το μίξερ μπήκε στη σύκλα. Κράτα πατημένο INTERACT όσο θέλεις.';}return true;
    }
    if(target.kind==='bucket'&&this.tool==='water')return this.beginActivity('water',target.object);
    if(target.kind==='rinse'&&this.tool==='mixer'&&this.mixerDirty&&!this.inserted){this.cleanSeconds=2;this.onSound?.('mixer-rinse');this.message='Ξεπλένεις τη φτερωτή…';return true;}
    this.message=`${target.kind==='bucket'?'Η σύκλα':'Αυτό το αντικείμενο'} δεν χρησιμοποιείται με το εργαλείο που κρατάς.`;return true;
  }
  present():void{
    const m=this.models,b=this.batch,state=b.getState();
    setMixingStationFill(m,b.volumeLitres,b.ready?0x827965:b.cementScoops>0?0x9e9887:0x789894);
    m.fill.userData.dryIngredients=b.cementScoops>0||b.sandScoops>0;
    updateMixingSurface(m,b.mixProgress,this.mixingNow,this.elapsed);
    for(const mixer of [m.mixer,this.heldTools.get('mixer')!])setMixerDirty(mixer,this.mixerDirty);
    setShovelLoaded(this.heldTools.get('shovel')!,Boolean(state.heldShovel));setShovelLoaded(m.shovel,Boolean(state.heldShovel));
    this.pouring.visible=this.pouringTime>0;
    if(this.pouring.visible){this.pouring.position.copy(this.bucketPosition());const p=this.pouring.geometry.getAttribute('position');for(let i=0;i<p.count;i++){const fall=(this.elapsed*1.8+i/p.count)%1;p.setXYZ(i,Math.sin(i*2.4)*.04,.3+(1-fall)*.35,Math.cos(i*2.4)*.04);}p.needsUpdate=true;}
    const activeSack=state.sacks.findIndex(sack=>sack.remainingKg>1e-6);
    m.sacks.forEach((sack,i)=>{setCementSackOpen(sack,state.sacks[i].open);sack.visible=i===activeSack;});
    m.sand.scale.setScalar(Math.max(.1,Math.cbrt(state.sandRemainingKg/600)));
    if(this.inserted||this.cleanSeconds>0){m.mixer.position.copy(this.inserted?m.bucket.position:m.rinse.position);m.mixer.position.y+=.06;m.mixer.rotation.set(0,0,0);m.paddle.rotation.y+=this.mixingNow||this.cleanSeconds>0?.31:0;}
    else{m.mixer.position.copy(this.mixerHome);m.mixer.rotation.copy(this.mixerRotation);}
    m.mixer.visible=this.inserted||this.cleanSeconds>0||this.tool!=='mixer'||!this.active;m.shovel.visible=this.tool!=='shovel'||!this.active;
    this.game.fpsRig.visible=!this.blocksWork;
    if(this.blocksWork)this.game.hud.updateMobileUseStatus(this.carrying?'ΑΦΗΣΕ ΤΗ ΣΥΚΛΑ':this.tool==='mixer'?(this.mixingNow?'ΑΝΑΚΑΤΕΜΑ':'ΚΡΑΤΑ ΓΙΑ ΑΝΑΜΙΞΗ'):'ΧΡΗΣΗ ΣΤΟΝ ΣΤΑΘΜΟ',true,this.mixingNow);
    this.stationTrowel.visible=this.tool!=='trowel'||!this.active;
    m.water.visible=this.tool!=='water'||!this.active;
    this.held.visible=this.active&&!this.carrying;
    this.heldTools.forEach((model,key)=>{model.visible=this.held.visible&&key===this.tool&&!(key==='mixer'&&(this.inserted||this.cleanSeconds>0));});
    const trowel=this.heldTools.get('trowel')!,load=trowel.getObjectByName('trowel-load');if(load){load.visible=Boolean(state.heldTrowel);(load as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>).material.color.setHex(0xb2aaa0);}
    this.held.position.set(0,-.1,-.42);this.held.rotation.set(0,0,0);
    if(this.activity){
      const duration=this.activity==='tear'?.85:this.activity==='water'?1.35:1.55,p=THREE.MathUtils.clamp(this.activityTime/duration,0,1),reach=Math.sin(p*Math.PI);
      const object=this.activity==='water'||p>.57?m.bucket:this.activity==='sand'?m.sand:m.sacks[this.activitySack];
      const target=object.getWorldPosition(new THREE.Vector3());target.y+=this.activity==='sand'&&p<.57?.18:.34;
      const local=this.game.renderer.camera.worldToLocal(target.clone());this.held.position.lerp(local,.76*reach);
      if(this.activity==='water')this.held.rotation.z=-1.35*reach;
      else if(p>.57)this.held.rotation.z=(this.activity==='cement'?-1.5:-.95)*reach;
      else this.held.rotation.x=(this.activity==='tear'?.55:-.72)*reach;
    }
    if(this.actionTime>0){const phase=Math.sin((1-this.actionTime/.65)*Math.PI);this.held.position.y-=phase*.15;this.held.rotation.x=phase*.3;}
    this.poseHands();
    // The removed recipe panel needs no per-percent DOM refresh. Updating its
    // controls through 100 progress values caused needless mobile repaints
    // beside a continuously held INTERACT pointer.
    const key=JSON.stringify([this.active,this.tool,this.carrying,this.inserted,this.mixerDirty,this.finished,this.activity,this.message,b.volumeLitres,b.waterLitres,b.cementScoops,b.sandScoops,b.quality,Boolean(state.heldTrowel),Boolean(state.heldShovel)]);
    if(key===this.uiKey)return;this.uiKey=key;
    this.readout.innerHTML=`<b>${b.waterLitres.toFixed(1)} L</b> νερό · <b>${b.cementScoops.toFixed(0)}</b> μιστριές · <b>${b.sandScoops.toFixed(0)}</b> φτυαριές<br><b>${b.volumeLitres.toFixed(1)} / 20 L</b> · Ανάμιξη <b>${Math.round(b.mixProgress*100)}%</b><br><span class="mix-help">${qualityNames[b.quality]}</span>`;
    this.meter.value=b.mixProgress;this.feedback.textContent=this.message;
    this.finish.hidden=!b.ready||this.inserted||this.finished;
    this.toolbelt.querySelectorAll<HTMLButtonElement>('[data-mix-equip]').forEach(button=>{const pressed=String(this.active&&button.dataset.mixEquip===this.tool);if(button.getAttribute('aria-pressed')!==pressed)button.setAttribute('aria-pressed',pressed);});
  }
  private poseHands():void{
    const c=this.game.renderer.camera,active=this.active||this.carrying,right=new THREE.Vector3(1,0,0).applyQuaternion(c.quaternion);
    c.updateMatrixWorld(true);this.models.group.updateMatrixWorld(true);
    for(const arm of this.arms){arm.group.visible=active;arm.hand.visible=active;if(!active)continue;
      const model=this.heldTools.get(this.tool);
      if(model&&model.visible&&!(this.tool==='trowel'&&arm.side<0)){if(arm.hand.parent!==model)model.add(arm.hand);arm.hand.position.fromArray(arm.side===1?model.userData.gripPoint??[.15,0,0]:model.userData.secondaryGripPoint??[-.12,.7,0]);}
      else{if(arm.hand.parent!==this.models.group)this.models.group.add(arm.hand);const p=this.carrying?this.bucketPosition().add(new THREE.Vector3(arm.side*.18,.31,0)):this.inserted||this.cleanSeconds>0?this.models.mixer.localToWorld(new THREE.Vector3().fromArray(arm.side===1?this.models.mixer.userData.gripPoint:this.models.mixer.userData.secondaryGripPoint)):c.localToWorld(new THREE.Vector3(arm.side*.22,-.45,-.4));arm.hand.position.copy(this.models.group.worldToLocal(p));}
      arm.hand.rotation.set(0,0,this.tool==='mixer'?-Math.PI/2:0);
      arm.hand.updateWorldMatrix(true,true);
      const shoulder=c.position.clone().addScaledVector(right,arm.side*.18).add(new THREE.Vector3(0,-.3,0));
      const wrist=arm.hand.localToWorld(new THREE.Vector3().fromArray(arm.hand.userData.wristPoint));
      poseWorkerArm(arm,shoulder,wrist,right);
    }
  }
  get mixerRunning():boolean{return this.mixingNow;}
  get telemetry(){return{active:this.active,tool:this.tool,carrying:this.carrying,customSupply:this.customSupply,finished:this.finished,activity:this.activity,activityProgress:this.activity?this.activityTime/(this.activity==='tear'?.85:this.activity==='water'?1.35:1.55):0,inserted:this.inserted,mixerDirty:this.mixerDirty,mixing:this.mixingNow,cleaningSeconds:this.cleanSeconds,bucketPosition:this.bucketPosition().toArray(),heldToolVisible:this.heldTools.get(this.tool)?.visible??false,aimedTarget:this.aimedObject()?.kind??null,batch:this.batch.getState(),hint:this.message};}
}
