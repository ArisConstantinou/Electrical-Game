import * as THREE from 'three';
import type { Game } from '../core/Game';
import { MortarBatch } from './MortarBatch';
import { createMixingStationModels, createMixerModel, createShovelModel, setMixingStationFill, setCementSackOpen, setMixerDirty, setShovelLoaded, updateMixingSurface } from '../world/MixingStationModels';
import { buildToolModel } from '../player/ToolModels';
import { workerHand, workerArm, poseWorkerArm, type WorkerArm } from '../player/WorkerArm';
import '../styles/mixing.css';

type MixingTool = 'trowel'|'shovel'|'mixer'|'water'|'hands';
type Action = 'water'|'cement'|'sand'|'pour'|'insert'|'rinse'|'carry'|'place'|'work'|'discard';
type QuickAction = 'water'|'cement'|'sand'|'mixer'|'rinse'|'carry'|'work';
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
  private holdPointer=false;
  private mixingNow=false;
  private cleanSeconds=0;
  private uiKey='';
  private elapsed=0;
  private readonly pouring:THREE.Points;
  private pouringTime=0;
  private visited=false;
  private previousCrouched=false;
  private sound:AudioContext|null=null;
  private motor:OscillatorNode|null=null;
  private gain:GainNode|null=null;
  private readonly activationDistance=2.8;
  private suppressInteractionFrame=false;
  private readonly mobileInteract:HTMLButtonElement|null;

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
    this.heldTools.forEach((model,key)=>{this.held.add(model);model.visible=false;if(key!=='trowel'){model.rotation.x=.6;const grip=new THREE.Vector3().fromArray(model.userData.gripPoint).applyEuler(model.rotation);model.position.set(.18,-.05,-.1).sub(grip);}});
    const particles=new THREE.BufferGeometry();particles.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(48),3));
    this.pouring=new THREE.Points(particles,new THREE.PointsMaterial({color:0xbda77e,size:.018,transparent:true,opacity:.85}));this.pouring.visible=false;game.renderer.scene.add(this.pouring);
    for(const side of [1,-1]){const hand=workerHand(side,'hose'),arm=workerArm(side,hand,new THREE.Vector3());game.renderer.scene.add(arm.group);this.arms.push(arm);}
    this.toggle=document.createElement('button');this.toggle.id='mixing-toggle';this.toggle.type='button';this.toggle.textContent='ΣΥΚΛΑ · ΦΤΙΑΞΕ ΠΥΛΟ';this.toggle.hidden=true;
    this.mobileInteract=game.hud.shell.querySelector('#mobile-interact');
    this.panel=document.createElement('section');this.panel.id='mixing-panel';this.panel.hidden=true;this.panel.setAttribute('aria-label','Παρασκευή πυλού');
    this.panel.innerHTML=`<header class="mix-header"><div><h2>Σταθμός πυλού</h2><p>Πάτησε το μεγάλο εικονίδιο του υλικού.</p></div><button type="button" class="mix-close" aria-label="Κλείσιμο σταθμού">×</button></header><div class="mix-readout"></div><progress max="1" value="0" aria-label="Ανάμιξη"></progress><p class="mix-feedback" role="status" aria-live="polite"></p><div class="mix-grid"><button type="button" class="mix-card" data-mix-quick="water"><span class="mix-icon" aria-hidden="true">💧</span><strong>ΝΕΡΟ</strong><small>+1 λίτρο</small></button>${[0,1,2].map(index=>`<button type="button" class="mix-card" data-mix-quick="cement" data-sack="${index}"><span class="mix-icon mix-sack-icon" aria-hidden="true">${index+1}</span><strong>ΤΣΙΜΕΝΤΟ ${index+1}</strong><small data-sack-state="${index}">Άνοιξε σακούλα</small></button>`).join('')}<button type="button" class="mix-card" data-mix-quick="sand"><span class="mix-icon" aria-hidden="true">⛏️</span><strong>ΑΜΜΟΣ</strong><small>+1 φτυαριά</small></button><button type="button" class="mix-card" data-mix-quick="mixer"><span class="mix-icon" aria-hidden="true">⚙️</span><strong>ΜΙΞΕΡ</strong><small class="mix-mixer-state">Βάλε στη σύκλα</small></button><button type="button" class="mix-card mix-hold-card" id="mixing-hold"><span class="mix-icon" aria-hidden="true">↻</span><strong>ΑΝΑΜΙΞΗ</strong><small>Κράτα πατημένο</small></button><button type="button" class="mix-card" data-mix-quick="rinse"><span class="mix-icon" aria-hidden="true">🚿</span><strong>ΞΕΠΛΥΜΑ</strong><small>Καθάρισε μίξερ</small></button><button type="button" class="mix-card" data-mix-quick="carry"><span class="mix-icon" aria-hidden="true">🪣</span><strong>ΣΥΚΛΑ</strong><small class="mix-bucket-state">Σήκωσε</small></button><button type="button" class="mix-card mix-work-card" data-mix-quick="work"><span class="mix-icon" aria-hidden="true">🔨</span><strong>ΤΟΙΧΟΣ</strong><small>Πιάσε μιστρί τοίχου</small></button></div><input id="mixing-water-step" type="hidden" value="1"><select id="mixing-sack" hidden aria-hidden="true"><option value="0">1</option><option value="1">2</option><option value="2">3</option></select><details><summary>Συνταγή και οδηγίες</summary><p class="mix-recipe">Νερό στο ⅓ της σύκλας, 6–7 μιστριές τσιμέντο και άμμος μέχρι να γεμίσει. Η πρώτη πίεση ανοίγει κάθε σακούλα· κάθε επόμενη ρίχνει αυτόματα μία μιστριά στη σύκλα.</p><button type="button" data-mix-action="discard">Άδειασε την παρτίδα</button><p class="mix-help">Κάθε εικονίδιο ολοκληρώνει ολόκληρη την πράξη. Το κανονικό μιστρί τοίχου είναι ξεχωριστό από το μιστρί μίξης.</p></details>`;
    this.readout=this.panel.querySelector('.mix-readout')!;this.feedback=this.panel.querySelector('.mix-feedback')!;this.meter=this.panel.querySelector('progress')!;
    game.hud.shell.append(this.toggle,this.panel);
    this.toggle.addEventListener('click',()=>{if(!this.active)this.setActive(true);else this.panel.hidden=!this.panel.hidden;this.holdPointer=false;this.uiKey='';});
    this.panel.addEventListener('pointerdown',event=>event.stopPropagation());
    this.panel.addEventListener('click',event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button');if(!button)return;if(button.classList.contains('mix-close')){this.setActive(false);return;}const quick=button.dataset.mixQuick as QuickAction;if(quick)this.quickAction(quick,Number(button.dataset.sack));const action=button.dataset.mixAction as Action;if(action)this.action(action);});
    const hold=this.panel.querySelector<HTMLButtonElement>('#mixing-hold')!;
    hold.addEventListener('pointerdown',event=>{event.preventDefault();hold.setPointerCapture(event.pointerId);this.holdPointer=true;this.enableSound();});
    for(const kind of ['pointerup','pointercancel','lostpointercapture'])hold.addEventListener(kind,()=>{this.holdPointer=false;});
    hold.addEventListener('keydown',event=>{if(event.code==='Space'||event.code==='Enter'){event.preventDefault();this.holdPointer=true;this.enableSound();}});
    hold.addEventListener('keyup',()=>{this.holdPointer=false;});hold.addEventListener('blur',()=>this.stop());
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
  private stop():void{this.holdPointer=false;this.mixingNow=false;if(this.gain&&this.sound)this.gain.gain.setTargetAtTime(0,this.sound.currentTime,.035);}
  private enableSound():void{
    if(!this.sound){this.sound=new AudioContext();this.motor=this.sound.createOscillator();this.gain=this.sound.createGain();this.motor.type='triangle';this.motor.frequency.value=86;this.gain.gain.value=0;this.motor.connect(this.gain).connect(this.sound.destination);this.motor.start();}
    void this.sound.resume().catch(()=>{});
  }
  chooseTool(tool:MixingTool):void{
    if(this.carrying&&tool!=='hands'){this.message='Άφησε πρώτα τη σύκλα στο δάπεδο.';return;}
    if(this.inserted&&tool!=='mixer'){this.message='Βγάλε πρώτα το μίκσερ από τη σύκλα.';return;}
    this.tool=tool;this.stop();this.game.input.resetTransientInput();this.message=`${names[tool]} στα χέρια. Τα υλικά που έχεις πάρει παραμένουν στο εργαλείο τους.`;
  }
  private quickAction(action:QuickAction,sackIndex=0):void{
    if(action==='work'){this.action('work');return;}
    if(action==='water'){this.chooseTool('water');this.action('water');return;}
    if(action==='cement'){
      this.panel.querySelector<HTMLSelectElement>('#mixing-sack')!.value=String(sackIndex);
      this.chooseTool('trowel');
      if(this.action('cement')&&this.batch.getState().heldTrowel)this.action('pour');
      return;
    }
    if(action==='sand'){
      this.chooseTool('shovel');
      if(this.action('sand')&&this.batch.getState().heldShovel)this.action('pour');
      return;
    }
    if(action==='mixer'){this.chooseTool('mixer');this.action('insert');return;}
    if(action==='rinse'){
      this.chooseTool('mixer');
      if(this.inserted)this.action('insert');
      this.action('rinse');
      return;
    }
    this.chooseTool('hands');this.action(this.carrying?'place':'carry');
  }
  private bucketPosition():THREE.Vector3{return this.models.bucket.getWorldPosition(new THREE.Vector3());}
  private near(object:THREE.Object3D,range=2.2):boolean{
    const point=object.getWorldPosition(new THREE.Vector3()),eye=this.game.renderer.camera.position;
    return Math.hypot(point.x-eye.x,point.z-eye.z)<=range;
  }
  canOpenFromInteract():boolean{
    if(this.carrying)return false;
    const c=this.game.renderer.camera;
    this.models.group.updateMatrixWorld(true);
    const station=this.models.group.getWorldPosition(this.stationPoint);
    if(Math.abs(station.y-c.position.y) > 2.0) return false;
    const dz=station.z-c.position.z,dx=station.x-c.position.x;
    if(Math.hypot(dx,dz) > this.activationDistance) return false;
    const direction=c.getWorldDirection(new THREE.Vector3());
    return direction.dot(new THREE.Vector3(dx,station.y+.35-c.position.y,dz).normalize())>.42;
  }
  handleInteractionRequest(requested:boolean):boolean{
    if(!requested || this.active || this.carrying || !this.canOpenFromInteract()) return false;
    this.setActive(true);
    this.suppressInteractionFrame=true;
    return true;
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
    if(!this.customSupply)return requested;
    if(this.blocksWork||!this.near(this.models.bucket,1.85)||!this.batch.ready){this.game.hud.notify('Έτοιμος πυλός χρειάζεται σε σύκλα κοντά σου.',false,1800);return 0;}
    return this.batch.consumeKg(requested);
  }
  get bondFactor():number{return !this.customSupply?1:this.batch.quality==='balanced'?1:this.batch.quality==='wet'?.45:this.batch.quality==='dry'?.55:.65;}
  update(dt:number,requested:boolean,heldInteraction:boolean):void{
    dt=Number.isFinite(dt)?Math.min(.05,Math.max(0,dt)):0;
    this.elapsed+=dt;this.pouringTime=Math.max(0,this.pouringTime-dt);
    const station=this.models.group.getWorldPosition(this.stationPoint),camera=this.game.renderer.camera.position;
    const distance=Math.hypot(station.x-camera.x,station.z-camera.z);
    if(this.active&&distance>this.activationDistance+.65)this.setActive(false);
    const interactAvailable=this.active||this.carrying||this.canOpenFromInteract();
    if(this.mobileInteract){this.mobileInteract.hidden=!interactAvailable;this.mobileInteract.querySelector('small')!.textContent=this.carrying?'ΑΦΗΣΕ ΣΥΚΛΑ':this.active?'ΣΤΟΧΕΥΣΕ ΑΝΤΙΚΕΙΜΕΝΟ':'ΑΝΟΙΞΕ ΣΤΑΘΜΟ';}
    this.toggle.hidden=!this.active&&!this.carrying;this.actionTime=Math.max(0,this.actionTime-dt);
    if(this.carrying){const c=this.game.renderer.camera,d=c.getWorldDirection(new THREE.Vector3());d.y=0;d.normalize();const p=c.position.clone().addScaledVector(d,.42);p.y=Math.max(.35,c.position.y-.95);this.models.bucket.position.copy(this.models.group.worldToLocal(p));}
    if(this.carrying&&requested)this.placeBucket();
    else if(this.active&&requested&&!this.holdPointer&&!this.suppressInteractionFrame)this.useAimedObject();
    this.suppressInteractionFrame=false;
    const held=this.active&&(this.holdPointer||heldInteraction);
    const direction=this.game.renderer.camera.getWorldDirection(new THREE.Vector3());
    const bucketAim=direction.dot(this.bucketPosition().add(new THREE.Vector3(0,.3,0)).sub(this.game.renderer.camera.position).normalize())>.88||direction.dot(this.bucketPosition().add(new THREE.Vector3(0,.75,0)).sub(this.game.renderer.camera.position).normalize())>.96;
    this.mixingNow=held&&this.tool==='mixer'&&this.inserted&&this.near(this.models.bucket,1.35)&&(this.holdPointer||bucketAim)&&!document.hidden;
    if(this.mixingNow){const before=this.batch.mixProgress;this.batch.mix(dt);if(this.batch.mixProgress>before||this.batch.ready)this.mixerDirty=true;this.message=qualityNames[this.batch.quality];}
    if(held&&this.tool==='mixer'&&this.inserted&&!this.near(this.models.bucket,1.35))this.message='Πλησίασε τη σύκλα για να ανακατέψεις.';
    if(this.cleanSeconds>0){if(this.active&&this.tool==='mixer'&&!this.inserted&&this.near(this.models.rinse,1.8)){this.cleanSeconds=Math.max(0,this.cleanSeconds-dt);if(this.cleanSeconds===0){this.mixerDirty=false;this.message='Το μίκσερ καθάρισε. Μπορείς να σηκώσεις τη σύκλα.';}}else{this.cleanSeconds=0;this.message='Το ξέπλυμα διακόπηκε. Πλησίασε ξανά με το μίκσερ.';}}
    if(this.gain&&this.sound)this.gain.gain.setTargetAtTime(this.mixingNow?.035:0,this.sound.currentTime,.06);
  }
  private useAimedObject():void{
    if(this.carrying){this.action('place');return;}
    const m=this.models,c=this.game.renderer.camera;this.ray.setFromCamera(new THREE.Vector2(),c);m.group.updateMatrixWorld(true);
    const hit=this.ray.intersectObjects([m.bucket,m.sand,...m.sacks,m.rinse,m.mixer,m.shovel],true)[0];if(!hit||hit.distance>3){this.message='Στόχευσε τη σύκλα ή το υλικό από κοντά.';return;}
    const belongs=(root:THREE.Object3D)=>{let o:THREE.Object3D|null=hit.object;while(o){if(o===root)return true;o=o.parent;}return false;};
    const index=m.sacks.findIndex(belongs);
    if(index>=0){this.panel.querySelector<HTMLSelectElement>('#mixing-sack')!.value=String(index);this.action('cement');}
    else if(belongs(m.sand))this.action('sand');else if(belongs(m.rinse))this.action('rinse');
    else if(belongs(m.bucket)){if(this.tool==='mixer'){if(!this.inserted)this.action('insert');}else this.action(this.tool==='water'?'water':this.tool==='hands'?'carry':'pour');}
    else if(belongs(m.mixer)){if(!this.inserted)this.chooseTool('mixer');}else if(belongs(m.shovel))this.chooseTool('shovel');
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
    m.sacks.forEach((sack,i)=>setCementSackOpen(sack,state.sacks[i].open));
    m.sand.scale.setScalar(Math.max(.1,Math.cbrt(state.sandRemainingKg/600)));
    if(this.inserted||this.cleanSeconds>0){m.mixer.position.copy(this.inserted?m.bucket.position:m.rinse.position);m.mixer.position.y+=.06;m.mixer.rotation.set(0,0,0);m.paddle.rotation.y+=this.mixingNow||this.cleanSeconds>0?.31:0;}
    else{m.mixer.position.copy(this.mixerHome);m.mixer.rotation.copy(this.mixerRotation);}
    m.mixer.visible=this.inserted||this.cleanSeconds>0||this.tool!=='mixer'||!this.active;m.shovel.visible=this.tool!=='shovel'||!this.active;
    this.game.fpsRig.visible=!this.blocksWork;
    if(this.blocksWork)this.game.hud.updateMobileUseStatus(this.carrying?'ΑΦΗΣΕ ΤΗ ΣΥΚΛΑ':this.tool==='mixer'?(this.mixingNow?'ΑΝΑΚΑΤΕΜΑ':'ΚΡΑΤΑ ΓΙΑ ΑΝΑΜΙΞΗ'):'ΧΡΗΣΗ ΣΤΟΝ ΣΤΑΘΜΟ',true,this.mixingNow);
    this.held.visible=this.active&&!this.carrying;
    this.heldTools.forEach((model,key)=>{model.visible=this.held.visible&&key===this.tool&&!(key==='mixer'&&(this.inserted||this.cleanSeconds>0));});
    const trowel=this.heldTools.get('trowel')!,load=trowel.getObjectByName('trowel-load');if(load){load.visible=Boolean(state.heldTrowel);(load as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>).material.color.setHex(0xb2aaa0);}
    this.held.position.set(0,-.22,-.35);this.held.rotation.set(0,0,0);
    if(this.actionTime>0){const phase=Math.sin((1-this.actionTime/.65)*Math.PI);this.held.position.y-=phase*.15;this.held.rotation.x=phase*.3;}
    this.poseHands();
    const key=JSON.stringify([this.active,this.tool,this.carrying,this.inserted,this.mixerDirty,this.message,b.volumeLitres,b.waterLitres,b.cementScoops,b.sandScoops,Math.floor(b.mixProgress*100),b.quality,Boolean(state.heldTrowel),Boolean(state.heldShovel)]);
    if(key===this.uiKey)return;this.uiKey=key;
    this.toggle.textContent=this.active?(this.panel.hidden?'ΑΝΟΙΞΕ ΠΑΝΕΛ':'ΚΛΕΙΣΕ ΠΑΝΕΛ'):this.carrying?'ΜΕΤΑΦΟΡΑ ΣΥΚΛΑΣ':'ΣΥΚΛΑ · ΦΤΙΑΞΕ ΠΥΛΟ';
    this.readout.innerHTML=`<b>${b.waterLitres.toFixed(1)} L</b> νερό · <b>${b.cementScoops.toFixed(0)}</b> μιστριές · <b>${b.sandScoops.toFixed(0)}</b> φτυαριές<br><b>${b.volumeLitres.toFixed(1)} / 20 L</b> · Ανάμιξη <b>${Math.round(b.mixProgress*100)}%</b><br><span class="mix-help">${qualityNames[b.quality]}${state.heldTrowel?' · Φορτωμένο μιστρί':''}${state.heldShovel?' · Γεμάτο φτυάρι':''}</span>`;
    this.meter.value=b.mixProgress;this.feedback.textContent=this.message;
    state.sacks.forEach((sack,index)=>{const label=this.panel.querySelector<HTMLElement>(`[data-sack-state="${index}"]`);if(label)label.textContent=sack.open?'+1 μιστριά στη σύκλα':'Άνοιξε σακούλα';});
    const mixerState=this.panel.querySelector<HTMLElement>('.mix-mixer-state');if(mixerState)mixerState.textContent=this.inserted?'Βγάλε από τη σύκλα':'Βάλε στη σύκλα';
    const bucketState=this.panel.querySelector<HTMLElement>('.mix-bucket-state');if(bucketState)bucketState.textContent=this.carrying?'Άφησε εδώ':'Σήκωσε';
    this.panel.querySelector<HTMLElement>('#mixing-hold')!.hidden=!this.inserted;
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
  get telemetry(){return{active:this.active,tool:this.tool,carrying:this.carrying,customSupply:this.customSupply,inserted:this.inserted,mixerDirty:this.mixerDirty,mixing:this.mixingNow,cleaningSeconds:this.cleanSeconds,bucketPosition:this.bucketPosition().toArray(),batch:this.batch.getState(),hint:this.message};}
}
