import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { WorkerGripTarget } from './WorkerArm';

/** Camera presentation of the authored arms. The world rig owns contacts and shadows. */
export class FirstPersonWorkerArms extends THREE.Group {
  private readonly pairs:{source:THREE.Bone;view:THREE.Bone}[]=[];
  private readonly bones=new Map<string,THREE.Bone>();
  private readonly skeleton:THREE.Skeleton;
  private readonly forearmRest=new Map<string,THREE.Quaternion>();

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
    for(const side of ['L','R'])this.forearmRest.set(side,this.bone('forearm.'+side).quaternion.clone().normalize());
  }

  update(camera:THREE.PerspectiveCamera,obstacles:NonNullable<WorkerGripTarget['forearmObstacles']>=[]):void {
    for(const {source,view}of this.pairs){view.matrixAutoUpdate=true;view.position.copy(source.position);view.quaternion.copy(source.quaternion);view.scale.copy(source.scale);}
    this.updateMatrixWorld(true);
    for(const side of ['L','R']){
      const upper=this.bone('upper_arm.'+side),fore=this.bone('forearm.'+side);
      const shoulder=upper.getWorldPosition(new THREE.Vector3()),elbow=fore.getWorldPosition(new THREE.Vector3());
      const foreMatrix=fore.matrixWorld.clone(),foreRotation=fore.getWorldQuaternion(new THREE.Quaternion()).normalize();
      const rest=this.forearmRest.get(side)!,y=new THREE.Vector3(0,1,0);
      // Reconstruct the upper arm from the forearm's authored bend plane.
      // A shoulder swing with a frozen forearm twists the shared elbow skin.
      const neutralRotation=foreRotation.clone().multiply(rest.clone().invert());
      const restDirection=y.clone().applyQuaternion(rest);
      const hinge=y.clone().cross(restDirection).normalize().applyQuaternion(neutralRotation);
      const localElbow=camera.worldToLocal(elbow.clone());
      const cameraInverse=camera.getWorldQuaternion(new THREE.Quaternion()).invert();
      const slope=Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()*.5)),wide=slope*camera.aspect;
      const planes=[new THREE.Vector3(0,1,-slope),new THREE.Vector3(0,-1,-slope),new THREE.Vector3(1,0,-wide),new THREE.Vector3(-1,0,-wide),new THREE.Vector3(0,0,-1)].map(n=>n.normalize());
      const originalLength=shoulder.distanceTo(elbow);
      const presentation=(bend:number)=>{
        const rotation=neutralRotation.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(hinge,y.angleTo(restDirection)-bend));
        const direction=y.clone().applyQuaternion(rotation).normalize(),localDirection=direction.clone().applyQuaternion(cameraInverse);
        let clearance=Infinity;
        // Continue the arm to the nearest edge of the view. The endpoint margin
        // includes sleeve thickness, so there is no exposed shoulder opening.
        for(const normal of planes){
          const speed=normal.dot(localDirection);
          if(speed>1e-5)clearance=Math.min(clearance,Math.max(0,(normal.dot(localElbow)+.15)/speed));
        }
        const length=Math.max(originalLength,Number.isFinite(clearance)?clearance:originalLength);
        const newShoulder=elbow.clone().addScaledVector(direction,-length);
        let penetration=0;const point=new THREE.Vector3();
        for(const obstacle of obstacles)for(let i=0;i<=12;i++){
          const t=i/12;point.copy(elbow).lerp(newShoulder,t).applyMatrix4(obstacle.inverse);
          penetration=Math.max(penetration,THREE.MathUtils.lerp(.047,.077,t)-obstacle.bounds.distanceToPoint(point));
        }
        return {rotation,length,newShoulder,penetration};
      };
      let chosen=presentation(.26);
      // The support upper arm can pass under the battery during side work.
      // Bend only in its authored hinge plane; keep the forearm and hand fixed.
      if(chosen.penetration>0){
        let previous=.26;
        for(let bend=.36;bend<=1.57;bend+=.1){
          const candidate=presentation(bend);
          if(candidate.penetration<chosen.penetration)chosen=candidate;
          if(candidate.penetration<=0){
            let low=previous,high=bend;
            for(let i=0;i<7;i++){const mid=(low+high)/2,probe=presentation(mid);if(probe.penetration>0)low=mid;else {high=mid;chosen=probe;}}
            break;
          }
          previous=bend;
        }
      }
      const {rotation,length,newShoulder}=chosen;
      upper.position.copy(upper.parent!.worldToLocal(newShoulder));
      upper.quaternion.copy(upper.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
      // Both skin influences must map the bind-pose elbow to the same point.
      // Moving only the child bone left a gap/overlap and pinched the skin.
      upper.scale.y*=length/originalLength;
      upper.updateWorldMatrix(false,true);
      // An exact affine compensation prevents the upper-arm scale from
      // stretching/shearing the forearm, gloves or calibrated finger contacts.
      fore.matrixAutoUpdate=false;
      fore.matrix.copy(upper.matrixWorld).invert().multiply(foreMatrix);
      fore.updateMatrixWorld(true);
    }
    this.skeleton.update();
  }
  private bone(name:string):THREE.Bone{return (this.bones.get(name)??this.bones.get(name.replaceAll('.','')))!;}
}
