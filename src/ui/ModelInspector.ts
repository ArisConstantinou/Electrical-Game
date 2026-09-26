import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WorkerBody } from '../player/WorkerBody';
import { FPSRig, RIG_TOOLS, type RigTool } from '../player/FPSRig';
import { createDistributionBoardVisual } from '../electrical/DistributionBoardVisual';
import type { Game } from '../core/Game';
import '../styles/model-inspector.css';

const STANCES:Record<string,string>={idle:'Όρθιος',crouch:'Σκυφτός',walk:'Περπάτημα μπροστά',back:'Περπάτημα πίσω',left:'Πλάγια αριστερά',right:'Πλάγια δεξιά',jog:'Τρέξιμο',crouchLeft:'Πλάγια σκυφτός',spray:'Κράτημα σπρέι',press:'Πάτημα σπρέι',tool:'Κράτημα εργαλείου'};
type Entry={id:string;label:string;path:string;source?:THREE.Object3D};

/** Trials-style viewer: isolated asset inspection, or the actual world in LIVE. */
export class ModelInspector {
  readonly scene=new THREE.Scene();
  readonly camera=new THREE.PerspectiveCamera(42,1,.01,200);
  readonly panel=document.createElement('section');
  readonly controls:OrbitControls;
  active=false;
  live=false;
  selected='character';
  stance='idle';
  playing=true;
  speed=1;
  elapsed=0;
  entries:Entry[]=[];
  private worker:WorkerBody|null=null;
  private rig:FPSRig|null=null;
  private poseCamera=new THREE.PerspectiveCamera(72,1,.025,60);
  private preview:THREE.Object3D|null=null;
  private materials:THREE.Material[]=[];
  private geometries:THREE.BufferGeometry[]=[];
  private count=100;
  private lastWidth=0;
  private lastHeight=0;
  private busy=false;
  private followTarget=new THREE.Vector3();
  private aiming=false;
  private heldUse=false;
  private heldInteract=false;
  private aimMode=false;
  private statsTime=0;
  private openButton=document.createElement('button');
  private opening=false;
  private readonly boardReferences:THREE.Group[]=[];

