import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as THREE from 'three';

const require=createRequire(import.meta.url),ts=require('typescript'),modules=new Map();
function load(file){file=resolve(file);if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);new Function('require','exports',ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(name=>name.startsWith('.')?load(resolve(dirname(file),name+'.ts')):require(name),exports);return exports;}
const {sampleTrowelMotion,TROWEL_CHARGE_SECONDS,TROWEL_FULL_CHARGE_GRACE_SECONDS,TROWEL_RELEASE_SECONDS,TROWEL_CAST_SECONDS}=load(fileURLToPath(new URL('../src/player/TrowelMotion.ts',import.meta.url)));
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
function cast(phase){const f=fixture(),{system,camera,origin}=f;system.swing(true,phase*.95,camera,origin);const holding=system.throwFeedback;assert(holding.holding);assert(Math.abs(holding.phase-phase)<1e-10);system.swing(false,0,camera,origin);assert.equal(system.projectiles.length,0,'Button-up starts the wrist motion, not an instant throw');system.swing(false,TROWEL_RELEASE_SECONDS,camera,origin);return {...f,holding,release:{...system.throwFeedback}};}

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
  const timeout=TROWEL_CHARGE_SECONDS+TROWEL_FULL_CHARGE_GRACE_SECONDS,clocks=[];
  for(const slice of [1/120,1/60,.05,timeout]){
    const {system,camera,origin}=fixture();let elapsed=0;
    while(elapsed<timeout-1e-9){
      const dt=Math.min(slice,timeout-elapsed);elapsed+=dt;system.swing(true,dt,camera,origin);
      if(elapsed<timeout-1e-9)assert.equal(system.throwFeedback.overheld,false,'Charge expired before the full-power grace elapsed');
    }
    assert.equal(system.throwFeedback.overheld,true);assert.equal(system.charge,0);
    assert.equal(system.throwFeedback.holding,true);assert.equal(system.throwFeedback.casting,false);
    assert.equal(system.throwFeedback.stage,'prepare');assert.equal(system.throwFeedback.swingDegrees,0);
    assert.deepEqual(system.throwFeedback.motion,sampleTrowelMotion({holding:true,charge:1,castElapsed:null}),'Only the bar resets: the loaded trowel must keep its full-charge held pose');
    for(let i=0;i<20;i++)system.swing(true,.5,camera,origin);
    assert.equal(system.charge,0,'Uninterrupted overhold started a second charge');
    assert.equal(system.throwFeedback.overheld,true);assert.equal(system.launchedMass,0);
    assert.equal(system.throwFeedback.motion.loadVisible,true);assert.equal(system.throwFeedback.motion.stage,'prepare');
    system.swing(false,.1,camera,origin);system.swing(false,1,camera,origin);
    assert.equal(system.throwFeedback.overheld,false);assert.equal(system.throwFeedback.casting,false);
    assert.equal(system.throwFeedback.holding,false);assert.equal(system.throwFeedback.stage,'ready');
    assert.equal(system.launchedMass,0,'Releasing an expired charge fired mortar');
    system.swing(true,TROWEL_CHARGE_SECONDS*.5,camera,origin);
    assert.equal(system.throwFeedback.quality,'perfect');
    system.swing(false,0,camera,origin);system.swing(false,TROWEL_RELEASE_SECONDS,camera,origin);
    assert.equal(system.throwFeedback.lastRelease,1);assert.equal(system.launchedMass,.65);
    clocks.push({slice,expiresAt:elapsed,renewedRelease:system.throwFeedback.lastRelease});
  }
  const {system,camera,origin}=fixture();
  system.swing(true,timeout-.001,camera,origin);assert.equal(system.charge,1);
  system.swing(false,0,camera,origin);system.swing(false,TROWEL_RELEASE_SECONDS,camera,origin);
  assert.equal(system.launchedMass,.65,'Full charge inside grace no longer casts');
  advance(system,1);system.swing(true,timeout,camera,origin);system.cancel();
  assert.equal(system.throwFeedback.overheld,false,'Tool-change cancellation retained expired UI state');
  system.swing(true,.2,camera,origin);assert(system.throwFeedback.holding);
  report.push({check:'Full charge expires after .8 seconds, blocks repeats and release shots, then rearms a fresh cast',clocks});
}

