import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const before=process.argv.includes('--before'),out=`output/worker-three-fixes/${before?'before':'after'}`;
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:810}});await blockPointerLock(context);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
 await page.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,{},{timeout:90000});await page.locator('#start-button').click();
 await page.evaluate(()=>{const g=window.__wireTheHouse;g.step=()=>{};g.input.locked=false;});
 const results=[];
 const directions=[['forward',0,-1],['forward-left',-1,-1],['left',-1,0],['backward-left',-1,1],['backward',0,1],['backward-right',1,1],['right',1,0],['forward-right',1,-1]];
 for(const speed of before?[.7]:[.7,2.2,3.41])for(const [direction,x,z]of directions){
  const name=speed===.7?direction:`${direction}-${speed}`;
  const result=await page.evaluate(async({name,x,z,speed})=>{
   const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera;
   const length=Math.hypot(x,z);x/=length;z/=length;w.phase=0;w.bend=0;w.travelTurn=0;w.gaitBlend=0;w.overview=true;
   g.player.crouched=false;g.player.yaw=0;g.player.pitch=0;g.player.velocity.set(x*speed,0,z*speed);g.fpsRig.visible=false;
   const frames=[];
   for(let i=0;i<120;i++){
    c.position.set(x*speed*i/60,1.65,z*speed*i/60);c.rotation.set(0,0,0);
    w.update(1/60,c,g.player,g.fpsRig,'spray',false,false);
    const pose=Object.fromEntries(w.poseSnapshot().map(p=>[p.name.replaceAll('.',''),{q:p.quaternion,t:p.translation}]).filter(([name])=>['pelvis','spine','chest','neck','head','clavicleL','clavicleR'].includes(name)));
    frames.push({time:i/60,phase:w.phase,yaw:w.rotation.y,origin:w.position.toArray(),feet:['L','R'].map(s=>w.point('foot.'+s).toArray()),pose,locomotion:structuredClone(w.telemetry.locomotion)});
   }
   // Review every direction against the same unobstructed camera. The old
   // capture followed the translated player into the wall, so a passing
   // numeric test could produce a screenshot containing no body at all.
   for(const child of g.renderer.scene.children)if(child!==w&&!child.isLight&&!child.isCamera)child.visible=false;
   w.position.set(0,0,0);w.updateMatrixWorld(true);w.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});
   c.position.set(1.2,1.25,-2.2);c.lookAt(0,.82,0);
   g.renderer.render();await g.renderer.waitForFrame();
   return {name,direction:[x,z],frames};
  },{name,x,z,speed});
  await page.screenshot({path:`${out}/walk-${name}.png`});results.push(result);
 }
 await writeFile(`${out}/directions.json`,JSON.stringify({results,errors},null,2));
 if(!before){
  const quaternionAngle=q=>2*Math.acos(Math.min(1,Math.abs(q[3]))),range=a=>Math.max(...a)-Math.min(...a);
  for(const r of results){
   const travel=[],cross=[];
   for(const f of r.frames.slice(60)){const [px,,pz]=f.origin,[fx,,fz]=f.feet[0];travel.push((fx-px)*r.direction[0]+(fz-pz)*r.direction[1]);cross.push((fx-px)*-r.direction[1]+(fz-pz)*r.direction[0]);}
   assert(range(travel)>.12,`${r.name}: feet must step along travel`);
   assert(range(cross)<.025,`${r.name}: feet must not swing across travel`);
   for(const f of r.frames){const dx=f.feet[1][0]-f.feet[0][0],dz=f.feet[1][2]-f.feet[0][2];assert(dx*Math.cos(f.yaw)-dz*Math.sin(f.yaw)>.09,`${r.name}: legs cross`);}
   assert(range(r.frames.map(f=>f.pose.pelvis.t[1]))>.008,`${r.name}: pelvis has no weight-transfer bob`);
   for(const [bone,minimum]of [['pelvis',.022],['spine',.010],['chest',.006],['neck',.002],['head',.001]])assert(Math.max(...r.frames.map(f=>quaternionAngle(f.pose[bone].q)))>minimum,`${r.name}: ${bone} remains rigid`);
   for(const side of ['L','R'])assert(Math.max(...r.frames.map(f=>quaternionAngle(f.pose['clavicle'+side].q)))>.012,`${r.name}: clavicle ${side} remains rigid`);
   assert(Math.max(...r.frames.map(f=>Math.abs(f.locomotion.forward)+Math.abs(f.locomotion.sideways)))>.99,`${r.name}: local direction telemetry is not normalized`);
  }
  assert.deepEqual(errors,[]);
 }
 console.log({before,cases:results.length,errors});
}finally{await browser.close();}