  constructor(private game:Game){
    this.scene.background=new THREE.Color('#dfe7ea');
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:0xc7d4d9,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;this.scene.add(floor,new THREE.GridHelper(100,100,0x718c99,0xa9bec7));
    this.scene.add(new THREE.HemisphereLight(0xf0f5ff,0x716456,2.4));
    const key=new THREE.DirectionalLight(0xffffff,3.2);key.position.set(-3,5,-4);this.scene.add(key);
    const fill=new THREE.DirectionalLight(0xb6d5ff,1.4);fill.position.set(3,2,3);this.scene.add(fill);
    this.openButton.id='model-inspector-open';this.openButton.type='button';
    this.openButton.setAttribute('aria-label','Open 3D models');
    this.openButton.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m16 3 12 7v12l-12 7L4 22V10zM4 10l12 7 12-7M16 17v12"/></svg><span>3D MODELS</span><span class="model-settings-chevron" aria-hidden="true">›</span>';
    this.openButton.addEventListener('click',()=>{if(game.hud.shell.classList.contains('settings-open'))game.hud.shell.querySelector<HTMLButtonElement>('#settings-toggle')?.click();void this.open();});
    const settingsPanel=game.hud.shell.querySelector('#settings-panel');
    if(!settingsPanel)throw new Error('Model Inspector requires the game settings panel');
    settingsPanel.querySelector('header')?.after(this.openButton);
    this.panel.id='model-inspector';this.panel.hidden=true;this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-modal','true');this.panel.setAttribute('aria-label','3D models');
    this.panel.className='model-viewer';
    this.panel.innerHTML=`<header class="model-viewer__header"><div><span>MODEL INSPECTOR</span><h2>3D MODELS</h2></div><button id="model-close" type="button" aria-label="Close 3D models">✕</button></header>
      <nav class="model-viewer__subjects"><button id="model-character" aria-pressed="true">CHARACTER</button><button id="model-assets" aria-pressed="false">ALL ASSETS</button><button id="model-live" aria-pressed="false">LIVE CONTROL</button></nav>
      <nav class="model-viewer__forms"><div id="character-poses"><label for="model-stance">STANCE</label><select id="model-stance">${Object.entries(STANCES).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select><label for="model-tool">TOOL</label><select id="model-tool">${RIG_TOOLS.map(t=>`<option value="${t}">${t.toUpperCase()}</option>`).join('')}</select><button id="model-play" aria-pressed="true">PAUSE</button><button id="model-restart">RESET</button><label for="model-speed">SPEED <output id="model-speed-value">1×</output></label><input id="model-speed" type="range" min="0.25" max="2" value="1" step="0.25"></div><div id="model-live-controls" hidden><label for="model-live-tool">TOOL</label><select id="model-live-tool">${RIG_TOOLS.map(t=>`<option value="${t}">${t.toUpperCase()}</option>`).join('')}<option value="mix:shovel">ΦΤΥΑΡΙ</option><option value="mix:trowel">ΜΥΣΤΡΙ ΜΙΞΗΣ</option><option value="mix:mixer">CORDLESS MIXER</option><option value="mix:water">ΔΟΧΕΙΟ ΝΕΡΟΥ</option><option value="mix:hands">ΑΦΗΣΕ ΕΡΓΑΛΕΙΟ ΜΙΞΗΣ</option></select><button id="model-crouch">CROUCH / STAND</button><button id="model-follow" aria-pressed="true">FOLLOW</button></div></nav>
      <div id="model-orbit" class="model-viewer__stage" tabindex="0" aria-label="Drag to rotate; right drag to pan; wheel to zoom"><div class="model-caption"><strong id="model-title">Χαρακτήρας</strong><span id="model-status" role="status"></span></div><aside class="model-library" hidden><label for="model-search">Όλα τα αντικείμενα και μέρη</label><input id="model-search" type="search" placeholder="Αναζήτηση…"><output id="model-count"></output><div id="model-list"></div><button id="model-more">Περισσότερα</button></aside><i id="model-aim-marker" hidden>+</i></div>
      <footer class="model-viewer__footer"><div id="model-drive" class="model-viewer__drive-controls" hidden><div class="model-viewer__direction-pad"><button data-control-input="KeyW" aria-label="Move forward">↑</button><button data-control-input="KeyA" aria-label="Move left">←</button><button data-control-input="KeyS" aria-label="Move backward">↓</button><button data-control-input="KeyD" aria-label="Move right">→</button></div><div class="model-viewer__action-pad"><button data-control-input="ShiftLeft">FAST</button><button id="model-use">USE</button><button id="model-interact">INTERACT · E</button></div></div><div class="model-viewer__tools"><button id="model-front">FRONT</button><button id="model-back">BACK</button><button id="model-side">SIDE</button><button id="model-fit">RESET VIEW</button></div><p id="model-live-prompt" role="status"></p><p class="model-note">Το παιχνίδι είναι σε παύση. Η επιθεώρηση δεν αλλάζει τα αντικείμενα του κόσμου.</p><p id="model-controls-hint">Left-drag: rotate · Right-drag: pan · Wheel: zoom</p><output id="model-stats"></output></footer>`;
    game.hud.shell.parentElement!.append(this.panel);
    const surface=this.el<HTMLElement>('#model-orbit');
    this.controls=new OrbitControls(this.camera,surface);this.controls.enableDamping=false;this.controls.enablePan=true;this.controls.minDistance=.05;this.controls.maxDistance=120;
    const library=this.el('.model-library');
    for(const event of ['pointerdown','pointerup','wheel'])library.addEventListener(event,e=>e.stopPropagation());
    const aimButton=document.createElement('button');aimButton.textContent='AIM';aimButton.setAttribute('aria-pressed','false');this.el('#model-live-controls').append(aimButton);
    aimButton.addEventListener('click',()=>{this.aimMode=!this.aimMode;aimButton.setAttribute('aria-pressed',String(this.aimMode));});
    // Panel gestures must not reach world pointer handlers (cancel/use/relock).
    // OrbitControls listens for release on ownerDocument. Swallowing pointerup
    // here leaves ROTATE active, so later hover motion keeps spinning the model.
    // Releases may reach the world listeners: they only clear held input.
    for(const event of ['pointerdown','wheel','contextmenu'])this.panel.addEventListener(event,e=>e.stopPropagation());
    addEventListener('blur',()=>{this.heldUse=false;this.heldInteract=false;});
    this.el('#model-live').addEventListener('click',()=>this.setLive(!this.live));
    this.el('#model-character').addEventListener('click',()=>{this.el('.model-library').hidden=true;void this.select('character');});
    this.el('#model-assets').addEventListener('click',()=>{this.el('.model-library').hidden=!this.el('.model-library').hidden;});
    this.el('#model-crouch').addEventListener('click',()=>window.dispatchEvent(new CustomEvent('wirehouse:work-height')));
    this.el('#model-follow').addEventListener('click',()=>{const b=this.el('#model-follow');b.setAttribute('aria-pressed',String(b.getAttribute('aria-pressed')!=='true'));});
    this.el<HTMLSelectElement>('#model-live-tool').addEventListener('change',e=>{const tool=(e.target as HTMLSelectElement).value;if(tool.startsWith('mix:')){const name=tool.slice(4);document.querySelector<HTMLButtonElement>(name==='hands'?'#mixing-put-down':`[data-mix-equip="${name}"]`)?.click();}else window.dispatchEvent(new CustomEvent('wirehouse:select-tool',{detail:tool}));});
    const held=(selector:string,interact:boolean)=>{const button=this.el(selector);button.addEventListener('pointerdown',e=>{if(!this.live)return;e.preventDefault();button.setPointerCapture(e.pointerId);this.use(true,interact);});for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,()=>this.use(false,interact));};
    held('#model-use',false);held('#model-interact',true);
    this.panel.querySelectorAll<HTMLElement>('[data-control-input]').forEach(button=>{button.addEventListener('pointerdown',e=>{if(!this.live)return;e.preventDefault();button.setPointerCapture(e.pointerId);this.game.input.keys.add(button.dataset.controlInput!);});for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,()=>this.game.input.keys.delete(button.dataset.controlInput!));});
    addEventListener('keyup',e=>{if(this.live&&e.code==='Enter')this.use(false,false);},true);
    surface.addEventListener('pointerdown',e=>{if(!this.live||e.button!==0||!(e.altKey||this.aimMode))return;this.aiming=true;this.controls.enabled=false;surface.setPointerCapture(e.pointerId);},true);
    surface.addEventListener('pointermove',e=>{if(this.live&&this.aiming)this.game.player.look(e.movementX,e.movementY);});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(event,()=>{if(this.live){this.aiming=false;this.controls.enabled=true;}});
    this.el('#model-close').addEventListener('click',()=>this.close());
    this.el<HTMLInputElement>('#model-search').addEventListener('input',()=>{this.count=100;this.renderList();});
    this.el('#model-more').addEventListener('click',()=>{this.count+=100;this.renderList();});
    this.el<HTMLSelectElement>('#model-stance').addEventListener('change',e=>{this.stance=(e.target as HTMLSelectElement).value;this.elapsed=0;this.updatePose(0);});
    this.el('#model-tool').addEventListener('change',()=>{this.stance='tool';this.el<HTMLSelectElement>('#model-stance').value='tool';this.updatePose(0);});
    this.el('#model-play').addEventListener('click',()=>{this.playing=!this.playing;this.el('#model-play').textContent=this.playing?'PAUSE':'PLAY';this.el('#model-play').setAttribute('aria-pressed',String(this.playing));});
    this.el('#model-restart').addEventListener('click',()=>{this.elapsed=0;if(this.worker)this.worker.resetPreviewMotion();this.updatePose(0);});
    this.el<HTMLInputElement>('#model-speed').addEventListener('input',e=>{this.speed=Number((e.target as HTMLInputElement).value);this.el('#model-speed-value').textContent=`${this.speed}×`;});
    for(const [id,direction] of [['front',new THREE.Vector3(0,.05,-1)],['back',new THREE.Vector3(0,.05,1)],['side',new THREE.Vector3(1,.05,0)],['fit',new THREE.Vector3(.15,.08,-1)]] as const)this.el(`#model-${id}`).addEventListener('click',()=>this.fit(this.isBoardReference()&&id!=='side'?direction.clone().multiply(new THREE.Vector3(1,1,-1)):direction));
    // Capture before gameplay listeners: text entry/orbiting must never use a tool.
    addEventListener('keydown',e=>{if(!this.active)return;if(e.code==='Escape'){e.preventDefault();this.close();e.stopImmediatePropagation();return;}const typing=e.target instanceof Element&&e.target.closest('input,select,textarea');if(e.code==='KeyC'&&!typing){e.preventDefault();this.faceFront();e.stopImmediatePropagation();return;}if(!this.live||typing){e.stopImmediatePropagation();return;}if(e.code==='Space'){e.preventDefault();if(!e.repeat)window.dispatchEvent(new CustomEvent('wirehouse:jump'));}if(e.code==='Enter'){e.preventDefault();if(!e.repeat)this.use(true,false);}},true);
  }
  private el<T extends HTMLElement=HTMLElement>(selector:string):T{return this.panel.querySelector<T>(selector)!;}
  private status(message:string):void{this.el('#model-status').textContent=message;}

  async open():Promise<void>{
    if(this.active||this.opening)return;
    this.opening=true;
    try{
      await this.game.workerBody.ready;
      await this.game.renderer.waitForFrame();
      this.active=true;this.panel.hidden=false;this.game.input.resetTransientInput();this.game.mortar.cancel();if(document.pointerLockElement)document.exitPointerLock();
      this.game.hud.shell.classList.add('model-open');this.game.renderer.modelScene=this.scene;this.game.renderer.viewCamera=this.camera;
      dispatchEvent(new CustomEvent('wirehouse:model-inspector-open'));
      this.buildLibrary();this.resize();this.controls.enabled=true;this.el('#model-close').focus();
      await this.select('character');
    }finally{this.opening=false;}
  }
  close():void{
    this.setLive(false);this.active=false;this.panel.hidden=true;this.controls.enabled=false;this.game.input.resetTransientInput();
    this.game.hud.shell.classList.remove('model-open');this.game.renderer.modelScene=null;this.game.renderer.modelViewport=null;this.game.renderer.viewCamera=null;
    this.game.hud.shell.querySelector<HTMLButtonElement>('#settings-toggle')?.focus();
  }
  private buildLibrary():void{
    if(this.boardReferences.length===0)this.boardReferences.push(createDistributionBoardVisual('first-fix'),createDistributionBoardVisual('second-fix'));
    this.entries=[{id:'character',label:'Χαρακτήρας · ζωντανές στάσεις',path:'CHARACTER'}];
    for(const board of this.boardReferences)this.entries.push({id:board.uuid,label:board.name,path:`ELECTRICAL REFERENCES / ${board.name}`,source:board});
    const visit=(o:THREE.Object3D,path:string):boolean=>{
      if(o===this.game.workerBody)return false;
      const label=o.name||`${o.type} ${o.id}`,next=path?`${path} / ${label}`:label;
      const children=o.children.map(c=>visit(c,next));
      const renderable=(o as THREE.Mesh).isMesh||(o as THREE.Line).isLine||(o as THREE.Points).isPoints||children.some(Boolean);
      if(renderable&&o!==this.game.renderer.scene&&!((o as THREE.Camera).isCamera))this.entries.push({id:o.uuid,label,path:next,source:o});
      return Boolean(renderable);
    };
    visit(this.game.renderer.scene,'');
    this.entries.splice(1,this.entries.length-1,...this.entries.slice(1).sort((a,b)=>a.path.localeCompare(b.path)));
    this.renderList();
  }
  private renderList():void{
    const query=this.el<HTMLInputElement>('#model-search').value.trim().toLowerCase();
    const matches=this.entries.filter(e=>(e.label+' '+e.path).toLowerCase().includes(query));
    this.el('#model-count').textContent=`${matches.length} αντικείμενα / μέρη`;
    const list=this.el('#model-list');list.replaceChildren();
    for(const entry of matches.slice(0,this.count)){const button=document.createElement('button');button.type='button';button.dataset.modelId=entry.id;button.setAttribute('aria-pressed',String(entry.id===this.selected));button.textContent=entry.label;button.title=entry.path;button.addEventListener('click',()=>void this.select(entry.id));list.append(button);}
    this.el('#model-more').hidden=matches.length<=this.count;
  }
  async select(id:string):Promise<void>{
    const entry=this.entries.find(e=>e.id===id);if(!entry)return;
    if(this.live)this.setLive(false);this.selected=id;this.clearPreview();this.el('.model-library').hidden=true;this.el('#model-character').setAttribute('aria-pressed',String(id==='character'));this.el('#model-assets').setAttribute('aria-pressed',String(id!=='character'));this.el('#model-title').textContent=entry.label;this.el('#character-poses').hidden=id!=='character';this.renderList();
    if(id==='character'){
      this.busy=true;this.status('Φόρτωση χαρακτήρα…');
      try{
        if(!this.worker){this.worker=new WorkerBody(this.scene);this.rig=new FPSRig();this.scene.add(this.poseCamera);this.poseCamera.add(this.rig);}
        await Promise.all([this.worker.ready,this.rig!.hammerReady]);
        if(!this.active||this.selected!=='character'){this.worker.visible=false;this.poseCamera.visible=false;return;}
        this.worker.visible=true;this.poseCamera.visible=true;this.worker.overview=true;this.updatePose(0);this.fit();this.status('Ζωντανό μοντέλο · ίδια γεωμετρία και λαβές με το παιχνίδι');
      }catch(error){this.status(`Δεν φορτώθηκε ο χαρακτήρας: ${String(error)}`);}finally{this.busy=false;}
    }else if(entry.source){
      this.preview=this.copyAsset(entry.source);this.preview.position.set(0,0,0);this.preview.quaternion.identity();entry.source.getWorldScale(this.preview.scale);this.preview.visible=true;this.scene.add(this.preview);this.preview.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(this.preview);if(!bounds.isEmpty())this.preview.position.y-=bounds.min.y;this.fit();this.status(entry.path);
    }
  }
  private clearPreview():void{
    this.preview?.traverse(object=>{if(object instanceof THREE.InstancedMesh)object.dispose();});
    this.preview?.removeFromParent();this.preview=null;for(const m of this.materials)m.dispose();for(const g of this.geometries)g.dispose();this.materials=[];this.geometries=[];
    if(this.worker)this.worker.visible=false;this.poseCamera.visible=false;
  }
  private copyAsset(source:THREE.Object3D):THREE.Object3D{
    // Avoid constructors of gameplay subclasses, which can create world side effects.
    let result:THREE.Object3D;
    if(source instanceof THREE.SkinnedMesh){
      source.skeleton.update();const geometry=source.geometry.clone(),p=geometry.getAttribute('position'),v=new THREE.Vector3();
      for(let i=0;i<p.count;i++){source.getVertexPosition(i,v);p.setXYZ(i,v.x,v.y,v.z);}geometry.deleteAttribute('skinIndex');geometry.deleteAttribute('skinWeight');geometry.computeVertexNormals();this.geometries.push(geometry);result=new THREE.Mesh(geometry,source.material);
    }else if(source instanceof THREE.InstancedMesh)result=new THREE.InstancedMesh(source.geometry,source.material,source.count).copy(source,false);
    else if(source instanceof THREE.Mesh)result=new THREE.Mesh(source.geometry,source.material);
    else if(source instanceof THREE.LineSegments)result=new THREE.LineSegments(source.geometry,source.material);
    else if(source instanceof THREE.Line)result=new THREE.Line(source.geometry,source.material);
    else if(source instanceof THREE.Points)result=new THREE.Points(source.geometry,source.material);
    else result=new THREE.Group();
    result.name=source.name;result.position.copy(source.position);result.quaternion.copy(source.quaternion);result.scale.copy(source.scale);result.visible=source.visible;
    const mesh=result as THREE.Mesh;if(mesh.material){const material=(m:THREE.Material)=>{const c=m.clone();c.colorWrite=true;c.depthWrite=true;c.depthTest=true;this.materials.push(c);return c;};mesh.material=Array.isArray(mesh.material)?mesh.material.map(material):material(mesh.material);}
    for(const child of source.children)if(!(child instanceof THREE.Light)&&!(child instanceof THREE.Camera)&&!(source.name==='FPS hammer tool'&&child.name.includes('five-finger')))result.add(this.copyAsset(child));
    return result;
  }
  private updatePose(dt:number):void{
    if(!this.worker?.loaded||!this.rig||this.selected!=='character')return;
    const crouch=this.stance==='crouch'||this.stance==='crouchLeft';
    const moving=['walk','back','left','right','jog','crouchLeft'].includes(this.stance);
    const velocity=new THREE.Vector3(this.stance==='left'||this.stance==='crouchLeft'?-1:this.stance==='right'?1:0,0,this.stance==='back'?1:this.stance==='walk'||this.stance==='jog'?-1:0).multiplyScalar(this.stance==='jog'?3.4:crouch?.6:1.2);
    const tool=this.stance==='tool'?this.el<HTMLSelectElement>('#model-tool').value as RigTool:'spray';
    this.poseCamera.position.set(0,crouch?.95:1.65,0);this.poseCamera.rotation.set(-.25,0,0);this.poseCamera.updateMatrixWorld(true);
    this.rig.show(tool);this.rig.visible=['spray','press','tool'].includes(this.stance);this.rig.update(dt,moving,this.stance==='press');
    if(tool==='laser')this.rig.poseLaser(this.poseCamera);else this.rig.poseArms(this.poseCamera);
    this.worker.update(dt,this.poseCamera,{eyeHeight:crouch?.95:1.65,pitch:-.25,yaw:0,velocity},this.rig,tool,this.stance==='press',false);this.worker.overview=true;
  }
  private isBoardReference():boolean{return this.boardReferences.some(board=>board.uuid===this.selected);}
  private fit(direction=this.isBoardReference()?new THREE.Vector3(.15,.08,1):new THREE.Vector3(.15,.08,-1)):void{
    // Discard pending orbit inertia before an explicit FRONT/RESET command.
    const damping=this.controls.enableDamping;this.controls.enableDamping=false;this.controls.update();
    this.controls.enableDamping=damping;direction=direction.clone();
    const root=this.live?this.game.workerBody:this.selected==='character'?this.worker:this.preview;if(!root)return;
    root.updateMatrixWorld(true);root.traverse(o=>{if(o instanceof THREE.SkinnedMesh){o.skeleton.update();o.computeBoundingBox();}});
    const box=new THREE.Box3().setFromObject(root),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    if(box.isEmpty()||!Number.isFinite(size.length()))return;
    const radius=Math.max(.025,size.length()/2),fov=THREE.MathUtils.degToRad(this.camera.fov),angle=Math.min(fov,2*Math.atan(Math.tan(fov/2)*this.camera.aspect));
    const framing=this.preview?.name==='FPS hammer tool' ? .68 : this.isBoardReference() ? .79 : 1.12;
    const distance=radius/Math.sin(angle/2)*framing;this.controls.target.copy(center);if(this.live)direction.applyAxisAngle(new THREE.Vector3(0,1,0),this.game.workerBody.rotation.y);this.camera.position.copy(center).addScaledVector(direction.normalize(),distance);this.camera.near=Math.max(.002,distance/1000);this.camera.far=Math.max(200,distance*5);this.camera.updateProjectionMatrix();this.controls.update();
  }
  private resize():void{
    const rect=this.el('#model-orbit').getBoundingClientRect(),canvas=this.game.renderer.webgl.domElement.getBoundingClientRect(),w=rect.width,h=rect.height;
    this.game.renderer.modelViewport={x:rect.left-canvas.left,y:rect.top-canvas.top,width:w,height:h};
    if(w===this.lastWidth&&h===this.lastHeight)return;this.lastWidth=w;this.lastHeight=h;
    this.camera.aspect=w/Math.max(1,h);this.camera.updateProjectionMatrix();this.fit();
  }
  update(dt:number):void{
    if(!this.active)return;this.resize();this.controls.update();
    if(this.playing&&!this.busy){this.elapsed+=dt*this.speed;this.updatePose(dt*this.speed);}
    this.statsTime+=dt;if(this.statsTime>.3){this.statsTime=0;this.el('#model-stats').textContent=this.selected==='character'?`${STANCES[this.stance]} · ${this.elapsed.toFixed(1)} s`:`${this.entries.length} διαθέσιμα αντικείμενα / μέρη`;}
  }
  private use(down:boolean,interact:boolean):void{if(!this.live)return;if(interact)this.heldInteract=down;else this.heldUse=down;const input=this.game.input;input.actionHeld=this.heldUse||this.heldInteract;if(down)input.actionRequested=true;if(interact){input.interactionHeld=down;if(down)input.interactionRequested=true;}}
  setLive(value:boolean):void{
    this.live=value&&this.active;this.panel.dataset.live=String(this.live);this.heldUse=false;this.heldInteract=false;this.game.input.resetTransientInput();this.game.mortar.cancel();this.el('.model-library').hidden=true;this.el('#model-aim-marker').hidden=true;
    this.el('#model-live').setAttribute('aria-pressed',String(this.live));this.el('#model-live').textContent='LIVE CONTROL';this.el('#model-drive').hidden=!this.live;this.el('#model-controls-hint').textContent=this.live?'WASD: move · Shift: fast · V: crouch · Space: jump · Enter: use · E: interact · AIM / Alt + drag: aim · Left-drag: orbit · Right-drag: pan · Wheel: zoom':'Left-drag: rotate · Right-drag: pan · Wheel: zoom';
    this.el('#model-live-controls').hidden=!this.live;this.el('#character-poses').hidden=this.live||this.selected!=='character';
    this.el('.model-note').textContent=this.live?'LIVE: Οι ενέργειες επηρεάζουν κανονικά το παιχνίδι. Τα μοντέλα και οι κινήσεις είναι τα πραγματικά.':'Το παιχνίδι είναι σε παύση. Η επιθεώρηση δεν αλλάζει αντικείμενα ή υλικά του κόσμου.';
    this.game.renderer.modelScene=this.live?null:this.scene;this.game.renderer.viewCamera=this.camera;
    this.controls.mouseButtons.LEFT=THREE.MOUSE.ROTATE;this.controls.mouseButtons.RIGHT=THREE.MOUSE.PAN;
    if(this.live){this.followTarget.copy(this.game.workerBody.position);this.el('#model-title').textContent='Πραγματικός χαρακτήρας · LIVE GAMEPLAY';this.el<HTMLSelectElement>('#model-live-tool').value=this.game.selectedTool;this.fit();}
    else if(this.active){this.fit();this.el('#model-title').textContent=this.entries.find(e=>e.id===this.selected)?.label??'';}
  }
  faceFront():void{this.fit(new THREE.Vector3(0,.05,this.isBoardReference()?1:-1));}
  beforeWorld(_dt:number):void{if(this.live){this.game.input.actionHeld=this.heldUse||this.heldInteract||this.game.input.pressed('KeyE');this.game.input.interactionHeld=this.heldInteract||this.game.input.pressed('KeyE');}}
  afterWorld(dt:number):void{
    if(!this.active||!this.live)return;
    this.resize();const target=this.game.workerBody.position;
    if(this.el('#model-follow').getAttribute('aria-pressed')==='true'){const delta=target.clone().sub(this.followTarget);this.camera.position.add(delta);this.controls.target.add(delta);}this.followTarget.copy(target);this.controls.update();
    this.game.renderer.viewCamera=this.camera;this.elapsed+=dt;
    const gaze=this.game.renderer.camera,ray=new THREE.Raycaster(gaze.getWorldPosition(new THREE.Vector3()),gaze.getWorldDirection(new THREE.Vector3()),0,12);
    const hit=ray.intersectObjects([this.game.room,this.game.mixing.models.group],true)[0];
    const aim=(hit?.point??ray.ray.at(3,new THREE.Vector3())).clone().project(this.camera),marker=this.el('#model-aim-marker');
    marker.hidden=aim.z<-1||aim.z>1||Math.abs(aim.x)>1||Math.abs(aim.y)>1;
    marker.style.left=`${(aim.x+1)*50}%`;marker.style.top=`${(1-aim.y)*50}%`;
    this.el('#model-stats').textContent=`LIVE · ${this.game.mixing.active?this.game.mixing.tool:this.game.selectedTool}`;
    const prompt=document.querySelector<HTMLElement>('#mixing-world-prompt');this.el('#model-live-prompt').textContent=prompt&&!prompt.hidden?prompt.textContent:document.querySelector('#interaction-prompt')?.textContent??'';
    this.status('WASD · V · E · χρήση εργαλείων · αριστερό σύρσιμο για κάμερα · Alt + αριστερό σύρσιμο για στόχευση');
  }
  get telemetry(){return {open:this.active,live:this.live,selected:this.selected,stance:this.stance,playing:this.playing,elapsed:this.elapsed,assets:this.entries.length,loaded:this.worker?.loaded??false};}
}
