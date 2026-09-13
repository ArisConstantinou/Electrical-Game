import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as THREE from 'three';

// Production classes against an analytical excavated volume. This isolates
// material behavior; browser tests exercise controls, rendering and real masonry.
const require=createRequire(import.meta.url),ts=require('typescript'),modules=new Map();
function load(file){file=resolve(file);if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);new Function('require','exports',ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(name=>name.startsWith('.')?load(resolve(dirname(file),name+'.ts')):require(name),exports);return exports;}
const {MortarSystem}=load(fileURLToPath(new URL('../src/systems/MortarSystem.ts',import.meta.url)));
const Z=new THREE.Vector3(0,0,1),report={suite:'mortar-volume-regression',checks:[]};
function cavity(halfWidth=.07,halfHeight=.07,depth=.06){
  const solid=(x,y,z)=>z< -depth||(z<0&&(Math.abs(x)>halfWidth||Math.abs(y-1)>halfHeight));
  return{volume:{frontZ:0,isOccupied:solid,raycast(origin,direction,maximum){
    for(let t=0;t<=maximum;t+=.001){const p=new THREE.Vector3().copy(origin).addScaledVector(direction,t);if(solid(p.x,p.y,p.z))return{point:p,normal:Z.clone()};}return null;
  }}};
}
function advance(system,seconds){for(let t=0;t<seconds-1e-9;t+=.01)system.update(Math.min(.01,seconds-t));}
function massBalance(system){const t=system.telemetry,error=t.launchedKg-t.stuckKg-t.restingKg-t.floorKg-t.movingKg;assert(Math.abs(error)<1e-7,`Material disappeared/duplicated: ${error}kg`);assert(Math.abs(system.field.mass-t.stuckKg)<1e-7,'Field quantity differs from adhered-material ledger');return{launchedKg:t.launchedKg,adheredKg:t.stuckKg,restingKg:t.restingKg,floorKg:t.floorKg,movingKg:t.movingKg,washedKg:t.washedKg,errorKg:error};}
function aim(camera,x,y,z=-.06){camera.position.set(x,y,.4);camera.lookAt(x,y,z);camera.updateMatrixWorld(true);}
function cast(system,camera){
  const origin=camera.position.clone().addScaledVector(camera.getWorldDirection(new THREE.Vector3()),.17),before=system.launchedMass;
  system.swing(true,.475,camera,origin);system.swing(false,0,camera,origin);
  assert.equal(system.launchedMass,before,'Button-up deposits mortar before the wrist releases');
  system.swing(false,.16,camera,()=>origin);
  assert(Math.abs(system.launchedMass-before-.65)<1e-9,'A cast must release one finite 0.65 kg scoop');
}
function components(system){
  const ids=new Map(),parents=[];
  const id=p=>{const key=p.map(v=>Math.round(v*1e5)).join(',');if(!ids.has(key)){ids.set(key,parents.length);parents.push(parents.length);}return ids.get(key);};
  const root=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  const join=(a,b)=>{a=root(a);b=root(b);if(a!==b)parents[a]=b;};
  for(const d of system.deposits){const p=d.mesh.geometry.getAttribute('position');for(let i=0;i<p.count;i+=3){const a=id([p.getX(i),p.getY(i),p.getZ(i)]);for(let j=1;j<3;j++)join(a,id([p.getX(i+j),p.getY(i+j),p.getZ(i+j)]));}}
  return new Set(parents.map((_,i)=>root(i))).size;
}

// The same API fills an arbitrary hole with no mission point, fitted-box state
// or target ID. Four released finite trowel loads must build a connected interior volume.
{
  const system=new MortarSystem(new THREE.Scene(),cavity(),[]),camera=new THREE.PerspectiveCamera();
  const targets=[[-.03,1.03],[.03,1.03],[0,.97],[0,1]];
  for(const[x,y]of targets)system.applyWater(new THREE.Vector3(x,y,-.059),Z,.025);
  const loadMass=[];
  for(const[x,y]of targets){aim(camera,x,y);cast(system,camera);advance(system,1.05);loadMass.push(system.stuckMass);}
  advance(system,3);
  let filled=0,samples=0;
  for(let x=-.05;x<=.05+1e-8;x+=.02)for(let y=.95;y<=1.05+1e-8;y+=.02)for(let z=-.045;z<=-.005+1e-8;z+=.01){samples++;if(system.field.sample(new THREE.Vector3(x,y,z))>=.35)filled++;}
  const fraction=filled/samples,connected=components(system);
  assert(fraction>=.75,`Four trowels did not build useful cavity volume: ${fraction}`);
  assert.equal(connected,1,'Merged mortar consists of disconnected petals/shells');
  assert(system.deposits.every(d=>d.fieldKey&&d.mesh.position.lengthSq()===0&&d.mesh.quaternion.angleTo(new THREE.Quaternion())<1e-8),'Deposits still use per-throw rotating meshes');
  const before=system.deposits.map(d=>Array.from(d.mesh.geometry.getAttribute('position').array));advance(system,.5);
  assert.deepEqual(system.deposits.map(d=>Array.from(d.mesh.geometry.getAttribute('position').array)),before,'Unforced, settled mortar geometry keeps rotating or changing');
  report.checks.push({name:'any cavity; four ballistic trowel loads',loadMassKg:loadMass,filledFraction:fraction,connectedSurfaceComponents:connected,...massBalance(system)});
}

