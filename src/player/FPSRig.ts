import * as THREE from 'three';
import { buildToolModel } from './ToolModels';
import { workerHand, workerArm, poseWorkerArm, flexWorkerHand, poseToolGrip, MAX_WRIST_REACH_M, UPPER_ARM_M, FOREARM_M, type WorkerArm } from './WorkerArm';
import type { BrickWall, ChiselContact } from '../world/BrickWall';

export type RigTool = 'spray' | 'hammer' | 'fitting' | 'level' | 'spring' | 'cutter' | 'trowel' | 'hose';
export const RIG_TOOLS: RigTool[] = ['spray', 'hammer', 'fitting', 'level', 'spring', 'cutter', 'trowel', 'hose'];

// The viewmodel belongs to the final transparent pass so wall paint can never
// composite over the hands or tool, regardless of camera distance.
const material = (color: number, roughness = 0.7, metalness = 0.05): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({
  color,
  roughness,
  metalness,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});
const place = (object: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D => { object.position.set(x, y, z); object.renderOrder = 20; return object; };

export class FPSRig extends THREE.Group {
  private readonly tools = new Map<RigTool, THREE.Group>();
  private readonly restingY = -0.12;
  private readonly touchViewport = window.matchMedia('(pointer: coarse)');
  private sprayCanMaterial: THREE.MeshStandardMaterial | null = null;
  private sprayMist: THREE.Points | null = null;
  private strikeAmount = 0;
  private flatTip: THREE.Mesh | null = null;
  private pointedTip: THREE.Mesh | null = null;
  private readonly tipAnchor = new THREE.Vector3(.02, .005, -.60);
  private readonly armSets = new Map<RigTool, WorkerArm[]>();
  private selectedTool: RigTool = 'spray';
  reachable = false;
  reachReason = 'Out of reach. Move closer or change your working angle.';
  readonly chiselTipWorld = new THREE.Vector3();
  toolAction = 0;
  hoseActive = false;
  levelTiltDegrees = 0;
  mortarCharge = 0;
  mortarRecovery = 0;
  mortarSwingDegrees = 0;
  mortarHolding = false;
  chiselInAir = false;
  workStanceSide = 0;
  workPositionLocked = false;
  private feedDepth = .02;
  private presentedDepthZ: number | null = null;
  private hammerGripBlend = 0;

  /** Seat the real visible tip on the first remaining solid, then read it back. */
  contact(camera: THREE.Camera, wall: BrickWall): ChiselContact | null {
    this.selectedTool='hammer';
    this.reachReason='Out of reach. Move closer, change your stance or crouch.';
    const hammer = this.tools.get('hammer')!;
    this.poseHammerGrips(hammer);
    if (this.flatTip) {
      this.flatTip.visible = wall.chiselType === 'flat'; this.flatTip.rotation.z = wall.chiselEdgeAngle;
      // Match metres in the world despite the camera rig's presentation scale.
      const scale=hammer.getWorldScale(new THREE.Vector3()).x;
      this.flatTip.scale.x=wall.chiselWidthM/(.045*scale);
    }
    if (this.pointedTip) this.pointedTip.visible = wall.chiselType === 'pointed';
    camera.updateMatrixWorld(true);
    this.updateWorldMatrix(true, false);
    // Blade roll and hammer pitch are independent. Positive pitch is the
    // electrician's top-to-bottom stroke: handle above the engaged cutting edge.
    const tilt=THREE.MathUtils.degToRad(wall.chiselTiltDegrees);
    // The working wall supplies world up and its normal. Looking around must
    // not silently change the independently chosen vertical/lateral attack.
    const side=THREE.MathUtils.degToRad(this.workStanceSide*75);
    const desiredWorld=new THREE.Vector3(Math.sin(side)*Math.cos(tilt),-Math.sin(tilt),-Math.cos(side)*Math.cos(tilt));
    // The zero-roll cutting edge stays horizontal in the wall's frame. A
    // shortest-arc rotation from the camera adds an accidental blade roll when
    // looking sideways or combining vertical and lateral hammer angles.
    const right=desiredWorld.clone().cross(new THREE.Vector3(0,1,0)).normalize();
    const back=desiredWorld.clone().negate();
    const up=back.clone().cross(right).normalize();
    const worldOrientation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,back));
    const parentRotation=this.getWorldQuaternion(new THREE.Quaternion()).invert();
    hammer.quaternion.copy(parentRotation.multiply(worldOrientation));
    hammer.updateWorldMatrix(true, false);
    const orientation = hammer.getWorldQuaternion(new THREE.Quaternion());
    const direction = new THREE.Vector3(0,0,-1).applyQuaternion(orientation);
    const edge = new THREE.Vector3(Math.cos(wall.chiselEdgeAngle), Math.sin(wall.chiselEdgeAngle), 0).applyQuaternion(orientation).normalize();
    const view = camera.getWorldDirection(new THREE.Vector3());
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const distance = (wall.volume.frontZ-eye.z)/view.z;
    if (distance < 0 || distance > 1.45 || direction.z >= -.04) { this.restHammer(camera); return null; }
    const entry = eye.clone().addScaledVector(view,distance);
    if (Math.abs(entry.x)>2.54 || entry.y<0 || entry.y>3) { this.restHammer(camera); return null; }
    // Follow the CHISEL axis through the aperture. Empty chambers consume no
    // impact and no energy: the next contact is a surviving rib or rear shell.
    const origin=entry.clone().addScaledVector(direction,-.02);
    // Finishing starts at the rib under the crosshair inside the open chase.
    // Tilting upward changes the blade attack, not the selected depth/target.
    // Ordinary excavation still follows the shaft through the front aperture.
    const upward=wall.chiselTiltDegrees<0;
    const rayOrigin=upward?eye:origin,rayDirection=upward?view:direction;
    const reach=upward?1.45:Math.min(.38,.24/Math.abs(direction.z));
    let hit=wall.volume.raycast(rayOrigin,rayDirection,reach),bladeOffsetM=0;
    if(wall.chiselType==='flat'){
      // A wide edge cannot pass through a hole merely because its centre is air.
      // At most nine rays, spaced no farther apart than the material lattice.
      const half=wall.chiselWidthM/2,steps=Math.ceil(half/.007);
      for(let i=1;i<=steps;i++)for(const sign of [-1,1]){
        const offset=sign*half*i/steps;
        const candidate=wall.volume.raycast(rayOrigin.clone().addScaledVector(edge,offset),rayDirection,reach);
        if(candidate&&(!hit||candidate.distance<hit.distance-1e-6)){hit=candidate;bladeOffsetM=offset;}
      }
    }
    this.chiselInAir=!hit;
    if(hit)this.feedDepth=THREE.MathUtils.clamp((wall.volume.frontZ-hit.point.z)/Math.abs(direction.z),0,.24);
    // Losing a shell contact must not throw the entire tool through the cell,
    // then teleport it back to the resting pose on the next pixel of aim.
    const target=hit?new THREE.Vector3(hit.point.x,hit.point.y,hit.point.z).addScaledVector(edge,-bladeOffsetM):entry.clone().addScaledVector(direction,this.feedDepth);
    const surfaceTarget=target.clone();
    if(this.workPositionLocked&&this.presentedDepthZ!==null){
      target.z=this.presentedDepthZ+THREE.MathUtils.clamp(target.z-this.presentedDepthZ,-.0025,.004);
    }
    this.presentedDepthZ=target.z;
    const local=this.worldToLocal(target.clone());
    hammer.position.copy(local).sub(this.tipAnchor.clone().applyQuaternion(hammer.quaternion));
    hammer.updateWorldMatrix(true, true);
    const housing=camera.worldToLocal(hammer.localToWorld(new THREE.Vector3(.02,-.055,-.1)));
    if(housing.z>-.26 || !this.gripsReachable(camera,hammer)){
      this.reachable=false;this.chiselInAir=true;
      if(this.workPositionLocked){this.constrainHeldTool(camera);this.poseArms(camera);this.chiselTipWorld.copy(hammer.localToWorld(this.tipAnchor.clone()));}
      else this.restHammer(camera);
      return null;
    }
    this.reachable = true;
    const tip = hammer.localToWorld(this.tipAnchor.clone());
    this.chiselTipWorld.copy(tip);
    this.poseArms(camera);
    if (!hit || target.distanceTo(surfaceTarget)>.003 || (this.hammerGripBlend>0 && this.hammerGripBlend<1)) return null;
    return {point:tip.clone().addScaledVector(edge,bladeOffsetM), direction, edge, chisel:wall.chiselType, energyJ:wall.chiselEnergyJ, widthM:wall.chiselWidthM, bladeOffsetM};
  }

  constructor() {
    super();
    this.name = 'Modular FPS hands and tools';
    this.userData.studioEntityId = 'fps-rig';
    this.position.set(0.02, this.restingY, -0.22);
    this.addTool('spray', this.createDetailedTool('spray'));
    this.addTool('hammer', this.createHammer());
    for(const tool of ['fitting','level','spring','cutter','trowel','hose'] as const)this.addTool(tool,this.createDetailedTool(tool));
    this.show('spray');
  }

  show(tool: RigTool): void { this.selectedTool=tool; this.tools.forEach((group, key) => { group.visible = key === tool; }); this.armSets.forEach((arms,key)=>arms.forEach(arm=>arm.group.visible=key===tool)); }
  setSprayColor(color: number): void {
    this.sprayCanMaterial?.color.setHex(color);
    this.tools.get('spray')?.traverse(object=>{if(object instanceof THREE.Mesh && object.userData.sprayColor)(object.material as THREE.MeshStandardMaterial).color.setHex(color);});
    (this.sprayMist?.material as THREE.PointsMaterial | undefined)?.color.setHex(color);
  }
  toolTipWorld(camera: THREE.Camera,tool: RigTool): THREE.Vector3 {
    camera.updateMatrixWorld(true);this.updateWorldMatrix(true,true);
    const group=this.tools.get(tool),tip=group?.userData.tipPoint as number[] | undefined;
    return group ? group.localToWorld(tip ? new THREE.Vector3().fromArray(tip) : new THREE.Vector3(.1,.04,-.14)) : camera.localToWorld(new THREE.Vector3(.15,-.18,-.55));
  }
  strike(): void { this.strikeAmount = 1; }
  update(dt: number, moving: boolean, spraying = false): void {
    // Positive chisel attack puts the rear handle on the body's LEFT. Swap
    // grips with that torso lean; returning to straight restores the right hand.
    const gripTarget=this.workStanceSide>.12?1:0;
    this.hammerGripBlend+=THREE.MathUtils.clamp(gripTarget-this.hammerGripBlend,-dt*2.8,dt*2.8);
    const bob = moving ? Math.sin(performance.now() * 0.012) * 0.006 : 0;
    // Keep the working hand above the landscape toolbar and inside a portrait
    // view. The entire tool moves with the wrist; arm lengths stay physical.
    const handTool=this.selectedTool!=='hammer';
    this.position.x=handTool&&innerWidth<innerHeight?-.065:.02;
    this.position.y=(handTool&&this.touchViewport.matches&&innerHeight<520?.02:this.restingY)+bob;
    this.strikeAmount = Math.max(0, this.strikeAmount - dt * 5.5);
    this.rotation.x = -Math.sin(this.strikeAmount * Math.PI) * 0.16;
    this.toolAction=Math.max(0,this.toolAction-dt*2.5);
    this.tools.forEach((group,key)=>{if(key!=='hammer')group.position.set(0,0,0);});
    const trigger=this.tools.get('hose')?.getObjectByName('hose-trigger');
    if(trigger)trigger.scale.x=this.hoseActive?.82:1;
    const bubble=this.tools.get('level')?.getObjectByName('level-bubble');
    if(bubble){if(bubble.userData.restX===undefined)bubble.userData.restX=bubble.position.x;bubble.position.x=bubble.userData.restX+THREE.MathUtils.clamp(this.levelTiltDegrees*.003,-.014,.014);}
    const actuator=this.tools.get('spray')?.getObjectByName('spray-actuator');
    if(actuator)actuator.position.y=spraying?.102:.104;
    const trowel=this.tools.get('trowel');
    if(trowel){
      // The degree readout and the visible wrist/tool use the same stroke.
      // Keep the gripping hand parented to the tool throughout the swing.
      const returning = this.mortarRecovery > 0;
      const degrees = this.mortarHolding || returning ? this.mortarSwingDegrees : 0;
      trowel.rotation.x = THREE.MathUtils.degToRad(degrees);
      trowel.position.y = this.mortarHolding ? -.025 * Math.sin(this.mortarCharge * Math.PI) : 0;
      const load=trowel.getObjectByName('trowel-load');if(load)load.visible=this.mortarRecovery<.2;
    }
    if (this.sprayMist) {
      this.sprayMist.visible = spraying;
      if (spraying) {
        const positions = this.sprayMist.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let index = 0; index < positions.count; index += 1) {
          const travel = (performance.now() * 0.0018 + index / positions.count) % 1;
          positions.setXYZ(index, 0.175 + (Math.random() - 0.5) * travel * 0.055, 0.021 + (Math.random() - 0.5) * travel * 0.055, -0.05 - travel * 0.34);
        }
        positions.needsUpdate = true;
      }
    }
  }

  private addTool(key: RigTool, group: THREE.Group): void { group.name = `FPS ${key} tool`; group.userData.studioEntityId = `fps-rig:${key}`; this.tools.set(key, group); this.add(group); }
  private poseHammerGrips(hammer:THREE.Group):void {
    const rear=new THREE.Vector3().fromArray(hammer.userData.gripPoint);
    const auxiliary=hammer.getObjectByName('Rotatable auxiliary handle')!;
    auxiliary.rotation.z=this.hammerGripBlend*Math.PI;
    const front=new THREE.Vector3().fromArray(auxiliary.userData.gripPoint).applyQuaternion(auxiliary.quaternion).add(auxiliary.position);
    hammer.userData.secondaryGripPoint=front.toArray();
    // Regrip in sequence: one hand stays on the rear handle while the other
    // travels around the housing. Percussion pauses until both hands are seated.
    for(const arm of this.armSets.get('hammer')??[]){
      const t=THREE.MathUtils.smoothstep(this.hammerGripBlend,arm.side<0?0:.5,arm.side<0?.5:1);
      arm.hand.position.lerpVectors(arm.side<0?front:rear,arm.side<0?rear:front,t);
      arm.hand.position.y-=Math.sin(t*Math.PI)*.09;
      const supporting=arm.side<0?1-t:t;
      arm.hand.rotation.set(0,0,arm.side*supporting*Math.PI/2);
      arm.hand.userData.gripRole=supporting>.99?'auxiliary':supporting<.01?'rear':'regripping';
      arm.hand.userData.gripping=t===0||t===1;
    }
  }
  private bodyFrame(camera:THREE.Camera): { eye:THREE.Vector3; right:THREE.Vector3; forward:THREE.Vector3 } {
    const eye=camera.getWorldPosition(new THREE.Vector3()),forward=camera.getWorldDirection(new THREE.Vector3());
    forward.y=0;forward.normalize();
    return {eye,forward,right:forward.clone().cross(new THREE.Vector3(0,1,0)).normalize()};
  }
  private shoulder(camera:THREE.Camera,side:number):THREE.Vector3 {
    const {eye,right,forward}=this.bodyFrame(camera);
    return eye.addScaledVector(right,side*.20).addScaledVector(forward,-.03).add(new THREE.Vector3(0,-.22,0));
  }
  private wrist(arm:WorkerArm):THREE.Vector3 {
    return arm.hand.localToWorld(new THREE.Vector3().fromArray(arm.hand.userData.wristPoint));
  }
  private gripsReachable(camera:THREE.Camera,tool:THREE.Group):boolean {
    tool.updateWorldMatrix(true,true);
    return (this.armSets.get(this.selectedTool)??[]).filter(arm=>arm.hand.userData.gripRole!=='resting').every(arm=>this.shoulder(camera,arm.side).distanceTo(this.wrist(arm))<=MAX_WRIST_REACH_M);
  }
  /** Move the held tool into the intersection of the two finite arm workspaces. */
  private constrainHeldTool(camera:THREE.Camera):void {
    const tool=this.tools.get(this.selectedTool)!;
    for(let i=0;i<16;i++){
      let moved=false;
      for(const arm of this.armSets.get(this.selectedTool)??[]){
        if(arm.hand.userData.gripRole==='resting')continue;
        tool.updateWorldMatrix(true,true);
        const shoulder=this.shoulder(camera,arm.side),wrist=this.wrist(arm),delta=wrist.clone().sub(shoulder),distance=delta.length();
        if(distance>MAX_WRIST_REACH_M){
          const correction=delta.multiplyScalar((MAX_WRIST_REACH_M-.0005-distance)/distance);
          const world=tool.getWorldPosition(new THREE.Vector3()).add(correction);
          tool.position.copy(this.worldToLocal(world)); moved=true;
        }
      }
      if(!moved)break;
    }
    tool.updateWorldMatrix(true,true);
  }
  private restHammer(camera:THREE.Camera):void {
    this.reachable=false;this.chiselInAir=true;
    this.presentedDepthZ=null;
    const hammer=this.tools.get('hammer')!;
    hammer.position.set(0,-.055,0);hammer.rotation.set(.12,-.08,0);
    this.constrainHeldTool(camera);this.poseArms(camera);
    this.chiselTipWorld.copy(hammer.localToWorld(this.tipAnchor.clone()));
  }
  poseArms(camera:THREE.Camera):void {
    if(this.selectedTool!=='hammer')this.constrainHeldTool(camera);
    const {right}=this.bodyFrame(camera);
    for(const arm of this.armSets.get(this.selectedTool)??[]){
      if(arm.hand.userData.gripRole==='resting')this.poseRestingHand(camera,arm);
      poseWorkerArm(arm,this.shoulder(camera,arm.side),this.wrist(arm),right);
      flexWorkerHand(arm.hand,arm.hand.userData.gripRole==='resting'?0:this.toolAction+this.strikeAmount*.35+(this.hoseActive?.4:0),performance.now()*.001);
      if(arm.hand.userData.gripping)poseToolGrip(arm.hand,this.tools.get(this.selectedTool)!,this.toolAction);
    }
  }
  private poseRestingHand(camera:THREE.Camera,arm:WorkerArm):void {
    const {right,forward}=this.bodyFrame(camera);
    // The free wrist hangs beside the hip in BODY space, independent of the
    // held tool's position, pitch, recoil or trowel swing.
    const wrist=this.shoulder(camera,arm.side).add(new THREE.Vector3(0,-.55,0)).addScaledVector(right,-.045).addScaledVector(forward,.025);
    const frame=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,new THREE.Vector3(0,1,0),forward.clone().negate()));
    const rotation=frame.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0,-Math.PI/2,Math.PI)));
    arm.group.updateWorldMatrix(true,false);
    arm.hand.quaternion.copy(arm.group.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
    arm.hand.position.copy(arm.group.worldToLocal(wrist)).sub(new THREE.Vector3().fromArray(arm.hand.userData.wristPoint).applyQuaternion(arm.hand.quaternion));
    arm.hand.updateWorldMatrix(true,true);
  }
  /** Hand tools need a body-space reachable target; a hose or mortar projectile can travel farther. */
  canReachPoint(camera:THREE.Camera,point:THREE.Vector3,extension=.10):boolean {
    return (this.selectedTool==='hammer'?[-1,1]:[1]).some(side=>this.shoulder(camera,side).distanceTo(point)<=MAX_WRIST_REACH_M+extension);
  }
  debugPose():object {
    return {tool:this.selectedTool,reachable:this.reachable,arms:(this.armSets.get(this.selectedTool)??[]).map(arm=>({
      side:arm.side,upperLengthM:UPPER_ARM_M,forearmLengthM:FOREARM_M,
      shoulder:arm.shoulder.toArray(),elbow:arm.elbow.toArray(),wrist:arm.wrist.toArray(),
      grip:arm.hand.getWorldPosition(new THREE.Vector3()).toArray(),fingers:arm.hand.children.filter(o=>o.userData.digit).length,gripping:arm.hand.userData.gripping??true,gripRole:arm.hand.userData.gripRole,
    }))};
  }
  private attachArms(kind:RigTool,group:THREE.Group):void {
    const arms:WorkerArm[]=[];
    const primary=new THREE.Vector3().fromArray(group.userData.gripPoint);
    for(const side of [1,-1]){
      const resting=side<0&&kind!=='hammer';
      const grip=side===1?primary.clone():resting?new THREE.Vector3():new THREE.Vector3().fromArray(group.userData.secondaryGripPoint);
      const style=resting?'relaxed':side<0?'hammer-support':kind;
      const hand=workerHand(side,style); hand.position.copy(grip);
      if(!resting&&group.userData.gripQuaternion)hand.quaternion.fromArray(group.userData.gripQuaternion);
      hand.userData.gripping=!resting;hand.userData.gripRole=resting?'resting':'primary';
      const arm=workerArm(side,hand,grip);arms.push(arm);this.add(arm.group);
      if(resting)arm.group.add(hand);else group.add(hand);
    }
    this.armSets.set(kind,arms);
  }
  private createDetailedTool(kind: Exclude<RigTool,'hammer'>):THREE.Group {
    const group=buildToolModel(kind);
    this.attachArms(kind,group);
    if(kind==='trowel'){
      const load=new THREE.Mesh(new THREE.IcosahedronGeometry(.044,2),material(0x857a66,.96));load.name='trowel-load';load.position.set(.01,.06,-.077);load.scale.set(.85,1.5,.22);group.add(load);
    }
    if(kind==='spray'){
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(54),3));
      this.sprayMist=new THREE.Points(geometry,new THREE.PointsMaterial({color:0x168cdb,size:.009,transparent:true,opacity:.4,depthTest:false}));this.sprayMist.visible=false;this.sprayMist.renderOrder=21;group.add(this.sprayMist);
    }
    // Shared builders also serve world props; only viewmodels use this overlay pass.
    group.traverse(object=>{if(object instanceof THREE.Mesh){for(const m of Array.isArray(object.material)?object.material:[object.material]){m.transparent=false;m.depthTest=true;m.depthWrite=true;}object.renderOrder=20;object.castShadow=false;}});
    return group;
  }
  private createHammer(): THREE.Group {
    const group = buildToolModel('hammer');
    this.attachArms('hammer',group);
    const chisel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.23, 12), material(0x6d7370, 0.3, 0.75));
    chisel.rotation.x = Math.PI / 2; place(chisel, 0.02, 0.005, -0.45);
    const wedge = new THREE.BufferGeometry();
    wedge.setAttribute('position', new THREE.Float32BufferAttribute([-.0225,-.006,.035, .0225,-.006,.035, .0225,.006,.035, -.0225,.006,.035, -.0225,0,-.035, .0225,0,-.035], 3));
    wedge.setIndex([0,2,1,0,3,2,0,1,5,0,5,4,3,4,5,3,5,2,0,4,3,1,2,5]);
    wedge.computeVertexNormals();
    const chiselTip = new THREE.Mesh(wedge, material(0x7b807c, 0.28, 0.8));
    place(chiselTip, 0.02, 0.005, -0.565);
    this.flatTip = chiselTip;
    this.pointedTip = new THREE.Mesh(new THREE.ConeGeometry(.012,.07,6), material(0x7b807c,.28,.8));
    this.pointedTip.rotation.x = -Math.PI/2;
    place(this.pointedTip,.02,.005,-.565); this.pointedTip.visible=false;
    group.add(chisel, chiselTip, this.pointedTip);
    // The wall must occlude parts of the bit inside solid shell/ribs. The other
    // handheld tools retain their established overlay rendering.
    group.traverse(object=>{ if(object instanceof THREE.Mesh) for(const m of Array.isArray(object.material)?object.material:[object.material]) {m.depthTest=true;m.depthWrite=true;m.transparent=false;} });
    return group;
  }
}
