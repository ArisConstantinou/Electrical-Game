import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { WheelbarrowModel } from '../world/SiteEquipmentModels';
import { setWheelbarrowFill } from '../world/SiteEquipmentModels';
import type { WorkerGripTarget } from '../player/WorkerArm';
import { GAME_CONFIG } from '../data/gameConfig';
import '../styles/wheelbarrow.css';

type Parcel={mass:number;position:THREE.Vector3;velocity:THREE.Vector3;scale:THREE.Vector3;rotation:THREE.Quaternion;settled:boolean};
const UP=new THREE.Vector3(0,1,0),clamp=THREE.MathUtils.clamp;

/** Bounded fixed-step cart dynamics; every spilled kilogram remains recoverable. */
export class Wheelbarrow {
  readonly capacityKg=114;
  massKg=114;
  shovelKg=0;
  consumedKg=0;
  driving=false;
  state:'parked'|'driving'|'tipping'|'flipped'|'righting'='parked';
  readonly velocity=new THREE.Vector3();
  readonly spills:THREE.InstancedMesh;
  private readonly parcels:Parcel[]=[];
  private readonly wheel:THREE.Object3D;
  private readonly wheelBase:THREE.Quaternion;
  private readonly panel:HTMLElement;
  private readonly dot:HTMLElement;
  private readonly text:HTMLElement;
  private readonly support:THREE.Vector3[]=[];
  private readonly stanceAnchor=new THREE.Vector3();
  private readonly carryRotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.12);
  private baseSurface:Float32Array;
  private fill=-1;
  private yaw=0;
  private pitch=0;
  private roll=0;
  private pitchSpeed=0;
  private rollSpeed=0;
  private wheelAngle=0;
  private slosh=new THREE.Vector2();
  private sloshSpeed=new THREE.Vector2();
  private accumulator=0;
  private time=0;
  private tipTime=0;
  private tipEnd=new THREE.Vector2();
  private tipStart=new THREE.Vector2();
  private recoveryStart=new THREE.Vector2();
  private savedCrouch=false;
  private handAction:{kind:'scoop'|'deposit';point:THREE.Vector3;elapsed:number;committed:boolean}|null=null;
  private readonly dummy=new THREE.Object3D();
  private readonly lastPosition=new THREE.Vector3();
  stability=0;
  speed=0;
  blocked=false;
  constructor(readonly model:WheelbarrowModel,private readonly game:Game){
    game.renderer.scene.attach(model.group);
    this.yaw=model.group.rotation.y;
    this.wheel=model.group.getObjectByName('single-pneumatic-wheel')!;this.wheelBase=this.wheel.quaternion.clone();
    model.group.updateWorldMatrix(true,true);const inverse=model.group.matrixWorld.clone().invert();
    // Actual authored surface vertices supply floor support through any rotation.
    for(const name of ['pressed-yellow-tray','continuous-handle-rail-1','continuous-handle-rail--1','bent-support-leg-1','bent-support-leg--1','single-pneumatic-wheel-rubber-carcass']){
      const object=model.group.getObjectByName(name) as THREE.Mesh;
      const p=object.geometry.getAttribute('position'),matrix=inverse.clone().multiply(object.matrixWorld);
      for(let i=0;i<p.count;i+=3)this.support.push(new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(matrix));
    }
    const carryFloor=-Math.min(...this.support.map(p=>p.clone().applyQuaternion(this.carryRotation).y))+.002;
    this.stanceAnchor.set(0,-carryFloor,-1.13).applyQuaternion(this.carryRotation.clone().invert());
    this.baseSurface=new Float32Array(model.mortar.geometry.getAttribute('position').array);
    const geo=new THREE.SphereGeometry(1,12,8);const pos=geo.getAttribute('position');
    for(let i=0;i<pos.count;i++){const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i),r=1+.065*Math.sin(x*16+z*13)*Math.cos(y*17);pos.setXYZ(i,x*r,y*r,z*r);}geo.computeVertexNormals();
    this.spills=new THREE.InstancedMesh(geo,(model.mortar.material as THREE.Material).clone(),240);
    this.spills.name='Recoverable spilled wheelbarrow mortar';this.spills.count=0;this.spills.castShadow=true;this.spills.receiveShadow=true;this.spills.frustumCulled=false;game.renderer.scene.add(this.spills);
    this.panel=document.createElement('aside');this.panel.id='wheelbarrow-guide';this.panel.hidden=true;
    this.panel.innerHTML='<b>ΚΑΡΟΤΣΙ · ΙΣΟΡΡΟΠΙΑ</b><div class="cart-guide-row"><div class="cart-level" aria-label="Κλίση καροτσιού"><span class="cart-safe"></span><i></i></div><div class="cart-readout"></div></div><small>WASD · ΚΙΝΗΣΗ &nbsp; MOUSE · ΣΤΡΟΦΗ<br>SHIFT · ΓΡΗΓΟΡΑ &nbsp; E · ΑΦΗΣΕ</small>';
    this.dot=this.panel.querySelector('i')!;this.text=this.panel.querySelector('.cart-readout')!;game.hud.shell.append(this.panel);
    addEventListener('blur',()=>{if(this.driving)this.release();});
  }
  get busy():boolean{return this.driving||this.state==='righting';}
  get floorKg():number{return this.parcels.filter(p=>p.settled).reduce((s,p)=>s+p.mass,0);}
  get airborneKg():number{return this.parcels.filter(p=>!p.settled).reduce((s,p)=>s+p.mass,0);}
  get recovering():boolean{return this.handAction!==null;}
  get recoveryPose(){return this.handAction?{...this.handAction,progress:clamp(this.handAction.elapsed/1.2,0,1)}:null;}
  enter():boolean{
    if(this.state==='flipped'){this.state='righting';this.tipTime=0;this.recoveryStart.set(this.pitch,this.roll);return true;}
    if(this.state!=='parked'||this.handAction)return false;
    const root=this.model.group,back=new THREE.Vector3(0,0,-.96).applyAxisAngle(UP,this.yaw).add(root.position);
    const room=GAME_CONFIG.room;if(Math.abs(back.x)>room.width/2-.28||back.z<room.wallFrontZ+.28||back.z>room.depth/2-.28){this.game.hud.notify('Χρειάζεται χώρος πίσω από τις λαβές.',false,1600);return false;}
    this.savedCrouch=this.game.player.crouched;this.game.player.crouched=false;this.game.player.workPosition.locked=false;
    this.game.player.yaw=this.yaw+Math.PI;this.game.player.pitch=-.60;
    this.game.renderer.camera.position.copy(back).setY(1.65);this.game.renderer.camera.rotation.set(-.60,this.game.player.yaw,0);
    this.velocity.set(0,0,0);this.driving=true;this.state='driving';return true;
  }
  release():void{this.driving=false;this.velocity.set(0,0,0);if(this.state==='driving')this.state='parked';this.game.player.crouched=this.savedCrouch;}
  consume(amount:number):number{if(this.state!=='parked')return 0;const take=Math.min(Math.max(0,amount),this.massKg);this.massKg-=take;this.consumedKg+=take;return take;}
  scoop(point:THREE.Vector3):boolean{
    if(this.shovelKg>0||this.handAction||!this.parcels.some(p=>p.settled&&p.mass>0&&p.position.distanceTo(point)<.6))return false;
    this.handAction={kind:'scoop',point:point.clone(),elapsed:0,committed:false};return true;
  }
  deposit():boolean{
    if(this.state!=='parked'||this.shovelKg<=0||this.handAction||this.massKg>=this.capacityKg)return false;
    this.handAction={kind:'deposit',point:this.model.group.localToWorld(new THREE.Vector3(0,.7,0)),elapsed:0,committed:false};return true;
  }
  update(dt:number):void{
    if(document.hidden)return;
    this.accumulator+=clamp(dt,0,.05);
    while(this.accumulator>=1/120){this.step(1/120);this.accumulator-=1/120;}
    if(this.driving){const back=new THREE.Vector3(0,0,-.96).applyAxisAngle(UP,this.yaw).add(this.model.group.position);this.game.renderer.camera.position.copy(back).setY(1.65);this.game.player.velocity.copy(this.velocity);}
    this.present();
  }
  private step(dt:number):void{
    this.time+=dt;this.blocked=false;const root=this.model.group,oldVelocity=this.velocity.clone(),forward=new THREE.Vector3(Math.sin(this.yaw),0,Math.cos(this.yaw)),right=new THREE.Vector3(Math.cos(this.yaw),0,-Math.sin(this.yaw));
    let turn=0;
    if(this.driving){
      const input=this.game.input;let x=Number(input.pressed('KeyD'))-Number(input.pressed('KeyA'))+input.mobileMove.x,y=Number(input.pressed('KeyW'))-Number(input.pressed('KeyS'))-input.mobileMove.y;
      const magnitude=Math.max(1,Math.hypot(x,y));x/=magnitude;y/=magnitude;
      const fast=input.pressed('ShiftLeft')||input.pressed('ShiftRight'),speed=fast?3.1:1.05;
      const target=forward.clone().multiplyScalar(y*speed).addScaledVector(right,-x*speed),change=target.sub(this.velocity),limit=(fast?9:1.8)*dt;
      if(change.length()>limit)change.setLength(limit);this.velocity.add(change);
      const yawDelta=Math.atan2(Math.sin(this.game.player.yaw-Math.PI-this.yaw),Math.cos(this.game.player.yaw-Math.PI-this.yaw));
      turn=clamp(yawDelta*7,-4,4);this.yaw+=turn*dt;
      this.lastPosition.copy(root.position);root.position.addScaledVector(this.velocity,dt);
      root.rotation.set(this.pitch,this.yaw,this.roll,'YXZ');root.updateWorldMatrix(true,true);
      if(!this.positionAllowed()){root.position.copy(this.lastPosition);this.velocity.set(0,0,0);this.blocked=true;}
      const travelled=root.position.clone().sub(this.lastPosition);this.wheelAngle+=travelled.length()*Math.sign(travelled.dot(forward)||travelled.dot(right))/.202;
    }else{this.velocity.multiplyScalar(Math.exp(-5*dt));if(this.state==='tipping'){this.lastPosition.copy(root.position);root.position.addScaledVector(this.velocity,dt);if(!this.positionAllowed()){root.position.copy(this.lastPosition);this.velocity.set(0,0,0);}}}
    const acceleration=this.velocity.clone().sub(oldVelocity).divideScalar(dt),ax=clamp(acceleration.dot(right)+turn*this.velocity.dot(forward),-24,24),az=clamp(acceleration.dot(forward),-24,24);
    const tx=clamp(-ax*.055,-.7,.7),tz=clamp(az*.05,-.65,.65);
    this.sloshSpeed.x+=(tx-this.slosh.x)*22*dt-this.sloshSpeed.x*6*dt;this.sloshSpeed.y+=(tz-this.slosh.y)*22*dt-this.sloshSpeed.y*6*dt;this.slosh.addScaledVector(this.sloshSpeed,dt);
    if(this.state==='driving'||this.state==='parked'){
      const load=.95+.05*this.massKg/this.capacityKg;
      this.rollSpeed+=(-ax*.11*load-this.roll)*19*dt-this.rollSpeed*4*dt;
      this.pitchSpeed+=((this.driving?.12:0)+az*.11*load-this.pitch)*19*dt-this.pitchSpeed*4*dt;
      this.roll+=this.rollSpeed*dt;this.pitch+=this.pitchSpeed*dt;
      this.stability=Math.hypot(this.roll/.55,(this.pitch-.12)/.65);
      if(this.stability>1){
        this.tipStart.set(this.pitch,this.roll);const direction=new THREE.Vector2(this.pitch-.12,this.roll).normalize();
        this.tipEnd.copy(direction).multiplyScalar(2.45);this.tipTime=0;this.state='tipping';const momentum=this.velocity.clone();this.release();this.velocity.copy(momentum);
        this.game.hud.notify('Το καρότσι ανατρέπεται! E για επαναφορά όταν σταματήσει.',false,2500);
      }
    }else if(this.state==='tipping'){
      this.tipTime+=dt;const t=THREE.MathUtils.smoothstep(this.tipTime/1.05,0,1);this.pitch=THREE.MathUtils.lerp(this.tipStart.x,this.tipEnd.x,t);this.roll=THREE.MathUtils.lerp(this.tipStart.y,this.tipEnd.y,t);if(t===1)this.state='flipped';
    }else if(this.state==='righting'){
      this.tipTime+=dt;const t=THREE.MathUtils.smoothstep(this.tipTime/1.15,0,1);this.pitch=this.recoveryStart.x*(1-t);this.roll=this.recoveryStart.y*(1-t);if(t===1){this.state='parked';this.pitchSpeed=this.rollSpeed=0;this.stability=0;}
    }
    root.rotation.set(this.pitch,this.yaw,this.roll,'YXZ');let minY=Infinity;for(const p of this.support)minY=Math.min(minY,p.clone().applyQuaternion(root.quaternion).y);root.position.y=-minY+.002;root.updateWorldMatrix(true,true);
    const up=UP.clone().applyQuaternion(root.quaternion),inclination=Math.acos(clamp(up.y,-1,1));
    const overflow=Math.max(0,inclination+this.slosh.length()*.7-(.48+(1-this.massKg/this.capacityKg)*.50));
    if(this.massKg>0&&overflow>0){const amount=Math.min(this.massKg,dt*(inclination>1.25?100:overflow*24));this.emit(amount);}
    for(const p of this.parcels){
      if(p.mass<=0||p.settled)continue;p.velocity.y-=9.81*dt;p.position.addScaledVector(p.velocity,dt);
      const r=Math.cbrt(p.mass/1900/(4*Math.PI/3));
      if(p.position.y<=r){const speed=Math.hypot(p.velocity.x,p.velocity.z),stretch=1+Math.min(3,speed*.6);const height=Math.max(.008,r*.38),wide=Math.sqrt((p.mass/1900)*3/(4*Math.PI*height*stretch));p.scale.set(wide*stretch,height,wide);p.position.y=height+.003;p.rotation.setFromAxisAngle(UP,Math.atan2(-p.velocity.z,p.velocity.x));p.position.x=clamp(p.position.x,-3.6,3.6);p.position.z=clamp(p.position.z,GAME_CONFIG.room.wallFrontZ+.1,3.4);p.settled=true;p.velocity.set(0,0,0);}
    }
    const action=this.handAction;
    if(action){action.elapsed+=dt;if(!action.committed&&action.elapsed>.64){action.committed=true;if(action.kind==='scoop'){
      let room=3.5;for(const p of this.parcels){if(!p.settled||p.position.distanceTo(action.point)>.6)continue;const amount=Math.min(room,p.mass),fraction=p.mass>0?(p.mass-amount)/p.mass:0;p.mass-=amount;room-=amount;this.shovelKg+=amount;p.scale.multiplyScalar(Math.cbrt(fraction));if(room<=0)break;}
    }else{const amount=Math.min(this.shovelKg,this.capacityKg-this.massKg);this.shovelKg-=amount;this.massKg+=amount;}}
      if(action.elapsed>=1.2)this.handAction=null;
    }
    this.speed=this.velocity.length();
  }
  private positionAllowed():boolean{
    const root=this.model.group,room=GAME_CONFIG.room,obstacles=this.game.mixing.collisionObstacles().filter(o=>o.id!=='wheelbarrow');
    // Cover the tray, wheel and handles with overlapping discs, not a huge
    // axis-aligned rectangle that jams diagonal steering in the work aisle.
    for(const [z,r] of [[-.82,.23],[-.36,.34],[.1,.35],[.57,.17]] as const){
      const p=new THREE.Vector3(0,0,z).applyAxisAngle(UP,this.yaw).add(root.position);
      if(p.x-r< -room.width/2||p.x+r>room.width/2||p.z-r<room.wallFrontZ||p.z+r>room.depth/2)return false;
      for(const o of obstacles){const dx=p.x-clamp(p.x,o.minX,o.maxX),dz=p.z-clamp(p.z,o.minZ,o.maxZ);if(dx*dx+dz*dz<r*r)return false;}
    }return true;
  }
  private emit(mass:number):void{
    // One bounded parcel per 40 ms. Coalesce into the latest airborne parcel
    // instead of losing mass when a long spill reaches the rendering budget.
    const root=this.model.group,localGravity=UP.clone().negate().applyQuaternion(root.quaternion.clone().invert());localGravity.x-=this.slosh.x;localGravity.z-=this.slosh.y;
    const a=Math.atan2(localGravity.x,localGravity.z),local=new THREE.Vector3(Math.sin(a)*.34,.70,Math.cos(a)*.46);
    const position=root.localToWorld(local),velocity=this.velocity.clone().add(new THREE.Vector3(Math.sin(a),-.15,Math.cos(a)).applyQuaternion(root.quaternion).multiplyScalar(.5+Math.abs(this.rollSpeed)+Math.abs(this.pitchSpeed)));
    const last=this.parcels.at(-1);let parcel=last&&!last.settled&&last.position.distanceTo(position)<.16?last:undefined;
    if(!parcel){parcel=this.parcels.find(p=>p.mass<1e-8);if(parcel){parcel.position.copy(position);parcel.velocity.copy(velocity);parcel.settled=false;parcel.mass=0;}else if(this.parcels.length<240){parcel={mass:0,position,velocity,scale:new THREE.Vector3(),rotation:new THREE.Quaternion(),settled:false};this.parcels.push(parcel);}else{
      // Reclaim a slot by joining nearby settled footprints; a rendering cap
      // must never trap mortar in an overturned tray or discard its mass.
      const settled=this.parcels.filter(p=>p.settled&&p.mass>0).sort((a,b)=>a.position.distanceToSquared(position)-b.position.distanceToSquared(position));
      if(settled.length>=2){const keep=settled[0],reuse=settled.slice(1).reduce((a,b)=>a.position.distanceToSquared(keep.position)<b.position.distanceToSquared(keep.position)?a:b),total=keep.mass+reuse.mass;keep.position.lerp(reuse.position,reuse.mass/total);keep.scale.multiplyScalar(Math.cbrt(total/keep.mass));keep.mass=total;keep.position.y=keep.scale.y+.003;reuse.mass=0;reuse.settled=false;reuse.position.copy(position);reuse.velocity.copy(velocity);parcel=reuse;}
      else parcel=this.parcels.filter(p=>!p.settled).reduce((a,b)=>a.position.distanceToSquared(position)<b.position.distanceToSquared(position)?a:b);
    }}
    parcel.mass+=mass;this.massKg-=mass;const radius=Math.cbrt(parcel.mass/1900/(4*Math.PI/3));parcel.scale.set(radius*1.2,radius*.85,radius/1.02);
  }
  private present():void{
    this.wheel.quaternion.copy(this.wheelBase).multiply(new THREE.Quaternion().setFromAxisAngle(UP,-this.wheelAngle));
    if(Math.abs(this.fill-this.massKg)>1e-7){setWheelbarrowFill(this.model,this.massKg/this.capacityKg);this.fill=this.massKg;this.baseSurface.set(this.model.mortar.geometry.getAttribute('position').array);}
    const p=this.model.mortar.geometry.getAttribute('position');
    for(let i=0;i<p.count;i++){const x=this.baseSurface[i*3],z=this.baseSurface[i*3+2],r=Math.min(1,Math.hypot(x/.34,z/.465));p.setY(i,this.baseSurface[i*3+1]+(1-r)*(.055*Math.sin(this.time*5+x*8+z*7)*Math.min(1,this.slosh.length()*4)+this.slosh.x*x+this.slosh.y*z));}p.needsUpdate=true;this.model.mortar.geometry.computeVertexNormals();
    this.spills.count=this.parcels.length;for(let i=0;i<this.parcels.length;i++){const p=this.parcels[i];this.dummy.position.copy(p.position);this.dummy.quaternion.copy(p.rotation);this.dummy.scale.copy(p.scale);if(p.mass<=1e-8)this.dummy.scale.setScalar(0);this.dummy.updateMatrix();this.spills.setMatrixAt(i,this.dummy.matrix);}this.spills.instanceMatrix.needsUpdate=true;this.spills.computeBoundingSphere();
    this.panel.hidden=!this.driving;this.game.hud.shell.classList.toggle('wheelbarrow-driving',this.driving);const danger=this.stability>.72;this.panel.dataset.danger=String(danger);this.dot.style.transform=`translate(${clamp(this.roll/.55,-1,1)*40}px,${clamp((this.pitch-.12)/.65,-1,1)*40}px)`;
    const speed=this.speed<.25?'TOO SLOW':this.speed>1.65?'TOO FAST':'NORMAL';this.text.innerHTML=`<b>${danger?'DANGER':this.blocked?'ΕΜΠΟΔΙΟ':'STABLE'}</b><span>${speed} · ${this.speed.toFixed(1)} m/s</span><span>${this.massKg.toFixed(1)} kg · ${Math.round(this.stability*100)}% κλίση</span>`;
  }
  anatomicalGrips():WorkerGripTarget[]{
    if(!this.driving)return[];return[-1,1].map(side=>{const center=this.model.group.localToWorld(new THREE.Vector3(-side*.301,.682,-.94)),axis=new THREE.Vector3(side*.019,-.092,.2).normalize().applyQuaternion(this.model.group.quaternion),rotation=new THREE.Quaternion().setFromUnitVectors(UP,axis);return{side,center,rotation,section:[.022,.022] as [number,number],active:true,straightWrist:true,bodyFrame:{position:this.model.group.localToWorld(this.stanceAnchor.clone()),quaternion:this.model.group.quaternion.clone().multiply(this.carryRotation.clone().invert()).multiply(new THREE.Quaternion().setFromAxisAngle(UP,Math.PI))},palmDirection:new THREE.Vector3(-side*.30,-1,.45).applyQuaternion(this.model.group.quaternion)};});
  }
  get telemetry(){return{state:this.state,driving:this.driving,massKg:this.massKg,capacityKg:this.capacityKg,shovelKg:this.shovelKg,floorKg:this.floorKg,airborneKg:this.airborneKg,consumedKg:this.consumedKg,totalKg:this.massKg+this.shovelKg+this.floorKg+this.airborneKg+this.consumedKg,speed:this.speed,stability:this.stability,pitch:this.pitch,roll:this.roll,yaw:this.yaw,wheelAngle:this.wheelAngle,slosh:this.slosh.toArray(),position:this.model.group.position.toArray(),parcels:this.parcels.length,blocked:this.blocked,recovering:this.handAction?.kind??null};}
}
