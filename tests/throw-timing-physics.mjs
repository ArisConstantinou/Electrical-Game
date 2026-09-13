import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as THREE from 'three';

const require=createRequire(import.meta.url),ts=require('typescript'),modules=new Map();
function load(file){file=resolve(file);if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);new Function('require','exports',ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(name=>name.startsWith('.')?load(resolve(dirname(file),name+'.ts')):require(name),exports);return exports;}
const {MortarSystem}=load(fileURLToPath(new URL('../src/systems/MortarSystem.ts',import.meta.url)));
const normal=new THREE.Vector3(0,0,1),report=[];
function fixture(){
  // Analytical open chase with surviving rear backing, independent of any
  // objective or box. Production contact, field deposition and gravity run.
  const solid=(_x,_y,z)=>z<-.045;
  const wall={volume:{frontZ:0,isOccupied:solid,raycast(origin,direction,max){
    if(direction.z>=0)return null;
    const distance=(-.045-origin.z)/direction.z;
    return distance>=0&&distance<=max?{point:origin.clone().addScaledVector(direction,distance),normal:normal.clone()}:null;
  }}};
  const system=new MortarSystem(new THREE.Scene(),wall,[]),camera=new THREE.PerspectiveCamera();
  system.angleDegrees=0;camera.position.set(0,1.1,.5);camera.lookAt(0,1.1,0);camera.updateMatrixWorld(true);
  for(const y of [.94,.98,1.02,1.06])system.applyWater(new THREE.Vector3(0,y,-.045),normal,.04);
  return{system,camera,origin:new THREE.Vector3(0,1.02,.23)};
}
function advance(system,seconds){for(let t=0;t<seconds-1e-9;t+=.01)system.update(Math.min(.01,seconds-t));}
function ledger(system){const t=system.telemetry,error=t.launchedKg-t.stuckKg-t.floorKg-t.restingKg-t.movingKg;assert(Math.abs(error)<1e-8,`Scoop mass changed: ${error}`);assert(Math.abs(system.field.mass-t.stuckKg)<1e-8);return{heldKg:t.stuckKg,floorKg:t.floorKg,movingKg:t.movingKg,errorKg:error};}
function cast(phase){const f=fixture(),{system,camera,origin}=f;system.swing(true,phase*.95,camera,origin);const holding=system.throwFeedback;assert(holding.holding);assert(Math.abs(holding.phase-phase)<1e-10);system.swing(false,0,camera,origin);return {...f,holding,release:{...system.throwFeedback}};}

const results=[];
for(const phase of [.2,.42,.5,.58,.7,1]){
  const {system,camera,release}=cast(phase),forward=camera.getWorldDirection(new THREE.Vector3());
  const incoming=system.projectiles.filter(p=>p.velocity.dot(forward)>0).reduce((sum,p)=>sum+p.mass,0);
  const returning=system.projectiles.filter(p=>p.velocity.dot(forward)<0).reduce((sum,p)=>sum+p.mass,0);
  assert(Math.abs(incoming+returning-.65)<1e-10,'Late splash duplicates/deletes scoop mass');
  assert(incoming>=.65*.45-1e-10,'Overthrow sends the entire scoop backwards');
  assert.equal(release.quality,phase<.42?'early':phase<=.58?'perfect':'late');
  assert.equal(release.lastRelease,1);assert.equal(system.telemetry.throwFeedback.quality,release.quality);
  if(phase<=.58)assert.equal(returning,0);
  else assert(system.projectiles.filter(p=>p.velocity.dot(forward)<0).every(p=>p.slurry),'Face-directed splash can adhere as fresh mortar');
  advance(system,4);const result={phase,release,forwardKg:incoming,backwardKg:returning,...ledger(system)};
  assert.equal(system.throwFeedback.splash,0,'Face feedback never fades');
  assert.equal(system.throwFeedback.quality,'ready');results.push(result);
  assert.equal(system.throwFeedback.swingDegrees,0,'Idle gauge does not return to the neutral rig angle');
}
assert(results[0].heldKg<results[2].heldKg*.45,'Early cast bonds as strongly as the ideal cast');
assert(results[0].floorKg>results[2].floorKg+.1,'Early rejected mass did not fall down');
assert(results[2].heldKg>.35,'Ideal throw fails to transfer a useful scoop into a damp chase');
assert(results[5].heldKg>.04,'Late cast never deposits any of its forward mortar');
assert(results[5].backwardKg>results[4].backwardKg&&results[5].release.splash>results[4].release.splash,'Overthrow splash is not monotonic');
report.push({check:'Actual early, ideal and late contact, gravity, adhesion and finite mass',results});