// A 74 mm single-gang installation with a 46 mm deep chase should be ready in
// four properly placed loads. Success is measured by real ring-volume coverage.
{
  const scene=new THREE.Scene(),point=new THREE.Group(),group=new THREE.Group(),box=new THREE.Group();
  box.width=box.height=.074;group.groupWidth=group.groupHeight=.074;group.boxes=[box];group.add(box);point.add(group);point.boxGroup=group;point.position.y=1;point.definition={id:'single-gang'};point.stage='fitted';point.setStage=function(stage){this.stage=stage;};scene.add(point);
  const system=new MortarSystem(scene,cavity(.072,.072,.046),[point]),camera=new THREE.PerspectiveCamera(),targets=[[0,1.062],[0,.938],[-.063,1],[.063,1]];
  for(const[x,y]of targets)system.applyWater(new THREE.Vector3(x,y,-.045),Z,.035);
  const coverage=[];
  for(const[x,y]of targets){aim(camera,x,y,-.046);cast(system,camera);advance(system,1.05);coverage.push(system.coverage(point));}
  advance(system,1.5);assert(system.ready(point),`Single gang still incomplete after four trowels: ${system.coverage(point)}`);
  assert.equal(point.stage,'mortared','Stable completed single gang failed to advance');
  report.checks.push({name:'single gang in four trowels',coverageByLoad:coverage,finalCoverage:system.coverage(point),...massBalance(system)});

  // Initial stability is not cement curing. After six minutes it remains fresh,
  // and a real water dose removes field material and revokes usable coverage.
  system.field.tick(360);for(const deposit of system.deposits)deposit.age+=360;
  const beforeMass=system.field.mass,beforeGeometry=system.deposits.reduce((sum,d)=>sum+d.mesh.geometry.getAttribute('position').count,0);
  let absorbed=0,runoff=0,delivered=0;
  system.onRunoff=e=>{runoff+=e.litres;};
  aim(camera,-.063,1,-.046);
  for(let i=0;i<80;i++){
    const hit=system.contact(camera.position,camera.getWorldDirection(new THREE.Vector3()),.9);assert(hit,'Wash ray unexpectedly missed receiver');
    const result=system.applyWater(hit.point,hit.normal,.02);absorbed+=result.absorbedLitres;delivered+=.02;advance(system,.06);
  }
  advance(system,3);
  assert(system.washedMass>.03,'Fresh mortar resisted all washout after six minutes');
  assert(system.field.mass<beforeMass-.03,'Water changed decoration only, not material volume');
  assert(Math.abs(delivered-absorbed-runoff)<1e-8,'Water dose counted twice or disappeared');
  assert(!system.ready(point),'Washed-out ring still reports usable completed coverage');
  const afterGeometry=system.deposits.reduce((sum,d)=>sum+d.mesh.geometry.getAttribute('position').count,0);
  assert.notEqual(afterGeometry,beforeGeometry,'Washout did not remesh the actual material');
  report.checks.push({name:'six-minute fresh mortar washout',beforeMassKg:beforeMass,afterMassKg:system.field.mass,coverageAfterWash:system.coverage(point),waterLitres:{delivered,absorbed,runoff},...massBalance(system)});
}

