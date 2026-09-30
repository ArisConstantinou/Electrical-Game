import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { WorkerGripTarget } from './WorkerArm';
import gripPoses from './hammerGripPoses.json';

/** Camera presentation of the authored arms. The world rig owns contacts and shadows. */
export class FirstPersonWorkerArms extends THREE.Group {
  private readonly pairs:{source:THREE.Bone;view:THREE.Bone}[]=[];
  private readonly bones=new Map<string,THREE.Bone>();
  private readonly skeleton:THREE.Skeleton;
  private readonly forearmRest=new Map<string,THREE.Quaternion>();
  private readonly handRest=new Map<string,THREE.Quaternion>();
  private readonly history=new Map<string,{shoulder:THREE.Vector3;elbow:THREE.Vector3;wrist:THREE.Vector3;swivel:number;bend:number}>();
  readonly gripTransforms=new Map<string,THREE.Matrix4>();
  readonly pose=new Map<string,{length:number;foreLength:number;bend:number;score:number}>();

  constructor(source:THREE.Group,worldBones:Map<string,THREE.Bone>){
    super();this.name='First-person worker arms';this.visible=false;
    const model=cloneSkeleton(source),meshes:THREE.SkinnedMesh[]=[];
    this.add(model);
    model.traverse(object=>{
      if(object instanceof THREE.Bone){
        this.bones.set(object.name,object);
        const world=worldBones.get(object.name);
        if(world)this.pairs.push({source:world,view:object});
      }
      if(!(object instanceof THREE.Mesh))return;
      object.castShadow=false;object.receiveShadow=true;object.frustumCulled=false;
      if(!(object instanceof THREE.SkinnedMesh)){object.visible=false;return;}
      const indices=object.geometry.getAttribute('skinIndex'),weights=object.geometry.getAttribute('skinWeight');
      const armBones=new Set(object.skeleton.bones.flatMap((bone,i)=>/^(upper_arm|forearm|hand|thumb|index|middle|ring|little)/.test(bone.name)?[i]:[]));
      const colors=new Float32Array(indices.count*4);let armVertices=0;
      for(let i=0;i<indices.count;i++){
        let arm=0;for(let j=0;j<4;j++)if(armBones.has(indices.getComponent(i,j)))arm+=weights.getComponent(i,j);
        colors.set([1,1,1,arm],i*4);if(arm>=.8)armVertices++;
      }
      if(!armVertices){object.visible=false;return;}
      object.geometry=object.geometry.clone();
      object.geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,4));
      const viewWeights=object.geometry.getAttribute('skinWeight');
      for(let i=0;i<indices.count;i++){
        const total=colors[i*4+3];if(total<=0)continue;
        for(let j=0;j<4;j++)viewWeights.setComponent(i,j,armBones.has(indices.getComponent(i,j))?weights.getComponent(i,j)/total:0);
      }
      // Omit torso triangles from the draw as well as the colour mask.
      const original=object.geometry.getIndex(),kept:number[]=[];
      if(original){
        for(let i=0;i<original.count;i+=3){
          const a=original.getX(i),b=original.getX(i+1),c=original.getX(i+2);
          if(Math.max(colors[a*4+3],colors[b*4+3],colors[c*4+3])>=.8)kept.push(a,b,c);
        }
        object.geometry.setIndex(kept);
      }
      const materials=(Array.isArray(object.material)?object.material:[object.material]).map(material=>{
        const copy=material.clone();copy.vertexColors=true;copy.alphaTest=.8;copy.alphaToCoverage=true;return copy;
      });
      object.material=Array.isArray(object.material)?materials:materials[0];meshes.push(object);
    });
    this.skeleton=meshes[0].skeleton;
    for(const mesh of meshes)mesh.skeleton=this.skeleton;
    for(const side of ['L','R']){
      this.forearmRest.set(side,this.bone('forearm.'+side).quaternion.clone().normalize());
      this.handRest.set(side,this.bone('hand.'+side).quaternion.clone().normalize());
    }
  }

  update(camera:THREE.PerspectiveCamera,grips:WorkerGripTarget[],dt:number):void {
    for(const {source,view}of this.pairs){view.matrixAutoUpdate=true;view.position.copy(source.position);view.quaternion.copy(source.quaternion);view.scale.copy(source.scale);}
    this.updateMatrixWorld(true);
    const y=new THREE.Vector3(0,1,0),inverseCamera=camera.matrixWorld.clone().invert();
    const slope=Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()*.5)),wide=slope*camera.aspect;
    for(const side of ['L','R']){
      const sign=side==='R'?1:-1,grip=grips.find(g=>g.side===sign);if(!grip)continue;
      const upper=this.bone('upper_arm.'+side),fore=this.bone('forearm.'+side),hand=this.bone('hand.'+side);
      const originalShoulder=upper.getWorldPosition(new THREE.Vector3()),originalElbow=fore.getWorldPosition(new THREE.Vector3()),originalWrist=hand.getWorldPosition(new THREE.Vector3());
      const upperLength=originalShoulder.distanceTo(originalElbow),foreLength=originalElbow.distanceTo(originalWrist);
      // These four grasps are calibrated on the authored gloves at the real
      // handle radii. World-body IK must never choose the FP wrist orientation.
      const rear=gripPoses[(side+'_rear') as keyof typeof gripPoses],auxiliary=gripPoses[(side+'_auxiliary') as keyof typeof gripPoses];
      const weight=grip.hammerRearWeight??(sign>0?1:0);
      const handRotation=new THREE.Quaternion().fromArray(auxiliary.rotation).slerp(new THREE.Quaternion().fromArray(rear.rotation),weight).premultiply(grip.rotation);
      const wristOffset=new THREE.Vector3().fromArray(auxiliary.wrist).lerp(new THREE.Vector3().fromArray(rear.wrist),weight).applyQuaternion(grip.rotation);
      const handMatrix=new THREE.Matrix4().compose(wristOffset.clone().add(grip.center),handRotation,hand.getWorldScale(new THREE.Vector3()));
      for(const name of Object.keys(auxiliary.fingers))this.bone(name).quaternion.fromArray((auxiliary.fingers as Record<string,number[]>)[name]).slerp(new THREE.Quaternion().fromArray((rear.fingers as Record<string,number[]>)[name]),weight);
      hand.updateWorldMatrix(false,true);
      const foreScale=fore.getWorldScale(new THREE.Vector3()),rest=this.forearmRest.get(side)!;
      const axis=y.clone().applyQuaternion(grip.rotation).normalize();
      const neutralFore=handRotation.clone().multiply(this.handRest.get(side)!.clone().invert());
      const restDirection=y.clone().applyQuaternion(rest),restBend=y.angleTo(restDirection);
      const previous=this.history.get(side),obstacles=grip.forearmObstacles??[];
      const planes=[new THREE.Vector3(0,1,-slope),new THREE.Vector3(-sign,0,-wide),new THREE.Vector3(0,0,-1)].map(n=>n.normalize());
      const handPoints=['hand.','middle.01.','index.03.','thumb.03.','little.03.'].map(name=>hand.worldToLocal(this.bone(name+side).getWorldPosition(new THREE.Vector3())).applyMatrix4(handMatrix).sub(grip.center));
      const candidate=(swivel:number,bend:number)=>{
        const turn=new THREE.Quaternion().setFromAxisAngle(axis,swivel);
        const wrist=wristOffset.clone().applyQuaternion(turn).add(grip.center);
        const foreRotation=turn.clone().multiply(neutralFore),foreDirection=y.clone().applyQuaternion(foreRotation);
        const elbow=wrist.clone().addScaledVector(foreDirection,-foreLength);
        const neutralUpper=foreRotation.clone().multiply(rest.clone().invert());
        const hinge=y.clone().cross(restDirection).normalize().applyQuaternion(neutralUpper);
        const upperRotation=neutralUpper.premultiply(new THREE.Quaternion().setFromAxisAngle(hinge,restBend-bend));
        const shoulder=elbow.clone().addScaledVector(y.clone().applyQuaternion(upperRotation),-upperLength);
        const localShoulder=shoulder.clone().applyMatrix4(inverseCamera),localElbow=elbow.clone().applyMatrix4(inverseCamera),localWrist=wrist.clone().applyMatrix4(inverseCamera);
        let eye=0,aim=0,collision=0;
        const clearance=(point:THREE.Vector3,radius:number)=>{
          eye=Math.max(eye,.12+radius-point.length());
          if(point.z<0)aim=Math.max(aim,Math.min(-point.z*slope*.13+radius-Math.abs(point.y),-point.z*wide*.13+radius-Math.abs(point.x)));
        };
        for(let i=0;i<=8;i++){
          const t=i/8,lower=localWrist.clone().lerp(localElbow,t),top=localElbow.clone().lerp(localShoulder,t);
          clearance(lower,THREE.MathUtils.lerp(.033,.052,t));clearance(top,THREE.MathUtils.lerp(.052,.12,t));
          for(const obstacle of obstacles){
            const low=wrist.clone().lerp(elbow,t).applyMatrix4(obstacle.inverse),high=elbow.clone().lerp(shoulder,t).applyMatrix4(obstacle.inverse);
            collision=Math.max(collision,THREE.MathUtils.lerp(.033,.052,t)-obstacle.bounds.distanceToPoint(low),THREE.MathUtils.lerp(.052,.078,t)-obstacle.bounds.distanceToPoint(high));
          }
        }
        for(let i=0;i<handPoints.length;i++)clearance(handPoints[i].clone().applyQuaternion(turn).add(grip.center).applyMatrix4(inverseCamera),i<2?.035:.018);
        const exposed=Math.max(0,Math.min(...planes.map(n=>n.dot(localShoulder)+.15)));
        const crossed=Math.max(0,.04-sign*localShoulder.x,.025-sign*(localElbow.x-localWrist.x)),raised=Math.max(0,localElbow.y-localWrist.y-.015);
        const continuity=previous?2000*(localShoulder.distanceToSquared(previous.shoulder)+localElbow.distanceToSquared(previous.elbow)+localWrist.distanceToSquared(previous.wrist)):0;
        const score=1e8*(eye**2+Math.max(0,aim)**2)+1e7*collision**2+1e6*exposed**2+1e5*(crossed**2+raised**2)+continuity+.02*swivel**2+.01*(bend-1)**2;
        return {swivel,bend,score,turn,wrist,elbow,shoulder,foreRotation,upperRotation,localShoulder,localElbow,localWrist};
      };
      let chosen=candidate(previous?.swivel??0,previous?.bend??1);
      const limit=Math.min(.05,dt)*8;
      if(previous){
        for(const swivel of [previous.swivel-limit,previous.swivel,previous.swivel+limit])for(const bend of [previous.bend-limit,previous.bend,previous.bend+limit]){
          if(bend<.08||bend>2.62)continue;const pose=candidate(swivel,bend);if(pose.score<chosen.score)chosen=pose;
        }
      }else for(let swivel=-Math.PI;swivel<Math.PI;swivel+=Math.PI/4)for(let bend=.15;bend<2.62;bend+=.45){const pose=candidate(swivel,bend);if(pose.score<chosen.score)chosen=pose;}
      for(const step of [.2,.05,.0125]){
        const center=chosen;
        for(const swivel of [center.swivel-step,center.swivel,center.swivel+step])for(const bend of [center.bend-step,center.bend,center.bend+step]){
          if(bend<.08||bend>2.62)continue;
          if(previous&&(Math.abs(swivel-previous.swivel)>limit||Math.abs(bend-previous.bend)>limit))continue;
          const pose=candidate(swivel,bend);if(pose.score<chosen.score)chosen=pose;
        }
      }
      this.history.set(side,{shoulder:chosen.localShoulder,elbow:chosen.localElbow,wrist:chosen.localWrist,swivel:chosen.swivel,bend:chosen.bend});
      this.pose.set(side,{length:upperLength,foreLength,bend:chosen.bend,score:chosen.score});
      upper.position.copy(upper.parent!.worldToLocal(chosen.shoulder.clone()));
      upper.quaternion.copy(upper.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(chosen.upperRotation));
      upper.updateWorldMatrix(false,true);
      fore.matrixAutoUpdate=false;
      fore.matrix.copy(upper.matrixWorld).invert().multiply(new THREE.Matrix4().compose(chosen.elbow,chosen.foreRotation,foreScale));
      fore.updateMatrixWorld(true);
      const turnMatrix=new THREE.Matrix4().makeTranslation(grip.center.x,grip.center.y,grip.center.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(chosen.turn)).multiply(new THREE.Matrix4().makeTranslation(-grip.center.x,-grip.center.y,-grip.center.z));
      this.gripTransforms.set(side,turnMatrix);
      hand.matrixAutoUpdate=false;hand.matrix.copy(fore.matrixWorld).invert().multiply(turnMatrix.clone().multiply(handMatrix));
      hand.updateMatrixWorld(true);
    }
    this.skeleton.update();
  }
  private bone(name:string):THREE.Bone{return (this.bones.get(name)??this.bones.get(name.replaceAll('.','')))!;}
}
