import * as THREE from 'three';
import { buildToolModel } from './ToolModels';
import type { TrowelMotion } from './TrowelMotion';
import { workerHand, workerArm, poseWorkerArm, flexWorkerHand, poseToolGrip, MAX_WRIST_REACH_M, UPPER_ARM_M, FOREARM_M, type WorkerArm } from './WorkerArm';
import type { BrickWall, ChiselContact } from '../world/BrickWall';
import type { BoxKind } from '../data/installationRules';

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
  private readonly tipAnchor = new THREE.Vector3(.02, .005, -.749);
  private readonly armSets = new Map<RigTool, WorkerArm[]>();
  private selectedTool: RigTool = 'spray';
  reachable = false;
  contactStatus: 'ready'|'feeding'|'regripping'|'no-solid'|'too-close'|'out-of-reach' = 'out-of-reach';
  reachReason = 'Out of reach. Move closer or change your working angle.';
  readonly chiselTipWorld = new THREE.Vector3();
  toolAction = 0;
  hoseActive = false;
  fittingBoxAvailable = true;
  private readonly fittingBoxParts: THREE.Object3D[] = [];
  private readonly fittingVariants=new Map<string,{parts:THREE.Object3D[];kinds:readonly BoxKind[];width:number}>();
  private fittingPreset='1G';
  levelTiltDegrees = 0;
  mortarCharge = 0;
  mortarRecovery = 0;
  mortarSwingDegrees = 0;
  mortarHolding = false;
  private mortarStrain = 0;
  private mortarStrainVelocity = 0;
  private mortarAppliedStrain = -1;
  private readonly trowelElbow = new THREE.Vector3();
  chiselInAir = false;
  workStanceSide = 0;
  /** Actual head lean in the body's right direction; independent of bit yaw. */
  workHeadLeanM:number|null=null;
  /** The chosen main hand persists when the bit leaves the wall or aim changes. */
  hammerHandedness:'left'|'right'|null=null;
  workStanceTiltDegrees:number|null=null;
  actualTiltDegrees=15;
  workPositionLocked = false;
  private readonly feedOffset = new THREE.Vector3();
  private presentedFeedOffset: THREE.Vector3 | null = null;
  private contactFeedBudgetM = 0;
  private lateralFeedBudgetM = Infinity;

  private hammerGripBlend = 0;
  private hammerLeftMain=false;
  private readonly hammerFeedOffset = new THREE.Vector3();
  private hammerPostureY=0;
  readonly hammerFit={housingCameraZ:0,wristReachM:[] as number[],feedM:0,postureY:0};

  /** Contact can be queried several times per impact; advance the pose once per frame. */
  beginFrame(dt: number, wallTravelM: number | null = null): void {
    this.contactFeedBudgetM = .24 * Math.min(Math.max(dt, 0), .05);
    // While feeding A/D along the wall, a new shell may retract the shaft, but
    // must not drag the visible bit backwards against the worker's movement.
    this.lateralFeedBudgetM = wallTravelM === null ? Infinity : Math.abs(wallTravelM) * .75;
  }

  /** Seat the real visible tip on the first remaining solid, then read it back. */
  contact(camera: THREE.Camera, wall: BrickWall): ChiselContact | null {
    this.selectedTool='hammer';
    this.contactStatus='out-of-reach';
    this.reachReason='Out of reach. Move closer, change your stance or crouch.';
    const hammer = this.tools.get('hammer')!;
    this.poseHammerGrips(hammer);
    if (this.flatTip) {
      this.flatTip.visible = wall.chiselType === 'flat'; this.flatTip.rotation.z = wall.chiselEdgeAngle;
      // Match metres in the world despite the camera rig's presentation scale.
      const scale=hammer.getWorldScale(new THREE.Vector3()).x;
      this.flatTip.scale.x=wall.chiselWidthM/(.05*scale);
    }
    if (this.pointedTip) this.pointedTip.visible = wall.chiselType === 'pointed';
    camera.updateMatrixWorld(true);
    this.updateWorldMatrix(true, false);
    // Blade roll and hammer pitch are independent. Positive pitch is the
    // electrician's top-to-bottom stroke: handle above the engaged cutting edge.
    this.actualTiltDegrees=this.workStanceTiltDegrees??wall.chiselTiltDegrees;
    const tilt=THREE.MathUtils.degToRad(this.actualTiltDegrees);
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
    // A slanted sight line can exceed 1.45 m while the bit is beside the body.
    // The actual wrist spheres below decide reach, rather than ray length.
    if (!Number.isFinite(distance) || distance < 0 || direction.z >= -.04) { this.restHammer(camera); return null; }
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
    const reach=upward?distance+.28/Math.max(.08,Math.abs(view.z)):Math.min(.38,.24/Math.abs(direction.z));
    const actualAxisContact=(candidate:ReturnType<typeof wall.volume.raycast>)=>{
      if(!upward||!candidate)return candidate;
      // A camera ray can just graze a fracture corner that the tilted shaft
      // never reaches. Do not let that nearer false contact block every later
      // strike or hide a reachable section farther along the cutting edge.
      const point=candidate.point;
      const origin={x:point.x-direction.x*.012,y:point.y-direction.y*.012,z:point.z-direction.z*.012};
      const physical=wall.volume.raycast(origin,direction,.028);
      return physical?{...candidate,point:physical.point,normal:physical.normal,material:physical.material}:null;
    };
    let hit=actualAxisContact(wall.volume.raycast(rayOrigin,rayDirection,reach)),bladeOffsetM=0;
    if(wall.chiselType==='flat'){
      // A wide edge cannot pass through a hole merely because its centre is air.
      // At most nine rays, spaced no farther apart than the material lattice.
      const half=wall.chiselWidthM/2,steps=Math.ceil(half/.007);
      for(let i=1;i<=steps;i++)for(const sign of [-1,1]){
        const offset=sign*half*i/steps;
        const candidate=actualAxisContact(wall.volume.raycast(rayOrigin.clone().addScaledVector(edge,offset),rayDirection,reach));
        if(candidate&&(!hit||candidate.distance<hit.distance-1e-6)){hit=candidate;bladeOffsetM=offset;}
      }
    }
    this.chiselInAir=!hit;
    // Losing a shell contact must not throw the entire tool through the cell,
    // then teleport it back to the resting pose on the next pixel of aim.
    const target=hit?new THREE.Vector3(hit.point.x,hit.point.y,hit.point.z).addScaledVector(edge,-bladeOffsetM):entry.clone().add(this.feedOffset);
    // Keep the actual blade centre's full offset through air. Wall-normal
    // depth is not shaft travel, and an off-centre wide blade contact also
    // differs from the shaft centre. Both approximations made the bit retreat.
    if(hit)this.feedOffset.copy(target).sub(entry);
    const surfaceTarget=target.clone();
    // Smooth all three feed axes relative to the moving sightline. Smoothing
    // world Z alone snapped the tilted bit sideways at each cavity boundary.
    const desiredFeed=target.clone().sub(entry);
    if(this.workPositionLocked&&this.presentedFeedOffset!==null){
      const advance=desiredFeed.clone().sub(this.presentedFeedOffset);
      advance.clampLength(0,this.contactFeedBudgetM);
      advance.x=THREE.MathUtils.clamp(advance.x,-this.lateralFeedBudgetM,this.lateralFeedBudgetM);
      this.contactFeedBudgetM=Math.max(0,this.contactFeedBudgetM-advance.length());
      this.lateralFeedBudgetM=Math.max(0,this.lateralFeedBudgetM-Math.abs(advance.x));
      this.presentedFeedOffset.add(advance);
      target.copy(entry).add(this.presentedFeedOffset);
    } else this.presentedFeedOffset=desiredFeed;
    const local=this.worldToLocal(target.clone());
    hammer.position.copy(local).sub(this.tipAnchor.clone().applyQuaternion(hammer.quaternion));
    hammer.updateWorldMatrix(true, true);
    this.seatHammerFeed(camera,direction);
    const housing=camera.worldToLocal(hammer.localToWorld(new THREE.Vector3(.02,-.055,-.1)));
    this.hammerFit.housingCameraZ=housing.z;
    this.hammerFit.wristReachM=(this.armSets.get('hammer')??[]).map(arm=>this.shoulder(camera,arm.side).distanceTo(this.wrist(arm)));
    // A body below or beside the eye can have a small camera Z while leaving
    // the bit fully visible. Reject an actual head collision, not that valid
    // oblique working posture merely because it fails a forward-Z cutoff.
    if(housing.length()<.19){
      this.contactStatus='too-close';
      this.reachReason='Too close. Step back slightly to give the hammer room.';
      this.reachable=false;this.chiselInAir=true;
      // The motor is colliding with the head, although the seated blade looks
      // ready to strike. Withdraw the real tool clear of the wall so the
      // presentation agrees with the rejected contact. Eyes never move.
      const withdrawal=Math.max(.055,(wall.volume.frontZ+.045-target.z)/Math.max(.04,-direction.z));
      const withdrawn=target.clone().addScaledVector(direction,-withdrawal);
      withdrawn.y-=.06;
      hammer.position.copy(this.worldToLocal(withdrawn)).sub(this.tipAnchor.clone().applyQuaternion(hammer.quaternion));
      this.constrainHeldTool(camera);this.poseArms(camera);
      this.chiselTipWorld.copy(hammer.localToWorld(this.tipAnchor.clone()));
      return null;
    }
    if(!this.gripsReachable(camera,hammer)){
      this.reachable=false;this.chiselInAir=true;
      if(this.workPositionLocked){this.constrainHeldTool(camera);this.poseArms(camera);this.chiselTipWorld.copy(hammer.localToWorld(this.tipAnchor.clone()));}
      else this.restHammer(camera);
      return null;
    }
    this.reachable = true;
    const tip = hammer.localToWorld(this.tipAnchor.clone());
    this.chiselTipWorld.copy(tip);
    this.poseArms(camera);
    if(!hit){this.contactStatus='no-solid';this.reachReason='No solid masonry under the chisel. Aim at an edge or remaining rib.';return null;}
    if(target.distanceTo(surfaceTarget)>.003){this.contactStatus='feeding';this.reachReason='Feeding the chisel into contact.';return null;}
    if(this.hammerGripBlend>0&&this.hammerGripBlend<1){this.contactStatus='regripping';this.reachReason='Changing grip. Keep holding to continue.';return null;}
    this.contactStatus='ready';this.reachReason='Chisel in contact. Hold to hammer.';
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
  get fittingBoxKinds():readonly BoxKind[]{return this.fittingVariants.get(this.fittingPreset)!.kinds;}
  /** Switch the finite supply model without rebuilding geometry or the hand. */
  setFittingBoxKinds(kinds:readonly BoxKind[]):void{
    const preset=kinds.join('+'),variant=this.fittingVariants.get(preset);
    if(!variant||preset===this.fittingPreset)return;
    this.fittingPreset=preset;
    const tool=this.tools.get('fitting')!;
    tool.userData.fittingBoxKinds=[...variant.kinds];tool.userData.fittingGroupWidth=variant.width;tool.userData.fittingBoxCount=variant.kinds.length;
    for(const part of this.fittingBoxParts)part.visible=this.fittingBoxAvailable&&part.userData.fittingPreset===preset;
  }
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
  /** Pose around the actual grip before querying the moving release edge. */
  poseTrowel(camera: THREE.Camera, motion: TrowelMotion, dt = 0, wallFrontZ = -2.41): THREE.Vector3 {
    const tool=this.tools.get('trowel')!;
    const arm=this.armSets.get('trowel')!.find(candidate=>candidate.side===1)!;
    const {right,forward}=this.bodyFrame(camera),shoulder=this.shoulder(camera,1);
    // The forearm and hand share one axis throughout the short stroke. The
    // elbow moves on the upper-arm sphere; neither arm segment stretches.
    const axis=new THREE.Vector3(-.82,.20,-.54).normalize().applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    const wallDistance=camera.getWorldPosition(new THREE.Vector3()).z-wallFrontZ;
    const feed=.24+.32*THREE.MathUtils.smoothstep(wallDistance,.55,1)-motion.offset.z;
    const upper=right.clone().multiplyScalar(.96).addScaledVector(forward,feed).add(new THREE.Vector3(0,.08,0)).normalize();
    this.trowelElbow.copy(shoulder).addScaledVector(upper,UPPER_ARM_M);
    const wrist=this.trowelElbow.clone().addScaledVector(axis,FOREARM_M);
    const orientation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),axis)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),THREE.MathUtils.degToRad(motion.rollDegrees)));
    tool.quaternion.copy(this.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation));
    const wristLocal=new THREE.Vector3().fromArray(arm.hand.userData.wristPoint).applyQuaternion(arm.hand.quaternion).add(arm.hand.position);
    tool.position.copy(this.worldToLocal(wrist)).sub(wristLocal.applyQuaternion(tool.quaternion));
    tool.userData.motionStage=motion.stage;
    camera.updateMatrixWorld(true);this.updateWorldMatrix(true,true);
    const load=tool.getObjectByName('trowel-load') as THREE.Mesh<THREE.BufferGeometry>;
    load.visible=motion.loadVisible;
    // A cohesive, yield-resistant mound lags behind acceleration. The contact
    // layer remains attached while its upper mass shears and stretches forward.
    const target=motion.stage==='drive'?.35:motion.stage==='flip'?1:motion.stage==='prepare'?.06:0;
    let remaining=Math.min(Math.max(dt,0),.1);
    while(remaining>0){const step=Math.min(remaining,1/120);this.mortarStrainVelocity+=(180*(target-this.mortarStrain)-23*this.mortarStrainVelocity)*step;this.mortarStrain+=this.mortarStrainVelocity*step;remaining-=step;}
    if(Math.abs(this.mortarStrain-target)<1e-5&&Math.abs(this.mortarStrainVelocity)<1e-5){this.mortarStrain=target;this.mortarStrainVelocity=0;}
    const strain=THREE.MathUtils.clamp(this.mortarStrain,0,1);
    // The empty blade still completes its wrist motion, but invisible mortar
    // needs no vertex upload or normal rebuild. Settled/duplicate poses likewise
    // reuse the same buffer; a 1e-5 strain change is below one micron here.
    if(load.visible&&Math.abs(strain-this.mortarAppliedStrain)>1e-5){
      const position=load.geometry.getAttribute('position'),rest=load.geometry.getAttribute('restPosition');
      for(let i=0;i<position.count;i++){
        const x=rest.getX(i),y=rest.getY(i),z=rest.getZ(i),weight=THREE.MathUtils.clamp(y/(load.userData.deformationHeight??.045),0,1);
        const stretch=1+strain*.42*weight,shrink=1/Math.sqrt(stretch);
        position.setXYZ(i,x*shrink,y*shrink,z*stretch-strain*.027*weight);
      }
      position.needsUpdate=true;load.geometry.computeVertexNormals();this.mortarAppliedStrain=strain;
    }
    // The conservative bound contains all deformed poses without reallocating.
    load.geometry.boundingSphere??=new THREE.Sphere(new THREE.Vector3(),.16);
    this.poseArms(camera);tool.updateWorldMatrix(true,true);
    return tool.localToWorld(new THREE.Vector3().fromArray(tool.userData.releasePoint));
  }
  strike(): void { this.strikeAmount = 1; }
  update(dt: number, moving: boolean, spraying = false): void {
    // Explicit side selection owns the hands. Geometric lean is only a fallback
    // for callers without a selected side, never a reason to undo that choice.
    const headLean=this.workHeadLeanM??-this.workStanceSide;
    if(this.hammerHandedness!==null)this.hammerLeftMain=this.hammerHandedness==='left';
    else if(headLean>.04)this.hammerLeftMain=true;
    else if(headLean<.015)this.hammerLeftMain=false;
    const gripTarget=this.hammerLeftMain?1:0;
    this.hammerGripBlend+=THREE.MathUtils.clamp(gripTarget-this.hammerGripBlend,-dt*2.8,dt*2.8);
    const bob = moving ? Math.sin(performance.now() * 0.012) * 0.006 : 0;
    // Keep the working hand above the landscape toolbar and inside a portrait
    // view. The entire tool moves with the wrist; arm lengths stay physical.
    const handTool=this.selectedTool!=='hammer';
    this.position.x=handTool&&innerWidth<innerHeight?-.065:.02;
    this.position.y=(handTool&&this.touchViewport.matches&&innerHeight<520?(this.selectedTool==='fitting'?-.07:.02):this.restingY)+bob;
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
    // Cant the rotatable support grip below the barrel. A purely horizontal
    // handle puts the supporting palm over the cutting edge in portrait view.
    auxiliary.rotation.z=Math.PI/4+this.hammerGripBlend*Math.PI/2;
    const front=new THREE.Vector3().fromArray(auxiliary.userData.gripPoint).applyQuaternion(auxiliary.quaternion).add(auxiliary.position);
    hammer.userData.secondaryGripPoint=front.toArray();
    // Regrip in sequence: one hand stays on the rear handle while the other
    // travels around the housing. Percussion pauses until both hands are seated.
    for(const arm of this.armSets.get('hammer')??[]){
      const t=THREE.MathUtils.smoothstep(this.hammerGripBlend,arm.side<0?0:.5,arm.side<0?.5:1);
      arm.hand.position.lerpVectors(arm.side<0?front:rear,arm.side<0?rear:front,t);
      arm.hand.position.y-=Math.sin(t*Math.PI)*.09;
      arm.grip.copy(arm.hand.position);
      const supporting=arm.side<0?1-t:t;
      arm.hand.rotation.set(0,0,arm.side*supporting*Math.PI/4);
      arm.hand.userData.gripRole=supporting>.99?'auxiliary':supporting<.01?'rear':'regripping';
      arm.hand.userData.gripping=t===0||t===1;
    }
  }
  /** Aim the physical nozzle around the held grip, before sampling its outlet. */
  aimWaterGun(camera:THREE.Camera,target:THREE.Vector3):void {
    const tool=this.tools.get('hose')!,grip=new THREE.Vector3().fromArray(tool.userData.gripPoint);
    const anchor=grip.clone().applyQuaternion(tool.quaternion).add(tool.position);
    for(let i=0;i<3;i++){
      const outlet=this.toolTipWorld(camera,'hose');
      const direction=target.clone().sub(outlet).normalize().applyQuaternion(this.getWorldQuaternion(new THREE.Quaternion()).invert());
      tool.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),direction);
      tool.position.copy(anchor).sub(grip.clone().applyQuaternion(tool.quaternion));
      this.constrainHeldTool(camera);
    }
  }
  waterGunDirectionWorld():THREE.Vector3 {
    return new THREE.Vector3(0,0,-1).applyQuaternion(this.tools.get('hose')!.getWorldQuaternion(new THREE.Quaternion()));
  }
  private bodyFrame(camera:THREE.Camera): { eye:THREE.Vector3; right:THREE.Vector3; forward:THREE.Vector3 } {
    const eye=camera.getWorldPosition(new THREE.Vector3()),forward=camera.getWorldDirection(new THREE.Vector3());
    forward.y=0;forward.normalize();
    return {eye,forward,right:forward.clone().cross(new THREE.Vector3(0,1,0)).normalize()};
  }
  private shoulder(camera:THREE.Camera,side:number):THREE.Vector3 {
    const {eye,right,forward}=this.bodyFrame(camera);
    // A small torso offset keeps the neutral two-handed body frame visible in
    // a narrow portrait view. Eyes remain fixed; arm lengths and wrist axes do not change.
    if(this.selectedTool==='trowel'&&innerWidth<innerHeight)eye.addScaledVector(right,-.13);
    if(this.selectedTool==='trowel'&&this.touchViewport.matches&&innerHeight<520)eye.y+=.11;
    // The head peeks past the motor while the shoulders stay over the torso.
    // This is a small neck lean, not extra arm reach or a stretched forearm.
    if(this.selectedTool==='hammer'&&this.workPositionLocked){
      const swapped=THREE.MathUtils.smoothstep(this.hammerGripBlend,0,1);
      eye.addScaledVector(right,THREE.MathUtils.lerp(.12,-.12,swapped));
    }
    const hammerWork=this.selectedTool==='hammer'&&this.workPositionLocked;
    if(hammerWork){eye.add(this.hammerFeedOffset);eye.y+=this.hammerPostureY;}
    return eye.addScaledVector(right,side*.20).addScaledVector(forward,hammerWork?0:-.085).add(new THREE.Vector3(0,-.22,0));
  }
  /** Find the shared, finite torso feed that keeps BOTH wrists within reach. */
  private seatHammerFeed(camera:THREE.Camera,axis:THREE.Vector3):void {
    this.hammerFeedOffset.set(0,0,0);this.hammerFit.feedM=0;this.hammerPostureY=0;this.hammerFit.postureY=0;
    if(!this.workPositionLocked)return;
    // A small torso bend lets crouched upward work reach a low rear handle.
    // Only the shoulders move: eyes, input aim and both arm lengths stay fixed.
    const arms=this.armSets.get('hammer')??[];
    const meanWristY=arms.reduce((sum,arm)=>sum+this.wrist(arm).y,0)/Math.max(1,arms.length);
    this.hammerPostureY=THREE.MathUtils.clamp(meanWristY+.20-(camera.getWorldPosition(new THREE.Vector3()).y-.22),-.16,0);
    this.hammerFit.postureY=this.hammerPostureY;
    // Feed follows the shaft, including its lateral/vertical component. A
    // 10 cm camera-forward offset exhausted one arm as soon as the shell fell.
    // Intersect both arm spheres with a bounded 24 cm torso travel segment.
    let lower=0,upper=.24;
    const radius=MAX_WRIST_REACH_M-.001;
    for(const arm of this.armSets.get('hammer')??[]){
      const delta=this.wrist(arm).sub(this.shoulder(camera,arm.side));
      const along=delta.dot(axis),discriminant=radius*radius-delta.lengthSq()+along*along;
      if(discriminant<0)return;
      const span=Math.sqrt(discriminant);
      lower=Math.max(lower,along-span);upper=Math.min(upper,along+span);
    }
    if(lower>upper)return;
    this.hammerFit.feedM=lower;
    this.hammerFeedOffset.copy(axis).multiplyScalar(lower);
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
    this.presentedFeedOffset=null;
    this.feedOffset.set(0,0,0);
    this.hammerFeedOffset.set(0,0,0);this.hammerFit.feedM=0;
    const hammer=this.tools.get('hammer')!;
    // Keep the chosen hand and screen side even outside a reachable work area.
    // The established right-handed rest pose is the blend's zero endpoint.
    hammer.position.set(-.18*this.hammerGripBlend,-.055,0);
    hammer.rotation.set(.12,THREE.MathUtils.lerp(-.08,.08,this.hammerGripBlend),0);
    this.constrainHeldTool(camera);this.poseArms(camera);
    this.chiselTipWorld.copy(hammer.localToWorld(this.tipAnchor.clone()));
  }
  poseArms(camera:THREE.Camera):void {
    const emptyFitting=this.selectedTool==='fitting'&&!this.fittingBoxAvailable;
    if(this.selectedTool==='fitting'){
      for(const part of this.fittingBoxParts)part.visible=this.fittingBoxAvailable&&part.userData.fittingPreset===this.fittingPreset;
      const hand=this.armSets.get('fitting')!.find(arm=>arm.side===1)!.hand;
      hand.userData.gripping=this.fittingBoxAvailable;
      hand.userData.gripRole=emptyFitting?'reaching':'primary';
      if(!emptyFitting){hand.position.fromArray(hand.userData.fittingGripPosition);hand.quaternion.fromArray(hand.userData.fittingGripQuaternion);}
    }
    if(this.selectedTool!=='hammer'&&this.selectedTool!=='trowel'&&!emptyFitting)this.constrainHeldTool(camera);
    const {right}=this.bodyFrame(camera);
    for(const arm of this.armSets.get(this.selectedTool)??[]){
      if(arm.hand.userData.gripRole==='resting')this.poseRestingHand(camera,arm);
      else if(emptyFitting)this.poseEmptyFittingHand(camera,arm);
      poseWorkerArm(arm,this.shoulder(camera,arm.side),this.wrist(arm),right,this.selectedTool==='trowel'&&arm.side===1?this.trowelElbow:undefined);
      flexWorkerHand(arm.hand,arm.hand.userData.gripRole==='resting'?0:this.toolAction+this.strikeAmount*.35+(this.hoseActive?.4:0),performance.now()*.001);
      if(arm.hand.userData.gripping)poseToolGrip(arm.hand,this.tools.get(this.selectedTool)!,this.toolAction);
    }
  }
  private poseEmptyFittingHand(camera:THREE.Camera,arm:WorkerArm):void {
    const {right,forward}=this.bodyFrame(camera);
    const wrist=this.shoulder(camera,arm.side).addScaledVector(forward,.40).add(new THREE.Vector3(0,-.14,0));
    const orientation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,new THREE.Vector3(0,1,0),forward.clone().negate()));
    const parent=arm.hand.parent!;parent.updateWorldMatrix(true,false);
    arm.hand.quaternion.copy(parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation));
    arm.hand.position.copy(parent.worldToLocal(wrist)).sub(new THREE.Vector3().fromArray(arm.hand.userData.wristPoint).applyQuaternion(arm.hand.quaternion));
    arm.hand.updateWorldMatrix(true,true);
  }
  private poseRestingHand(camera:THREE.Camera,arm:WorkerArm):void {
    const {right,forward}=this.bodyFrame(camera);
    // The free wrist hangs beside the hip in BODY space, independent of the
    // held tool's position, pitch, recoil or trowel swing.
    const wrist=this.shoulder(camera,arm.side).add(new THREE.Vector3(0,-.55,0)).addScaledVector(right,-.045).addScaledVector(forward,.025);
    // Kneeling cannot carry the standing hip-height hand through the floor.
    // Raise the wrist and fold the free forearm slightly forward beside the
    // knee. The two-bone solver keeps both arm lengths fixed; the hanging
    // fingers retain clear floor space and standing posture stays identical.
    const floorLift=Math.max(0,.23-wrist.y);
    wrist.y+=floorLift;wrist.addScaledVector(forward,Math.min(.14,floorLift*.55));
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
    if(kind==='fitting'){
      for(const kinds of [['1G'],['2G'],['2G','1G']] as const){
        const variant=kinds.length===1&&kinds[0]==='1G'?group:buildToolModel('fitting',kinds);
        const parts=[...variant.children],preset=kinds.join('+');
        this.fittingVariants.set(preset,{parts,kinds,width:variant.userData.fittingGroupWidth});
        for(const part of parts){part.visible=preset===this.fittingPreset;group.add(part);this.fittingBoxParts.push(part);}
      }
    }
    this.attachArms(kind,group);
    if(kind==='fitting'){
      const hand=this.armSets.get(kind)!.find(arm=>arm.side===1)!.hand;
      hand.userData.fittingGripPosition=hand.position.toArray();
      hand.userData.fittingGripQuaternion=hand.quaternion.toArray();
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
    // Exactly 400 mm of exposed steel from the dust seal (-.349) to the
    // cutting edge (-.749). Keep the contact anchor and visual mesh identical.
    group.userData.tipPoint=this.tipAnchor.toArray();
    group.userData.chiselStartPoint=[.02,.005,-.349];
    group.userData.exposedChiselLengthM=.40;
    group.userData.nominalBladeWidthM=.05;
    // Moderately metallic brushed steel remains readable under indoor fill
    // lighting even when the room has no environment map for chrome reflections.
    const chisel = new THREE.Mesh(new THREE.CylinderGeometry(.009, .009, .31, 16), material(0x969e9d, .48, .30));
    chisel.name='400 mm exposed chisel shaft';
    chisel.rotation.x = Math.PI / 2; place(chisel, 0.02, 0.005, -.504);
    const wedge = new THREE.BufferGeometry();
    // Forged narrow neck, 50 mm flared blade, and a separate bright ground
    // bevel. Flat face normals make the actual blade roll easy to read.
    const stations=[[.009,.007,.05],[.025,.0045,-.02],[.025,.0006,-.05]];
    const vertices:number[]=[],indices:number[]=[];
    for(const [halfWidth,halfThickness,z] of stations)vertices.push(-halfWidth,-halfThickness,z,halfWidth,-halfThickness,z,halfWidth,halfThickness,z,-halfWidth,halfThickness,z);
    for(let station=0;station<2;station++)for(let edge=0;edge<4;edge++){
      const a=station*4+edge,b=station*4+(edge+1)%4,c=b+4,d=a+4;
      indices.push(a,c,b,a,d,c);
    }
    indices.push(0,2,3,0,1,2,8,10,9,8,11,10);
    wedge.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));wedge.setIndex(indices);
    const bladeGeometry=wedge.toNonIndexed();wedge.dispose();bladeGeometry.computeVertexNormals();
    bladeGeometry.addGroup(0,24,0);bladeGeometry.addGroup(24,24,1);bladeGeometry.addGroup(48,12,0);
    const chiselTip = new THREE.Mesh(bladeGeometry,[material(0x9ba6a7,.45,.30),material(0xe1e8e5,.27,.35)]);
    chiselTip.name='50 mm flat chisel with ground cutting bevel';
    place(chiselTip, 0.02, 0.005, -.699);
    this.flatTip = chiselTip;
    this.pointedTip = new THREE.Mesh(new THREE.ConeGeometry(.009,.10,8), material(0xb6c2be,.38,.30));
    this.pointedTip.name='Interchangeable pointed chisel';
    this.pointedTip.rotation.x = -Math.PI/2;
    place(this.pointedTip,.02,.005,-.699); this.pointedTip.visible=false;
    group.add(chisel, chiselTip, this.pointedTip);
    // The wall must occlude parts of the bit inside solid shell/ribs. The other
    // handheld tools retain their established overlay rendering.
    group.traverse(object=>{ if(object instanceof THREE.Mesh) for(const m of Array.isArray(object.material)?object.material:[object.material]) {m.depthTest=true;m.depthWrite=true;m.transparent=false;} });
    return group;
  }
}