// Tiny unresolved mass must remain unretained, and removing real support releases
// all material instead of leaving an invisible or floating collision volume.
{
  const {MortarField}=load(fileURLToPath(new URL('../src/systems/MortarField.ts',import.meta.url)));
  const field=new MortarField(),solid=p=>p.z<0;
  assert.equal(field.add(new THREE.Vector3(0,1,0),Z,.002,solid),0);
  assert.equal(field.mass,0);assert.equal(field.raycast(new THREE.Vector3(0,1,.1),Z.clone().negate(),.2),null);
  const held=field.add(new THREE.Vector3(0,1,0),Z,.65,solid);
  assert(held>.6);assert(field.releaseUnsupported(solid).mass<.005);
  const before=field.mass,released=field.releaseUnsupported(()=>false);
  assert(Math.abs(released.mass-before)<1e-8);assert.equal(field.mass,0);
  assert.equal(field.raycast(new THREE.Vector3(0,1,.1),Z.clone().negate(),.2),null);
  report.checks.push({name:'unresolved material and removed support',releasedKg:released.mass});
}
// Fitting/moving the box removes its actual volume, retaining an existing bed
// behind its back. Its depth is measured backwards from the mouth, not centered.
{
  const scene=new THREE.Scene(),wall=cavity(.1,.1,.13),system=new MortarSystem(scene,wall,[]);
  const accepted=system.deposit(new THREE.Vector3(0,1,-.13),.65,Z);system.launchedMass+=accepted;system.stuckMass+=accepted;
  const rearBefore=[...system.field.nodes.values()].filter(n=>n.z*.008<-.065).reduce((sum,n)=>sum+n.value*system.field.nodeMass,0);
  const point=new THREE.Group(),group=new THREE.Group(),box=new THREE.Group();box.width=box.height=.074;box.depth=.047;group.boxes=[box];group.add(box);point.add(group);point.boxGroup=group;point.position.y=1;point.definition={id:'rear-bed'};scene.add(point);system.points.push(point);
  system.refreshOpeningGeometry();
  const rearAfter=[...system.field.nodes.values()].filter(n=>n.z*.008<-.065).reduce((sum,n)=>sum+n.value*system.field.nodeMass,0);
  assert(rearBefore>.1);assert(Math.abs(rearAfter-rearBefore)<1e-8,'Finite box erased the deeper back bed');
  assert(!system.insideBox(new THREE.Vector3(0,1,-.08)));assert(system.insideBox(new THREE.Vector3(0,1,.25)),'Forward mouth corridor could be occluded');assert(system.insideBox(new THREE.Vector3(0,1,-.025)));
  report.checks.push({name:'finite box preserves back bed',rearBeforeKg:rearBefore,rearAfterKg:rearAfter,...massBalance(system)});
}

// Integration ledger: the hose's hit and miss branches feed disjoint litre
// quantities to RoomWater; absorbed water remains outside the floor ledger.
{
  const {RoomWaterSystem}=load(fileURLToPath(new URL('../src/systems/RoomWaterSystem.ts',import.meta.url)));
  const scene=new THREE.Scene(),wall=cavity(),m=new MortarSystem(scene,wall,[]),water=new RoomWaterSystem(scene,wall),camera=new THREE.PerspectiveCamera();let absorbed=0;
  const apply=m.applyWater.bind(m);m.applyWater=(...args)=>{const result=apply(...args);absorbed+=result.absorbedLitres;return result;};
  m.onRunoff=e=>water.addRunoff(e);m.onWaterEmission=e=>water.addEmission(e);
  aim(camera,0,1);for(let i=0;i<100;i++){m.wet(camera,camera.position,.01);water.update(.01);}
  camera.lookAt(0,10,1);camera.updateMatrixWorld(true);for(let i=0;i<100;i++){m.wet(camera,camera.position,.01);water.update(.01);}
  const delivered=.24,t=water.telemetry;assert(Math.abs(delivered-absorbed-t.receivedLitres)<1e-8,'Hose water was duplicated/lost across hit and miss callbacks');
  assert(t.runoffLitres>0&&t.emissionLitres>0);assert(Math.abs(t.conservationErrorLitres)<1e-8);
  report.checks.push({name:'hose hit/miss to RoomWater unique ledger',deliveredLitres:delivered,absorbedLitres:absorbed,...t});
}