{
  const {system,camera,origin}=fixture();system.swing(true,.4,camera,origin);system.cancel();system.swing(false,0,camera,origin);
  assert.equal(system.launchedMass,0);assert.equal(system.throwFeedback.quality,'ready');
  system.launch(origin,new THREE.Vector3(0,0,-5),.65);
  assert.equal(system.projectiles.length,1);assert.equal(system.projectiles[0].bond,1);assert.equal(system.throwFeedback.lastRelease,0);
  advance(system,4);assert(system.stuckMass>.35);report.push({check:'Cancel does not throw; explicit launch keeps baseline adhesion',...ledger(system)});
}
{
  const {system}=cast(1);advance(system,.325);
  assert(Math.abs(system.throwFeedback.swingDegrees-45)<1e-8,'Recovery gauge differs from the actual smooth return angle');
  report.push({check:'Recovery returns the live swing-angle readout to neutral',halfRecoveryDegrees:system.throwFeedback.swingDegrees});
}
{
  const {system,camera}=cast(1);advance(system,.7);
  camera.position.set(.25,1.02,.4);camera.lookAt(.25,1.02,0);camera.updateMatrixWorld(true);
  assert(system.pack(camera),'Close manual packing fixture failed');
  assert(system.recovery>0);assert.equal(system.throwFeedback.quality,'ready');
  assert.equal(system.throwFeedback.phase,0);assert.equal(system.throwFeedback.strength,0);
  assert.equal(system.throwFeedback.swingDegrees,0);assert.equal(system.throwFeedback.lastRelease,1);
  report.push({check:'Packing recovery never replays a previous late throw',...ledger(system)});
}
{
  const {system,camera,origin}=fixture();
  for(let i=0;i<47;i++)system.launch(origin,new THREE.Vector3(0,0,-1),.01);
  system.swing(true,.95,camera,origin);system.swing(false,0,camera,origin);
  assert.equal(system.projectiles.length,47);assert(Math.abs(system.launchedMass-.47)<1e-9);assert.equal(system.throwFeedback.lastRelease,0);
  report.push({check:'Projectile budget rejects a whole late scoop atomically',...ledger(system)});
}
// A close trowel can penetrate both masonry and an already growing bed. The
// entire finite scoop must start in free space and strike the exposed surface.
{
 const {system,camera}=fixture(),tip=new THREE.Vector3(0,1.02,-.09),loads=[];
 for(let i=0;i<4;i++){
  system.swing(true,.475,camera,tip);system.swing(false,0,camera,tip);
  const projectile=system.projectiles.find(p=>!p.slurry);
  assert(projectile,'Close throw did not create its scoop');
  assert(projectile.mesh.position.z>-.045,'Scoop started behind solid backing');
  assert(system.field.sample(projectile.mesh.position)<.35,'Scoop started inside existing mortar');
  advance(system,1);loads.push(system.field.mass);
 }
 assert(loads[1]>loads[0]+.1&&loads[2]>loads[1]+.1,'Repeated close casts fail to build on the visible bed');
 system.preview(camera,tip,true);
 assert(system.target.visible&&system.target.position.z>=-.045,'Preview points behind the receiver');
 report.push({check:'Close casts start outside masonry and accumulated mortar',loadsKg:loads,...ledger(system)});
}

// Desktop/mobile tool offsets share the same sighted ballistic target.
{
 const samples=[];
 for(const x of [-.04,-.125])for(const phase of [.2,.5,.8]){
  const {system,camera}=fixture();system.angleDegrees=12;
  const origin=new THREE.Vector3(x,1.16,.15),velocity=system.velocity(camera,phase,origin);
  const time=(-.045-origin.z)/velocity.z,impact=origin.clone().addScaledVector(velocity,time);impact.y-=4.905*time*time;
  assert(Math.abs(impact.x)<1e-8&&Math.abs(impact.y-1.1)<1e-8,'Offset cast missed crosshair');
  assert(Math.abs(velocity.length()-(2+phase*6))<1e-8,'Aiming correction changed timing strength');
  system.angleDegrees=22;assert(system.velocity(camera,phase,origin).y>velocity.y,'Manual loft no longer raises throw');
  samples.push({offsetX:x,phase,impact:impact.toArray(),speed:velocity.length()});
 }
 report.push({check:'Ballistic aim converges at unchanged timing speed; manual loft remains active',samples});
}

console.log(JSON.stringify({suite:'throw-timing-physics',passed:true,checks:report},null,2));
