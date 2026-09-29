import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

/** Camera presentation of the authored arms. The world rig owns contacts and shadows. */
export class FirstPersonWorkerArms extends THREE.Group {
  private readonly pairs:{source:THREE.Bone;view:THREE.Bone}[]=[];
  private readonly bones=new Map<string,THREE.Bone>();
  private readonly skeleton:THREE.Skeleton;

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
  }

  update(camera:THREE.PerspectiveCamera):void {
    for(const {source,view}of this.pairs){view.position.copy(source.position);view.quaternion.copy(source.quaternion);view.scale.copy(source.scale);}
    this.updateMatrixWorld(true);
    for(const side of ['L','R']){
      const upper=this.bone('upper_arm.'+side),fore=this.bone('forearm.'+side);
      const shoulder=upper.getWorldPosition(new THREE.Vector3()),elbow=fore.getWorldPosition(new THREE.Vector3());
      const foreRotation=fore.getWorldQuaternion(new THREE.Quaternion()),upperRotation=upper.getWorldQuaternion(new THREE.Quaternion());
      // Put the sleeve opening just beyond the lower view plane. A fixed
      // camera anchor unnecessarily elongates the upper arm on steep views.
      const newShoulder=camera.worldToLocal(elbow.clone());
      const slope=Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()*.5));
      const drop=Math.max(shoulder.distanceTo(elbow)*.7,(newShoulder.y-slope*newShoulder.z+.18)/(1+slope*slope));
      newShoulder.x=side==='R'?.30:-.30;
      newShoulder.y-=drop;newShoulder.z+=drop*slope;
      camera.localToWorld(newShoulder);
      const rotation=new THREE.Quaternion().setFromUnitVectors(elbow.clone().sub(shoulder).normalize(),elbow.clone().sub(newShoulder).normalize()).multiply(upperRotation);
      upper.position.copy(upper.parent!.worldToLocal(newShoulder));
      upper.quaternion.copy(upper.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
      upper.updateWorldMatrix(false,true);
      // Keep the complete forearm, wrist and finger pose at its physical grip.
      fore.position.copy(fore.parent!.worldToLocal(elbow));
      fore.quaternion.copy(fore.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(foreRotation));
      fore.updateWorldMatrix(false,true);
    }
    this.skeleton.update();
  }
  private bone(name:string):THREE.Bone{return (this.bones.get(name)??this.bones.get(name.replaceAll('.','')))!;}
}