{
  const {system,camera,origin}=fixture();system.swing(true,.4,camera,origin);system.cancel();system.swing(false,0,camera,origin);
  assert.equal(system.launchedMass,0);assert.equal(system.throwFeedback.quality,'ready');
  system.launch(origin,new THREE.Vector3(0,0,-5),.65);
  assert.equal(system.projectiles.length,1);assert.equal(system.projectiles[0].bond,1);assert.equal(system.throwFeedback.lastRelease,0);
  advance(system,4);assert(system.stuckMass>.35);report.push({check:'Cancel does not throw; explicit launch keeps baseline adhesion',...ledger(system)});
}
{
  const {system,camera,origin}=fixture();
  system.swing(true,.475,camera,origin);system.swing(false,0,camera,origin);
  let samples=0,releasePose;
  const movingTip=new THREE.Vector3(.04,1.04,.21);
  const sample=()=>{samples++;releasePose=system.throwFeedback;return movingTip;};
  system.swing(false,.1,camera,sample);system.update(.1);
  assert.equal(samples,0);assert.equal(system.launchedMass,0,'No mass leaves before the wrist closes');
  system.swing(false,.059,camera,sample);system.update(.059);
  assert.equal(samples,0);assert.equal(system.projectiles.length,0);
  system.swing(false,.001,camera,sample);
  assert.equal(samples,1);assert.equal(releasePose.lastRelease,0,'Pose is sampled before mass spawns');
  assert(releasePose.castElapsed>=.159999,'Origin callback observes the advanced phase clock');
  assert(releasePose.motion.rollDegrees>=145,'The wrist must be closed before release');
  assert.equal(releasePose.swingDegrees,releasePose.motion.rollDegrees,'Live angle readout must follow the forearm roll');
  assert(system.projectiles[0].mesh.position.distanceTo(movingTip)<1e-8,'Release must use the current blade, not its button-up position');
  system.update(.001);
  assert(Math.abs(system.throwFeedback.castElapsed-.16)<1e-8,'Swing and update double-advanced the release slice');
  for(let i=0;i<70;i++){system.swing(true,.01,camera,sample);system.update(.01);}
  assert.equal(samples,1);assert.equal(system.throwFeedback.lastRelease,1,'Holding during recovery auto-launched another scoop');
  assert.equal(system.throwFeedback.holding,false,'A held recovery input automatically rearmed charging');
  system.swing(false,0,camera,sample);system.swing(true,.2,camera,sample);
  assert(system.throwFeedback.holding,'A fresh released-then-held input cannot rearm');
  assert.equal(samples,1,'Charging samples a release origin prematurely');
  report.push({check:'Delayed release samples the closed moving blade once; clocks and recovery rearm are bounded',releasePose});
}
{
  for(const elapsed of [0,.08,.159]){
    const {system,camera,origin}=fixture();system.swing(true,.475,camera,origin);system.swing(false,0,camera,origin);
    system.swing(false,elapsed,camera,origin);system.cancel();
    system.swing(false,.5,camera,()=>{throw new Error('Cancelled cast sampled a blade');});advance(system,1);
    assert.equal(system.launchedMass,0);assert.equal(system.projectiles.length,0);assert.equal(system.throwFeedback.casting,false);
  }
  report.push({check:'Tool-change or blur cancellation before release preserves the full unthrown scoop'});
}
{
  const clocks=[];
  for(const slice of [.01,1/60,.05]){
    const {system,camera,origin}=fixture();system.swing(true,.475,camera,origin);system.swing(false,0,camera,origin);
    let elapsed=0,releasedAt=null;
    while(elapsed<TROWEL_CAST_SECONDS-1e-9){
      const dt=Math.min(slice,TROWEL_CAST_SECONDS-elapsed);elapsed+=dt;
      system.swing(false,dt,camera,()=>{releasedAt=elapsed;return origin;});system.update(dt);
      if(elapsed<.159999)assert.equal(system.launchedMass,0);
    }
    assert(releasedAt>=.159999&&releasedAt<.16+slice+1e-8,'Release delay varies by more than one simulation slice');
    assert(system.recovery<1e-8,'Recovery consumes the pending interval a second time');
    assert.equal(system.throwFeedback.lastRelease,1);assert(Math.abs(system.launchedMass-.65)<1e-10);
    clocks.push({slice,releasedAt,completedAt:elapsed,recovery:system.recovery});
  }
  report.push({check:'One complete cast lasts .82 seconds at 100, 60 and 20 simulation Hz',clocks});
}
{
  const {system,camera}=cast(.5);advance(system,1);
  const before=system.telemetry,fieldMass=system.field.mass;
  assert.equal(system.pack(camera),false,'Pressing the chase must not add mortar');
  assert.equal(system.telemetry.launchedKg,before.launchedKg);assert.equal(system.field.mass,fieldMass);
  assert.equal(system.projectiles.length,before.airborne);
  report.push({check:'Packing compatibility call never manufactures a scoop',...ledger(system)});
}
{
  const poses=[0,.08,.16,.3,.4,.82].map(castElapsed=>sampleTrowelMotion({holding:false,charge:.5,castElapsed}));
  assert.equal(sampleTrowelMotion({holding:true,charge:1,castElapsed:null}).rollDegrees,0,'Preparation spills an open-face load');
  for(const pose of poses){
    assert.equal(pose.pitchDegrees,0,'A short neutral-wrist flick adds wrist pitch');
    assert.equal(pose.yawDegrees,0,'A short neutral-wrist flick adds wrist yaw');
    assert(Math.hypot(pose.offset.x,pose.offset.y,pose.offset.z)<=.071,'Flick became a broad arm swing');
  }
  assert.equal(poses[0].loadVisible,true);assert.equal(poses[2].loadVisible,false);
  assert(poses[2].rollDegrees>90&&poses[3].rollDegrees>90,'Release and follow-through must keep the blade closed');
  assert.equal(poses.at(-1).rollDegrees,0);assert.deepEqual(poses.at(-1).offset,{x:0,y:0,z:0});
  assert.equal(TROWEL_CAST_SECONDS,.82);
  report.push({check:'Open preparation, wrist flip, closed follow-through and complete reset',poses});
}
{
  const {system,camera,origin}=fixture();
  for(let i=0;i<47;i++)system.launch(origin,new THREE.Vector3(0,0,-1),.01);
  system.swing(true,.95,camera,origin);system.swing(false,0,camera,origin);system.swing(false,.16,camera,origin);
  assert.equal(system.projectiles.length,47);assert(Math.abs(system.launchedMass-.47)<1e-9);assert.equal(system.throwFeedback.lastRelease,0);
  report.push({check:'Projectile budget rejects a whole late scoop atomically',...ledger(system)});
}
// A close trowel can penetrate both masonry and an already growing bed. The
// entire finite scoop must start in free space and strike the exposed surface.
{
 const {system,camera}=fixture(),tip=new THREE.Vector3(0,1.02,-.09),loads=[];
 for(let i=0;i<4;i++){
  system.swing(true,.475,camera,tip);system.swing(false,0,camera,tip);system.swing(false,.16,camera,tip);
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
