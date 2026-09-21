import * as THREE from 'three';
import type { Game } from '../core/Game';
import { WorkerBody } from '../player/WorkerBody';
import { FPSRig } from '../player/FPSRig';
import { ElectricalBox } from '../electrical/Box';
import { boxAssemblyBounds,boxAssemblyKey,boxModuleSize,type BoxModuleLayout } from '../electrical/BoxAssembly';
import { ChasingSystem } from './ChasingSystem';
import { apprenticePath,type FloorPoint } from './ApprenticeNavigation';
import type { BrickWall } from '../world/BrickWall';

type Phase='idle'|'fetching'|'picking-up'|'lifting'|'walking'|'breaking'|'done'|'blocked';
type Mode='off'|'point'|'layout'|'plan';
interface Job {anchor:THREE.Vector3;modules:BoxModuleLayout[];targets:THREE.Vector3[];cursor:number}
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
    this.highlight.name='Apprentice yellow directive';this.ghost.name='Apprentice box preview';scene.add(this.highlight,this.ghost);
    this.paperCanvas.width=1024;this.paperCanvas.height=768;
    this.paper=new THREE.Mesh(new THREE.PlaneGeometry(.42,.315),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(this.paperCanvas),side:THREE.DoubleSide}));
    this.paper.name='Electrical instruction drawing';this.paper.position.set(0,-.20,-.51);this.paper.rotation.x=-.15;this.paper.visible=false;game.renderer.camera.add(this.paper);this.drawPlan();
    const label=document.createElement('label');label.className='apprentice-count';label.innerHTML='Apprentices <select id="apprentice-count" aria-label="Apprentices"><option value="0">0</option><option value="1" selected>1</option></select>';
    document.querySelector('#start-button')!.after(label);
    label.querySelector('select')!.addEventListener('change',e=>{this.count=Number((e.target as HTMLSelectElement).value);});
    this.toolbar.id='apprentice-controls';this.toolbar.setAttribute('aria-label','Οδηγίες Apprentice');
    this.toolbar.innerHTML='<div class="apprentice-actions"><button data-apprentice="point">T · ΔΕΙΞΕ</button><button data-apprentice="layout">E · ΚΟΥΤΙΑ</button><button data-apprentice="confirm">OK · ENTER</button><button data-apprentice="plan">V · ΣΧΕΔΙΟ</button><button data-apprentice="cancel">ΕΞΟΔΟΣ</button></div>';
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
  get telemetry(){return{count:this.count,mode:this.mode,phase:this.phase,waiting:this.waiting,message:this.message,position:this.camera.position.toArray(),highlightSamples:this.lines.length,strikes:this.strikes,removedVolume:this.removedVolume,job:this.job?{anchor:this.job.anchor.toArray(),modules:this.job.modules,cursor:this.job.cursor,targets:this.job.targets.length}:null};}

  command(action:string):void {
    const g=this.game;if(!g.started)return;
    if(g.mixing.wheelbarrow.busy||g.mixing.blocksWork||g.pvc.blocksWork){g.hud.notify('Άφησε πρώτα τον εξοπλισμό που κρατάς.',false,1500);return;}
    if(action==='confirm'){this.confirm();return;}
    if(action==='layout'){
      if(!this.anchor){this.message='T · Δείξε πρώτα την περιοχή στον τοίχο';return;}
      if(!['idle','done','blocked'].includes(this.phase)){this.message='Ο Apprentice εκτελεί ήδη την επιβεβαιωμένη εργασία';return;}
      window.dispatchEvent(new CustomEvent('wirehouse:select-tool',{detail:'fitting'}));
      window.dispatchEvent(new CustomEvent('wirehouse:box-enter-assembly'));this.mode='layout';this.previewKey='';this.message='1–4 σύνδεση · τροχός 1G/2G · R περιστροφή · OK επιβεβαίωση';return;
    }
    if(action==='cancel'){
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
    if(this.mode==='point'&&(requested||this.game.input.actionHeld)&&['idle','done','blocked'].includes(this.phase)){
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
    if(!['idle','done','blocked'].includes(this.phase))return;
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
    this.job={anchor:this.anchor.clone(),modules,targets,cursor:0};this.strikes=0;this.removedVolume=0;this.stall=0;
    this.mode='point';this.ghost.visible=false;this.clear(this.highlight);this.lines.length=0;window.dispatchEvent(new CustomEvent('wirehouse:box-exit-assembly'));
    this.phase=this.hasHammer?'walking':'fetching';this.elapsed=0;this.path=[];this.message='Επιβεβαιώθηκε · ο Apprentice παίρνει το κάγκο';this.drawPlan();
  }
  private moveTo(destination:FloorPoint,dt:number):boolean{
    const pos=this.camera.position;
    if(Math.hypot(destination.x-pos.x,destination.z-pos.z)<.045){this.velocity.set(0,0,0);this.path=[];return true;}
    if(!this.path.length){const path=apprenticePath(pos,destination,this.game.mixing.collisionObstacles());if(!path){this.phase='blocked';this.message='Δεν υπάρχει ελεύθερη διαδρομή · μετακίνησε τον εξοπλισμό';return false;}this.path=path;}
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
    else if(this.hasHammer){
      this.rig.restHammer(this.camera);
      const target=this.hammer.getWorldPosition(new THREE.Vector3()),rotation=this.hammer.getWorldQuaternion(new THREE.Quaternion()),alpha=1-Math.exp(-8*dt);
      this.carriedPosition.lerp(target,alpha);this.carriedRotation.slerp(rotation,alpha);
      this.hammer.position.copy(this.hammer.parent!.worldToLocal(this.carriedPosition.clone()));
      this.hammer.quaternion.copy(this.hammer.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(this.carriedRotation));this.hammer.updateWorldMatrix(false,true);this.rig.poseArms(this.camera);
    }
    this.camera.updateMatrixWorld(true);
    this.body.update(dt,this.camera,{eyeHeight:this.camera.position.y,velocity:this.velocity,yaw:this.camera.rotation.y,pitch:this.camera.rotation.x},this.rig,'hammer',this.phase==='breaking',false);
    this.body.overview=true;this.presentUI();
  }
  private breakWall(dt:number):void{
    const job=this.job!,wall=this.game.room.brickWall;
    let target=job.targets[job.cursor];
    while(target&&!this.columnOccupied(target)){job.cursor++;target=job.targets[job.cursor];this.stall=0;}
    if(!target){
      const bounds=boxAssemblyBounds(job.modules);
      const clear=job.modules.every(m=>{const size=boxModuleSize(m),x=job.anchor.x+m.x-bounds.centerX,y=job.anchor.y+m.y-bounds.centerY;return wall.volume.cavityBox({x:x-size.width/2,y:y-size.height/2,z:FRONT-.049},{x:x+size.width/2,y:y+size.height/2,z:FRONT}).clear;});
      this.phase=clear?'done':'blocked';this.message=clear?'Το σπάσιμο ολοκληρώθηκε · επόμενη φάση: πηλός και κουτιά':'Υπάρχει υπόλοιπο υλικού στην κοιλότητα · απαιτείται έλεγχος';return;
    }
    const player=this.game.renderer.camera.position;
    if(Math.hypot(player.x-this.camera.position.x,player.z-this.camera.position.z)<.58){this.waiting=true;this.message='Κάνε λίγο χώρο για να δουλέψω';return;}
    this.camera.position.x=THREE.MathUtils.damp(this.camera.position.x,target.x,12,dt);
    this.camera.position.y=THREE.MathUtils.damp(this.camera.position.y,THREE.MathUtils.clamp(target.y+.33,.66,1.9),12,dt);
    this.camera.position.z=THREE.MathUtils.damp(this.camera.position.z,FRONT+.76,12,dt);
    this.camera.lookAt(target);this.camera.updateMatrixWorld(true);
    const contact=this.rig.contact(this.camera,this.hammerWall);this.cooldown-=dt;
    if(this.cooldown>0)return;this.cooldown=.10;
    if(!contact||Math.hypot(contact.point.x-target.x,contact.point.y-target.y)>.08){if(++this.stall>50){this.phase='blocked';this.message='Δεν φτάνω τη θέση με ασφαλή επαφή εργαλείου';}return;}
    const impact=this.debris.hitContact({...contact,energyJ:8,chisel:'flat',widthM:.035});
    this.strikes++;this.rig.strike();this.game.audio.play('hammer',.65);
    if(impact?.removedVolume){this.removedVolume+=impact.removedVolume;this.stall=0;}else if(++this.stall>80){this.phase='blocked';this.message='Το εργαλείο δεν προχωρά · χρειάζεται έλεγχος της επαφής';}
    this.message=`Σπάσιμο · ${Math.round(job.cursor/job.targets.length*100)}% της επιβεβαιωμένης περιοχής`;
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
      if(touch){const label=({point:'ΔΕΙΞΕ',layout:'ΚΟΥΤΙΑ',confirm:'OK',plan:'ΣΧΕΔΙΟ',cancel:'ΕΞΟΔΟΣ'} as Record<string,string>)[action!];if(b.textContent!==label)b.textContent=label;}
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
