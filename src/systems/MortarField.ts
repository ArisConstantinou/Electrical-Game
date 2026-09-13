import * as THREE from 'three';

interface Node { x: number; y: number; z: number; value: number; age: number; dilution: number }
export interface MortarFieldChunk { key: string; geometry: THREE.BufferGeometry; mass: number; age: number; dilution: number }
export interface MortarFillProfile {frontZ:number;supportZ:(x:number,y:number)=>number|null}
export interface FieldContact { point: THREE.Vector3; normal: THREE.Vector3; distance: number }
const CORNERS = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const TETRA = [[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
const LEVEL = .35;
const CHUNK = 16;
const FRESH_SECONDS = 3600;

/** Sparse, fixed-world wet-mortar volume. The field stores material quantity;
 * marching tetrahedra emits ONE union skin per spatial chunk, never one shell
 * per throw. 8 mm resolution and rheology are game approximations. */
export class MortarField {
  readonly spacing = .008;
  readonly density = 1900;
  readonly nodes = new Map<string, Node>();
  readonly dirty = new Set<string>();
  readonly maxNodes = 180000;
  revision = 0;
  private readonly chunkNodes = new Map<string, Set<string>>();
  private key(x: number, y: number, z: number): string { return `${x},${y},${z}`; }
  private chunkKey(x: number, y: number, z: number): string { return this.key(Math.floor(x / CHUNK), Math.floor(y / CHUNK), Math.floor(z / CHUNK)); }
  get nodeMass(): number { return this.spacing ** 3 * this.density; }
  get mass(): number { let sum = 0; for (const node of this.nodes.values()) sum += node.value * this.nodeMass; return sum; }
  private at(x: number, y: number, z: number): number { return this.nodes.get(this.key(x,y,z))?.value ?? 0; }
  private changed(node: Node): void {
    for (let x=-1;x<=0;x++) for(let y=-1;y<=0;y++) for(let z=-1;z<=0;z++) this.dirty.add(this.chunkKey(node.x+x,node.y+y,node.z+z));
  }
  private set(x: number,y: number,z: number,value: number,age: number,dilution=0): void {
    const key=this.key(x,y,z), old=this.nodes.get(key);
    if(value<1e-7){ if(old){this.changed(old);this.nodes.delete(key);this.chunkNodes.get(this.chunkKey(x,y,z))?.delete(key);} return; }
    const node:Node={x,y,z,value:Math.min(1,value),age,dilution}; this.nodes.set(key,node);this.changed(node);
    const chunk=this.chunkKey(x,y,z);let entries=this.chunkNodes.get(chunk);if(!entries){entries=new Set();this.chunkNodes.set(chunk,entries);}entries.add(key);
  }
  sample(point: THREE.Vector3): number {
    const h=this.spacing,x=point.x/h,y=point.y/h,z=point.z/h,ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),tx=x-ix,ty=y-iy,tz=z-iz;
    // Use the same six linear tetrahedra as the mesh, so field collision cannot
    // occupy a curved trilinear surface that the visible skin does not contain.
    const axes=[{v:tx,dx:1,dy:0,dz:0},{v:ty,dx:0,dy:1,dz:0},{v:tz,dx:0,dy:0,dz:1}].sort((a,b)=>b.v-a.v);
    const [a,b,c]=axes;
    return this.at(ix,iy,iz)*(1-a.v)+this.at(ix+a.dx,iy+a.dy,iz+a.dz)*(a.v-b.v)+this.at(ix+a.dx+b.dx,iy+a.dy+b.dy,iz+a.dz+b.dz)*(b.v-c.v)+this.at(ix+1,iy+1,iz+1)*c.v;
  }
  normal(point: THREE.Vector3): THREE.Vector3 {
    const h=this.spacing*.6,d=new THREE.Vector3();
    for(const axis of ['x','y','z'] as const){const a=point.clone(),b=point.clone();a[axis]-=h;b[axis]+=h;d[axis]=this.sample(a)-this.sample(b);}
    return d.lengthSq()>1e-12?d.normalize():new THREE.Vector3(0,0,1);
  }
  stateAt(point:THREE.Vector3):{age:number;dilution:number;value:number} {
    const x=Math.round(point.x/this.spacing),y=Math.round(point.y/this.spacing),z=Math.round(point.z/this.spacing);
    let weight=0,age=0,dilution=0,value=0;
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++){
      const node=this.nodes.get(this.key(x+dx,y+dy,z+dz));if(!node)continue;
      const w=node.value/(1+dx*dx+dy*dy+dz*dz);weight+=w;age+=node.age*w;dilution+=node.dilution*w;value=Math.max(value,node.value);
    }
    return{age:weight?age/weight:Infinity,dilution:weight?dilution/weight:0,value};
  }
  raycast(origin:THREE.Vector3,direction:THREE.Vector3,maxDistance:number):FieldContact|null {
    if(!this.nodes.size)return null;
    const step=this.spacing*.5,point=new THREE.Vector3();let previous=0;
    for(let index=0;index<=Math.ceil(maxDistance/step);index++){
      const distance=Math.min(index*step,maxDistance);point.copy(origin).addScaledVector(direction,distance);
      if(this.sample(point)>=LEVEL){let a=previous,b=distance;for(let i=0;i<7;i++){const middle=(a+b)*.5;if(this.sample(point.copy(origin).addScaledVector(direction,middle))>=LEVEL)b=middle;else a=middle;}point.copy(origin).addScaledVector(direction,b);return{point:point.clone(),normal:this.normal(point),distance:b};}
      previous=distance;
    }
    return null;
  }

  add(point:THREE.Vector3,normal:THREE.Vector3,mass:number,blocked:(point:THREE.Vector3)=>boolean,profile?:MortarFillProfile,footprintMass=mass):number {
    if(mass<this.nodeMass*5||this.nodes.size>=this.maxNodes)return 0;
    const axis=normal.clone().normalize(),radius=Math.max(.012,Math.cbrt(footprintMass/.65)*.084);
    const depth=THREE.MathUtils.clamp(mass/this.density/(Math.PI*radius*radius)*2.5,.018,.075);
    const center=point.clone().addScaledVector(axis,depth*.3),reach=Math.max(radius,depth),h=this.spacing;
    const candidates:Array<{x:number;y:number;z:number;weight:number;old:number;age:number;dilution:number}>=[];
    const min=[Math.floor((center.x-reach)/h),Math.floor((center.y-reach)/h),Math.floor((center.z-reach)/h)];
    const max=[Math.ceil((center.x+reach)/h),Math.ceil((center.y+reach)/h),Math.ceil((center.z+reach)/h)];
    if(profile){min[2]=Math.floor((profile.frontZ-.20)/h);max[2]=Math.floor((profile.frontZ+.004)/h);}
    const columns=new Map<string,number|null>();
    const q=new THREE.Vector3(),delta=new THREE.Vector3();
    for(let x=min[0];x<=max[0];x++)for(let y=min[1];y<=max[1];y++)for(let z=min[2];z<=max[2];z++){
      q.set(x*h,y*h,z*h);let weight:number;
      if(profile){
        const metric=((q.x-point.x)**2+(q.y-point.y)**2)/(radius*radius);if(metric>=1)continue;
        const key=this.key(x,y,0);let back=columns.get(key);if(back===undefined){back=profile.supportZ(q.x,q.y);columns.set(key,back);}
        // Only the first exposed surviving wall surface backs a column. Sealed
        // chambers behind an intact clay shell cannot receive remote mortar.
        if(back===null||q.z<back||q.z>profile.frontZ+.004||blocked(q))continue;
        const fillDepth=Math.max(0,q.z-back);
        const cavityPriority=profile.frontZ-back>.012?8:.08;
        weight=(.25+.75*(1-metric)**.8)*Math.exp(-fillDepth/.032)*cavityPriority;
      }else{
        delta.copy(q).sub(center);const axial=delta.dot(axis),radial=Math.max(0,delta.lengthSq()-axial*axial),metric=radial/(radius*radius)+axial*axial/(depth*depth);
        if(metric>=1||blocked(q))continue;weight=(1-metric)**1.4;
      }
      const old=this.nodes.get(this.key(x,y,z));if((old?.value??0)>.9999)continue;
      candidates.push({x,y,z,weight,old:old?.value??0,age:old?.age??0,dilution:old?.dilution??0});
    }
    if(!candidates.length)return 0;
    const target=mass/this.nodeMass;
    const volume=(scale:number):number=>{let added=0;for(const c of candidates)added+=Math.max(0,Math.min(1,c.weight*scale)-c.old);return added;};
    let low=0,high=128;for(let i=0;i<22;i++){const middle=(low+high)*.5;if(volume(middle)>target)high=middle;else low=middle;}
    let added=0;
    for(const c of candidates){const value=Math.max(c.old,Math.min(1,c.weight*low)),increment=value-c.old;if(increment<1e-8)continue;if(!this.nodes.has(this.key(c.x,c.y,c.z))&&this.nodes.size>=this.maxNodes)break;
      added+=increment;this.set(c.x,c.y,c.z,value,c.age*c.old/value,c.dilution*c.old/value);
    }
    // Collect diffuse tails with no visible skin. Repeated small retained
    // quantities must build a cohesive seed instead of being discarded forever.
    let unresolved=0;
    for(const c of candidates){const node=this.nodes.get(this.key(c.x,c.y,c.z));if(!node||node.value>=LEVEL)continue;
      let visible=false;for(let dx=-1;dx<=1&&!visible;dx++)for(let dy=-1;dy<=1&&!visible;dy++)for(let dz=-1;dz<=1;dz++)if(this.at(c.x+dx,c.y+dy,c.z+dz)>=LEVEL){visible=true;break;}
      if(!visible){const increment=Math.max(0,node.value-c.old);unresolved+=increment;this.set(c.x,c.y,c.z,c.old,c.age,c.dilution);}
    }
    let recovered=0;
    if(unresolved>0){
      // The strongest available profile cells are nearest the backed core.
      // Compact rejected tails there, conserving the same finite quantity.
      candidates.sort((a,b)=>b.weight-a.weight);
      for(const c of candidates){
        const node=this.nodes.get(this.key(c.x,c.y,c.z)),old=node?.value??0;
        const increment=Math.min(unresolved-recovered,1-old);if(increment<1e-8)continue;
        if(!node&&this.nodes.size>=this.maxNodes)break;
        const value=old+increment;
        this.set(c.x,c.y,c.z,value,(node?.age??0)*old/value,(node?.dilution??0)*old/value);
        recovered+=increment;if(recovered>=unresolved-1e-8)break;
      }
    }
    if(added>0)this.revision++;return (added-unresolved+recovered)*this.nodeMass;
  }

  tick(dt:number):void {for(const node of this.nodes.values()){node.age+=dt;node.dilution=Math.max(0,node.dilution-dt*.006);}}
  invalidateGeometry():void {for(const node of this.nodes.values())this.changed(node);}

  /** Water lowers fresh cohesion and physically removes local material. The
   * returned kg must be transferred to moving slurry by the caller. */
  wash(point:THREE.Vector3,litres:number,radius=.055):{removedKg:number;affectedKg:number} {
    const candidates:Array<{node:Node;weight:number;fresh:number}>=[];let totalWeight=0,affected=0;
    for(const node of this.nodes.values()){
      const distance=Math.hypot(node.x*this.spacing-point.x,node.y*this.spacing-point.y,node.z*this.spacing-point.z);
      if(distance>radius||node.age>=FRESH_SECONDS)continue;const fresh=Math.max(0,1-node.age/FRESH_SECONDS),weight=(1-distance/radius)*node.value*fresh;
      candidates.push({node,weight,fresh});totalWeight+=weight;affected+=node.value*this.nodeMass;
    }
    if(totalWeight<1e-9)return{removedKg:0,affectedKg:0};
    let removed=0;
    for(const{node,weight,fresh}of candidates){const share=litres*weight/totalWeight;node.dilution=Math.min(2,node.dilution+share/(node.value*this.nodeMass+.0001)*2);
      const loss=Math.min(node.value*this.nodeMass,share*(.25+node.dilution*.65)*fresh);removed+=loss;
      this.set(node.x,node.y,node.z,node.value-loss/this.nodeMass,node.age,node.dilution);
    }
    if(removed>0)this.revision++;return{removedKg:removed,affectedKg:affected};
  }

  /** Remove material occupying moved box openings; quantity is counted at the
   * same fixed nodes as deposition, independent of remesh triangle counts. */
  removeWhere(blocked:(point:THREE.Vector3)=>boolean,freshOnly=false):number {
    let removed=0;const point=new THREE.Vector3();
    for(const node of [...this.nodes.values()])if((!freshOnly||node.age<FRESH_SECONDS)&&blocked(point.set(node.x*this.spacing,node.y*this.spacing,node.z*this.spacing))){removed+=node.value*this.nodeMass;this.set(node.x,node.y,node.z,0,node.age);}
    if(removed>0)this.revision++;return removed;
  }

  /** Connected wet volume must still touch masonry. Removing its support or
   * washing through its neck releases the entire detached coherent piece.
   * Sub-isosurface tails belong only to an adjacent visible component. */
  releaseUnsupported(solid:(point:THREE.Vector3)=>boolean):{mass:number;point:THREE.Vector3} {
    const visited=new Set<string>(),supported=new Set<string>(),q=new THREE.Vector3(),h=this.spacing;
    for(const [key,node] of this.nodes){if(node.value<LEVEL||visited.has(key))continue;
      const members:Node[]=[node];visited.add(key);let anchored=false;
      for(let i=0;i<members.length;i++){
        const n=members[i];
        if(!anchored)for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])if(solid(q.set((n.x+dx*1.6)*h,(n.y+dy*1.6)*h,(n.z+dz*1.6)*h))){anchored=true;break;}
        for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++){
          const k=this.key(n.x+dx,n.y+dy,n.z+dz),other=this.nodes.get(k);if(!visited.has(k)&&other&&other.value>=LEVEL){visited.add(k);members.push(other);}
        }
      }
      if(anchored)for(const member of members)supported.add(this.key(member.x,member.y,member.z));
    }
    let mass=0;const center=new THREE.Vector3();
    for(const [key,node] of [...this.nodes]){
      let keep=supported.has(key);
      if(!keep&&node.value<LEVEL)for(let dx=-1;dx<=1&&!keep;dx++)for(let dy=-1;dy<=1&&!keep;dy++)for(let dz=-1;dz<=1;dz++)if(supported.has(this.key(node.x+dx,node.y+dy,node.z+dz))){keep=true;break;}
      if(!keep){const kg=node.value*this.nodeMass;mass+=kg;center.addScaledVector(q.set(node.x*h,node.y*h,node.z*h),kg);this.set(node.x,node.y,node.z,0,node.age);}
    }
    if(mass>0){center.multiplyScalar(1/mass);this.revision++;}return{mass,point:center};
  }

  remesh(clip:(triangle:THREE.Vector3[])=>THREE.Vector3[][]):MortarFieldChunk[] {
    const results:MortarFieldChunk[]=[];
    for(const key of this.dirty){
      const [cx,cy,cz]=key.split(',').map(Number),x0=cx*CHUNK,y0=cy*CHUNK,z0=cz*CHUNK,positions:number[]=[],normals:number[]=[];
      const cubes=new Set<string>();
      for(let dx=0;dx<=1;dx++)for(let dy=0;dy<=1;dy++)for(let dz=0;dz<=1;dz++){
        const entries=this.chunkNodes.get(this.key(cx+dx,cy+dy,cz+dz));if(!entries)continue;
        for(const entry of entries){const node=this.nodes.get(entry)!;if(node.value<LEVEL*.3)continue;
          for(let ox=-1;ox<=0;ox++)for(let oy=-1;oy<=0;oy++)for(let oz=-1;oz<=0;oz++){const x=node.x+ox,y=node.y+oy,z=node.z+oz;if(x>=x0&&x<x0+CHUNK&&y>=y0&&y<y0+CHUNK&&z>=z0&&z<z0+CHUNK)cubes.add(this.key(x,y,z));}
        }
      }
      const edge=(a:number,b:number,points:THREE.Vector3[],values:number[]):THREE.Vector3=>points[a].clone().lerp(points[b],(LEVEL-values[a])/(values[b]-values[a]));
      const emit=(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3):void=>{
        const center=a.clone().add(b).add(c).multiplyScalar(1/3),outward=this.normal(center);
        if(new THREE.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).dot(outward)<0)[b,c]=[c,b];
        for(const polygon of clip([a,b,c]))for(let i=1;i<polygon.length-1;i++){
          const aa=polygon[0],bb=polygon[i],cc=polygon[i+1];if(new THREE.Vector3().crossVectors(bb.clone().sub(aa),cc.clone().sub(aa)).lengthSq()<1e-18)continue;
          for(const p of [aa,bb,cc]){positions.push(p.x,p.y,p.z);const n=this.normal(p);normals.push(n.x,n.y,n.z);}
        }
      };
      for(const cube of cubes){const[x,y,z]=cube.split(',').map(Number),values=CORNERS.map(([dx,dy,dz])=>this.at(x+dx,y+dy,z+dz));if(values.every(v=>v<LEVEL)||values.every(v=>v>=LEVEL))continue;
        const points=CORNERS.map(([dx,dy,dz])=>new THREE.Vector3((x+dx)*this.spacing,(y+dy)*this.spacing,(z+dz)*this.spacing));
        for(const tetra of TETRA){const inside=tetra.filter(i=>values[i]>=LEVEL),outside=tetra.filter(i=>values[i]<LEVEL);if(!inside.length||!outside.length)continue;
          if(inside.length===1){const a=inside[0];emit(edge(a,outside[0],points,values),edge(a,outside[1],points,values),edge(a,outside[2],points,values));}
          else if(outside.length===1){const a=outside[0];emit(edge(a,inside[0],points,values),edge(a,inside[1],points,values),edge(a,inside[2],points,values));}
          else {const[a,b]=inside,[c,d]=outside,ac=edge(a,c,points,values),ad=edge(a,d,points,values),bc=edge(b,c,points,values),bd=edge(b,d,points,values);emit(ac,bc,bd);emit(ac,bd,ad);}
        }
      }
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.computeBoundingSphere();
      let mass=0,age=Infinity,dilution=0;for(const nodeKey of this.chunkNodes.get(key)??[]){const node=this.nodes.get(nodeKey)!;mass+=node.value*this.nodeMass;age=Math.min(age,node.age);dilution=Math.max(dilution,node.dilution);}
      results.push({key,geometry,mass,age:Number.isFinite(age)?age:0,dilution});
    }
    this.dirty.clear();return results;
  }

  get statistics(){return{nodes:this.nodes.size,chunks:this.chunkNodes.size,massKg:this.mass,resolutionMm:this.spacing*1000,freshWorkingSeconds:FRESH_SECONDS,revision:this.revision};}
}
