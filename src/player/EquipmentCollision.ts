import * as THREE from 'three';

export interface PlayerObstacle {
  id:string;
  minX:number;
  maxX:number;
  minZ:number;
  maxZ:number;
  /** Optional range of walkable floor heights for a multi-level site. */
  minFloorY?:number;
  maxFloorY?:number;
  /** World-space wall centreline samples; collision uses their real thickness, not the broad-phase AABB. */
  segments?:readonly { ax:number; az:number; bx:number; bz:number; halfWidth:number }[];
}

/** Resolve a circular player body against fixed equipment footprints on X/Z. */
export function resolveEquipmentCollisions(position:THREE.Vector3,radius:number,obstacles:readonly PlayerObstacle[]):string[] {
  const contacts=new Set<string>();
  for(let pass=0;pass<4;pass++){
    let moved=false;
    for(const obstacle of obstacles){
      if(obstacle.segments?.length){
        if(position.x<obstacle.minX-radius||position.x>obstacle.maxX+radius||
          position.z<obstacle.minZ-radius||position.z>obstacle.maxZ+radius)continue;
        let bestPenetration=0, pushX=0, pushZ=0;
        for(const segment of obstacle.segments){
          const vx=segment.bx-segment.ax,vz=segment.bz-segment.az;
          const lengthSq=vx*vx+vz*vz;
          const t=lengthSq>1e-10?THREE.MathUtils.clamp(((position.x-segment.ax)*vx+(position.z-segment.az)*vz)/lengthSq,0,1):0;
          const dx=position.x-(segment.ax+vx*t),dz=position.z-(segment.az+vz*t);
          const distance=Math.hypot(dx,dz),penetration=radius+segment.halfWidth-distance;
          if(penetration<=bestPenetration)continue;
          bestPenetration=penetration;
          if(distance>1e-5){pushX=dx/distance;pushZ=dz/distance;}
          else{const length=Math.sqrt(lengthSq)||1;pushX=-vz/length;pushZ=vx/length;}
        }
        if(bestPenetration>0){
          position.x+=pushX*bestPenetration;position.z+=pushZ*bestPenetration;
          contacts.add(obstacle.id);moved=true;
        }
        continue;
      }
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
