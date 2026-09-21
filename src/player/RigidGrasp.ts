import * as THREE from 'three';

export interface GraspArm {
  shoulder:THREE.Vector3;
  upperLength:number;
  handSign?:number;
  /** Preserve the calibrated hand/object orientation; solve arm placement only. */
  lockRotation?:boolean;
  screenRegion?:{minX:number;maxX:number;minY?:number;maxY?:number};
  screenObstacles?:THREE.Box2[];
  elbow:THREE.Vector3;
  wrist:THREE.Vector3;
}
export interface GraspHistory {rotation:THREE.Quaternion;swivel:THREE.Quaternion}

/** Fit a calibrated forearm/hand/tool unit to its shoulder, the camera and
 * nearby work surfaces. The wrist and finger joints are not optimization variables. */
export function solveRigidGrasp(
  center:THREE.Vector3,rotation:THREE.Quaternion,arm:GraspArm,camera:THREE.PerspectiveCamera,
  corners:THREE.Vector3[],frontForBounds?:(bounds:THREE.Box3)=>number|null,history?:GraspHistory,
):{center:THREE.Vector3;rotation:THREE.Quaternion;swivel:THREE.Quaternion;error:number} {
  const inverseCamera=camera.matrixWorld.clone().invert();
  const cameraQ=camera.getWorldQuaternion(new THREE.Quaternion()),cameraInverse=cameraQ.clone().invert();
  const previousQ=history?cameraQ.clone().multiply(history.rotation):null;
  const previousSwivel=history?cameraQ.clone().multiply(history.swivel).multiply(cameraInverse):null;
  const forward=new THREE.Vector3(0,0,-1).applyQuaternion(cameraQ);
  const right=new THREE.Vector3(1,0,0).applyQuaternion(cameraQ);right.y=0;right.normalize();
  const lift=THREE.MathUtils.smoothstep(forward.y,.25,.9);
  const preferredUpper=forward.clone();preferredUpper.y=-.85+lift*1.5;preferredUpper.addScaledVector(right,.18*(arm.handSign??1)).normalize();
  const evaluate=(q:THREE.Quaternion,swivel=new THREE.Quaternion())=>{
    const sphereCenter=arm.shoulder.clone().sub(arm.elbow.clone().applyQuaternion(q));
    const p=center.clone().sub(sphereCenter).applyQuaternion(swivel).setLength(arm.upperLength).add(sphereCenter);
    const wrist=arm.wrist.clone().applyQuaternion(q).add(p),view=wrist.clone().applyMatrix4(inverseCamera),ndc=wrist.clone().project(camera);
    const overflow=Math.max(0,Math.abs(ndc.x)-.82,Math.abs(ndc.y)-.82);
    let violation=overflow*overflow+Math.max(0,.20+view.z)**2*100;
    const points=corners.map(c=>c.clone().applyQuaternion(q).add(p));
    if(arm.handSign!==undefined)for(const point of points){
      const projected=point.clone().project(camera),view=point.clone().applyMatrix4(inverseCamera);
      violation+=Math.max(0,(arm.screenRegion?.minX??-.90)-projected.x,projected.x-(arm.screenRegion?.maxX??.90),(arm.screenRegion?.minY??-.90)-projected.y,projected.y-(arm.screenRegion?.maxY??.90))**2*(arm.screenRegion?40:1)+Math.max(0,.15+view.z)**2*100;
    }
    if(arm.screenObstacles?.length){
      const screen=new THREE.Box2().setFromPoints(points.map(point=>{const p=point.clone().project(camera);return new THREE.Vector2(p.x,p.y);}));
      for(const obstacle of arm.screenObstacles){
        const penetration=Math.min(screen.max.x-obstacle.min.x,obstacle.max.x-screen.min.x,screen.max.y-obstacle.min.y,obstacle.max.y-screen.min.y);
        if(penetration>0)violation+=penetration*penetration*100;
      }
    }
    const bounds=new THREE.Box3().setFromPoints(points);
    const front=frontForBounds?.(bounds);
    if(front!=null)violation+=Math.max(0,front+.004-bounds.min.z)**2*100;
    const upper=arm.elbow.clone().applyQuaternion(q).add(p).sub(arm.shoulder).normalize();
    // A visible, connected wrist alone is not a valid arm: keep the elbow
    // below the shoulder at level aim, on its own side, and out of the chest.
    const anatomy=Math.max(0,upper.y-(-.12+lift*.95))**2+Math.max(0,-.12-upper.dot(right)*(arm.handSign??1))**2;
    const angle=rotation.angleTo(q),continuity=previousQ?previousQ.angleTo(q)**2*.02+previousSwivel!.angleTo(swivel)**2*.004:0;
    const score=violation+anatomy*.5+upper.distanceToSquared(preferredUpper)*.002+angle*angle*.0003+p.distanceToSquared(center)*.001+continuity;
    return{center:p,rotation:q,swivel,error:violation,score};
  };
  let best=evaluate(rotation.clone());
  if(previousQ){const prior=evaluate(arm.lockRotation?rotation:previousQ,previousSwivel!);if(prior.score<best.score)best=prior;}
  const axes=[new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)].map(v=>v.applyQuaternion(cameraQ));
  for(const step of [.6,.3,.15,.075,.0375,.01875])for(let pass=0;pass<3;pass++)for(const axis of axes){
    const base=best.rotation;
    if(!arm.lockRotation)for(const sign of [-1,1]){
      const candidate=evaluate(new THREE.Quaternion().setFromAxisAngle(axis,sign*step).multiply(base),best.swivel);
      if(candidate.score<best.score)best=candidate;
    }
    const swivel=best.swivel;
    for(const sign of [-1,1]){
      const candidate=evaluate(best.rotation,new THREE.Quaternion().setFromAxisAngle(axis,sign*step).multiply(swivel));
      if(candidate.score<best.score)best=candidate;
    }
  }
  if(previousQ&&previousSwivel){
    // The optimizer can switch between two similarly scored arm poses when
    // the camera height crosses a crouch boundary. Keep the rigid grasp exact,
    // but bound the per-frame orientation change so the elbow/forearm follows
    // the new solution instead of snapping to it in one frame.
    const maxAngularStep=THREE.MathUtils.degToRad(12);
    const continuousRotation=arm.lockRotation?rotation.clone():previousQ.clone().rotateTowards(best.rotation,maxAngularStep);
    const continuousSwivel=previousSwivel.clone().rotateTowards(best.swivel,maxAngularStep);
    best=evaluate(continuousRotation,continuousSwivel);
  }
  return best;
}
