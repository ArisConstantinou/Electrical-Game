import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { PlayerController } from './PlayerController';
import type { FPSRig, RigTool } from './FPSRig';
import type { WorkerGripTarget } from './WorkerArm';
import referenceGrips from './referenceGrips.json';
import {solveRigidGrasp,type GraspHistory} from './RigidGrasp';

const Y=new THREE.Vector3(0,1,0);
/** Full anatomical sample. World-space skeleton owns the pose; camera aim remains independent. */
export class WorkerBody extends THREE.Group {
  readonly ready:Promise<void>;
  loaded=false;
  overview=false;
  private bones=new Map<string,THREE.Bone>();
  private skeletons=new Set<THREE.Skeleton>();
  private graspHistory:GraspHistory|undefined;
  private graspTool='';
  private referenceGrips:Record<string,(typeof referenceGrips)['driver:R']>=referenceGrips;
  private rest=new Map<THREE.Bone,{q:THREE.Quaternion;p:THREE.Vector3}>();
  private headParts:THREE.Object3D[]=[];
  private headMaterials:THREE.Material[]=[];
  private phase=0;
  private gaitBlend=0;
  private travelTurn=0;
  private travel=new THREE.Vector3(0,0,-1);
  private clock=0;
  private bend=0;
  private handFrames=new Map<string,{basis:THREE.Quaternion;knuckle:THREE.Vector3;foreToHand:THREE.Quaternion}>();
  private fingerAdduction=new Map<string,number>();
  private fingerSplay=new Map<string,THREE.Vector3>();
  private sprayGrip={across:0,back:.055,height:.065,tilt:1.25};
  private thumbOpposition=new Map<string,THREE.Vector3>();
  private thumbSurface=new Map<string,{mesh:THREE.SkinnedMesh;index:number}[]>();
  private thumbPoseCache=new Map<string,{key:string;angles:number[]}>();
  private boxFingerAxes=new Map<string,THREE.Vector3>();
  private fingerAxes=new Map<string,THREE.Vector3>();
  private lengths=new Map<string,number>();
  private fingerFit:Record<string,unknown>={};
  private gripErrors:Record<string,number>={};
  private armTwist:Record<string,{upperDegrees:number;foreDegrees:number}>={};
  private footRest=new Map<string,THREE.Quaternion>();
  private locomotionState={speed:0,forward:0,sideways:0,pelvisBobM:0,pelvisSwayM:0,pelvisYawDegrees:0,spineCounterDegrees:0,headCounterDegrees:0};
  constructor(scene:THREE.Scene){
    super();this.name='Anatomical full body worker';this.userData.studioEntityId='worker:full-body';scene.add(this);
    this.ready=Promise.all([new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/worker/worker.glb`),fetch(`${import.meta.env.BASE_URL}assets/worker/skeleton.json`).then(r=>r.json())]).then(([g,metadata])=>{
      for(const [name,entry]of Object.entries(metadata) as [string,{head:number[];tail:number[]}][])this.lengths.set(name,new THREE.Vector3().fromArray(entry.head).distanceTo(new THREE.Vector3().fromArray(entry.tail)));
      this.add(g.scene);g.scene.traverse(o=>{
        if(o instanceof THREE.SkinnedMesh)this.skeletons.add(o.skeleton);
        if(o instanceof THREE.Bone){this.bones.set(o.name,o);this.rest.set(o,{q:o.quaternion.clone(),p:o.position.clone()});}
        if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;}
        if(o.name.startsWith('WorkerHead')||o.name.includes('eye'))this.headParts.push(o);
      });
      // Keep the head in the shadow pass. A hidden Object3D is omitted from
      // every pass, producing a headless first-person shadow.
      const headMeshes=new Set<THREE.Mesh>();
      for(const root of this.headParts)root.traverse(part=>{if(part instanceof THREE.Mesh)headMeshes.add(part);});
      for(const part of headMeshes){
        const originals=Array.isArray(part.material)?part.material:[part.material];
        const materials=originals.map(m=>m.clone());
        part.material=Array.isArray(part.material)?materials:materials[0];
        this.headMaterials.push(...materials);
      }
      this.updateMatrixWorld(true);
      for(const side of ['L','R'])this.footRest.set(side,this.bone('foot.'+side).getWorldQuaternion(new THREE.Quaternion()));
      for(const side of ['L','R']){
        const samples:{mesh:THREE.SkinnedMesh;index:number}[]=[];
        g.scene.traverse(o=>{
          if(!(o instanceof THREE.SkinnedMesh))return;
          const indices=o.geometry.attributes.skinIndex,weights=o.geometry.attributes.skinWeight;
          const thumbIndices=new Set(o.skeleton.bones.map((b,i)=>b.name.replaceAll('.','').startsWith('thumb')&&b.name.endsWith(side)?i:-1));thumbIndices.delete(-1);
          for(let i=0;i<indices.count;i++){
            let weight=0;for(let j=0;j<4;j++)if(thumbIndices.has(indices.getComponent(i,j)))weight+=weights.getComponent(i,j);
            if(weight>=.75)samples.push({mesh:o,index:i});
          }
        });
        this.thumbSurface.set(side,samples);
        const hand=this.bone('hand.'+side),q=hand.getWorldQuaternion(new THREE.Quaternion());
        const long=this.point('middle.01.'+side).sub(this.point('hand.'+side)).normalize().applyQuaternion(q.clone().invert());
        const radial=this.point('index.01.'+side).sub(this.point('little.01.'+side)).applyQuaternion(q.clone().invert());radial.addScaledVector(long,-radial.dot(long)).normalize();
        this.handFrames.set(side,{basis:new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(radial,long,radial.clone().cross(long))).invert(),knuckle:hand.worldToLocal(this.point('middle.01.'+side)),foreToHand:this.bone('forearm.'+side).getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q)});
        const worldRadial=radial.clone().applyQuaternion(q);
        for(const digit of ['index','middle','ring','little','thumb'])for(let j=1;j<=3;j++){
          const name=`${digit}.0${j}.${side}`,joint=this.bone(name);
          this.fingerAxes.set(name,worldRadial.clone().applyQuaternion(joint.getWorldQuaternion(new THREE.Quaternion()).invert()));
          // Remove the longitudinal component: a hinge may bend, not twist.
          this.boxFingerAxes.set(name,this.fingerAxes.get(name)!.clone().setY(0).normalize());
          if(j===1)this.fingerSplay.set(digit+side,radial.clone().cross(long).applyQuaternion(q).applyQuaternion(joint.getWorldQuaternion(new THREE.Quaternion()).invert()));
          if(j===1&&digit!=='thumb'){
            const normal=radial.clone().cross(long).applyQuaternion(q),d=Y.clone().applyQuaternion(joint.getWorldQuaternion(new THREE.Quaternion())),l=long.clone().applyQuaternion(q);
            d.addScaledVector(normal,-d.dot(normal)).normalize();this.fingerAdduction.set(digit+side,Math.atan2(normal.dot(d.clone().cross(l)),d.dot(l)));
          }
          if(digit==='thumb'&&j===1)this.thumbOpposition.set(side,long.clone().applyQuaternion(q).applyQuaternion(joint.getWorldQuaternion(new THREE.Quaternion()).invert()));
        }

      }
      this.loaded=true;
    });
  }
  private bone(name:string):THREE.Bone{
    const b=this.bones.get(name)||this.bones.get(name.replaceAll('.',''));
    if(!b)throw new Error(`Missing worker joint: ${name}`);return b;
  }
  private point(name:string):THREE.Vector3{return this.bone(name).getWorldPosition(new THREE.Vector3());}
  private worldRotation(b:THREE.Bone,q:THREE.Quaternion):void{
    b.quaternion.copy(b.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));b.updateWorldMatrix(false,true);
  }
  private rotateWorld(name:string,axis:THREE.Vector3,angle:number):void{
    if(Math.abs(angle)<1e-8)return;
    const b=this.bone(name),q=new THREE.Quaternion().setFromAxisAngle(axis,angle).multiply(b.getWorldQuaternion(new THREE.Quaternion()));
    this.worldRotation(b,q);
  }
  private orient(name:string,target:THREE.Vector3):void{
    const b=this.bone(name),q=b.getWorldQuaternion(new THREE.Quaternion()),direction=target.clone().sub(b.getWorldPosition(new THREE.Vector3())).normalize();
    this.worldRotation(b,new THREE.Quaternion().setFromUnitVectors(Y.clone().applyQuaternion(q),direction).multiply(q));
  }
  private limb(upper:string,lower:string,end:string,target:THREE.Vector3,pole:THREE.Vector3,margin=.006):void{
    const a=this.point(upper),b=this.point(lower),c=this.point(end),l1=a.distanceTo(b),l2=b.distanceTo(c);
    const axis=target.clone().sub(a),d=THREE.MathUtils.clamp(axis.length(),Math.abs(l1-l2)+.006,l1+l2-margin);axis.normalize();
    const along=(l1*l1-l2*l2+d*d)/(2*d),height=Math.sqrt(Math.max(0,l1*l1-along*along));
    pole=pole.clone().addScaledVector(axis,-pole.dot(axis)).normalize();
    const elbow=a.clone().addScaledVector(axis,along).addScaledVector(pole,height);
    this.orient(upper,elbow);this.orient(lower,a.clone().addScaledVector(axis,d));
  }
  private reachWithShoulder(side:string,target:THREE.Vector3,margin=.012):void{
    const clavicle=this.bone('clavicle.'+side),origin=clavicle.getWorldPosition(new THREE.Vector3());
    const restQ=clavicle.parent!.getWorldQuaternion(new THREE.Quaternion()).multiply(this.rest.get(clavicle)!.q);
    const offset=this.point('upper_arm.'+side).sub(origin).applyQuaternion(clavicle.getWorldQuaternion(new THREE.Quaternion()).invert()).applyQuaternion(restQ);
    const reach=this.point('upper_arm.'+side).distanceTo(this.point('forearm.'+side))+this.point('forearm.'+side).distanceTo(this.point('hand.'+side))-margin;
    const toward=new THREE.Quaternion().setFromUnitVectors(offset.clone().normalize(),target.clone().sub(origin).normalize());
    const angle=2*Math.acos(THREE.MathUtils.clamp(toward.w,-1,1)),limit=Math.min(1,THREE.MathUtils.degToRad(25)/Math.max(.001,angle));
    const rotation=new THREE.Quaternion(),distance=(t:number)=>origin.clone().add(offset.clone().applyQuaternion(rotation.identity().slerp(toward,t))).distanceTo(target);
    // Protract/elevate the shoulder only as far as contact requires. The
    // clavicle and arm lengths stay fixed, including after hand swapping.
    let lo=0,hi=limit;
    if(distance(0)<=reach)hi=0;
    else for(let i=0;i<12;i++){const mid=(lo+hi)/2;if(distance(mid)>reach)lo=mid;else hi=mid;}
    this.worldRotation(clavicle,new THREE.Quaternion().slerp(toward,hi).multiply(restQ));
  }
  update(dt:number,camera:THREE.PerspectiveCamera,player:Pick<PlayerController,'eyeHeight'|'velocity'|'yaw'|'pitch'>,fps:FPSRig,tool:RigTool,working:boolean,station:boolean,stationGrips:WorkerGripTarget[]=[],frontForBounds?:(bounds:THREE.Box3)=>number|null):void{
    if(!this.loaded)return;
    this.visible=true;
    fps.useAnatomicalBody(true);
    this.gripErrors={};
    this.armTwist={};
    this.fingerFit={};
    this.clock+=dt;
    for(const [b,r]of this.rest){b.quaternion.copy(r.q);b.position.copy(r.p);}
    const cartGrip=stationGrips.some(g=>g.palmDirection);
    const crouch=cartGrip?0:player.eyeHeight<1.1?1:0;this.bend=THREE.MathUtils.damp(this.bend,crouch,14,Math.min(dt,.05));
    const speed=Math.hypot(player.velocity.x,player.velocity.z);
    const grips=station?stationGrips:fps.anatomicalGrips();
    const yawQ=new THREE.Quaternion().setFromAxisAngle(Y,player.yaw),forward=new THREE.Vector3(0,0,-1).applyQuaternion(yawQ),right=new THREE.Vector3(1,0,0).applyQuaternion(yawQ);
    this.gaitBlend=THREE.MathUtils.damp(this.gaitBlend,speed>.025?1:0,12,Math.min(dt,.05));
    if(speed>.025)this.travel.set(player.velocity.x,0,player.velocity.z).normalize();
    // Slow work uses short side steps. At jogging speed the torso and feet
    // turn into travel while the player's gaze and tool aim stay independent.
    // This avoids either crossed legs or an implausibly fast lateral shuffle.
    const along=this.travel.dot(forward),sideways=this.travel.dot(right);
    const turn=-Math.atan2(sideways*(along<-.05?-1:1),Math.abs(along));
    const travelYaw=speed>.025?turn*THREE.MathUtils.smoothstep(speed,.8,2.2)*.85:0;
    // Loaded hands constrain the shoulders: strafe with short steps instead
    // of turning the whole torso away from camera-mounted tool handles.
    const desiredTurn=grips.some(g=>g.active)?0:travelYaw;
    this.travelTurn=THREE.MathUtils.damp(this.travelTurn,desiredTurn,10,Math.min(dt,.05));
    const cartFrame=grips.find(g=>g.active&&g.bodyFrame)?.bodyFrame;
    const bodyYaw=player.yaw+this.travelTurn,bodyQ=cartFrame?.quaternion.clone()??new THREE.Quaternion().setFromAxisAngle(Y,bodyYaw),bodyForward=new THREE.Vector3(0,0,-1).applyQuaternion(bodyQ),bodyRight=new THREE.Vector3(1,0,0).applyQuaternion(bodyQ);
    const bodyOffset=.17;
    this.position.set(camera.position.x+Math.sin(player.yaw)*bodyOffset,0,camera.position.z+Math.cos(player.yaw)*bodyOffset);this.rotation.set(0,bodyYaw,0);
    if(cartFrame){this.position.copy(cartFrame.position);this.quaternion.copy(cartFrame.quaternion);}
    this.updateMatrixWorld(true);
    const pelvis=this.bone('pelvis'),position=pelvis.getWorldPosition(new THREE.Vector3());position.y-=this.bend*.44;
    position.x+=Math.sin(player.yaw)*this.bend*.15;position.z+=Math.cos(player.yaw)*this.bend*.15;
    // Locomotion starts at the centre of mass, not at the ankles. Two vertical
    // pulses per cycle follow the two contacts, while lateral sway transfers
    // weight over the stance leg. Both fade continuously at start/stop.
    const speedBlend=THREE.MathUtils.lerp(.55,1,THREE.MathUtils.smoothstep(speed,.18,3.4)),step=Math.sin(this.phase),doubleStep=Math.cos(this.phase*2),motion=this.gaitBlend*speedBlend;
    // Preserve a seated bit/handle as the highest-priority constraint. The
    // legs keep their full stride, but the centre-of-mass and rib-cage motion
    // become deliberately quieter while a hand is loaded so the shoulder IK
    // cannot cross its reach boundary during a crouch transition.
    const activeGrip=grips.some(g=>g.active),contactGrip=grips.some(g=>g.active&&g.contactLocked);
    const upperMotion=cartFrame?0:motion*(contactGrip?.18:activeGrip?.45:1);
    const pelvisBob=.013*doubleStep*upperMotion,pelvisSway=.018*step*upperMotion*(.72+.28*Math.abs(along));
    position.y+=pelvisBob;position.addScaledVector(bodyRight,pelvisSway);
    pelvis.position.copy(pelvis.parent!.worldToLocal(position));
    this.updateMatrixWorld(true);
    const pelvisYaw=-step*upperMotion*THREE.MathUtils.degToRad(5.5)*(along+sideways*.28);
    const pelvisRoll=-step*upperMotion*THREE.MathUtils.degToRad(2.6)+sideways*upperMotion*THREE.MathUtils.degToRad(1.4);
    const pelvisPitch=-along*upperMotion*THREE.MathUtils.degToRad(2.2);
    this.rotateWorld('pelvis',bodyRight,pelvisPitch);this.rotateWorld('pelvis',bodyForward,pelvisRoll);this.rotateWorld('pelvis',Y,pelvisYaw);
    // The rib cage counter-rotates against the pelvis and leans into travel.
    // Crouch keeps its existing forward fold, now layered with the gait rather
    // than replacing every standing movement with a rigid torso.
    const spineDirection=Y.clone().applyQuaternion(cartFrame?.quaternion??new THREE.Quaternion()).addScaledVector(forward,1.1*this.bend).addScaledVector(this.travel,.050*upperMotion).addScaledVector(bodyRight,-step*.018*upperMotion).normalize();
    this.orient('spine',this.point('spine').add(spineDirection));this.rotateWorld('spine',Y,-pelvisYaw*.72);
    const chestDirection=Y.clone().applyQuaternion(cartFrame?.quaternion??new THREE.Quaternion()).addScaledVector(forward,.24*this.bend).addScaledVector(this.travel,.026*upperMotion).addScaledVector(bodyRight,step*.014*upperMotion).normalize();
    this.orient('chest',this.point('chest').add(chestDirection));this.rotateWorld('chest',Y,-pelvisYaw*.52);
    const headCounter=-this.travelTurn-pelvisYaw*.22;
    this.rotateWorld('neck',Y,headCounter*.72);this.rotateWorld('head',Y,headCounter*.28);
    this.locomotionState={speed,forward:along,sideways,pelvisBobM:pelvisBob,pelvisSwayM:pelvisSway,pelvisYawDegrees:THREE.MathUtils.radToDeg(pelvisYaw),spineCounterDegrees:THREE.MathUtils.radToDeg(-pelvisYaw*.72),headCounterDegrees:THREE.MathUtils.radToDeg(headCounter)};
    // A lateral step is shorter so the trailing foot never crosses the lead
    // foot. Cadence follows distance travelled, including backwards motion.
    const lateral=Math.abs(this.travel.dot(bodyRight));
    const amplitude=Math.min(THREE.MathUtils.lerp(.22,.36,THREE.MathUtils.smoothstep(speed,.8,3.4)),.12/Math.max(.01,lateral))*(1-this.bend*.30);
    this.phase+=speed*dt*Math.PI/(2*amplitude);
    this.updateMatrixWorld(true);
    for(const [side,sign]of [['R',1],['L',-1]] as const){
      const phase=(this.phase+(side==='R'?0:Math.PI))%(Math.PI*2),moving=this.gaitBlend;
      // Linear return during support cancels body translation, keeping the
      // planted shoe still in world space; only the swing phase lifts it.
      const u=phase/Math.PI,stride=(u<1?-amplitude+2*amplitude*THREE.MathUtils.smoothstep(u,0,1):amplitude-2*amplitude*(u-1))*moving;
      const foot=this.position.clone().addScaledVector(bodyRight,sign*.187).addScaledVector(bodyForward,-.055).addScaledVector(this.travel,stride);
      foot.y=.09+Math.max(0,Math.sin(phase))*.065*moving;
      this.limb('thigh.'+side,'shin.'+side,'foot.'+side,foot,bodyForward.clone().addScaledVector(bodyRight,sign*.12));
      this.worldRotation(this.bone('foot.'+side),(cartFrame?yawQ:bodyQ).clone().multiply(this.footRest.get(side)!));
      // Lift the toe during swing, then return the complete boot to the flat
      // planted rest frame. This is deliberately absent during support so the
      // existing analytic plant cancellation remains exact.
      const swing=Math.max(0,Math.sin(phase))*moving;
      this.rotateWorld('foot.'+side,bodyRight,-THREE.MathUtils.degToRad(8)*swing);
      this.rotateWorld('toe.'+side,bodyRight,THREE.MathUtils.degToRad(11)*swing);
    }
    const raisedCart=cartFrame?THREE.MathUtils.smoothstep(cartFrame.position.y,.003,.06):0;
    if(cartFrame&&cartFrame.position.y>.003){
      // Raised handles need a longer horizontal reach, not a floating worker.
      // Keep the feet on the floor and step the torso back into arm's reach.
      const drop=cartFrame.position.y;this.position.y-=drop;this.updateMatrixWorld(true);
      const back=forward.clone().negate();let retreat=0;
      for(const grip of grips.filter(g=>g.active&&g.bodyFrame)){
        const side=grip.side>0?'R':'L',axis=Y.clone().applyQuaternion(grip.rotation),long=grip.palmDirection!.clone().normalize();
        const across=long.clone().addScaledVector(axis,-long.dot(axis)).normalize().multiplyScalar(-grip.side),away=across.clone().cross(axis).normalize();
        const radial=axis.clone().addScaledVector(long,-axis.dot(long)).normalize(),q=this.handOrientation(side,radial,long);
        const wrist=grip.center.clone().addScaledVector(across,-grip.side*grip.section[0]*.6).addScaledVector(away,-grip.section[1]-.012).sub(this.handFrames.get(side)!.knuckle.clone().applyQuaternion(q));
        const d=wrist.sub(this.point('upper_arm.'+side)),reach=this.lengths.get('upper_arm.'+side)!+this.lengths.get('forearm.'+side)!-.002;
        const projection=d.dot(back);retreat=Math.max(retreat,projection+Math.sqrt(Math.max(0,projection*projection+reach*reach-d.lengthSq())));
      }
      this.position.addScaledVector(back,retreat);this.updateMatrixWorld(true);
      // Ground the boots again after the stance shift; arm solving follows.
      for(const [side,sign]of [['R',1],['L',-1]] as const){const foot=this.point('foot.'+side);foot.y=.09;this.limb('thigh.'+side,'shin.'+side,'foot.'+side,foot,forward.clone().addScaledVector(right,sign*.12));this.worldRotation(this.bone('foot.'+side),yawQ.clone().multiply(this.footRest.get(side)!));}
    }
    const fixedHands=this.poseReferenceGrasps(grips,camera,fps,station,right,frontForBounds);
    if(cartFrame){this.poseCartHandles(grips,right,raisedCart,working);fixedHands.add('R');fixedHands.add('L');}
    for(const [side,sign]of [['R',1],['L',-1]] as const){
      if(fixedHands.has(side))continue;
      const grip=grips.find(g=>g.side===sign&&g.active);
      if(tool==='spray'&&!station&&sign===1&&fps.visible){
        // Solve the arm first. The palm continues the forearm instead of
        // forcing an unrelated camera-fixed hand rotation onto the wrist.
        const wrist=this.position.clone().addScaledVector(right,.24).addScaledVector(forward,.38);
        wrist.y=camera.position.y-.28+THREE.MathUtils.clamp(player.pitch,-.65,.45)*.10;
        this.limb('upper_arm.R','forearm.R','hand.R',wrist,right.clone().multiplyScalar(.6).add(new THREE.Vector3(0,-1,0)));
        const long=this.point('hand.R').sub(this.point('forearm.R')).normalize();
        const radial=Y.clone().addScaledVector(long,-long.y).normalize();
        // Preserve the grip in palm space. Keeping the can world-vertical
        // while the forearm pitches changes which side the index must reach.
        const axis=radial.clone().multiplyScalar(Math.cos(this.sprayGrip.tilt)).addScaledVector(long,Math.sin(this.sprayGrip.tilt));
        const back=axis.clone().cross(long).normalize(),across=axis.clone().cross(back).normalize();
        this.setHandOrientation(side,radial,long);
        const center=this.point('middle.01.R').addScaledVector(across,this.sprayGrip.across).addScaledVector(back,this.sprayGrip.back).addScaledVector(axis,-this.sprayGrip.height);
        const rotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across,axis,back));
        const nozzleBack=forward.clone().negate().addScaledVector(axis,forward.dot(axis)).normalize();
        const canQ=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(axis.clone().cross(nozzleBack),axis,nozzleBack));
        const buttonTarget=fps.poseAnatomicalSpray(center,canQ,false);
        this.fitFinger('index',side,buttonTarget,true);
        // Place the whole grasp behind the actuator: the distal index must
        // run towards the nozzle, not across it. Rotate the palm and its
        // contact frame together, then solve the elbow for that wrist pose.
        const aimPitch=THREE.MathUtils.clamp(player.pitch+.25,-.9,.6);
        const targetAxis=Y.clone().addScaledVector(right,-.32).addScaledVector(forward,.65).normalize().applyAxisAngle(right,aimPitch);
        const axisTurn=new THREE.Quaternion().setFromUnitVectors(axis,targetAxis);
        const indexDirection=Y.clone().applyQuaternion(this.bone('index.03.R').getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(axisTurn);
        indexDirection.addScaledVector(targetAxis,-indexDirection.dot(targetAxis)).normalize();
        const nozzleDirection=forward.clone().addScaledVector(targetAxis,-forward.dot(targetAxis)).normalize();
        const graspTurn=Math.atan2(targetAxis.dot(indexDirection.clone().cross(nozzleDirection)),indexDirection.dot(nozzleDirection));
        const graspQ=new THREE.Quaternion().setFromAxisAngle(targetAxis,graspTurn).multiply(axisTurn);
        const alignedLong=long.clone().applyQuaternion(graspQ),alignedRadial=radial.clone().applyQuaternion(graspQ);
        const alignedWrist=this.point('hand.R').sub(center).applyQuaternion(graspQ).add(center);
        const forearmLength=this.point('hand.R').distanceTo(this.point('forearm.R'));
        const shoulder=this.point('upper_arm.R'),upperLength=shoulder.distanceTo(this.point('forearm.R'));
        const lookingDown=THREE.MathUtils.clamp(-player.pitch-.25,0,1);
        const elbowPole=forward.clone().multiplyScalar(1.15).addScaledVector(right,.28).addScaledVector(Y,-.38-lookingDown*.45).normalize();
        const forearmDirection=alignedLong.clone().addScaledVector(forward,.2).addScaledVector(Y,-lookingDown*.9).normalize();
        const wristAngle=alignedLong.angleTo(forearmDirection),wristLimit=THREE.MathUtils.degToRad(25);
        if(wristAngle>wristLimit){const turn=new THREE.Quaternion().setFromUnitVectors(alignedLong,forearmDirection);forearmDirection.copy(alignedLong).applyQuaternion(new THREE.Quaternion().slerp(turn,wristLimit/wristAngle));}
        const reachableWrist=shoulder.clone().addScaledVector(elbowPole,upperLength).addScaledVector(forearmDirection,forearmLength);
        const graspShift=reachableWrist.clone().sub(alignedWrist);
        alignedWrist.copy(reachableWrist);center.add(graspShift);
        axis.copy(targetAxis);nozzleBack.copy(nozzleDirection).negate();
        canQ.setFromRotationMatrix(new THREE.Matrix4().makeBasis(axis.clone().cross(nozzleBack),axis,nozzleBack));
        buttonTarget.copy(fps.poseAnatomicalSpray(center,canQ,working));
        this.limb('upper_arm.R','forearm.R','hand.R',alignedWrist,elbowPole);
        this.setHandOrientation(side,alignedRadial,alignedLong);
        rotation.premultiply(graspQ);
        this.wrapGrip(side,center,rotation,[.0335,.0335],true,working,'round',undefined,buttonTarget);
        const finalDirection=Y.clone().applyQuaternion(this.bone('index.03.R').getWorldQuaternion(new THREE.Quaternion()));
        const finalPlanar=finalDirection.clone().addScaledVector(axis,-finalDirection.dot(axis)).normalize();
        this.fingerFit.sprayForward={dot:finalPlanar.dot(nozzleDirection),wristBendDegrees:THREE.MathUtils.radToDeg(alignedLong.angleTo(this.point('hand.R').sub(this.point('forearm.R')).normalize())),long:alignedLong.toArray(),wrist:this.point('hand.R').toArray(),elbow:this.point('forearm.R').toArray(),shoulder:shoulder.toArray()};
      }else if(!station&&grip&&side==='R'&&(tool==='trowel'||tool==='hose')){
        // Carry one rigid forearm/palm/grip unit. Rotating only the palm to an
        // aimed handle folded the hose wrist backwards at downward views.
        const axis=Y.clone().applyQuaternion(grip.rotation),inverse=grip.rotation.clone().invert();
        const long=camera.getWorldDirection(new THREE.Vector3());long.addScaledVector(axis,-long.dot(axis)).normalize();
        const across=long.clone().negate(),back=across.clone().cross(axis).normalize();
        const handQ=this.handOrientation(side,axis,long);
        const middle=grip.center.clone().addScaledVector(across,-grip.section[0]*.6).addScaledVector(back,-grip.section[1]-.012);
        const wrist=middle.sub(this.handFrames.get(side)!.knuckle.clone().applyQuaternion(handQ));
        const shoulder=this.point('upper_arm.R'),foreLength=this.point('hand.R').distanceTo(this.point('forearm.R'));
        const elbow=wrist.clone().addScaledVector(long,-foreLength),upperLength=shoulder.distanceTo(this.point('forearm.R'));
        const bounds=fps.heldToolBoundsWorld(),corners:THREE.Vector3[]=[];
        for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])corners.push(new THREE.Vector3(x,y,z).sub(grip.center).applyQuaternion(inverse));
        const pose=solveRigidGrasp(grip.center,grip.rotation,{shoulder,upperLength,handSign:1,lockRotation:true,screenRegion:{minX:.02,maxX:.90},elbow:elbow.clone().sub(grip.center).applyQuaternion(inverse),wrist:wrist.clone().sub(grip.center).applyQuaternion(inverse)},camera,corners,frontForBounds);
        const shift=pose.center.clone().sub(grip.center);
        this.orient('upper_arm.R',elbow.add(shift));this.orient('forearm.R',wrist.add(shift));this.setHandOrientation(side,axis,long);
        fps.transformAnatomicalGrasp(grip.center,pose.center,new THREE.Quaternion());
        const rotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across,axis,back));
        this.wrapGrip(side,pose.center,rotation,grip.section,false,working,grip.shape,grip.trigger?.clone().add(shift));
        this.gripErrors.R=this.point('hand.R').distanceTo(wrist);
      }else if(tool==='laser'&&grip&&side==='R'){
        const axis=Y.clone().applyQuaternion(grip.rotation),oldAcross=new THREE.Vector3(1,0,0).applyQuaternion(grip.rotation),oldBack=new THREE.Vector3(0,0,1).applyQuaternion(grip.rotation);
        let long=grip.center.clone().sub(this.point('upper_arm.R')).addScaledVector(axis,-grip.center.clone().sub(this.point('upper_arm.R')).dot(axis)).normalize();
        let rotation=grip.rotation.clone(),section=grip.section,wrist=grip.center.clone();
        for(let pass=0;pass<4;pass++){
          const across=long.clone().multiplyScalar(-1),back=across.clone().cross(axis).normalize();
          rotation.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across,axis,back));
          section=[Math.hypot(grip.section[0]*across.dot(oldAcross),grip.section[1]*across.dot(oldBack)),Math.hypot(grip.section[0]*back.dot(oldAcross),grip.section[1]*back.dot(oldBack))];
          const radial=axis.clone().addScaledVector(long,-axis.dot(long)).normalize(),q=this.handOrientation(side,radial,long);
          const middle=grip.center.clone().addScaledVector(across,-section[0]*.6).addScaledVector(back,-section[1]-.012);
          wrist=middle.sub(this.handFrames.get(side)!.knuckle.clone().applyQuaternion(q));
          this.limb('upper_arm.R','forearm.R','hand.R',wrist,right.clone().multiplyScalar(.18).add(new THREE.Vector3(0,-1,0)));
          long=this.point('hand.R').sub(this.point('forearm.R')).normalize();
          this.setHandOrientation(side,axis.clone().addScaledVector(long,-axis.dot(long)).normalize(),long);
        }
        this.gripErrors.R=this.point('hand.R').distanceTo(wrist);
        this.wrapGrip(side,grip.center,rotation,section,false,working,grip.shape);
      }else if(grip){
        const axis=Y.clone().applyQuaternion(grip.rotation),oldAcross=new THREE.Vector3(1,0,0).applyQuaternion(grip.rotation),oldBack=new THREE.Vector3(0,0,1).applyQuaternion(grip.rotation);
        // A handle fixes the contact axis, not a camera-space 90-degree wrist
        // bend. Approach it from the elbow and solve the palm offset twice.
        const rigidContact=tool==='fitting'&&!station;
        // A trowel is held as a straight continuation of the forearm. Its elbow
        // pole follows the handle instead of folding under the palm; the old
        // generic pole bent the visible wrist by 47–73°.
        const straightTrowel=grip.straightWrist===true;
        let long=rigidContact?oldBack.clone().negate():grip.center.clone().sub(this.point('upper_arm.'+side));
        long.normalize();
        let rotation=grip.rotation.clone(),section:[number,number]=grip.section;
        for(let pass=0;pass<2;pass++){
          // The knuckle row follows the handle. A skewed palm makes each
          // finger chase a different cylinder plane and twists the joints.
          long.addScaledVector(axis,-long.dot(axis)).normalize();
          const across=long.clone().addScaledVector(axis,-long.dot(axis)).normalize().multiplyScalar(-sign),back=across.clone().cross(axis).normalize();
          rotation.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across,axis,back));
          section=[Math.hypot(grip.section[0]*across.dot(oldAcross),grip.section[1]*across.dot(oldBack)),Math.hypot(grip.section[0]*back.dot(oldAcross),grip.section[1]*back.dot(oldBack))];
          const radial=axis.clone().addScaledVector(long,-axis.dot(long)).normalize();
          const q=this.handOrientation(side,radial,long),middle=grip.center.clone().addScaledVector(across,-sign*section[0]*.6).addScaledVector(back,-section[1]-.012);
          // Calibrated palm clearance for a casing pinch, not a handle wrap.
          if(rigidContact)middle.add((side==='R'?new THREE.Vector3(.0591,-.0009,.0019):new THREE.Vector3(-.0619,-.0019,-.0028)).applyQuaternion(grip.rotation));
          const wrist=middle.sub(this.handFrames.get(side)!.knuckle.clone().applyQuaternion(q));
          this.reachWithShoulder(side,wrist);
          const elbowPole=straightTrowel?long.clone().negate():right.clone().multiplyScalar(sign*.45).add(new THREE.Vector3(0,-1,0));
          this.limb('upper_arm.'+side,'forearm.'+side,'hand.'+side,wrist,elbowPole);
          this.setHandOrientation(side,radial,long);
          this.gripErrors[side]=this.point('hand.'+side).distanceTo(wrist);
          if(pass===0&&!rigidContact)long=this.point('hand.'+side).sub(this.point('forearm.'+side)).normalize();
        }
        if(rigidContact)this.pinchBox(side,grip.center,grip.rotation);
        else this.wrapGrip(side,grip.center,rotation,section,false,working,grip.shape,grip.trigger);
      }else{
        // Free arms counter-swing from the clavicle through the full chain.
        // Side steps keep a smaller fore/aft arc and add lateral balance;
        // held tools skip this branch and retain their exact contact solve.
        const armPhase=Math.sin(this.phase+(sign===1?Math.PI:0))*this.gaitBlend,armRange=THREE.MathUtils.lerp(.045,.14,speedBlend);
        this.rotateWorld('clavicle.'+side,Y,-armPhase*THREE.MathUtils.degToRad(4.5));
        const wrist=this.position.clone().addScaledVector(bodyRight,sign*.245-sideways*armPhase*armRange*.25).addScaledVector(bodyForward,.015+armPhase*armRange*(.55+.45*Math.abs(along)));
        wrist.y=Math.max(.32,camera.position.y-.80)+Math.abs(armPhase)*.014+Math.sin(this.clock*1.7)*.002;
        this.limb('upper_arm.'+side,'forearm.'+side,'hand.'+side,wrist,bodyRight.clone().multiplyScalar(sign).add(new THREE.Vector3(0,-1,0)));
        this.worldRotation(this.bone('hand.'+side),this.bone('forearm.'+side).getWorldQuaternion(new THREE.Quaternion()).multiply(this.handFrames.get(side)!.foreToHand));
        for(const digit of ['index','middle','ring','little'])for(let j=1;j<=3;j++){
          const b=this.bone(`${digit}.0${j}.${side}`);b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),sign*[.10,.18,.12][j-1]));
        }
      }
    }
    if(tool==='fitting'&&!station)this.poseBoxGrasps(grips,camera,fps,right,frontForBounds);
    else this.boxGraspHistory.clear();
    this.headParts.forEach(o=>o.visible=true);
    for(const material of this.headMaterials){material.colorWrite=this.overview;material.depthWrite=this.overview;}
    // Publish the completed pose as one unit. Render/shadow passes can have
    // visited this skeleton earlier; tools and skin must use the same pose.
    this.updateMatrixWorld(true);
    for(const skeleton of this.skeletons)skeleton.update();
  }
  private poseCartHandles(grips:WorkerGripTarget[],right:THREE.Vector3,raised:number,working:boolean):void {
    const contacts=grips.filter(g=>g.active&&g.bodyFrame),back=right.clone().cross(Y).normalize();
    const poses=new Map<string,{rotation:THREE.Quaternion;section:[number,number]}>();
    // Solve contact and stance together: an elevated handle is reached by
    // stepping back, while shoulders, elbows and wrists retain their lengths.
    for(let stance=0;stance<6;stance++){
      for(const grip of contacts){
        const side=grip.side>0?'R':'L',axis=Y.clone().applyQuaternion(grip.rotation);let long=grip.palmDirection!.clone().normalize();
        // Keep space for the thumb web: aligning the palm with the shaft
        // buries its base in the grip even when the fingertip can reach.
        const limitPalm=()=>{const along=THREE.MathUtils.clamp(long.dot(axis),-.80,.80),across=long.clone().addScaledVector(axis,-long.dot(axis)).normalize();long.copy(across).multiplyScalar(Math.sqrt(1-along*along)).addScaledVector(axis,along);};
        for(let pass=0;pass<4;pass++){
          limitPalm();
          const across=long.clone().addScaledVector(axis,-long.dot(axis)).normalize().multiplyScalar(-grip.side),away=across.clone().cross(axis).normalize();
          const rotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across,axis,away));
          const radial=axis.clone().addScaledVector(long,-axis.dot(long)).normalize(),q=this.handOrientation(side,radial,long);
          const wrist=grip.center.clone().addScaledVector(across,-grip.side*grip.section[0]*.6).addScaledVector(away,-grip.section[1]-.012).sub(this.handFrames.get(side)!.knuckle.clone().applyQuaternion(q));
          this.reachWithShoulder(side,wrist,.0005);this.limb('upper_arm.'+side,'forearm.'+side,'hand.'+side,wrist,long.clone().negate(),.0005);this.setHandOrientation(side,radial,long);
          this.gripErrors[side]=this.point('hand.'+side).distanceTo(wrist);poses.set(side,{rotation,section:grip.section});
          long=grip.palmDirection!.clone().normalize().lerp(this.point('hand.'+side).sub(this.point('forearm.'+side)).normalize(),raised).normalize();
        }
      }
      if(raised===0||stance===5)break;
      let retreat=0;
      for(const grip of contacts){const side=grip.side>0?'R':'L',d=this.point('hand.'+side).sub(this.point('upper_arm.'+side)),reach=this.lengths.get('upper_arm.'+side)!+this.lengths.get('forearm.'+side)!-.001;
        const projection=d.dot(back);retreat=Math.max(retreat,projection+Math.sqrt(Math.max(0,projection*projection+reach*reach-d.lengthSq())));
      }
      if(retreat<.0005)break;this.position.addScaledVector(back,Math.min(retreat,.12));this.updateMatrixWorld(true);
    }
    for(const grip of contacts){const side=grip.side>0?'R':'L',pose=poses.get(side)!;this.wrapGrip(side,grip.center,pose.rotation,pose.section,false,working,'round',undefined,undefined,true);}
    if(raised>0)for(const [side,sign]of [['R',1],['L',-1]] as const){const foot=this.point('foot.'+side),phase=this.phase+(side==='R'?0:Math.PI);foot.y=.09+Math.max(0,Math.sin(phase))*.065*this.gaitBlend;this.limb('thigh.'+side,'shin.'+side,'foot.'+side,foot,back.clone().negate().addScaledVector(right,sign*.12));}
  }
  private boxGraspHistory=new Map<THREE.Object3D,GraspHistory>();
  private boxUnitScreenBounds(object:THREE.Object3D,side:number,camera:THREE.PerspectiveCamera):THREE.Box2 {
    object.updateWorldMatrix(true,true);const bounds=new THREE.Box3().setFromObject(object),points:THREE.Vector3[]=[];
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])points.push(new THREE.Vector3(x,y,z));
    const projected=(point:THREE.Vector3)=>{const p=point.clone().project(camera);return new THREE.Vector2(p.x,p.y);},screen=new THREE.Box2().setFromPoints(points.map(projected));
    if(side>0){const hand=['hand.R','index.01.R','index.02.R','index.03.R','middle.01.R','middle.02.R','middle.03.R','ring.01.R','ring.02.R','ring.03.R','little.01.R','little.02.R','little.03.R','thumb.01.R','thumb.02.R','thumb.03.R'].map(name=>projected(this.point(name)));screen.union(new THREE.Box2().setFromPoints(hand).expandByScalar(.02));}
    return screen;
  }
  private boxScreenDelta(object:THREE.Object3D,camera:THREE.PerspectiveCamera,dx:number,dy:number):THREE.Vector3 {
    if(Math.abs(dx)<1e-6&&Math.abs(dy)<1e-6)return new THREE.Vector3();
    const center=object.getWorldPosition(new THREE.Vector3()),view=center.clone().applyMatrix4(camera.matrixWorldInverse),halfHeight=-view.z*Math.tan(THREE.MathUtils.degToRad(camera.fov*.5)),cameraQ=camera.getWorldQuaternion(new THREE.Quaternion());
    return new THREE.Vector3(1,0,0).applyQuaternion(cameraQ).multiplyScalar(dx*halfHeight*camera.aspect).addScaledVector(new THREE.Vector3(0,1,0).applyQuaternion(cameraQ),dy*halfHeight);
  }
  private boxViewportCorrection(object:THREE.Object3D,side:number,camera:THREE.PerspectiveCamera):THREE.Vector3 {
    const bounds=this.boxUnitScreenBounds(object,side,camera),dx=bounds.min.x<-.98?-.98-bounds.min.x:bounds.max.x>.98?.98-bounds.max.x:0,dy=bounds.min.y<-.98?-.98-bounds.min.y:bounds.max.y>.98?.98-bounds.max.y:0;
    return this.boxScreenDelta(object,camera,dx,dy);
  }
  private boxObstacleCorrection(object:THREE.Object3D,side:number,camera:THREE.PerspectiveCamera,fps:FPSRig):THREE.Vector3 {
    if(side<0)return new THREE.Vector3();
    const unit=this.boxUnitScreenBounds(object,side,camera),obstacles=fps.boxGraspScreenObstacles(object,camera).map(obstacle=>obstacle.clone().expandByScalar(-.025));
    const xs=[0,-.98-unit.min.x,.98-unit.max.x],ys=[0,-.98-unit.min.y,.98-unit.max.y];
    for(const obstacle of obstacles){xs.push(obstacle.min.x-unit.max.x-.001,obstacle.max.x-unit.min.x+.001);ys.push(obstacle.min.y-unit.max.y-.001,obstacle.max.y-unit.min.y+.001);}
    const choices=[] as {x:number;y:number;score:number}[];
    for(const x of xs)for(const y of ys){
      const moved=unit.clone().translate(new THREE.Vector2(x,y));
      if(moved.min.x<-.98||moved.max.x>.98||moved.min.y<-.98||moved.max.y>.98||obstacles.some(obstacle=>moved.intersectsBox(obstacle)))continue;
      // In portrait the hand and casing sit at slightly different depths, so
      // a large horizontal correction can push the nearer fingers offscreen.
      // Prefer the available vertical lane and keep their rigid pinch intact.
      choices.push({x,y,score:Math.abs(y)*.10+Math.abs(x)});
    }
    choices.sort((a,b)=>a.score-b.score);const best=choices[0];
    return best?this.boxScreenDelta(object,camera,best.x,best.y):new THREE.Vector3();
  }
  private clampBoxComposition(objects:THREE.Object3D[],grips:WorkerGripTarget[],camera:THREE.PerspectiveCamera,fps:FPSRig):void {
    const assembly=objects.find(object=>grips.find(grip=>grip.object===object)?.side===-1),candidate=objects.find(object=>grips.find(grip=>grip.object===object)?.side===1);
    if(!assembly||!candidate)return;
    for(let pass=0;pass<5;pass++){
      const bounds=this.boxUnitScreenBounds(assembly,-1,camera).union(this.boxUnitScreenBounds(candidate,1,camera));
      for(const obstacle of fps.boxGraspScreenObstacles(candidate,camera))bounds.union(obstacle.clone().expandByScalar(-.025));
      const dx=bounds.min.x<-.98?-.98-bounds.min.x:bounds.max.x>.98?.98-bounds.max.x:0,dy=bounds.min.y<-.98?-.98-bounds.min.y:bounds.max.y>.98?.98-bounds.max.y:0;
      const delta=this.boxScreenDelta(candidate,camera,dx,dy);if(delta.lengthSq()<1e-12)break;
      this.translateArm('L',delta);this.translateArm('R',delta);fps.translateBoxGrasp(assembly,delta);fps.translateBoxGrasp(candidate,delta);this.updateMatrixWorld(true);
    }
  }
  private translateArm(side:string,delta:THREE.Vector3):void {
    if(delta.lengthSq()<1e-12)return;const clavicle=this.bone('clavicle.'+side),world=clavicle.getWorldPosition(new THREE.Vector3()).add(delta);clavicle.position.copy(clavicle.parent!.worldToLocal(world));clavicle.updateWorldMatrix(true,true);
  }
  private poseBoxGrasps(grips:WorkerGripTarget[],camera:THREE.PerspectiveCamera,fps:FPSRig,right:THREE.Vector3,frontForBounds?:(bounds:THREE.Box3)=>number|null):void {
    const objects=[...new Set(grips.filter(g=>g.active&&g.object&&!g.referenceKey).map(g=>g.object!))].sort((a,b)=>grips.find(g=>g.object===a)!.side-grips.find(g=>g.object===b)!.side);
    for(const object of objects){
      const targets=grips.filter(g=>g.active&&g.object===object),primary=targets[0];
      // Preserve every finger and the hand/tool contact. The rigid unit now
      // includes a straight forearm; only the shoulder/elbow place this unit.
      const inverse=primary.rotation.clone().invert();
      const frames=targets.map(grip=>{
        const name=grip.side>0?'R':'L',wrist=this.point('hand.'+name),oldElbow=this.point('forearm.'+name);
        const long=this.point('middle.01.'+name).sub(wrist).normalize();
        const elbow=wrist.clone().addScaledVector(long,-wrist.distanceTo(oldElbow));
        const handQ=this.bone('hand.'+name).getWorldQuaternion(new THREE.Quaternion());
        const neutralQ=handQ.clone().multiply(this.handFrames.get(name)!.foreToHand.clone().invert());
        neutralQ.premultiply(new THREE.Quaternion().setFromUnitVectors(Y.clone().applyQuaternion(neutralQ),long));
        const shoulder=this.point('upper_arm.'+name);
        const screenRegion=grip.side<0?{minX:-.90,maxX:.05}:{minX:.10,maxX:.90};
        return{name,handSign:grip.side,lockRotation:true,screenObstacles:fps.boxGraspScreenObstacles(object,camera),screenRegion,shoulder,upperLength:shoulder.distanceTo(oldElbow),elbow:elbow.sub(primary.center).applyQuaternion(inverse),wrist:wrist.sub(primary.center).applyQuaternion(inverse),foreQ:inverse.clone().multiply(neutralQ),handQ:inverse.clone().multiply(handQ)};
      });
      if(primary.contactLocked)continue;
      const corners=fps.boxGraspViewCorners(object,primary.center,primary.rotation);
      if(primary.side>0)for(const name of ['hand.R','index.01.R','index.02.R','index.03.R','middle.01.R','middle.02.R','middle.03.R','ring.01.R','ring.02.R','ring.03.R','little.01.R','little.02.R','little.03.R','thumb.01.R','thumb.02.R','thumb.03.R'])corners.push(this.point(name).sub(primary.center).applyQuaternion(inverse));
      // Start with the arm, as with spray: position the elbow first,
      // palm continuing the forearm. Carry the captured contact with it.
      const forward=camera.getWorldDirection(new THREE.Vector3()),flat=forward.clone();flat.y=0;flat.normalize();
      const side=primary.side;
      const desiredRotation=camera.getWorldQuaternion(new THREE.Quaternion());
      const pole=flat.clone().multiplyScalar(1.15).addScaledVector(right,-side*(camera.aspect<1?.65:.20)).addScaledVector(Y,-.05).normalize();
      const elbow=frames[0].shoulder.clone().addScaledVector(pole,frames[0].upperLength);
      const desiredCenter=elbow.sub(frames[0].elbow.clone().applyQuaternion(desiredRotation));
      desiredCenter.add(fps.boxGraspMotion(object));
      const pose=solveRigidGrasp(desiredCenter,desiredRotation,frames[0],camera,corners,frontForBounds,this.boxGraspHistory.get(object));
      const cameraQ=camera.getWorldQuaternion(new THREE.Quaternion()),cameraInverse=cameraQ.clone().invert();
      this.boxGraspHistory.set(object,{rotation:cameraInverse.clone().multiply(pose.rotation),swivel:cameraInverse.clone().multiply(pose.swivel).multiply(cameraQ)});
      for(const frame of frames){
        const elbow=frame.elbow.clone().applyQuaternion(pose.rotation).add(pose.center);
        this.orient('upper_arm.'+frame.name,elbow);
        this.worldRotation(this.bone('forearm.'+frame.name),pose.rotation.clone().multiply(frame.foreQ));
        this.worldRotation(this.bone('hand.'+frame.name),pose.rotation.clone().multiply(frame.handQ));
        this.gripErrors[frame.name]=this.point('hand.'+frame.name).distanceTo(frame.wrist.clone().applyQuaternion(pose.rotation).add(pose.center));
      }
      const turn=pose.rotation.clone().multiply(inverse);
      fps.transformAnatomicalGrasp(primary.center,pose.center,turn,object);
      this.updateMatrixWorld(true);
      if(side<0)fps.clampFittingZones(camera);
      for(let pass=0;pass<3;pass++){
        const viewportShift=this.boxViewportCorrection(object,side,camera);
        if(viewportShift.lengthSq()>1e-12){this.translateArm(side>0?'R':'L',viewportShift);fps.translateBoxGrasp(object,viewportShift);this.updateMatrixWorld(true);}
        const obstacleShift=this.boxObstacleCorrection(object,side,camera,fps);
        if(obstacleShift.lengthSq()>1e-12){this.translateArm(side>0?'R':'L',obstacleShift);fps.translateBoxGrasp(object,obstacleShift);this.updateMatrixWorld(true);}
      }
    }
    fps.clampFittingZones(camera);
    const candidate=objects.find(object=>grips.find(grip=>grip.object===object)?.side===1);
    if(candidate)for(let pass=0;pass<3;pass++){
      const viewportShift=this.boxViewportCorrection(candidate,1,camera);
      if(viewportShift.lengthSq()>1e-12){this.translateArm('R',viewportShift);fps.translateBoxGrasp(candidate,viewportShift);this.updateMatrixWorld(true);}
      const obstacleShift=this.boxObstacleCorrection(candidate,1,camera,fps);
      if(obstacleShift.lengthSq()>1e-12){this.translateArm('R',obstacleShift);fps.translateBoxGrasp(candidate,obstacleShift);this.updateMatrixWorld(true);}
    }
    this.clampBoxComposition(objects,grips,camera,fps);
  }
  private poseReferenceGrasps(grips:WorkerGripTarget[],camera:THREE.PerspectiveCamera,fps:FPSRig,station:boolean,right:THREE.Vector3,frontForBounds?: (bounds:THREE.Box3)=>number|null):Set<string>{
    const targets=grips.filter(g=>g.active&&g.object&&g.referenceKey&&this.referenceGrips[g.referenceKey]);
    const solved=new Set<string>();if(!targets.length){this.graspHistory=undefined;return solved;}
    const primary=targets[0],inverse=primary.rotation.clone().invert(),object=primary.object!;
    const frames=targets.filter(g=>g.object===object).map(grip=>{
      const side=grip.side>0?'R':'L',reference=this.referenceGrips[grip.referenceKey!];
      const fore=reference.joints.find(j=>j.name==='forearm.'+side)!,hand=reference.joints.find(j=>j.name==='hand.'+side)!;
      const rotation=inverse.clone().multiply(grip.rotation),offset=grip.center.clone().sub(primary.center).applyQuaternion(inverse);
      const elbow=new THREE.Vector3().fromArray(fore.positionInGrip).applyQuaternion(rotation).add(offset);
      const wrist=new THREE.Vector3().fromArray(hand.positionInGrip).applyQuaternion(rotation).add(offset);
      const shoulder=this.point('upper_arm.'+side),upperLength=shoulder.distanceTo(this.point('forearm.'+side));
      return{side,reference,fore,hand,rotation,shoulder,upperLength,elbow,wrist};
    });
    const contact=primary.contactLocked;
    if(this.graspTool!==primary.referenceKey||contact)this.graspHistory=undefined;
    this.graspTool=primary.referenceKey!;
    const bounds=station?new THREE.Box3().setFromObject(object):fps.heldToolBoundsWorld(),corners:THREE.Vector3[]=[];
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])corners.push(new THREE.Vector3(x,y,z).sub(primary.center).applyQuaternion(inverse));
    const pose=contact?{center:primary.center,rotation:primary.rotation,swivel:new THREE.Quaternion(),error:0}:solveRigidGrasp(primary.center,primary.rotation,frames[0],camera,corners,frontForBounds,this.graspHistory);
    const cameraQ=camera.getWorldQuaternion(new THREE.Quaternion()),cameraInverse=cameraQ.clone().invert();
    if(!contact)this.graspHistory={rotation:cameraInverse.clone().multiply(pose.rotation),swivel:cameraInverse.clone().multiply(pose.swivel).multiply(cameraQ)};
    this.userData.graspSolve={error:pose.error,angle:pose.rotation.angleTo(primary.rotation),contact};
    for(const frame of frames){
      const {side,fore,reference}=frame,elbow=frame.elbow.clone().applyQuaternion(pose.rotation).add(pose.center);
      if(contact){
        // A seated bit fixes the complete grasp in world space. Reach with
        // the torso/shoulder instead of folding the wrist or detaching it.
        this.reachReferenceElbow(side,elbow);
        this.limb('clavicle.'+side,'upper_arm.'+side,'forearm.'+side,elbow,right.clone().multiplyScalar(side==='R'?1:-1).addScaledVector(Y,-.25));
      }
      else this.orient('upper_arm.'+side,elbow);
      this.worldRotation(this.bone('forearm.'+side),pose.rotation.clone().multiply(frame.rotation).multiply(new THREE.Quaternion().fromArray(fore.quaternionInGrip)));
      for(const joint of reference.joints)if(!joint.name.startsWith('forearm.'))this.bone(joint.name).quaternion.fromArray(joint.localQuaternion);
      this.bone('forearm.'+side).updateWorldMatrix(false,true);
      this.gripErrors[side]=this.point('hand.'+side).distanceTo(frame.wrist.clone().applyQuaternion(pose.rotation).add(pose.center));
      solved.add(side);
    }
    if(!contact){
      const turn=pose.rotation.clone().multiply(inverse);
      if(!station)fps.transformAnatomicalGrasp(primary.center,pose.center,turn);
      else{
        const position=object.getWorldPosition(new THREE.Vector3()).sub(primary.center).applyQuaternion(turn).add(pose.center);
        const rotation=turn.clone().multiply(object.getWorldQuaternion(new THREE.Quaternion()));
        object.position.copy(object.parent!.worldToLocal(position));object.quaternion.copy(object.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));object.updateWorldMatrix(false,true);
      }
    }
    return solved;
  }
  private reachReferenceElbow(side:string,target:THREE.Vector3):void{
    const clavicle=this.point('clavicle.'+side),upper=this.point('upper_arm.'+side);
    const a=clavicle.distanceTo(upper),b=upper.distanceTo(this.point('forearm.'+side));
    const nearest=Math.abs(a-b)+.008,reach=a+b-.008,d=clavicle.distanceTo(target),tooClose=d<nearest;
    if(d<=reach&&!tooClose)return;
    const spine=this.bone('spine'),origin=spine.getWorldPosition(new THREE.Vector3()),offset=clavicle.clone().sub(origin);
    const turn=new THREE.Quaternion().setFromUnitVectors(offset.clone().normalize(),target.clone().sub(origin).normalize());
    if(tooClose)turn.invert();
    const angularLimit=THREE.MathUtils.degToRad(30)/Math.max(.001,new THREE.Quaternion().angleTo(turn));
    const max=tooClose?angularLimit:Math.min(1,angularLimit);
    const distance=(t:number)=>offset.clone().applyQuaternion(new THREE.Quaternion().slerp(turn,t)).add(origin).distanceTo(target);
    let lo=0,hi=max;
    for(let i=0;i<16;i++){const mid=(lo+hi)/2;if(tooClose?distance(mid)<nearest:distance(mid)>reach)lo=mid;else hi=mid;}
    this.worldRotation(spine,new THREE.Quaternion().slerp(turn,hi).multiply(spine.getWorldQuaternion(new THREE.Quaternion())));
  }
  private handOrientation(side:string,axis:THREE.Vector3,long:THREE.Vector3):THREE.Quaternion {
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(axis,long,axis.clone().cross(long))).multiply(this.handFrames.get(side)!.basis);
  }
  private setHandOrientation(side:string,axis:THREE.Vector3,long:THREE.Vector3):void {
    const q=this.handOrientation(side,axis,long),frame=this.handFrames.get(side)!;
    const upper=this.bone('upper_arm.'+side),fore=this.bone('forearm.'+side);
    const upperDirection=this.point('forearm.'+side).sub(this.point('upper_arm.'+side)).normalize();
    const direction=this.point('hand.'+side).sub(this.point('forearm.'+side)).normalize();
    const foreQ=q.clone().multiply(frame.foreToHand.clone().invert());
    foreQ.premultiply(new THREE.Quaternion().setFromUnitVectors(Y.clone().applyQuaternion(foreQ),direction));
    // Build a neutral swing frame from the bind pose on every solve. Merely
    // forcing the forearm to the palm's roll concentrates all pronation at
    // the elbow; accumulating roll across IK passes also twists the sleeve.
    const upperSwing=upper.parent!.getWorldQuaternion(new THREE.Quaternion()).multiply(this.rest.get(upper)!.q);
    upperSwing.premultiply(new THREE.Quaternion().setFromUnitVectors(Y.clone().applyQuaternion(upperSwing),upperDirection));
    const neutralFore=upperSwing.clone().multiply(this.rest.get(fore)!.q);
    neutralFore.premultiply(new THREE.Quaternion().setFromUnitVectors(Y.clone().applyQuaternion(neutralFore),direction));
    const delta=foreQ.clone().multiply(neutralFore.clone().invert());
    let twist=2*Math.atan2(new THREE.Vector3(delta.x,delta.y,delta.z).dot(direction),delta.w);
    twist=THREE.MathUtils.euclideanModulo(twist+Math.PI,Math.PI*2)-Math.PI;
    const upperRoll=THREE.MathUtils.clamp(twist*.55,-Math.PI/2,Math.PI/2);
    const upperQ=new THREE.Quaternion().setFromAxisAngle(upperDirection,upperRoll).multiply(upperSwing);
    const transported=upperQ.clone().multiply(this.rest.get(fore)!.q);
    transported.premultiply(new THREE.Quaternion().setFromUnitVectors(Y.clone().applyQuaternion(transported),direction));
    this.armTwist[side]={upperDegrees:THREE.MathUtils.radToDeg(upperRoll),foreDegrees:THREE.MathUtils.radToDeg(transported.angleTo(foreQ))};
    this.worldRotation(upper,upperQ);
    this.worldRotation(fore,foreQ);this.worldRotation(this.bone('hand.'+side),q);
  }
  private wrapGrip(side:string,center:THREE.Vector3,rotation:THREE.Quaternion,section:[number,number],spray:boolean,working:boolean,shape:'round'|'box'='round',trigger?:THREE.Vector3,buttonTarget?:THREE.Vector3,contactCylinder=false):void {
    const sign=side==='R'?1:-1,axis=Y.clone().applyQuaternion(rotation),across=new THREE.Vector3(1,0,0).applyQuaternion(rotation),back=new THREE.Vector3(0,0,1).applyQuaternion(rotation);
    for(const digit of spray||trigger?['middle','ring','little']:['index','middle','ring','little'])this.closeFinger(digit,side,center,rotation,section,shape);
    if(trigger)this.fitFinger('index',side,trigger);
    if(spray){
      const actuator=buttonTarget??center.clone().addScaledVector(axis,working?.118:.120).addScaledVector(back,-.002);
      this.fitFinger('index',side,actuator,true);
    }
    const tip=center.clone().addScaledVector(across,sign*(spray?.043:section[0]+.005)).addScaledVector(back,spray?.018:.008).addScaledVector(axis,spray?.067:.018);
    if(contactCylinder){
      // Approach the near surface with the thumb's pad. A fixed far-side
      // target exceeds the thumb's range and buckles its knuckle into the palm.
      const thumb=this.bone('thumb.03.'+side),offset=this.point('thumb.03.'+side).addScaledVector(Y.clone().applyQuaternion(thumb.getWorldQuaternion(new THREE.Quaternion())),this.lengths.get('thumb.03.'+side)!).sub(center);
      const height=THREE.MathUtils.clamp(offset.dot(axis),-.07,.07);
      offset.addScaledVector(axis,-offset.dot(axis)).normalize();
      tip.copy(center).addScaledVector(axis,height).addScaledVector(offset,section[0]+.012);
    }
    this.fitThumb(side,tip,spray||contactCylinder?{center,axis,radius:section[0]}:undefined,contactCylinder);
    const thumbEnd=this.bone('thumb.03.'+side),end=this.point('thumb.03.'+side).add(Y.clone().applyQuaternion(thumbEnd.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(this.lengths.get('thumb.03.'+side)!));
    this.fingerFit['thumbContact'+side]={center:center.toArray(),axis:axis.toArray(),across:across.toArray(),back:back.toArray(),tip:end.toArray(),section};
  }
  private pinchBox(side:string,center:THREE.Vector3,rotation:THREE.Quaternion):void {
    const sign=side==='R'?1:-1;
    // Thumb inside, index/middle outside the side wall. The other fingers
    // fold toward the palm; none of these joints twist about their length.
    const target=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z).applyQuaternion(rotation).add(center);
    this.fitFinger('index',side,target(sign*.010,.020,0),false,this.boxFingerAxes);
    this.fitFinger('middle',side,target(sign*.010,side==='R'?-.006:-.012,0),false,this.boxFingerAxes);
    this.fitFinger('ring',side,target(sign*.050,-.033,.035),false,this.boxFingerAxes);
    this.fitFinger('little',side,target(sign*.047,-.055,.040),false,this.boxFingerAxes);
    this.fitThumb(side,target(-sign*.010,.020,0));
  }
  private closeFinger(digit:string,side:string,center:THREE.Vector3,rotation:THREE.Quaternion,section:[number,number],shape:string):void {
    const sign=side==='R'?1:-1,axis=Y.clone().applyQuaternion(rotation),across=new THREE.Vector3(1,0,0).applyQuaternion(rotation),back=new THREE.Vector3(0,0,1).applyQuaternion(rotation),rx=section[0]+.010,rz=section[1]+.010;
    const height=this.point(`${digit}.01.${side}`).sub(center).dot(axis);
    const outline=(angle:number)=>{const x=Math.cos(angle),z=Math.sin(angle),p=shape==='box'?.5:1;return center.clone().addScaledVector(axis,height).addScaledVector(across,rx*Math.sign(x)*Math.abs(x)**p).addScaledVector(back,rz*Math.sign(z)*Math.abs(z)**p);};
    for(let j=1;j<=3;j++){
      const name=`${digit}.0${j}.${side}`,base=this.point(name),relative=base.clone().sub(center),angle=Math.atan2(relative.dot(back)/rz,relative.dot(across)/rx),length=this.lengths.get(name)!;
      let low=0,high=Math.PI;for(let n=0;n<12;n++){const a=(low+high)/2;if(outline(angle-sign*a).distanceTo(base)<length)low=a;else high=a;}
      this.orient(name,outline(angle-sign*(low+high)/2));
    }
  }
  private fitThumb(side:string,target:THREE.Vector3,cylinder?:{center:THREE.Vector3;axis:THREE.Vector3;radius:number},reuseSurfaceContact=false):void {
    const sign=side==='R'?1:-1,names=[1,2,3].map(j=>`thumb.0${j}.${side}`),angles=[0,0,.3,.3];
    const axes=[this.thumbOpposition.get(side)!,this.fingerAxes.get(names[0])!,this.fingerAxes.get(names[1])!,this.fingerAxes.get(names[2])!],indices=[0,0,1,2],limits=[[-.85,.85],[-.65,.65],[0,cylinder?.95:.70],[0,cylinder?.12:.35]];
    const pose=()=>{for(let j=0;j<3;j++){const b=this.bone(names[j]);b.quaternion.copy(this.rest.get(b)!.q);if(j===0)b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axes[0],angles[0])).multiply(new THREE.Quaternion().setFromAxisAngle(axes[1],angles[1]));else b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axes[j+1],sign*angles[j+1]));b.updateWorldMatrix(false,true);}};
    const tip=()=>{const b=this.bone(names[2]);return this.point(names[2]).add(Y.clone().applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(this.lengths.get(names[2])!));};
    // The contact geometry is expressed in palm space. Crouch/yaw do not
    // invalidate it; normalize signed zero to avoid needless cache misses.
    const hand=this.bone('hand.'+side),key=cylinder?[...hand.worldToLocal(target.clone()).toArray(),...hand.worldToLocal(cylinder.center.clone()).toArray(),...cylinder.axis.clone().applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()).invert()).toArray()].map(n=>Math.round(n*10000)/10000).join(','):'';
    const cached=this.thumbPoseCache.get(side);
    if(cylinder&&cached?.key===key){angles.splice(0,4,...cached.angles);pose();this.fingerFit['thumb'+side]={error:tip().distanceTo(target),angles:angles.map(a=>a*180/Math.PI)};return;}
    if(cylinder&&cached&&reuseSurfaceContact){
      // A moving cart changes world transforms continuously, but its thumb
      // contact usually remains valid. Verify the actual skin once before
      // running the much more expensive full surface fit again.
      angles.splice(0,4,...cached.angles);pose();const vertex=new THREE.Vector3();
      const surfaceGap=()=>{let gap=Infinity;for(const sample of this.thumbSurface.get(side)!){sample.mesh.getVertexPosition(sample.index,vertex);vertex.applyMatrix4(sample.mesh.matrixWorld).sub(cylinder.center);const h=vertex.dot(cylinder.axis);if(Math.abs(h)>.08)continue;vertex.addScaledVector(cylinder.axis,-h);gap=Math.min(gap,vertex.length()-cylinder.radius);}return gap;};
      let gap=surfaceGap();
      // Follow the previous contact with a small bounded correction. A full
      // fit from rest is reserved for acquisition or a large discontinuity.
      if(Math.abs(gap)<.025)for(let pass=0;pass<3&&(gap<-.001||gap>.003);pass++){
        let best=gap,bestAxis=-1,bestAngle=0;
        for(let j=0;j<3;j++){
          const original=angles[j],probe=.012;angles[j]=THREE.MathUtils.clamp(original+probe,limits[j][0],limits[j][1]);pose();const slope=(surfaceGap()-gap)/probe;
          angles[j]=original;if(Math.abs(slope)<.002)continue;
          const candidate=THREE.MathUtils.clamp(original+THREE.MathUtils.clamp((.001-gap)/slope,-.12,.12),limits[j][0],limits[j][1]);angles[j]=candidate;pose();const next=surfaceGap();angles[j]=original;
          if(Math.abs(next-.001)<Math.abs(best-.001)){best=next;bestAxis=j;bestAngle=candidate;}
        }
        if(bestAxis<0){pose();break;}angles[bestAxis]=bestAngle;pose();gap=best;
      }
      if(gap>=-.001&&gap<=.003){this.thumbPoseCache.set(side,{key,angles:[...angles]});this.fingerFit['thumb'+side]={error:tip().distanceTo(target),angles:angles.map(a=>a*180/Math.PI),solver:'retained-surface-contact'};return;}
    }
    pose();
    for(let pass=0;pass<10;pass++)for(let j=3;j>=0;j--){
      const b=this.bone(names[indices[j]]),origin=this.point(names[indices[j]]),axis=axes[j].clone().applyQuaternion(j===0?b.parent!.getWorldQuaternion(new THREE.Quaternion()).multiply(this.rest.get(b)!.q):b.getWorldQuaternion(new THREE.Quaternion())),from=tip().sub(origin),to=target.clone().sub(origin);
      from.addScaledVector(axis,-from.dot(axis)).normalize();to.addScaledVector(axis,-to.dot(axis)).normalize();const delta=Math.atan2(axis.dot(from.clone().cross(to)),from.dot(to));
      angles[j]=THREE.MathUtils.clamp(angles[j]+(j<2?1:sign)*delta,limits[j][0],limits[j][1]);pose();
    }
    if(cylinder){
      // Fingertip-only IK can meet its target while burying the IP joint in
      // the can. Fit the flesh envelope along both phalanges as well, keeping
      // the distal joint nearly straight as in the supplied grip photographs.
      const cost=()=>{
        const end=tip(),points=[this.point(names[1]),this.point(names[2]),end];
        let value=end.distanceToSquared(target)+angles[3]**2*.0002;
        for(let j=0;j<2;j++)for(const t of [0,.5,1]){
          const offset=points[j].clone().lerp(points[j+1],t).sub(cylinder.center),height=offset.dot(cylinder.axis);
          if(height<-.1||height>.095)continue;
          offset.addScaledVector(cylinder.axis,-height);
          const pad=THREE.MathUtils.lerp(.014,.010,(j+t)/2),gap=offset.length()-cylinder.radius-pad;
          value+=Math.min(0,gap)**2*40;
        }
        return value;
      };
      let best=cost();
      for(const step of [.18,.09,.045,.0225,.01125])for(let pass=0;pass<2;pass++)for(let j=0;j<4;j++){
        const original=angles[j];let chosen=original;
        for(const direction of [-1,1]){
          angles[j]=THREE.MathUtils.clamp(original+direction*step,limits[j][0],limits[j][1]);pose();const score=cost();
          if(score<best){best=score;chosen=angles[j];}
        }
        angles[j]=chosen;pose();
      }
      // Finish against deformed thumb skin, not just bone centres. The
      // thumb pad is not a circular capsule, especially with a bent elbow.
      const vertex=new THREE.Vector3(),samples=this.thumbSurface.get(side)!;
      const skinCost=()=>{
        let closest=Infinity;
        for(const sample of samples){
          sample.mesh.getVertexPosition(sample.index,vertex);vertex.applyMatrix4(sample.mesh.matrixWorld).sub(cylinder.center);
          const height=vertex.dot(cylinder.axis);if(height<-.09||height>.083)continue;
          vertex.addScaledVector(cylinder.axis,-height);closest=Math.min(closest,vertex.length()-cylinder.radius);
        }
        return (closest-.001)**2*(closest<0?50:8)+tip().distanceToSquared(target);
      };
      best=skinCost();
      for(const step of [.08,.04,.02,.01,.005])for(let pass=0;pass<3;pass++)for(let j=0;j<3;j++){
        const original=angles[j];let chosen=original;
        for(const direction of [-1,1]){angles[j]=THREE.MathUtils.clamp(original+direction*step,limits[j][0],limits[j][1]);pose();const score=skinCost();if(score<best){best=score;chosen=angles[j];}}
        angles[j]=chosen;pose();
      }
      this.thumbPoseCache.set(side,{key,angles:[...angles]});
    }
    this.fingerFit['thumb'+side]={error:tip().distanceTo(target),angles:angles.map(a=>a*180/Math.PI)};
  }
  private fitFinger(digit:string,side:string,target:THREE.Vector3,actuator=false,hinges=this.fingerAxes):void {
    const sign=side==='R'?1:-1,adduction=this.fingerAdduction.get(digit+side)??0,angles=[adduction,.3,.5,.3],names=[1,2,3].map(j=>`${digit}.0${j}.${side}`);
    const spread=actuator?.55:.35;
    const axes=[this.fingerSplay.get(digit+side)!,...names.map(n=>hinges.get(n)!)],indices=[0,0,1,2],limits=[[adduction-spread,adduction+spread],[actuator?-.45:0,1.35],[0,1.75],[0,1.25]];
    const pose=()=>{for(let j=0;j<3;j++){const b=this.bone(names[j]);b.quaternion.copy(this.rest.get(b)!.q);if(j===0)b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axes[0],angles[0]));b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axes[j+1],sign*angles[j+1]));b.updateWorldMatrix(false,true);}};
    const tip=()=>{const b=this.bone(names[2]);return this.point(names[2]).add(Y.clone().applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(this.lengths.get(names[2])!));};
    pose();
    for(let pass=0;pass<10;pass++)for(let j=3;j>=0;j--){
      const b=this.bone(names[indices[j]]),origin=this.point(names[indices[j]]),q=j===0?b.parent!.getWorldQuaternion(new THREE.Quaternion()).multiply(this.rest.get(b)!.q):b.getWorldQuaternion(new THREE.Quaternion()),axis=axes[j].clone().applyQuaternion(q);
      const from=tip().sub(origin),to=target.clone().sub(origin);from.addScaledVector(axis,-from.dot(axis)).normalize();to.addScaledVector(axis,-to.dot(axis)).normalize();
      const delta=Math.atan2(axis.dot(from.clone().cross(to)),from.dot(to));angles[j]=THREE.MathUtils.clamp(angles[j]+(j===0?1:sign)*delta,limits[j][0],limits[j][1]);pose();
    }
    this.fingerFit[digit+side]={error:tip().distanceTo(target),tip:tip().toArray(),target:target.toArray(),angles:angles.map(a=>a*180/Math.PI)};
  }
  get telemetry(){return{loaded:this.loaded,visible:this.visible,bones:this.bones.size,phase:this.phase,crouch:this.bend,source:'Blender Human Base Meshes v1.4.1 CC0',scope:'shared body / all tool grips',locomotion:this.locomotionState,gripReachErrors:this.gripErrors,armTwist:this.armTwist,fingerFit:this.fingerFit};}
  resetPreviewMotion():void{this.phase=0;this.clock=0;this.gaitBlend=0;this.travelTurn=0;}
  poseSnapshot(){return [...this.rest].map(([b,r])=>({name:b.name,quaternion:r.q.clone().invert().multiply(b.quaternion).toArray(),translation:b.position.clone().sub(r.p).toArray()}));}
}
