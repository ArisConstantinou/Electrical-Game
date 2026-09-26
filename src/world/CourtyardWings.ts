import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { siteMaterial } from './SiteMaterials';
import type { PlayerObstacle } from '../player/EquipmentCollision';

type WallBuilder = (name:string,x0:number,z0:number,x1:number,z1:number,base?:number,height?:number)=>void;

/** The retained concept's inhabited courtyard edges: two unequal wings,
 * continuous verandas, deep unfinished openings and supported setbacks. */
export function addCourtyardWings(root:THREE.Group, wall:WallBuilder, obstacles:PlayerObstacle[]):THREE.Mesh[] {
  const floors:THREE.Mesh[]=[];
  const concrete=siteMaterial('concrete',0xe2ded5);
  const screed=siteMaterial('floor',0xd4cec3);
  const box=(name:string,x:number,y:number,z:number,w:number,h:number,d:number,material=concrete)=>{
    const mesh=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,2,.009),material);
    mesh.name=name;mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;
    mesh.userData.constructionRenderBatch=true;root.add(mesh);return mesh;
  };
  const floor=(name:string,x0:number,x1:number,z0:number,z1:number,y:number)=>{
    const mesh=box(name,(x0+x1)/2,y-.11,(z0+z1)/2,x1-x0,.22,z1-z0,screed);
    mesh.userData.authoredWalkable=true;floors.push(mesh);return mesh;
  };
  const guard=(name:string,x0:number,z0:number,x1:number,z1:number,y:number)=>{
    const parts:THREE.BufferGeometry[]=[];
    const length=Math.hypot(x1-x0,z1-z0),n=Math.ceil(length/1.7);
    const rail=(a:THREE.Vector3,b:THREE.Vector3,r:number)=>{
      const direction=b.clone().sub(a),g=new THREE.CylinderGeometry(r,r,direction.length(),8);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize()));
      g.translate(...a.clone().add(b).multiplyScalar(.5).toArray());parts.push(g);
    };
    for(let i=0;i<=n;i++){const t=i/n,x=x0+(x1-x0)*t,z=z0+(z1-z0)*t;rail(new THREE.Vector3(x,y,z),new THREE.Vector3(x,y+1.05,z),.024);}
    for(const h of [.5,1.02])rail(new THREE.Vector3(x0,y+h,z0),new THREE.Vector3(x1,y+h,z1),.02);
    const mesh=new THREE.Mesh(mergeGeometries(parts),new THREE.MeshStandardMaterial({color:0xb7a052,roughness:.72,metalness:.2}));
    parts.forEach(p=>p.dispose());mesh.name=name;mesh.castShadow=true;root.add(mesh);
    obstacles.push({id:name,minX:Math.min(x0,x1)-.035,maxX:Math.max(x0,x1)+.035,minZ:Math.min(z0,z1)-.035,maxZ:Math.max(z0,z1)+.035,minFloorY:y,maxFloorY:y+.02,
      segments:[{ax:x0,az:z0,bx:x1,bz:z1,halfWidth:.035}]});
  };
  const portal=(name:string,x:number,z0:number,z1:number,y:number)=>{
    box(`${name} concrete head`,x,y+2.84,(z0+z1)/2,.34,.32,z1-z0+.28);
    for(const z of [z0-.10,z1+.10])box(`${name} rough deep reveal`,x,y+1.35,z,.30,2.7,.20);
  };

  // The existing garage roof is the west half of the L1 veranda. Its eastern
  // extension and the L2 bridge align with that roof without coplanar overlays.
  floor('L1 east veranda continuation floor',18.01,21.25,2.55,6.1,3.3);
  floor('L2 south bridge and shaded L1 veranda roof',12.65,21.25,2.55,6.1,6.6);
  floor('L1 east courtyard wing floor',16.1,21.25,5.95,15.55,3.3);
  floor('L2 east courtyard wing floor and L1 roof',16.1,21.25,6.1,15.55,6.6);
  floor('L2 east wing stepped roof',18.0,21.25,6.1,11.0,9.9);
  for(const x of [13.0,17.9,21.1])for(const z of [2.65,6.0]){
    box('L1 veranda continuous cast column',x,4.95,z,.3,3.3,.3);
    if(x>18)box('Ground east veranda cast support',x,1.65,z,.3,3.3,.3);
  }
  for(const z of [6.1,10.8,15.4])for(const x of [16.2,21.1]){
    box('Ground east colonnade structural support',x,1.65,z,.3,3.3,.3);
    box('L1 east colonnade structural support',x,4.95,z,.3,3.3,.3);
    if(z<11)box('L2 recessed east wing support',x,8.25,z,.3,3.3,.3);
  }
  for(const level of [1,2]){
    const y=level*3.3,label=`L${level}`;
    const north=level===1?15.4:10.85;
    wall(`${label} east wing outer south pier`,21.1,6.1,21.1,7.2,y);
    wall(`${label} east wing outer middle pier`,21.1,8.8,21.1,north,y);
    wall(`${label} east wing south return`,18.2,6.1,21.1,6.1,y);
    wall(`${label} east wing north return`,18.2,north,21.1,north,y);
    wall(`${label} courtyard room entrance south pier`,18.2,6.1,18.2,7.05,y);
    wall(`${label} courtyard room entrance north pier`,18.2,8.85,18.2,10.85,y);
    portal(`${label} courtyard room door-ready opening`,18.2,7.05,8.85,y);
    portal(`${label} exterior rough window`,21.1,7.2,8.8,y);
    guard(`${label} exterior window temporary guard`,21.11,7.2,21.11,8.8,y);
    if(level===1){
      wall('L1 north bedroom courtyard pier',18.2,10.85,18.2,12.3,y);
      wall('L1 north bedroom end pier',18.2,14.05,18.2,15.4,y);
      wall('L1 east bedrooms separating partition',18.2,10.85,21.1,10.85,y);
      portal('L1 north bedroom door-ready opening',18.2,12.3,14.05,y);
    }
    guard(`${label} courtyard veranda inner protection`,16.18,6.15,16.18,15.4,y);
    guard(`${label} north veranda end protection`,16.18,15.43,21.18,15.43,y);
    guard(`${label} south veranda front protection`,18.2,2.61,21.18,2.61,y);
    guard(`${label} south veranda outside protection`,21.18,2.61,21.18,6.05,y);
    guard(`${label} bridge courtyard-side protection`,12.7,6.04,16.18,6.04,y);
    if(level===2)guard('L2 north open terrace outside protection',21.18,10.9,21.18,15.43,y);
  }
  // A broad west wing steps back around the existing stair, replacing the
  // isolated tower silhouette with the concept's inhabited terraced mass.
  for(const level of [1,2,3,4]){
    const y=level*3.3,label=`L${level}`,west=level<3?-1.2:level===3?-.2:1.0;
    const north=level<3?15.5:level===3?14.2:12.65;
    floor(`${label} west wing and veranda floor`,west,4.45,6.5,level===1?north:8.55,y);
    floor(`${label} west wing access bridge floor`,4.45,6.5,6.5,7.95,y);
    floor(`${label} west wing cast roof`,west-.1,4.45,8.55,north+.1,y+3.3);
    if(level===4)guard('L4 terminal stair well protection',4.45,7.95,6.5,7.95,y);
    // A shaded veranda runs beside the stair. Wide empty apertures have real
    // reveals and supported heads, without fitted doors or glass.
    wall(`${label} west wing south return`,west,8.6,3.0,8.6,y);
    wall(`${label} west wing north return`,west,north,3.0,north,y);
    wall(`${label} west wing room entrance south pier`,3.0,8.6,3.0,9.55,y);
    wall(`${label} west wing room entrance north pier`,3.0,11.3,3.0,north,y);
    portal(`${label} west wing room opening`,3.0,9.55,11.3,y);
    wall(`${label} west outer window south pier`,west,8.6,west,9.45,y);
    wall(`${label} west outer window north pier`,west,11.35,west,north,y);
    portal(`${label} west outer deep aperture`,west,9.45,11.35,y);
    guard(`${label} west window fall protection`,west,9.45,west,11.35,y);
    guard(`${label} west veranda outer end`,3.1,north,4.4,north,y);
    guard(`${label} west wing southern terrace`,west,6.55,4.45,6.55,y);
    guard(`${label} west wing terrace outside edge`,west,6.55,west,8.55,y);
    for(const x of [west,3.0,4.4])for(const z of [8.6,north]){
      box(`${label} west wing cast corner column`,x,y+1.65,z,.28,3.3,.28);
      if(level===1)box('Ground support under west wing',x,1.65,z,.28,3.3,.28);
    }
    box(`${label} west wing outer fascia`,west,y+3.13,(8.6+north)/2,.32,.34,north-8.6+.3);
    box(`${label} west veranda outer fascia`,4.4,y+3.13,(8.6+north)/2,.32,.34,north-8.6+.3);
    box(`${label} west wing north fascia`,(west+4.4)/2,y+3.13,north,4.4-west+.32,.34,.32);
  }
  // Continuous columns and landing beams support both switchback flights.
  for(const x of [4.45,8.55]){
    box('Stair core continuous cast support',x,6.6,12.12,.3,13.2,.3);
  }
  for(const base of [0,3.3,6.6,9.9])box('Stair landing transverse bearing beam',6.5,base+1.48,12.12,4.4,.34,.30);
  for(const level of [1,2])portal(`L${level} main wing to veranda opening`,12.5,2.8,4.2,level*3.3);
  // The street-facing wing spans several bays above the existing garage.
  // Each upper volume steps back, while its uncovered roof is the next
  // terrace. These widths avoid leaving a narrow five-storey room tower.
  const frontPortal=(name:string,z:number,x0:number,x1:number,y:number)=>{
    box(`${name} cast lintel`,(x0+x1)/2,y+2.84,z,x1-x0+.3,.32,.34);
    for(const x of [x0-.1,x1+.1])box(`${name} deep reveal`,x,y+1.35,z,.2,2.7,.30);
  };
  floor('L1 front room extension supported beside garage roof',6.36,9,-3.4,0,3.3);
  for(const z of [-3.3,0])box('Ground support under extended main wing',6.5,1.65,z,.3,3.3,.3);
  for(const level of [1,2,3,4]){
    const y=level*3.3,label=`L${level}`;
    const west=level<3?12.7:level===3?12.8:11.0;
    const east=level<3?18.0:level===3?16.8:15.2;
    const front=level<3?-3.3:level===3?-1.7:-.6;
    const back=level<3?2.6:1.6;
    const door=level<3?15.6:level===3?14.9:12.8;
    // L1 already stands on the garage roof. Higher bridges are complete
    // slabs with supported joins to the original core and east veranda.
    if(level===2)floor('L2 broad front wing slab',12.65,18.15,-3.4,2.55,y);
    if(level===3){
      floor('L3 main front terrace and stepped wing slab',12.64,18.15,-3.4,4.5,y);
    }
    if(level===4){
      floor('L4 main front terrace and stepped wing slab',11.14,16.95,-1.8,4.5,y);
    }
    const mainWest=level<=2?6.5:7,mainEast=level<=2?12.5:level===3?11:10;
    const mainCenter=(mainWest+mainEast)/2,halfOpening=level<=2?1.1:.9;
    frontPortal(`${label} unified main facade opening`,front,mainCenter-halfOpening,mainCenter+halfOpening,y);
    guard(`${label} main facade opening protection`,mainCenter-halfOpening,front,mainCenter+halfOpening,front,y);
    box(`${label} continuous main facade fascia`,mainCenter,y+3.13,front,mainEast-mainWest+.3,.34,.34);
    for(const x of [mainWest,mainEast])box(`${label} main facade cast column`,x,y+1.65,front,.3,3.3,.3);
    wall(`${label} front wing west return`,west,front,west,back,y);
    wall(`${label} front wing east return`,east,front,east,back,y);
    wall(`${label} front wing rear west pier`,west,back,door-.8,back,y);
    wall(`${label} front wing rear east pier`,door+.8,back,east,back,y);
    frontPortal(`${label} front wing room entry`,back,door-.8,door+.8,y);
    const middle=(west+east)/2;
    wall(`${label} front facade west pier`,west,front,middle-1.05,front,y);
    wall(`${label} front facade east pier`,middle+1.05,front,east,front,y);
    frontPortal(`${label} front facade rough aperture`,front,middle-1.05,middle+1.05,y);
    guard(`${label} front facade opening protection`,middle-1.05,front,middle+1.05,front,y);
    // The following floor closes this roof; only the terminal roof is added
    // separately, so no coplanar slabs are stacked over the same room.
    if(level===4)floor('L4 front wing terminal roof',west-.15,east+.15,front-.15,back+.15,y+3.3);
    for(const x of [west,east])for(const z of [front,back]){
      box(`${label} front wing load-bearing column`,x,y+1.65,z,.30,3.3,.30);
      if(level===1)box('Ground frame supporting front wing',x,1.65,z,.30,3.3,.30);
    }
    box(`${label} continuous street fascia`,(west+east)/2,y+3.13,front,east-west+.3,.34,.34);
    if(level>=3){
      const edge=level===3?18.0:16.8;
      guard(`${label} expanded main terrace east protection`,edge,back+.05,edge,4.4,y);
      guard(`${label} expanded main terrace rear protection`,east,4.4,edge,4.4,y);
    }
  }
  // Cast ring beams visually carry the slab edges and meet the columns; the
  // brick infill stops at the same underside instead of floating in front.
  for(const y of [3.3,6.6]){
    box('Courtyard wing continuous inner ring beam',16.2,y-.21,10.8,.32,.42,9.5);
    box('Courtyard wing continuous outer ring beam',21.1,y-.21,10.8,.32,.42,9.5);
    box('South veranda continuous fascia beam',16.97,y-.21,2.65,8.55,.42,.32);
  }
  return floors;
}
