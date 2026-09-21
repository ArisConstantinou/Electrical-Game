import * as THREE from 'three';
import { buildToolModel } from './ToolModels';
import { buildTapeMeasureModel, buildMeasurePencil } from './TapeMeasureModel';
import { buildReferenceToolModel } from './ReferenceToolModels';
import type { TrowelMotion } from './TrowelMotion';
import { workerHand, workerArm, poseWorkerArm, flexWorkerHand, poseToolGrip, MAX_WRIST_REACH_M, UPPER_ARM_M, FOREARM_M, type WorkerArm, workerGripTarget, hideLegacyWorkerArm, type WorkerGripTarget } from './WorkerArm';
import type { BrickWall, ChiselContact } from '../world/BrickWall';
import { MaterialId } from '../world/MasonryVolume';
import type { BoxKind } from '../data/installationRules';
import { ElectricalBox } from '../electrical/Box';
import { boxAssemblyBounds, boxModuleSize, horizontalBoxLayout, type BoxAssemblySnapshot, type BoxAttachmentZone, type BoxModuleLayout } from '../electrical/BoxAssembly';

export type RigTool = 'spray' | 'hammer' | 'fitting' | 'level' | 'spring' | 'cutter' | 'trowel' | 'hose' | 'measure' | 'drill' | 'driver' | 'laser';
export const RIG_TOOLS: RigTool[] = ['spray', 'hammer', 'fitting', 'level', 'spring', 'cutter', 'trowel', 'hose', 'measure', 'drill', 'driver', 'laser'];

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
  useAnatomicalSpray(active:boolean):void {this.useAnatomicalBody(active);}
  useAnatomicalBody(active:boolean):void {
    for(const arms of this.armSets.values())for(const arm of arms)hideLegacyWorkerArm(arm,active);
  }
  anatomicalGrips():WorkerGripTarget[] {
    if(!this.visible)return [];
    return (this.armSets.get(this.selectedTool)??[]).map(arm=>{
      const grip=workerGripTarget(arm,arm.hand.userData.gripping===true||(this.selectedTool==='measure'&&arm.side<0));
      if(['drill','driver','measure','level','spring','cutter'].includes(this.selectedTool)&&arm.side>0){
        grip.referenceKey=`${this.selectedTool}:R`;
        Object.defineProperty(grip,'object',{value:this.tools.get(this.selectedTool)});
      }
      if(this.selectedTool==='drill'||this.selectedTool==='driver'){
        grip.contactLocked=this.reachable;
        grip.section=[.020,.029];grip.shape='box';
        const tool=this.tools.get(this.selectedTool)!,trigger=tool.getObjectByName('Index finger trigger');
        if(arm.side>0&&trigger)grip.trigger=trigger.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,0,-.013).applyQuaternion(tool.getWorldQuaternion(new THREE.Quaternion())));
      }
      if(this.selectedTool==='fitting'){
        grip.shape='box';
        Object.defineProperty(grip,'object',{value:arm.side>0?this.fittingCandidateRoot:this.fittingAssemblyRoot});
      }
      if(this.selectedTool==='trowel')grip.straightWrist=true;
      if(this.selectedTool==='measure'){
        if(arm.side>0){grip.contactLocked=this.tools.get('measure')!.userData.measuring===true;grip.section=[.031,.025];grip.shape='box';}
        else {grip.section=[.005,.003];grip.shape='box';}
      }
      if(this.selectedTool==='laser'){grip.section=[.021,.035];grip.shape='box';}
      return grip;
    });
  }
  poseAnatomicalSpray(center:THREE.Vector3,orientation:THREE.Quaternion,pressed=false):THREE.Vector3 {
    const tool=this.tools.get('spray')!,can=tool.children[0];
    const worldQ=orientation.clone().multiply(can.quaternion.clone().invert());
    tool.quaternion.copy(tool.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldQ));
    tool.position.copy(tool.parent!.worldToLocal(center.clone())).sub(can.position.clone().applyQuaternion(tool.quaternion));
    tool.getObjectByName('spray-actuator')!.position.y=pressed?.102:.104;
    tool.updateWorldMatrix(false,true);
    // The target is the fingertip bone endpoint; its fleshy pad extends below it.
    return tool.getObjectByName('Broad finger press actuator')!.localToWorld(new THREE.Vector3(0,.025,0));
  }
  /** Preserve the candidate's attachment motion while the arm carries it. */
  boxGraspMotion(object:THREE.Object3D):THREE.Vector3 {
    if(object!==this.fittingCandidateRoot||!this.fittingAttachment)return new THREE.Vector3();
    return object.position.clone().sub(this.fittingCandidateHome).applyQuaternion(object.parent!.getWorldQuaternion(new THREE.Quaternion()));
  }
  boxGraspViewCorners(object:THREE.Object3D,center:THREE.Vector3,rotation:THREE.Quaternion):THREE.Vector3[]{
    const bounds=new THREE.Box3(),inverse=rotation.clone().invert();
    for(const root of object===this.fittingAssemblyRoot?[object,this.fittingZonesRoot]:[object]){
      root.updateWorldMatrix(true,true);root.traverse(part=>{
        const geometry=(part as THREE.Mesh).geometry;if(!geometry)return;
        if(!geometry.boundingBox)geometry.computeBoundingBox();const box=geometry.boundingBox!;
        for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])bounds.expandByPoint(new THREE.Vector3(x,y,z).applyMatrix4(part.matrixWorld).sub(center).applyQuaternion(inverse));
      });
    }
    const corners:THREE.Vector3[]=[];
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])corners.push(new THREE.Vector3(x,y,z));
    return corners;
  }
  /** Project the assembly and each attachment zone separately: empty space
   * between zones is usable, but the next casing must not cover a choice. */
  boxGraspScreenObstacles(object:THREE.Object3D,camera:THREE.PerspectiveCamera):THREE.Box2[]{
    if(object!==this.fittingCandidateRoot||this.fittingAttachment)return [];
    return [this.fittingAssemblyRoot,...this.fittingZonesRoot.children].map(root=>{
      root.updateWorldMatrix(true,true);const bounds=new THREE.Box2();
      root.traverse(part=>{
        const geometry=(part as THREE.Mesh).geometry;if(!geometry)return;
        if(!geometry.boundingBox)geometry.computeBoundingBox();const box=geometry.boundingBox!;
        for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
          const point=new THREE.Vector3(x,y,z).applyMatrix4(part.matrixWorld).project(camera);
          bounds.expandByPoint(new THREE.Vector2(point.x,point.y));
        }
      });return bounds.expandByScalar(.025);
    });
  }
  /** Numbered choices are interaction UI attached to the held assembly. Keep
   * their cross visible without moving the physical boxes, hands or camera. */
  clampFittingZones(camera:THREE.PerspectiveCamera):void {
    if(!this.fittingZonesRoot.visible||!this.fittingZonesRoot.children.length)return;
    const worldRight=new THREE.Vector3(1,0,0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion())),worldUp=new THREE.Vector3(0,1,0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    for(let pass=0;pass<6;pass++){
      const bounds=this.boxGraspScreenObstacles(this.fittingCandidateRoot,camera).slice(1).reduce((all,box)=>all.union(box),new THREE.Box2());
      const dx=bounds.min.x<-.96?-.96-bounds.min.x:bounds.max.x>.96?.96-bounds.max.x:0,dy=bounds.min.y<-.96?-.96-bounds.min.y:bounds.max.y>.96?.96-bounds.max.y:0;
      if(Math.abs(dx)<1e-6&&Math.abs(dy)<1e-6)break;
      const world=this.fittingZonesRoot.getWorldPosition(new THREE.Vector3()),view=world.clone().applyMatrix4(camera.matrixWorldInverse),halfHeight=-view.z*Math.tan(THREE.MathUtils.degToRad(camera.fov*.5));
      world.addScaledVector(worldRight,dx*halfHeight*camera.aspect).addScaledVector(worldUp,dy*halfHeight);
      this.fittingZonesRoot.position.copy(this.fittingZonesRoot.parent!.worldToLocal(world));this.fittingZonesRoot.updateWorldMatrix(false,true);
    }
  }
  translateBoxGrasp(object:THREE.Object3D,delta:THREE.Vector3):void {
    const parts=object===this.fittingAssemblyRoot?[object,this.fittingZonesRoot]:[object];
    const arm=this.armSets.get('fitting')!.find(entry=>entry.side===(object===this.fittingAssemblyRoot?-1:1));if(arm)parts.push(arm.hand);
    for(const part of parts){const world=part.getWorldPosition(new THREE.Vector3()).add(delta);part.position.copy(part.parent!.worldToLocal(world));part.updateWorldMatrix(false,true);}
  }
  private graspBases=new Map<THREE.Object3D,{position:THREE.Vector3;rotation:THREE.Quaternion}>();
  private restoreGrasp():void {
    for(const [tool,{position,rotation}] of this.graspBases){tool.position.copy(position);tool.quaternion.copy(rotation);tool.updateWorldMatrix(false,true);}
    this.graspBases.clear();
  }
  /** Carry the tool, contact anchor and labels with the solved forearm. */
  transformAnatomicalGrasp(from:THREE.Vector3,to:THREE.Vector3,turn:THREE.Quaternion,object?:THREE.Object3D):void {
    const tool=object??this.tools.get(this.selectedTool)!;
    const objects=tool===this.fittingAssemblyRoot?[tool,this.fittingZonesRoot]:[tool];
    if(this.selectedTool==='fitting'){
      const arm=this.armSets.get('fitting')!.find(a=>a.side===(tool===this.fittingAssemblyRoot?-1:1));
      if(arm)objects.push(arm.hand);
    }
    for(const part of objects){
      if(!this.graspBases.has(part))this.graspBases.set(part,{position:part.position.clone(),rotation:part.quaternion.clone()});
      const position=part.getWorldPosition(new THREE.Vector3()).sub(from).applyQuaternion(turn).add(to);
      const rotation=turn.clone().multiply(part.getWorldQuaternion(new THREE.Quaternion()));
      part.position.copy(part.parent!.worldToLocal(position));
      part.quaternion.copy(part.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
      part.updateWorldMatrix(false,true);
    }
  }
  private readonly tools = new Map<RigTool, THREE.Group>();
  private readonly heldBounds = new Map<string, THREE.Box3>();
  private readonly surfaceBounds = new THREE.Box3();
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
  private measureMarkTime=0;
  private readonly measureMarkPoint=new THREE.Vector3();
  private readonly measureOrientation=new THREE.Quaternion();
  private readonly measureMarkOrientation=new THREE.Quaternion();
  private readonly referenceMotors=new Map<'drill'|'driver',THREE.Object3D>();
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
  private readonly fittingAssemblyRoot=new THREE.Group();
  private readonly fittingCandidateRoot=new THREE.Group();
  private readonly fittingZonesRoot=new THREE.Group();
  private fittingAssembly:BoxAssemblySnapshot|null=null;
  private fittingZones:Array<{zone:BoxAttachmentZone;module:BoxModuleLayout;available:boolean}>=[];
  private fittingAttachment:{elapsed:number;duration:number;addedId:string;target:THREE.Vector3}|null=null;
  private readonly fittingCandidateHome=new THREE.Vector3(.125,-.018,-.055);
  private fittingPresentationScale=1;
  private fittingAssemblyActive=false;
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
  private hammerWasWorking=false;
  private holdHammerFeed=false;
  private readonly lastHammerEntry=new THREE.Vector3(Infinity,Infinity,Infinity);
  private readonly lastHammerDirection=new THREE.Vector3();
  readonly hammerFit={housingCameraZ:0,wristReachM:[] as number[],feedM:0,postureY:0};

  /** Contact can be queried several times per impact; advance the pose once per frame. */
  beginFrame(dt: number, wallTravelM: number | null = null, working=true): void {
    this.updateFittingAttachment(dt);
    if(this.hammerWasWorking&&!working)this.holdHammerFeed=true;
    if(working)this.holdHammerFeed=false;
    this.hammerWasWorking=working;
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
    // Releasing percussion parks the bit at its presented depth. The newly
    // exposed shell must not keep pulling it sideways/down through a cavity.
    // A deliberate change of aim/attack resumes normal contact positioning.
    if(entry.distanceToSquared(this.lastHammerEntry)>1e-10||direction.distanceToSquared(this.lastHammerDirection)>1e-10)this.holdHammerFeed=false;
    this.lastHammerEntry.copy(entry);this.lastHammerDirection.copy(direction);
    if (Math.abs(entry.x)>2.54 || entry.y<0 || entry.y>3) { this.restHammer(camera); return null; }
    // Follow the CHISEL axis through the aperture. Empty chambers consume no
    // impact and no energy: the next contact is a surviving rib or rear shell.
    const origin=entry.clone().addScaledVector(direction,-.02);
    // Finishing starts at the rib under the crosshair inside the open chase.
    // Tilting upward changes the blade attack, not the selected depth/target.
    // Ordinary excavation still follows the shaft through the front aperture.
    const upward=wall.chiselTiltDegrees<0;
    if(!upward){
      // A recessed joint is only about 12 mm wide. Starting the angled shaft
      // at the facade projection of the crosshair sends it beside that joint,
      // into a hollow brick, even though the player is aiming at its grey face.
      // Seat the shaft through the visible joint instead. Trace from outside
      // the wall so a nearer lip still blocks the real blade; never teleport
      // contact through intact masonry to the selected backing.
      const visible=wall.volume.raycast(eye,view,distance+.28/Math.max(.08,Math.abs(view.z)));
      if(visible?.material===MaterialId.Mortar){
        const travel=(wall.volume.frontZ-visible.point.z)/Math.max(.04,-direction.z)+.02;
        origin.set(visible.point.x,visible.point.y,visible.point.z).addScaledVector(direction,-travel);
      }
    }
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
      advance.clampLength(0,this.holdHammerFeed?0:this.contactFeedBudgetM);
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
      // Resolve only the actual overlap. A fixed withdrawal snapped the
      // entire tool by centimetres when crossing the head-clearance boundary.
      const clearance=housing.clone().normalize().multiplyScalar(.19-housing.length());
      clearance.applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
      hammer.position.copy(this.worldToLocal(hammer.getWorldPosition(new THREE.Vector3()).add(clearance)));
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
    const measure=buildTapeMeasureModel();this.attachArms('measure',measure);this.addTool('measure',measure);
    for(const kind of ['drill','driver','laser'] as const){
      const tool=buildReferenceToolModel(kind);this.attachArms(kind,tool);this.addTool(kind,tool);
      if(kind!=='laser')this.referenceMotors.set(kind,tool.getObjectByName('reference-motor')!);
    }
    this.show('spray');
  }

  show(tool: RigTool): void { if(tool!=='measure')this.measureMarkTime=0; this.selectedTool=tool; this.tools.forEach((group, key) => { group.visible = key === tool; }); this.armSets.forEach((arms,key)=>arms.forEach(arm=>arm.group.visible=key===tool)); }
  get fittingBoxKinds():readonly BoxKind[]{return this.fittingAssembly?.modules.map(module=>module.kind)??this.fittingVariants.get(this.fittingPreset)?.kinds??['1G'];}
  /** Legacy presets now enter the same live assembly representation used by custom puzzles. */
  setFittingBoxKinds(kinds:readonly BoxKind[]):void{
    const modules=horizontalBoxLayout(kinds),activeId=modules.at(-1)!.id;
    this.setFittingAssembly({modules,activeId,candidateKind:kinds.at(-1)??'1G',candidateRotation:0},[]);
  }
  setFittingAssembly(snapshot:BoxAssemblySnapshot,zones:Array<{zone:BoxAttachmentZone;module:BoxModuleLayout;available:boolean}>,addedId?:string):void{
    this.restoreGrasp();
    this.fittingAssembly={...snapshot,modules:snapshot.modules.map(module=>({...module}))};
    this.fittingZones=zones.map(zone=>({...zone,module:{...zone.module}}));
    this.fittingPreset=snapshot.modules.map(module=>`${module.kind}@${module.rotation}:${module.x.toFixed(3)},${module.y.toFixed(3)}`).join('|');
    for(const part of this.fittingBoxParts)part.visible=false;
    this.rebuildFittingAssembly();
    const added=addedId?this.fittingAssemblyRoot.children.find(object=>object.userData.assemblyModuleId===addedId):undefined;
    if(added){
      added.visible=false;
      this.rebuildFittingCandidate((added.userData.boxKind as BoxKind)??snapshot.candidateKind,added.userData.quarterTurn??0);
      const local=added.position.clone().multiplyScalar(this.fittingPresentationScale);
      this.fittingAttachment={elapsed:0,duration:.34,addedId:addedId!,target:this.fittingAssemblyRoot.position.clone().add(local)};
      this.fittingZonesRoot.visible=false;
    }else{
      this.fittingAttachment=null;
      this.rebuildFittingCandidate(snapshot.candidateKind,snapshot.candidateRotation);
      this.rebuildFittingZones();
    }
    const bounds=boxAssemblyBounds(snapshot.modules),tool=this.tools.get('fitting')!;
    tool.userData.fittingBoxKinds=snapshot.modules.map(module=>module.kind);
    tool.userData.fittingGroupWidth=bounds.width;tool.userData.fittingGroupHeight=bounds.height;tool.userData.fittingBoxCount=snapshot.modules.length;
    this.heldBounds.clear();
  }
  private clearFittingRoot(root:THREE.Group):void{
    // Do not dispose detached viewmodel buffers during play. Three's WebGPU
    // render bundles may still reference them after Queue.submit(), which
    // turns rapid wheel/number edits into device validation errors. The small
    // transient objects become unreachable here and are reclaimed with the
    // renderer/page lifecycle.
    for(const child of [...root.children])root.remove(child);
  }
  private viewBox(module:Pick<BoxModuleLayout,'id'|'kind'|'rotation'>):ElectricalBox{
    // Dynamic boxes need the same depth policy as the other anatomical
    // viewmodels: rear casing faces must not overwrite their own front rim.
    const box=new ElectricalBox(module.kind,`held-assembly:${module.id}`);
    box.rotation.z=module.rotation*Math.PI/2;box.userData.assemblyModuleId=module.id;box.userData.boxKind=module.kind;box.userData.quarterTurn=module.rotation;
    box.traverse(object=>{object.frustumCulled=false;if(object instanceof THREE.Mesh){object.material=(Array.isArray(object.material)?object.material:[object.material]).map(entry=>{const copy=entry.clone();copy.depthTest=true;copy.depthWrite=true;return copy;});if((object.material as THREE.Material[]).length===1)object.material=(object.material as THREE.Material[])[0];object.renderOrder=20;object.castShadow=false;object.receiveShadow=false;}});
    return box;
  }
  private rebuildFittingAssembly():void{
    this.clearFittingRoot(this.fittingAssemblyRoot);
    const snapshot=this.fittingAssembly;if(!snapshot)return;
    const bounds=boxAssemblyBounds(snapshot.modules);
    // Held casings retain their world dimensions relative to the anatomical
    // hands. Fit the arm/assembly into view instead of shrinking the boxes.
    this.fittingPresentationScale=1;
    this.fittingAssemblyRoot.position.set(-.105,.005,-.065);
    this.fittingAssemblyRoot.scale.setScalar(this.fittingPresentationScale);
    for(const module of snapshot.modules){
      const box=this.viewBox(module);box.position.set(module.x-bounds.centerX,module.y-bounds.centerY,0);this.fittingAssemblyRoot.add(box);
      if(module.id===snapshot.activeId){
        const size=boxModuleSize(module),edge=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.width+.010,size.height+.010,.010)),new THREE.LineBasicMaterial({color:0x62e5ff,depthTest:false,transparent:true,opacity:.9}));
        edge.name='Active box cyan outline';edge.userData.assemblyModuleId=`active-${module.id}`;edge.renderOrder=22;edge.frustumCulled=false;edge.position.copy(box.position);this.fittingAssemblyRoot.add(edge);
      }
    }
  }
  private rebuildFittingCandidate(kind:BoxKind,rotation:number):void{
    this.clearFittingRoot(this.fittingCandidateRoot);
    const box=this.viewBox({id:'candidate',kind,rotation:rotation as 0|1|2|3});box.name=`Right-hand next ${kind} box`;this.fittingCandidateRoot.add(box);
    this.fittingCandidateRoot.scale.setScalar(1);
    this.fittingCandidateRoot.position.copy(this.fittingCandidateHome);
  }
  private zoneLabel(value:number,available:boolean):THREE.Sprite{
    const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;const context=canvas.getContext('2d')!;
    context.shadowColor='#05171ccc';context.shadowBlur=12;
    context.fillStyle=available?'#173a42e8':'#352d2ba8';context.strokeStyle=available?'#a8f2ff':'#9d7771';context.lineWidth=5;context.beginPath();context.arc(48,48,38,0,Math.PI*2);context.fill();context.stroke();
    context.shadowBlur=0;context.strokeStyle=available?'#6fbfca88':'#80696677';context.lineWidth=2;context.beginPath();context.arc(48,48,30,0,Math.PI*2);context.stroke();
    context.fillStyle=available?'#ffffff':'#c7aaa5';context.font='bold 50px Arial';context.textAlign='center';context.textBaseline='middle';context.fillText(String(value),48,52);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false,transparent:true}));sprite.scale.set(.034,.034,1);sprite.renderOrder=24;sprite.frustumCulled=false;return sprite;
  }
  fittingZoneAtScreen(camera:THREE.Camera,rect:DOMRect,x:number,y:number):number|null{
    if(!this.fittingZonesRoot.visible)return null;
    this.fittingZonesRoot.updateWorldMatrix(true,true);
    let selected:number|null=null,distance=28;
    for(const zone of this.fittingZonesRoot.children){
      if(!zone.userData.available)continue;
      const point=zone.getWorldPosition(new THREE.Vector3()).project(camera);
      if(point.z<-1||point.z>1)continue;
      const px=rect.left+(point.x+1)*rect.width/2,py=rect.top+(1-point.y)*rect.height/2;
      const delta=Math.hypot(px-x,py-y);
      if(delta<distance){distance=delta;selected=zone.userData.zone as number;}
    }
    return selected;
  }
  private rebuildFittingZones():void{
    this.clearFittingRoot(this.fittingZonesRoot);
    const snapshot=this.fittingAssembly;if(!snapshot)return;
    const bounds=boxAssemblyBounds(snapshot.modules);
    this.fittingZonesRoot.position.copy(this.fittingAssemblyRoot.position);
    this.fittingZonesRoot.scale.setScalar(this.fittingPresentationScale);
    for(const zone of this.fittingZones){
      const size=boxModuleSize(zone.module),group=new THREE.Group();group.name=`Box attachment zone ${zone.zone}`;group.userData.zone=zone.zone;group.userData.available=zone.available;
      const edge=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.width+.006,size.height+.006,.008)),new THREE.LineBasicMaterial({color:zone.available?0x58dff5:0x7b5d58,transparent:true,opacity:zone.available?.82:.42,depthTest:false}));edge.renderOrder=21;edge.frustumCulled=false;group.add(edge);
      const label=this.zoneLabel(zone.zone,zone.available);label.position.z=.012;group.add(label);
      group.position.set(zone.module.x-bounds.centerX,zone.module.y-bounds.centerY,.004);
      this.fittingZonesRoot.add(group);
    }
    this.fittingZonesRoot.visible=true;
  }
  private updateFittingAttachment(dt:number):void{
    const animation=this.fittingAttachment;if(!animation)return;
    animation.elapsed+=Math.max(0,Math.min(dt,.05));const t=THREE.MathUtils.smoothstep(animation.elapsed,0,animation.duration);
    this.fittingCandidateRoot.position.lerpVectors(this.fittingCandidateHome,animation.target,t);
    if(t<1)return;
    const added=this.fittingAssemblyRoot.children.find(object=>object.userData.assemblyModuleId===animation.addedId);if(added)added.visible=true;
    this.fittingAttachment=null;
    if(this.fittingAssembly)this.rebuildFittingCandidate(this.fittingAssembly.candidateKind,this.fittingAssembly.candidateRotation);
    this.rebuildFittingZones();
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
  trowelReleaseWorld(camera:THREE.Camera):THREE.Vector3 {
    camera.updateMatrixWorld(true);this.updateWorldMatrix(true,true);
    const tool=this.tools.get('trowel')!;
    return tool.localToWorld(new THREE.Vector3().fromArray(tool.userData.releasePoint));
  }
  /** The world-vertical casing meets the measured blade endpoint without moving the camera. */
  poseMeasure(camera:THREE.Camera,top:THREE.Vector3|null,normal=new THREE.Vector3(0,0,1)):void {
    const tool=this.tools.get('measure')!;
    camera.updateMatrixWorld(true);this.updateWorldMatrix(true,false);
    // The model is authored in metres, independent of presentation scaling.
    const parentScale=this.getWorldScale(new THREE.Vector3());
    tool.scale.set(1/parentScale.x,1/parentScale.y,1/parentScale.z);
    if(top){
      this.measureOrientation.copy(this.measureWallOrientation(normal));
      tool.quaternion.copy(this.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(this.measureOrientation));
      tool.position.copy(this.worldToLocal(top.clone()));
      tool.updateWorldMatrix(true,true);
      this.reachable=this.gripsReachable(camera,tool);
      tool.userData.measuring=true;
    }else{
      this.measureMarkTime=0;
      tool.position.set(.11,-.04,-.03);tool.rotation.set(.12,-.16,-.16);
      this.constrainHeldTool(camera);this.reachable=false;tool.userData.measuring=false;
    }
    this.poseArms(camera);
  }
  /** A short left-hand graphite stroke at the current measured point. */
  markMeasure():void {
    const tool=this.tools.get('measure')!;
    if(this.selectedTool!=='measure'||!tool.userData.measuring)return;
    tool.getWorldPosition(this.measureMarkPoint);this.measureMarkOrientation.copy(this.measureOrientation);this.measureMarkTime=.40;
  }
  /** Seat the real bit while the body and finite arm stay outside the wall. */
  poseReferenceTool(camera:THREE.Camera,kind:'drill'|'driver',point:THREE.Vector3|null,normal:THREE.Vector3,working:boolean,dt:number):void {
    const tool=this.tools.get(kind)!;
    camera.updateMatrixWorld(true);this.updateWorldMatrix(true,false);
    const orientation=this.measureWallOrientation(normal),scale=this.getWorldScale(new THREE.Vector3());tool.scale.set(1/scale.x,1/scale.y,1/scale.z);
    this.reachable=point!==null&&this.canReachPoint(camera,point,.10,normal);
    if(point&&this.reachable){
      const tip=new THREE.Vector3().fromArray(tool.userData.tipPoint).applyQuaternion(orientation);
      tool.position.copy(this.worldToLocal(point.clone().sub(tip)));
      tool.quaternion.copy(this.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation));
    }else{
      tool.position.set(.11,-.015,-.025);tool.rotation.set(.10,-.12,0);this.constrainHeldTool(camera);
    }
    const motor=this.referenceMotors.get(kind)!;
    if(working&&this.reachable)motor.rotation.z=(motor.rotation.z+Math.min(Math.max(dt,0),.05)*(kind==='drill'?36:21))%(Math.PI*2);
    tool.userData.working=working&&this.reachable;
    this.poseArms(camera);
  }
  /** Hold the laser upright with a nearly extended arm. Its portable pose is
   * independent from the drilled-fixing orientation used after mounting. */
  poseLaser(camera:THREE.Camera):void {
    const tool=this.tools.get('laser')!,{eye,right,forward}=this.bodyFrame(camera),shoulder=this.shoulder(camera,1),up=new THREE.Vector3(0,1,0),view=camera.getWorldDirection(new THREE.Vector3());
    camera.updateMatrixWorld(true);this.updateWorldMatrix(true,false);
    const scale=this.getWorldScale(new THREE.Vector3());tool.scale.set(1/scale.x,1/scale.y,1/scale.z);
    const orientation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,forward.clone().negate()));
    const screenRight=.15-Math.max(0,1-(camera as THREE.PerspectiveCamera).aspect)*(.12+Math.abs(view.y)*.25);
    const gripOffset=eye.clone().addScaledVector(view,.45).addScaledVector(right,screenRight).addScaledVector(up,-.03).sub(shoulder);
    if(gripOffset.length()>.502)gripOffset.setLength(.502);
    const grip=shoulder.clone().add(gripOffset);
    tool.quaternion.copy(this.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation));
    const localGrip=new THREE.Vector3().fromArray(tool.userData.gripPoint).applyQuaternion(tool.quaternion);
    tool.position.copy(this.worldToLocal(grip)).sub(localGrip);tool.updateWorldMatrix(true,true);
    this.reachable=true;this.poseArms(camera);
  }
  poseTrowel(camera: THREE.Camera, motion: TrowelMotion, dt = 0, wallFrontZ = -2.41): THREE.Vector3 {
    const tool=this.tools.get('trowel')!;
    const arm=this.armSets.get('trowel')!.find(candidate=>candidate.side===1)!;
    const {right,forward}=this.bodyFrame(camera),shoulder=this.shoulder(camera,1);
    const view=camera.getWorldDirection(new THREE.Vector3());
    const carryWeight=motion.stage==='ready'?THREE.MathUtils.smoothstep(view.z,-.65,-.05):0;
    // Away from the installation wall the loaded trowel rests low beside the
    // body. Keeping the wall-casting pose while looking toward the sand put
    // the blade, paste and forearm across the centre of the screen.
    const cameraFrame=camera.getWorldQuaternion(new THREE.Quaternion());
    const axis=new THREE.Vector3(-.82,.20,-.54).normalize().applyQuaternion(cameraFrame);
    const wallDistance=camera.getWorldPosition(new THREE.Vector3()).z-wallFrontZ;
    const feed=.24+.32*THREE.MathUtils.smoothstep(wallDistance,.55,1)-motion.offset.z;
    const upper=right.clone().multiplyScalar(.96).addScaledVector(forward,feed).add(new THREE.Vector3(0,.08,0)).normalize();
    if(carryWeight>0){
      const carryWrist=camera.localToWorld(new THREE.Vector3(.24,-.23,-.40));
      const direction=carryWrist.clone().sub(shoulder),distance=THREE.MathUtils.clamp(direction.length(),.045,MAX_WRIST_REACH_M);direction.normalize();
      carryWrist.copy(shoulder).addScaledVector(direction,distance);
      const along=(UPPER_ARM_M**2-FOREARM_M**2+distance**2)/(2*distance),height=Math.sqrt(Math.max(0,UPPER_ARM_M**2-along**2));
      const pole=new THREE.Vector3(0,-1,0).addScaledVector(right,.65);pole.addScaledVector(direction,-pole.dot(direction)).normalize();
      const carryElbow=shoulder.clone().addScaledVector(direction,along).addScaledVector(pole,height);
      axis.lerp(carryWrist.sub(carryElbow).normalize(),carryWeight).normalize();
      upper.lerp(carryElbow.sub(shoulder).normalize(),carryWeight).normalize();
    }
    this.trowelElbow.copy(shoulder).addScaledVector(upper,UPPER_ARM_M);
    const wrist=this.trowelElbow.clone().addScaledVector(axis,FOREARM_M);
    // Resolve wrist roll in the player's view frame. A shortest-arc rotation
    // from world -Z flips around its antipode when the player turns around.
    const localAxis=axis.clone().applyQuaternion(cameraFrame.clone().invert());
    const orientation=cameraFrame.clone().multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),localAxis))
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
    // Blend precomputed strain poses. Rebuilding 1,421 vertices and their
    // normals here used several milliseconds per frame on slower phones.
    if(load.visible&&Math.abs(strain-this.mortarAppliedStrain)>1e-5){
      const weights=load.morphTargetInfluences!,scaled=strain*weights.length,lower=Math.floor(scaled),fraction=scaled-lower;
      weights.fill(0);if(lower>0)weights[lower-1]=1-fraction;if(lower<weights.length)weights[lower]=fraction;
      this.mortarAppliedStrain=strain;
    }
    // The conservative bound contains all deformed poses without reallocating.
    load.geometry.boundingSphere??=new THREE.Sphere(new THREE.Vector3(),.16);
    this.poseArms(camera);tool.updateWorldMatrix(true,true);
    return tool.localToWorld(new THREE.Vector3().fromArray(tool.userData.releasePoint));
  }
  strike(): void { this.strikeAmount = 1; }
  setFittingAssemblyActive(active:boolean):void {this.fittingAssemblyActive=active;}
  update(dt: number, moving: boolean, spraying = false): void {
    this.restoreGrasp();
    this.measureMarkTime=Math.max(0,this.measureMarkTime-Math.min(Math.max(dt,0),.05));
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
    // Two separated box hands need the centred frame on portrait screens.
    this.position.x=handTool&&this.selectedTool!=='fitting'&&innerWidth<innerHeight?-.065:.02;
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
    const localTarget=this.worldToLocal(target.clone()),anchor=grip.clone();
    const tipOffset=new THREE.Vector3().fromArray(tool.userData.tipPoint).sub(grip);
    // Start from the same held grip each frame, rather than yesterday's rotated
    // outlet. That feedback loop flipped the gun when a nearby wall crossed
    // the outlet, even with a completely stationary camera and touch.
    // Retract towards the body when the target is inside the barrel's reach;
    // leave a short forward water path instead of aiming back at the player.
    const lateralSq=(localTarget.x-anchor.x)**2+(localTarget.y-anchor.y)**2;
    const clearance=Math.max(.08,Math.sqrt(Math.max(0,(tipOffset.length()+.04)**2-lateralSq)));
    anchor.z=Math.max(anchor.z,localTarget.z+clearance);
    for(let i=0;i<4;i++){
      const toTarget=localTarget.clone().sub(anchor);
      // Solve R * (tipOffset + distance * -Z) = target - grip. This aims
      // from the actual offset nozzle in one operation, without an unstable
      // fixed-point iteration around an outlet that is itself rotating.
      const forward=Math.sqrt(Math.max(0,toTarget.lengthSq()-tipOffset.x**2-tipOffset.y**2));
      const aimOffset=tipOffset.clone();aimOffset.z=-forward;
      tool.quaternion.setFromUnitVectors(aimOffset.normalize(),toTarget.normalize());
      tool.position.copy(anchor).sub(grip.clone().applyQuaternion(tool.quaternion));
      this.constrainHeldTool(camera);
      const held=grip.clone().applyQuaternion(tool.quaternion).add(tool.position);
      if(held.distanceToSquared(anchor)<1e-12)break;
      anchor.copy(held);
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
    const radius=MAX_WRIST_REACH_M-.001;
    const distances=arms.map(arm=>{
      const delta=this.wrist(arm).sub(this.shoulder(camera,arm.side));
      return {squared:delta.lengthSq(),along:delta.dot(axis)};
    });
    if(!distances.length)return;
    const furthest=(feed:number)=>Math.max(...distances.map(d=>d.squared-2*feed*d.along+feed*feed));
    // The minimax distance is convex along the bounded torso travel. Keep
    // the closest feasible posture even when one wrist is just outside reach;
    // returning zero there caused a 21 cm jump at a half-degree aim change.
    let lo=0,hi=.24;
    for(let i=0;i<32;i++){
      const a=(2*lo+hi)/3,b=(lo+2*hi)/3;
      if(furthest(a)<furthest(b))hi=b;else lo=a;
    }
    let feed=(lo+hi)/2;
    if(furthest(0)<=radius*radius)feed=0;
    else if(furthest(feed)<=radius*radius){
      lo=0;hi=feed;
      for(let i=0;i<24;i++){const mid=(lo+hi)/2;if(furthest(mid)>radius*radius)lo=mid;else hi=mid;}
      feed=hi;
    }
    this.hammerFit.feedM=feed;
    this.hammerFeedOffset.copy(axis).multiplyScalar(feed);
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
  /** Conservative local envelope, cached once per held box preset, including the gripping hand. */
  heldToolBoundsWorld(target=new THREE.Box3()):THREE.Box3 {
    const tool=this.tools.get(this.selectedTool)!;
    const key=this.selectedTool==='fitting'?`${this.selectedTool}:${this.fittingPreset}:${this.fittingBoxAvailable}`:this.selectedTool;
    tool.updateWorldMatrix(true,true);
    let bounds=this.heldBounds.get(key);
    if(!bounds){
      bounds=new THREE.Box3();
      const inverse=tool.matrixWorld.clone().invert(),relative=new THREE.Matrix4(),partBounds=new THREE.Box3();
      const collect=(object:THREE.Object3D):void=>{
        if(!object.visible&&object.name!=='trowel-load')return;
        if(object instanceof THREE.Mesh){
          object.geometry.computeBoundingBox();
          if(object.geometry.boundingBox){
            relative.multiplyMatrices(inverse,object.matrixWorld);
            partBounds.copy(object.geometry.boundingBox).applyMatrix4(relative);bounds!.union(partBounds);
          }
        }
        for(const child of object.children)collect(child);
      };
      collect(tool);
      // Finger flex and the loaded trowel's morph envelopes stay inside this
      // small skin. Never rebuild all mesh bounds during a swing or camera pan.
      bounds.expandByScalar(.003);this.heldBounds.set(key,bounds);
    }
    return target.copy(bounds).applyMatrix4(tool.matrixWorld);
  }
  /** Retract a held tool from the local wall/patch/casing surface, with physical hand IK. */
  constrainWorkSurfaces(camera:THREE.Camera,frontForBounds:(bounds:THREE.Box3)=>number|null):number {
    // The hammer's working bit deliberately enters material and owns its
    // contact/feed solver. A generic envelope would pull it off the chisel hit.
    if(this.selectedTool==='hammer'||this.selectedTool==='measure'||this.selectedTool==='drill'||this.selectedTool==='driver')return 0;
    const tool=this.tools.get(this.selectedTool)!;
    let retracted=0;
    for(let attempt=0;attempt<3;attempt++){
      const bounds=this.heldToolBoundsWorld(this.surfaceBounds),front=frontForBounds(bounds);
      if(front===null||!Number.isFinite(front))break;
      const correction=front+.002-bounds.min.z;
      if(correction<=1e-6)break;
      const position=tool.getWorldPosition(new THREE.Vector3());
      if(this.selectedTool==='trowel'){
        // Retract at the shoulder, preserving the authored straight wrist and
        // fixed forearm axis throughout the flip. A generic two-bone IK pose
        // here bends the wrist sharply even though the hand still holds the grip.
        const shoulder=this.shoulder(camera,1),upper=this.trowelElbow.clone().sub(shoulder);
        const z=Math.min(UPPER_ARM_M-.0001,upper.z+correction);
        const lateral=Math.hypot(upper.x,upper.y),radius=Math.sqrt(UPPER_ARM_M**2-z*z);
        const next=upper.clone();
        if(lateral>1e-8){next.x*=radius/lateral;next.y*=radius/lateral;}else next.set(radius,0,z);
        next.z=z;next.add(shoulder);
        position.add(next.clone().sub(this.trowelElbow));this.trowelElbow.copy(next);
      }else position.z+=correction;
      tool.position.copy(this.worldToLocal(position));retracted+=correction;
      this.poseArms(camera);
    }
    return retracted;
  }
  restHammer(camera:THREE.Camera):void {
    this.reachable=false;this.chiselInAir=true;
    this.presentedFeedOffset=null;
    this.feedOffset.set(0,0,0);
    this.hammerFeedOffset.set(0,0,0);this.hammerFit.feedM=0;
    const hammer=this.tools.get('hammer')!;
    // Keep the chosen hand and screen side even outside a reachable work area.
    // The established right-handed rest pose is the blend's zero endpoint.
    const {eye,right,forward}=this.bodyFrame(camera),view=camera.getWorldDirection(new THREE.Vector3());
    const worldQ=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,new THREE.Vector3(0,1,0),forward.clone().negate()));
    worldQ.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-.28,THREE.MathUtils.lerp(-.12,.12,this.hammerGripBlend),-.06+this.hammerGripBlend*.12)));
    hammer.quaternion.copy(this.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldQ));
    const target=eye.clone().addScaledVector(forward,.32).addScaledVector(right,THREE.MathUtils.lerp(.16,-.16,this.hammerGripBlend));
    target.y-=.34+THREE.MathUtils.clamp(-view.y,0,1)*.13;
    hammer.position.copy(this.worldToLocal(target));
    this.constrainHeldTool(camera);this.poseArms(camera);
    this.chiselTipWorld.copy(hammer.localToWorld(this.tipAnchor.clone()));
  }
  poseArms(camera:THREE.Camera):void {
    const emptyFitting=this.selectedTool==='fitting'&&!this.fittingBoxAvailable;
    if(this.selectedTool==='fitting'){
      for(const part of this.fittingBoxParts)part.visible=false;
      this.fittingAssemblyRoot.visible=this.fittingBoxAvailable;
      this.fittingCandidateRoot.visible=this.fittingBoxAvailable;
      this.fittingZonesRoot.visible=this.fittingAssemblyActive&&this.fittingBoxAvailable&&!this.fittingAttachment;
      for(const arm of this.armSets.get('fitting')!){
        const hand=arm.hand;hand.userData.gripping=this.fittingBoxAvailable;hand.userData.gripRole=emptyFitting?'reaching':arm.side<0?'assembly':'candidate';
        if(!emptyFitting){
          const modules=this.fittingAssembly?.modules??horizontalBoxLayout(['1G']);
          const bounds=boxAssemblyBounds(modules);
          // Hold an actual outside casing edge, including L-shaped assemblies.
          const held=modules.reduce((best,module)=>{
            const edge=module.x-boxModuleSize(module).width/2,bestEdge=best.x-boxModuleSize(best).width/2;
            return edge<bestEdge-1e-6||Math.abs(edge-bestEdge)<1e-6&&module.y<best.y?module:best;
          });
          const candidate=this.fittingCandidateRoot.children[0];
          const candidateSize=boxModuleSize({kind:candidate?.userData.boxKind??'1G',rotation:candidate?.userData.quarterTurn??0});
          const scale=arm.side<0?this.fittingPresentationScale:this.fittingCandidateRoot.scale.x;
          const edge=arm.side<0
            ?new THREE.Vector3((held.x-boxModuleSize(held).width/2-bounds.centerX)*scale,(held.y-bounds.centerY)*scale,-.0185*scale)
            :new THREE.Vector3(candidateSize.width*.5*scale,0,-.0185*scale);
          hand.position.copy(arm.side<0?this.fittingAssemblyRoot.position:this.fittingCandidateRoot.position).add(edge);
          hand.quaternion.identity();hand.userData.gripSection=[.006,.0185*scale];
        }
      }
    }
    if(this.selectedTool!=='hammer'&&this.selectedTool!=='trowel'&&this.selectedTool!=='measure'&&this.selectedTool!=='drill'&&this.selectedTool!=='driver'&&!emptyFitting)this.constrainHeldTool(camera);
    const {right}=this.bodyFrame(camera);
    for(const arm of this.armSets.get(this.selectedTool)??[]){
      if(this.selectedTool==='measure'&&arm.side<0&&this.measureMarkTime>0)this.poseMeasurePencil(camera,arm);
      else if(arm.hand.userData.gripRole==='resting')this.poseRestingHand(camera,arm);
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
  private poseMeasurePencil(camera:THREE.Camera,arm:WorkerArm):void {
    this.poseRestingHand(camera,arm);
    const restPosition=arm.hand.getWorldPosition(new THREE.Vector3()),restRotation=arm.hand.getWorldQuaternion(new THREE.Quaternion());
    const elapsed=.40-this.measureMarkTime;
    const blend=elapsed<.10?THREE.MathUtils.smoothstep(elapsed,0,.10):1-THREE.MathUtils.smoothstep(elapsed,.28,.40);
    const stroke=THREE.MathUtils.clamp((elapsed-.10)/.18,0,1);
    const rotation=this.measureMarkOrientation.clone().multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(.35,.45,-.82).normalize()));
    const tip=this.measureMarkPoint.clone().add(new THREE.Vector3(THREE.MathUtils.lerp(-.020,.019,stroke),0,.0002).applyQuaternion(this.measureMarkOrientation));
    const grip=tip.sub(new THREE.Vector3(0,.098,0).applyQuaternion(rotation));
    const position=restPosition.lerp(grip,blend),orientation=restRotation.slerp(rotation,blend);
    const wristOffset=new THREE.Vector3().fromArray(arm.hand.userData.wristPoint).applyQuaternion(orientation);
    const shoulder=this.shoulder(camera,arm.side),wrist=position.clone().add(wristOffset),reach=wrist.clone().sub(shoulder);
    // Moving the camera during a stroke cannot stretch the arm or detach the hand.
    if(reach.length()>MAX_WRIST_REACH_M)position.copy(shoulder).add(reach.setLength(MAX_WRIST_REACH_M-.0001)).sub(wristOffset);
    const parent=arm.hand.parent!;parent.updateWorldMatrix(true,false);
    arm.hand.quaternion.copy(parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation));
    arm.hand.position.copy(parent.worldToLocal(position));arm.hand.updateWorldMatrix(true,true);
  }
  /** Hand tools need a body-space reachable target; a hose or mortar projectile can travel farther. */
  canReachPoint(camera:THREE.Camera,point:THREE.Vector3,extension=.10,normal?:THREE.Vector3):boolean {
    if(this.selectedTool==='drill'||this.selectedTool==='driver'){
      const tool=this.tools.get(this.selectedTool)!,hand=this.armSets.get(this.selectedTool)!.find(arm=>arm.side===1)!.hand;
      const wrist=new THREE.Vector3().fromArray(hand.userData.wristPoint).applyQuaternion(hand.quaternion).add(hand.position)
        .sub(new THREE.Vector3().fromArray(tool.userData.tipPoint)).applyQuaternion(this.measureWallOrientation(normal??new THREE.Vector3(0,0,1))).add(point);
      return this.shoulder(camera,1).distanceTo(wrist)<=MAX_WRIST_REACH_M;
    }
    if(this.selectedTool==='measure'){
      const hand=this.armSets.get('measure')!.find(arm=>arm.side===1)!.hand;
      const wrist=new THREE.Vector3().fromArray(hand.userData.wristPoint).applyQuaternion(hand.quaternion).add(hand.position)
        .applyQuaternion(normal?this.measureWallOrientation(normal):this.measureOrientation).add(point);
      return this.shoulder(camera,1).distanceTo(wrist)<=MAX_WRIST_REACH_M;
    }
    return (this.selectedTool==='hammer'?[-1,1]:[1]).some(side=>this.shoulder(camera,side).distanceTo(point)<=MAX_WRIST_REACH_M+extension);
  }
  private measureWallOrientation(normal:THREE.Vector3):THREE.Quaternion {
    const back=new THREE.Vector3(normal.x,0,normal.z).normalize(),up=new THREE.Vector3(0,1,0);
    if(back.lengthSq()<.5)back.set(0,0,1);
    const right=up.clone().cross(back).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,back));
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
      const style=kind==='measure'&&side<0?'spring':resting?'relaxed':side<0?'hammer-support':kind==='measure'||kind==='laser'?'fitting':kind==='drill'||kind==='driver'?'hose':kind;
      const hand=workerHand(side,style); hand.position.copy(grip);
      if(kind==='measure'&&side<0){const pencil=buildMeasurePencil();pencil.userData.heldAccessory=true;hand.add(pencil);}
      if(!resting&&group.userData.gripQuaternion)hand.quaternion.fromArray(group.userData.gripQuaternion);
      hand.userData.gripping=!resting;hand.userData.gripRole=resting?'resting':'primary';
      const arm=workerArm(side,hand,grip);arms.push(arm);this.add(arm.group);
      if(resting)arm.group.add(hand);else group.add(hand);
    }
    this.armSets.set(kind,arms);
  }
  private createDetailedTool(kind: Exclude<RigTool,'hammer'|'measure'|'drill'|'driver'|'laser'>):THREE.Group {
    const group=buildToolModel(kind);
    if(kind==='fitting'){
      for(const kinds of [['1G'],['2G'],['2G','1G']] as const){
        const variant=kinds.length===1&&kinds[0]==='1G'?group:buildToolModel('fitting',kinds);
        const parts=[...variant.children],preset=kinds.join('+');
        this.fittingVariants.set(preset,{parts,kinds,width:variant.userData.fittingGroupWidth});
        for(const part of parts){part.visible=preset===this.fittingPreset;group.add(part);this.fittingBoxParts.push(part);}
      }
      this.fittingAssemblyRoot.name='Left-hand live box assembly';this.fittingCandidateRoot.name='Right-hand next box';this.fittingZonesRoot.name='Numbered live attachment zones';
      group.add(this.fittingAssemblyRoot,this.fittingCandidateRoot,this.fittingZonesRoot);
    }
    this.attachArms(kind,group);
    if(kind==='fitting'){
      for(const arm of this.armSets.get(kind)!){
        const hand=arm.hand;if(hand.parent!==group)group.add(hand);hand.userData.gripping=true;hand.userData.gripRole=arm.side<0?'assembly':'candidate';
      }
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
