import * as THREE from 'three';

interface Node { x: number; y: number; z: number; value: number; age: number; dilution: number }
export interface MortarFieldChunk { key: string; geometry: THREE.BufferGeometry; mass: number; age: number; dilution: number }
export interface MortarImpactFootprint {majorScale:number;minorScale:number;rotationRadians:number;offsetScale:number;edgePhase:number}
export interface MortarFillProfile {frontZ:number;supportZ:(x:number,y:number)=>number|null;impact?:MortarImpactFootprint}
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
  private readonly occupiedMin = new THREE.Vector3(Infinity, Infinity, Infinity);
  private readonly occupiedMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  private meshSamples: {x:number;y:number;z:number;size:number;values:Float64Array}|null=null;
  private readonly settling:Array<{remaining:number;cells:Set<string>;blocked:(p:THREE.Vector3)=>boolean}>=[];
  private key(x: number, y: number, z: number): string { return `${x},${y},${z}`; }
  private chunkKey(x: number, y: number, z: number): string { return this.key(Math.floor(x / CHUNK), Math.floor(y / CHUNK), Math.floor(z / CHUNK)); }
  get nodeMass(): number { return this.spacing ** 3 * this.density; }
  get mass(): number { let sum = 0; for (const node of this.nodes.values()) sum += node.value * this.nodeMass; return sum; }
  private at(x: number, y: number, z: number): number {
    const samples=this.meshSamples;
    if(samples){const dx=x-samples.x,dy=y-samples.y,dz=z-samples.z,n=samples.size;
      if(dx>=0&&dy>=0&&dz>=0&&dx<n&&dy<n&&dz<n)return samples.values[(dx*n+dy)*n+dz];}
    return this.nodes.get(this.key(x,y,z))?.value ?? 0;
  }
  private changed(node: Node): void {
    // Interpolation changes touching cells, and the .6-cell normal gradient
    // reaches one cell farther. Refresh both sides of a chunk boundary even
    // when only its lighting gradient, not its triangles, has changed.
    for(let x=Math.floor((node.x-2)/CHUNK);x<=Math.floor((node.x+1)/CHUNK);x++)
      for(let y=Math.floor((node.y-2)/CHUNK);y<=Math.floor((node.y+1)/CHUNK);y++)
        for(let z=Math.floor((node.z-2)/CHUNK);z<=Math.floor((node.z+1)/CHUNK);z++)this.dirty.add(this.key(x,y,z));
  }
  private set(x: number,y: number,z: number,value: number,age: number,dilution=0): void {
    const key=this.key(x,y,z), old=this.nodes.get(key);
    if(value<1e-7){ if(old){this.changed(old);this.nodes.delete(key);this.chunkNodes.get(this.chunkKey(x,y,z))?.delete(key);if(!this.nodes.size){this.occupiedMin.set(Infinity,Infinity,Infinity);this.occupiedMax.set(-Infinity,-Infinity,-Infinity);}} return; }
    const node:Node={x,y,z,value:Math.min(1,value),age,dilution}; this.nodes.set(key,node);this.changed(node);
    const h=this.spacing;
    this.occupiedMin.x=Math.min(this.occupiedMin.x,(x-1)*h);this.occupiedMin.y=Math.min(this.occupiedMin.y,(y-1)*h);this.occupiedMin.z=Math.min(this.occupiedMin.z,(z-1)*h);
    this.occupiedMax.x=Math.max(this.occupiedMax.x,(x+1)*h);this.occupiedMax.y=Math.max(this.occupiedMax.y,(y+1)*h);this.occupiedMax.z=Math.max(this.occupiedMax.z,(z+1)*h);
    const chunk=this.chunkKey(x,y,z);let entries=this.chunkNodes.get(chunk);if(!entries){entries=new Set();this.chunkNodes.set(chunk,entries);}entries.add(key);
  }
  sample(point: THREE.Vector3): number {
    return this.sampleXYZ(point.x,point.y,point.z);
  }
  private sampleXYZ(px:number,py:number,pz:number):number {
    const h=this.spacing,x=px/h,y=py/h,z=pz/h,ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),tx=x-ix,ty=y-iy,tz=z-iz;
    // Use the same six linear tetrahedra as the mesh, so field collision cannot
    // occupy a curved trilinear surface that the visible skin does not contain.
    let maximum:number,middle:number,minimum:number,ax:number,ay:number,az:number,bx:number,by:number,bz:number;
    if(tx>=ty&&tx>=tz){maximum=tx;ax=1;ay=az=0;if(ty>=tz){middle=ty;minimum=tz;bx=by=1;bz=0;}else{middle=tz;minimum=ty;bx=bz=1;by=0;}}
    else if(ty>=tz){maximum=ty;ay=1;ax=az=0;if(tx>=tz){middle=tx;minimum=tz;bx=by=1;bz=0;}else{middle=tz;minimum=tx;by=bz=1;bx=0;}}
    else {maximum=tz;az=1;ax=ay=0;if(tx>=ty){middle=tx;minimum=ty;bx=bz=1;by=0;}else{middle=ty;minimum=tx;by=bz=1;bx=0;}}
    return this.at(ix,iy,iz)*(1-maximum)+this.at(ix+ax,iy+ay,iz+az)*(maximum-middle)+this.at(ix+bx,iy+by,iz+bz)*(middle-minimum)+this.at(ix+1,iy+1,iz+1)*minimum;
  }
  normal(point: THREE.Vector3): THREE.Vector3 {
    const h=this.spacing*.6,{x,y,z}=point,d=new THREE.Vector3(this.sampleXYZ(x-h,y,z)-this.sampleXYZ(x+h,y,z),this.sampleXYZ(x,y-h,z)-this.sampleXYZ(x,y+h,z),this.sampleXYZ(x,y,z-h)-this.sampleXYZ(x,y,z+h));
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
    // Conservative support bounds include every interpolation cell touching a
    // node. Rays through the rest of the room need no 4 mm field sampling.
    let enter=0,leave=maxDistance;
    for(const axis of ['x','y','z'] as const){
      if(Math.abs(direction[axis])<1e-12){if(origin[axis]<this.occupiedMin[axis]||origin[axis]>this.occupiedMax[axis])return null;continue;}
      const a=(this.occupiedMin[axis]-origin[axis])/direction[axis],b=(this.occupiedMax[axis]-origin[axis])/direction[axis];
      enter=Math.max(enter,Math.min(a,b));leave=Math.min(leave,Math.max(a,b));if(leave<enter)return null;
    }
    const step=this.spacing*.5,point=new THREE.Vector3();let previous=0;
    // Preserve the original sample lattice and binary-search precision.
    const first=Math.max(0,Math.floor(enter/step));previous=Math.max(0,(first-1)*step);
    for(let index=first;index<=Math.ceil(Math.min(maxDistance,leave)/step);index++){
      const distance=Math.min(index*step,maxDistance);point.copy(origin).addScaledVector(direction,distance);
      if(this.sample(point)>=LEVEL){let a=previous,b=distance;for(let i=0;i<7;i++){const middle=(a+b)*.5;if(this.sample(point.copy(origin).addScaledVector(direction,middle))>=LEVEL)b=middle;else a=middle;}point.copy(origin).addScaledVector(direction,b);return{point:point.clone(),normal:this.normal(point),distance:b};}
      previous=distance;
    }
    return null;
  }

  add(point:THREE.Vector3,normal:THREE.Vector3,mass:number,blocked:(point:THREE.Vector3)=>boolean,profile?:MortarFillProfile,footprintMass=mass):number {
    if(mass<this.nodeMass*5||this.nodes.size>=this.maxNodes)return 0;
    const axis=normal.clone().normalize(),radius=Math.max(.012,Math.cbrt(footprintMass/.65)*.084),impact=profile?.impact;
    const majorRadius=radius*(impact?.majorScale??1),minorRadius=radius*(impact?.minorScale??1);
    const depth=THREE.MathUtils.clamp(mass/this.density/(Math.PI*majorRadius*minorRadius)*2.5,.012,.082);
    const center=point.clone().addScaledVector(axis,depth*.3),reach=Math.max(majorRadius,minorRadius,depth),h=this.spacing;
    const candidates:Array<{x:number;y:number;z:number;weight:number;old:number;age:number;dilution:number;capacity:number}>=[];
    const flowCells=new Set<string>();
    const min=[Math.floor((center.x-reach)/h),Math.floor((center.y-reach)/h),Math.floor((center.z-reach)/h)];
    const max=[Math.ceil((center.x+reach)/h),Math.ceil((center.y+reach)/h),Math.ceil((center.z+reach)/h)];
    // A fixed 4 mm allowance can stop between lattice rows: a shallow clay rib
    // then has no free node above it and leaves an unfillable slit in the bed.
    // Admit the first exterior row for a thin coat, with density capped below
    // so its interpolated skin still ends at most 10 mm outside the wall.
    if(profile){min[2]=Math.floor((profile.frontZ-.20)/h);max[2]=Math.floor(profile.frontZ/h)+1;}
    const columns=new Map<string,number|null>();
    const q=new THREE.Vector3(),delta=new THREE.Vector3();
    for(let x=min[0];x<=max[0];x++)for(let y=min[1];y<=max[1];y++)for(let z=min[2];z<=max[2];z++){
      q.set(x*h,y*h,z*h);let weight:number,capacity=1;
      if(profile){
        const angle=impact?.rotationRadians??0,c=Math.cos(angle),s=Math.sin(angle),offset=(impact?.offsetScale??0)*radius;
        const dx=q.x-point.x-Math.cos(angle)*offset,dy=q.y-point.y-Math.sin(angle)*offset;
        const u=dx*c+dy*s,v=-dx*s+dy*c,theta=Math.atan2(v/Math.max(.001,minorRadius),u/Math.max(.001,majorRadius));
        const phase=impact?.edgePhase??0;
        const ragged=1+.105*Math.sin(theta*3+phase)+.065*Math.sin(theta*5-phase*1.7)+.035*Math.cos(theta*7+phase*.6);
        const metric=(u*u/(majorRadius*majorRadius)+v*v/(minorRadius*minorRadius))/(ragged*ragged);if(metric>=1)continue;
        const key=this.key(x,y,0);let back=columns.get(key);if(back===undefined){back=profile.supportZ(q.x,q.y);columns.set(key,back);}
        // Only the first exposed surviving wall surface backs a column. Sealed
        // chambers behind an intact clay shell cannot receive remote mortar.
        if(back===null||q.z<back||blocked(q))continue;
        if(z===max[2])capacity=Math.min(1,LEVEL/Math.max(LEVEL,1-(profile.frontZ+.010-q.z)/h));
        const fillDepth=Math.max(0,q.z-back);
        const cavityPriority=profile.frontZ-back>.012?8:.08;
        const clumps=.91+.09*Math.sin(u/Math.max(h,majorRadius)*11+phase+Math.cos(v/Math.max(h,minorRadius)*9));
        weight=(.22+.78*(1-metric)**.78)*clumps*Math.exp(-fillDepth/.032)*cavityPriority;
      }else{
        delta.copy(q).sub(center);const axial=delta.dot(axis),radial=Math.max(0,delta.lengthSq()-axial*axial),metric=radial/(radius*radius)+axial*axial/(depth*depth);
        if(metric>=1||blocked(q))continue;weight=(1-metric)**1.4;
      }
      const key=this.key(x,y,z);
      // Keep the sub-cell finishing film at its capped density; settling it
      // down to LEVEL would erase its skin, while filling it would exceed the
      // coat limit. The deeper fresh material keeps its short plastic response.
      if(capacity===1)flowCells.add(key);
      const old=this.nodes.get(key);if((old?.value??0)>=capacity-.0001||(old?.age??0)>=FRESH_SECONDS)continue;
      candidates.push({x,y,z,weight,old:old?.value??0,age:old?.age??0,dilution:old?.dilution??0,capacity});
    }
    if(!candidates.length)return 0;
    const target=mass/this.nodeMass;
    const volume=(scale:number):number=>{let added=0;for(const c of candidates)added+=Math.max(0,Math.min(c.capacity,c.weight*scale)-c.old);return added;};
    let low=0,high=128;for(let i=0;i<22;i++){const middle=(low+high)*.5;if(volume(middle)>target)high=middle;else low=middle;}
    let added=0;
    for(const c of candidates){const value=Math.max(c.old,Math.min(c.capacity,c.weight*low)),increment=value-c.old;if(increment<1e-8)continue;if(!this.nodes.has(this.key(c.x,c.y,c.z))&&this.nodes.size>=this.maxNodes)break;
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
        const increment=Math.min(unresolved-recovered,c.capacity-old);if(increment<1e-8)continue;
        if(!node&&this.nodes.size>=this.maxNodes)break;
        const value=old+increment;
        this.set(c.x,c.y,c.z,value,(node?.age??0)*old/value,(node?.dilution??0)*old/value);
        recovered+=increment;if(recovered>=unresolved-1e-8)break;
      }
    }
    if(added>0){
      this.revision++;
      // Impact briefly yields the fresh bed. Keep the same finite quantity in
      // its checked, backed footprint; cured mortar is never remobilized.
      if(this.settling.length>=4)this.settling.shift();
      this.settling.push({remaining:.24,cells:flowCells,blocked});
    }
    return (added-unresolved+recovered)*this.nodeMass;
  }

  tick(dt:number):void {
    for(const node of this.nodes.values()){node.age+=dt;node.dilution=Math.max(0,node.dilution-dt*.006);}
    this.settleFresh(dt);
  }

  /** Short plastic settling, not an endlessly flowing fluid. Transfers change
   * the collision field and its union skin together, conserving mass and age. */
  private settleFresh(dt:number):void {
    const q=new THREE.Vector3(),h=this.spacing;
    for(let batchIndex=this.settling.length-1;batchIndex>=0;batchIndex--){
      const batch=this.settling[batchIndex],step=Math.min(Math.max(0,dt),batch.remaining);
      if(step<=0)continue;batch.remaining-=step;
      // Only cells present at the start can emit this step; newly reached cells
      // wait until the next step before they can carry material onward.
      const sources=[...batch.cells].map(key=>this.nodes.get(key)).filter((node):node is Node=>!!node&&node.value>=LEVEL&&node.age<FRESH_SECONDS);
      let moved=0;
      for(const source of sources){
        const key=this.key(source.x,source.y,source.z),node=this.nodes.get(key);if(!node||node.age>=FRESH_SECONDS)continue;
        // Interior material already confined on all sides has no free surface.
        if(this.at(node.x,node.y,node.z+1)>.9&&this.at(node.x,node.y-1,node.z)>.9)continue;
        let best:{x:number;y:number;z:number;value:number;score:number}|null=null;
        for(const [dx,dy,dz] of [[0,-1,0],[0,0,-1],[-1,0,0],[1,0,0]]){
          const x=node.x+dx,y=node.y+dy,z=node.z+dz,k=this.key(x,y,z);if(!batch.cells.has(k))continue;
          const target=this.nodes.get(k);if((!target&&this.nodes.size>=this.maxNodes)||(target?.age??0)>=FRESH_SECONDS||batch.blocked(q.set(x*h,y*h,z*h)))continue;
          const value=target?.value??0,score=node.value-value+(dy<0?.20:dz<0?.12:0);
          if(score>.3&&(!best||score>best.score))best={x,y,z,value,score};
        }
        if(!best)continue;
        const base=Math.min(.22,source.value*.24,node.value-LEVEL,(1-best.value)*.5)*Math.max(.15,1-node.age/FRESH_SECONDS);
        if(base<.005)continue;
        // Distribute the same short yielding response over simulation time.
        // Four 60 ms jumps made already adhered mortar visibly twitch; a
        // normal frame now transfers only its share of that quantity.
        const amount=Math.min(base*step/.06,node.value-LEVEL,1-best.value);
        const target=this.nodes.get(this.key(best.x,best.y,best.z)),total=best.value+amount;
        this.set(best.x,best.y,best.z,total,((target?.age??0)*best.value+node.age*amount)/total,((target?.dilution??0)*best.value+node.dilution*amount)/total);
        this.set(node.x,node.y,node.z,node.value-amount,node.age,node.dilution);moved+=amount;
      }
      if(moved>0)this.revision++;
      if(batch.remaining<=1e-8||!moved)this.settling.splice(batchIndex,1);
    }
  }
  invalidateGeometry():void {for(const node of this.nodes.values())this.changed(node);}

  /** A remesh may span several frames while fresh material continues yielding.
   * Copy one coherent field revision, including the interpolation/normal halo,
   * so neighboring chunk boundaries can be published together without seams. */
  createMeshSnapshot():MortarField {
    const snapshot=new MortarField(),copiedChunks=new Set<string>();
    snapshot.revision=this.revision;
    for(const key of this.dirty){
      snapshot.dirty.add(key);
      const [x,y,z]=key.split(',').map(Number);
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)copiedChunks.add(this.key(x+dx,y+dy,z+dz));
    }
    for(const key of copiedChunks){
      const entries=this.chunkNodes.get(key);if(!entries)continue;
      snapshot.chunkNodes.set(key,new Set(entries));
      for(const entry of entries){const node=this.nodes.get(entry);if(node)snapshot.nodes.set(entry,{...node});}
    }
    return snapshot;
  }

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

  remesh(clip:(triangle:THREE.Vector3[])=>THREE.Vector3[][],maxChunks=Infinity):MortarFieldChunk[] {
    const results:MortarFieldChunk[]=[];
    const normalCache=new Map<string,THREE.Vector3>();
    const vertexNormal=(p:THREE.Vector3):THREE.Vector3=>{
      const key=`${Math.round(p.x*1e8)},${Math.round(p.y*1e8)},${Math.round(p.z*1e8)}`;
      let normal=normalCache.get(key);if(!normal){normal=this.normal(p);normalCache.set(key,normal);}return normal;
    };
    try { for(const key of this.dirty){
      if(results.length>=maxChunks)break;
      const [cx,cy,cz]=key.split(',').map(Number),x0=cx*CHUNK,y0=cy*CHUNK,z0=cz*CHUNK,positions:number[]=[],normals:number[]=[];
      // Normal gradients revisit the same lattice samples thousands of times.
      // A local, exact Float64 snapshot removes string/map work in that hot
      // loop; the two-cell halo contains the .6-cell gradient on both sides.
      const size=CHUNK+5,samples={x:x0-2,y:y0-2,z:z0-2,size,values:new Float64Array(size**3)};
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++){
        for(const entry of this.chunkNodes.get(this.key(cx+dx,cy+dy,cz+dz))??[]){
          const node=this.nodes.get(entry)!,x=node.x-samples.x,y=node.y-samples.y,z=node.z-samples.z;
          if(x>=0&&y>=0&&z>=0&&x<size&&y<size&&z<size)samples.values[(x*size+y)*size+z]=node.value;
        }
      }
      this.meshSamples=samples;
      const cubes=new Set<string>();
      for(let dx=0;dx<=1;dx++)for(let dy=0;dy<=1;dy++)for(let dz=0;dz<=1;dz++){
        const entries=this.chunkNodes.get(this.key(cx+dx,cy+dy,cz+dz));if(!entries)continue;
        for(const entry of entries){const node=this.nodes.get(entry)!;if(node.value<LEVEL*.3)continue;
          for(let ox=-1;ox<=0;ox++)for(let oy=-1;oy<=0;oy++)for(let oz=-1;oz<=0;oz++){const x=node.x+ox,y=node.y+oy,z=node.z+oz;if(x>=x0&&x<x0+CHUNK&&y>=y0&&y<y0+CHUNK&&z>=z0&&z<z0+CHUNK)cubes.add(this.key(x,y,z));}
        }
      }
      const edge=(a:number,b:number,points:THREE.Vector3[],values:number[]):THREE.Vector3=>points[a].clone().lerp(points[b],(LEVEL-values[a])/(values[b]-values[a]));
      const emit=(a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3,outward:THREE.Vector3):void=>{
        if(new THREE.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).dot(outward)<0)[b,c]=[c,b];
        for(const polygon of clip([a,b,c]))for(let i=1;i<polygon.length-1;i++){
          // Preserve tiny but real triangles where a settling isosurface
          // crosses a chunk edge. Dropping them independently opened pinholes
          // against the neighboring chunk's surviving boundary segment.
          const aa=polygon[0],bb=polygon[i],cc=polygon[i+1];if(new THREE.Vector3().crossVectors(bb.clone().sub(aa),cc.clone().sub(aa)).lengthSq()<1e-24)continue;
          for(const p of [aa,bb,cc]){positions.push(p.x,p.y,p.z);const n=vertexNormal(p);normals.push(n.x,n.y,n.z);}
        }
      };
      for(const cube of cubes){const[x,y,z]=cube.split(',').map(Number),values=CORNERS.map(([dx,dy,dz])=>this.at(x+dx,y+dy,z+dz));if(values.every(v=>v<LEVEL)||values.every(v=>v>=LEVEL))continue;
        const points=CORNERS.map(([dx,dy,dz])=>new THREE.Vector3((x+dx)*this.spacing,(y+dy)*this.spacing,(z+dz)*this.spacing));
        for(const tetra of TETRA){const inside=tetra.filter(i=>values[i]>=LEVEL),outside=tetra.filter(i=>values[i]<LEVEL);if(!inside.length||!outside.length)continue;
          const outward=points[outside[0]].clone().sub(points[inside[0]]);
          if(inside.length===1){const a=inside[0];emit(edge(a,outside[0],points,values),edge(a,outside[1],points,values),edge(a,outside[2],points,values),outward);}
          else if(outside.length===1){const a=outside[0];emit(edge(a,inside[0],points,values),edge(a,inside[1],points,values),edge(a,inside[2],points,values),outward);}
          else {const[a,b]=inside,[c,d]=outside,ac=edge(a,c,points,values),ad=edge(a,d,points,values),bc=edge(b,c,points,values),bd=edge(b,d,points,values);emit(ac,bc,bd,outward);emit(ac,bd,ad,outward);}
        }
      }
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.computeBoundingSphere();
      let mass=0,age=Infinity,dilution=0;for(const nodeKey of this.chunkNodes.get(key)??[]){const node=this.nodes.get(nodeKey)!;mass+=node.value*this.nodeMass;age=Math.min(age,node.age);dilution=Math.max(dilution,node.dilution);}
      results.push({key,geometry,mass,age:Number.isFinite(age)?age:0,dilution});
      this.dirty.delete(key);
      this.meshSamples=null;
    }} finally {this.meshSamples=null;}
    return results;
  }

  get statistics(){return{nodes:this.nodes.size,chunks:this.chunkNodes.size,massKg:this.mass,resolutionMm:this.spacing*1000,freshWorkingSeconds:FRESH_SECONDS,revision:this.revision};}
}
