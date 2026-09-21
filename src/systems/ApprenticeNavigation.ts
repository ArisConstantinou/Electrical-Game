import type { PlayerObstacle } from '../player/EquipmentCollision';
export interface FloorPoint {x:number;z:number}
export function apprenticePath(start:FloorPoint,end:FloorPoint,obstacles:readonly PlayerObstacle[]):FloorPoint[]|null {
  const cell=.16,minX=-3.36,minZ=-1.92,nx=43,nz=33,radius=.29;
  const point=(i:number):FloorPoint=>({x:minX+(i%nx)*cell,z:minZ+Math.floor(i/nx)*cell});
  const index=(p:FloorPoint)=>Math.round((p.z-minZ)/cell)*nx+Math.round((p.x-minX)/cell);
  const free=(p:FloorPoint)=>p.x>=minX&&p.x<=3.36&&p.z>=minZ&&p.z<=3.2&&!obstacles.some(o=>p.x>o.minX-radius&&p.x<o.maxX+radius&&p.z>o.minZ-radius&&p.z<o.maxZ+radius);
  if(!free(end))return null;
  const source=index(start),goal=index(end),parents=new Int32Array(nx*nz).fill(-1),queue=[source];parents[source]=source;
  for(let cursor=0;cursor<queue.length;cursor++){
    const current=queue[cursor];if(current===goal)break;
    for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
      const x=current%nx+dx,z=Math.floor(current/nx)+dz;if(x<0||x>=nx||z<0||z>=nz)continue;
      const next=z*nx+x;if(parents[next]!==-1||!free(point(next)))continue;
      parents[next]=current;queue.push(next);
    }
  }
  if(parents[goal]===-1)return null;
  const result:FloorPoint[]=[end];for(let i=goal;i!==source;i=parents[i])result.unshift(point(i));
  return result;
}
