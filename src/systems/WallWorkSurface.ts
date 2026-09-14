import * as THREE from 'three';
import type {BrickWall} from '../world/BrickWall';

export interface WallWorkSurface {
  point:THREE.Vector3;
  normal:THREE.Vector3;
  stable:boolean;
}

const raycaster=new THREE.Raycaster();
const centre=new THREE.Vector2();
const normalMatrix=new THREE.Matrix3();

/** Closest vertical work surface: real masonry or explicitly registered solid room walls. */
export function queryWallWorkSurface(camera:THREE.Camera,wall:BrickWall,stableWalls:THREE.Object3D[]=[],maxDistance=2.35):WallWorkSurface|null {
  camera.updateWorldMatrix(true,false);
  raycaster.setFromCamera(centre,camera);raycaster.near=0;raycaster.far=maxDistance;
  const brick=wall.aim(camera,maxDistance);
  let result:WallWorkSurface|null=null;
  let distance=maxDistance;
  if(brick){
    const candidateDistance=brick.point.distanceTo(raycaster.ray.origin);
    if(candidateDistance<=distance){distance=candidateDistance;result={point:brick.point.clone(),normal:new THREE.Vector3(0,0,1),stable:false};}
  }
  for(const object of stableWalls)object.updateWorldMatrix(true,true);
  for(const hit of raycaster.intersectObjects(stableWalls,true)){
    if(hit.distance>distance)break;
    if(!hit.face||!hit.object.visible)continue;
    const normal=hit.face.normal.clone().applyNormalMatrix(normalMatrix.getNormalMatrix(hit.object.matrixWorld));
    if(Math.abs(normal.y)>=.1)continue;
    // A horizontal frame stays floor referenced even with tiny modelling tolerances.
    normal.y=0;normal.normalize();
    if(normal.dot(raycaster.ray.direction)>0)normal.negate();
    result={point:hit.point.clone(),normal,stable:true};distance=hit.distance;break;
  }
  return result;
}