// A coverage segment can start INSIDE a thick, valid bed. The old surface-only
// ray wrongly reported these filled cells empty when its exit was beyond65mm.
{
  const scene=new THREE.Scene(),point=new THREE.Group(),group=new THREE.Group(),box=new THREE.Group();box.width=box.height=.074;box.depth=.037;group.groupWidth=group.groupHeight=.074;group.boxes=[box];group.add(box);point.add(group);point.boxGroup=group;point.position.y=1;point.definition={id:'overfilled-ring'};point.stage='fitted';point.setStage=function(stage){this.stage=stage;};scene.add(point);
  const m=new MortarSystem(scene,cavity(.16,.16,.08),[point]);
  let held=0;for(const z of [-.06,-.015,.035])held+=m.field.add(new THREE.Vector3(0,1,z),Z,3,q=>q.z<-.08||m.insideBox(q));m.launchedMass+=held;m.stuckMass+=held;m.field.tick(2);m.field.invalidateGeometry();m.syncFieldGeometry();
  point.updateWorldMatrix(true,true);let inside=0,oldSurfaceHits=0;
  for(let side=0;side<4;side++)for(let i=0;i<12;i++){
    const t=-.9+1.8*i/11,w=.063,h=.061,q=new THREE.Vector3(side<2?t*w:side===2?-w:w,1+(side<2?side===0?-h:h:t*h),.024);
    if(m.field.sample(q)>=.35)inside++;
    const ray=new THREE.Raycaster(q,Z.clone().negate(),0,.065);for(const d of m.deposits)d.mesh.updateWorldMatrix(true,false);if(ray.intersectObjects(m.deposits.map(d=>d.mesh),false).length)oldSurfaceHits++;
  }
  assert(inside>30,'Regression does not start inside enough filled volume');assert(oldSurfaceHits<36,'Regression no longer reproduces the missing exit surface');
  assert(m.ready(point),'Solid ring falsely incomplete when ray origins lie inside actual mortar');
  report.checks.push({name:'overfilled ring still contains valid material',insideOrigins:inside,oldSurfaceHits,volumeCoverage:m.coverage(point),...massBalance(m)});
}

// Repeated real impacts on an already filled front cannot grow a balloon. The
// finite local capacity keeps the coat thin and transfers unused mixture to waste.
{
 const m=new MortarSystem(new THREE.Scene(),cavity(.065,.065,.055),[]);
 m.applyWater(new THREE.Vector3(0,1,-.054),Z,.035);
 for(let i=0;i<12;i++){m.launch(new THREE.Vector3(0,1,.4),new THREE.Vector3(0,0,-4),.65);advance(m,.9);}
 advance(m,4);let front=-Infinity;
 for(const d of m.deposits){const positions=d.mesh.geometry.getAttribute('position');for(let i=0;i<positions.count;i++)front=Math.max(front,positions.getZ(i));}
 assert(front<=.011,'Repeated outer hits grew an outward mortar balloon');assert(m.floorMass>m.stuckMass,'Filled local capacity did not shed excess mixture');
 report.checks.push({name:'repeated outside casts retain thin coat and shed excess',frontBuildoutMm:front*1000,...massBalance(m)});
}
// A closed hollow block is not an exposed chase. No cast can transport paste
// through its surviving shell into an invisible rear chamber.
{
 const occupied=(x,y,z)=>z<-.08||(z<0&&z>-.018),wall={volume:{frontZ:0,isOccupied:occupied,raycast(o,d,max){for(let t=0;t<=max;t+=.001){const p=o.clone().addScaledVector(d,t);if(occupied(p.x,p.y,p.z))return{point:p,normal:Z.clone()};}return null;}}};
 const m=new MortarSystem(new THREE.Scene(),wall,[]);for(let i=0;i<4;i++){m.launch(new THREE.Vector3(0,1,.4),new THREE.Vector3(0,0,-4));advance(m,1);}
 assert([...m.field.nodes.values()].every(n=>n.z*m.field.spacing>-.018),'Mortar teleported through a sealed clay shell');
 report.checks.push({name:'sealed clay shell blocks remote cavity filling',...massBalance(m)});
}

// A full lip must not shrink a whole scoop's footprint to its small retained
// fraction and permanently exclude the adjacent empty groove.
{
 const m=new MortarSystem(new THREE.Scene(),cavity(.10,.14,.117),[]),lip=new THREE.Vector3(0,1.064,0);
 const profile={frontZ:0,supportZ:()=>-.117};
 for(let i=0;i<12;i++)m.field.add(lip,Z,.65,q=>q.z<-.117||q.y<1.03,profile);
 const origin=new THREE.Vector3(0,1,.1),direction=Z.clone().negate();
 assert.equal(m.field.raycast(origin,direction,.25),null,'Fixture groove was already filled');
 let total=0;const increments=[];
 for(let i=0;i<20;i++){const held=m.deposit(lip,.118,Z,false,.65);increments.push(held);total+=held;}
 const hit=m.field.raycast(origin,direction,.25);
 assert(total>.3,'Full lip rejects every retained scoop');
 assert(hit&&hit.point.z>-.012,'Adjacent deep groove cannot fill to the face');
 report.checks.push({name:'Full scoop spreads past a saturated lip into the empty groove',retainedKg:total,grooveSurfaceZ:hit.point.z,increments});
}

