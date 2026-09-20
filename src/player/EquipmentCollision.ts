import * as THREE from 'three';

export interface PlayerObstacle {
  id:string;
  minX:number;
  maxX:number;
  minZ:number;
  maxZ:number;
}

/** Resolve a circular player body against fixed equipment footprints on X/Z. */
export function resolveEquipmentCollisions(position:THREE.Vector3,radius:number,obstacles:readonly PlayerObstacle[]):string[] {
  const contacts=new Set<string>();
  for(let pass=0;pass<4;pass++){
    let moved=false;
    for(const obstacle of obstacles){
      const closestX=THREE.MathUtils.clamp(position.x,obstacle.minX,obstacle.maxX);
      const closestZ=THREE.MathUtils.clamp(position.z,obstacle.minZ,obstacle.maxZ);
      const dx=position.x-closestX,dz=position.z-closestZ,distanceSq=dx*dx+dz*dz;
      if(distanceSq>=radius*radius)continue;
      contacts.add(obstacle.id);moved=true;
      if(distanceSq>1e-10){
        const distance=Math.sqrt(distanceSq),push=(radius-distance)/distance;
        position.x+=dx*push;position.z+=dz*push;continue;
      }
      // The centre is inside the footprint. Leave through the nearest expanded
      // face; deterministic ordering prevents jitter in corners and overlaps.
      const faces=[
        {distance:Math.abs(position.x-(obstacle.minX-radius)),axis:'x' as const,value:obstacle.minX-radius},
        {distance:Math.abs(position.x-(obstacle.maxX+radius)),axis:'x' as const,value:obstacle.maxX+radius},
        {distance:Math.abs(position.z-(obstacle.minZ-radius)),axis:'z' as const,value:obstacle.minZ-radius},
        {distance:Math.abs(position.z-(obstacle.maxZ+radius)),axis:'z' as const,value:obstacle.maxZ+radius},
      ].sort((a,b)=>a.distance-b.distance);
      if(faces[0].axis==='x')position.x=faces[0].value;else position.z=faces[0].value;
    }
    if(!moved)break;
  }
  return [...contacts];
}