// Small retained portions must seed a visible backed volume. They previously
// remained below the isosurface threshold and were discarded on every cast.
{
 const {MortarField}=load(fileURLToPath(new URL('../src/systems/MortarField.ts',import.meta.url)));
 const f=new MortarField(),point=new THREE.Vector3(0,1,-.117),profile={frontZ:0,supportZ:()=>-.117};
 let accepted=0;for(let i=0;i<10;i++)accepted+=f.add(point,Z,.02,q=>q.z<-.117,profile);
 assert(accepted>.19,'Small useful portions repeatedly vanish instead of building a seed');
 assert(f.raycast(new THREE.Vector3(0,1,.05),Z.clone().negate(),.2),'Retained mass has no visible skin');
 assert(Math.abs(f.mass-accepted)<1e-8,'Compacting diffuse tails duplicates material');
 assert(f.releaseUnsupported(q=>q.z<-.117).mass<.001,'Cohesive seed is not backed by masonry');
 report.checks.push({name:'Small retained portions form a visible supported seed',acceptedKg:accepted});
}

// Microfacets inside a backed recess capture an incoming scoop, while moisture,
// outward momentum and a real through-opening remain physically significant.
{
 const flat=cavity(0,0,0),m=new MortarSystem(new THREE.Scene(),flat,[]),p=new THREE.Vector3(.2,1,0),v=new THREE.Vector3(0,0,-3),grazing=new THREE.Vector3(.98,0,.2).normalize();
 const dry=m.retention(p,v,Z),glancing=m.retention(p,v,grazing);
 m.applyWater(p,Z,.025);const damp=m.retention(p,v,Z);
 for(let i=0;i<20;i++)m.applyWater(p,Z,.1);const flooded=m.retention(p,v,Z);
 assert(glancing<dry*.2);assert(damp>dry);assert(flooded<damp*.5);
 const recess=new MortarSystem(new THREE.Scene(),cavity(),[]),back=new THREE.Vector3(0,1,-.06),capture=recess.retention(back,v,grazing);
 assert(capture>.4&&capture>glancing*3,'Backed recess still rejects a whole scoop because of one tiny facet');
 assert.equal(recess.retention(back,new THREE.Vector3(0,0,3),grazing),0,'Outward residue gained confinement adhesion');
 for(const halfWidth of [Infinity,.3]){
   const wall={volume:{frontZ:0,depth:.2,isOccupied:(x,y,z)=>Math.abs(x)>halfWidth&&z<0&&z>-.2,raycast:()=>null}};
   const air=new MortarSystem(new THREE.Scene(),wall,[]);
   air.launch(new THREE.Vector3(0,1,.2),v);advance(air,2);
   assert.equal(air.field.mass,0,'Scoop adhered in an unbacked through-opening');
   assert.equal(air.deposit(back,.65,grazing),0,'Unsupported deposition created floating fill');
   massBalance(air);
 }
 report.checks.push({name:'Confined capture preserves flat moisture, glancing, outward and open-air behavior',dry,glancing,damp,flooded,capture});
}

// Deferred rendering changes no collision or mass and eventually produces the
// exact same surface as the synchronous diagnostic path.
{
 const {MortarField}=load(fileURLToPath(new URL('../src/systems/MortarField.ts',import.meta.url)));
 const full=new MortarField(),queued=new MortarField(),profile={frontZ:0,supportZ:()=>-.08},p=new THREE.Vector3(0,1,-.08),solid=q=>q.z<-.08;
 for(const field of [full,queued])for(let i=0;i<4;i++)field.add(p,Z,.65,solid,profile);
 const origin=new THREE.Vector3(0,1,.1),direction=Z.clone().negate();
 assert.deepEqual(queued.raycast(origin,direction,.3),full.raycast(origin,direction,.3));
 const expected=full.remesh(triangle=>[triangle]),actual=[];let calls=0;
 while(queued.dirty.size){const before=queued.dirty.size,chunks=queued.remesh(triangle=>[triangle],1);assert.equal(chunks.length,1);assert.equal(queued.dirty.size,before-1);actual.push(...chunks);calls++;}
 const surface=chunks=>chunks.map(({key,mass,age,dilution,geometry})=>({key,mass,age,dilution,positions:Array.from(geometry.getAttribute('position').array),normals:Array.from(geometry.getAttribute('normal').array)}));
 assert.deepEqual(surface(actual),surface(expected));assert.equal(queued.mass,full.mass);assert(calls>1);
 report.checks.push({name:'Budgeted remesh preserves exact geometry, authoritative collision and mass',chunks:calls,massKg:queued.mass});
}

console.log(JSON.stringify({...report,passed:true},null,2));
