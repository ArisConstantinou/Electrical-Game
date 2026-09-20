import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const phase=process.argv[2]??'before',out=`output/hand-repair/${phase}`;await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});const report={cases:[],errors:[]};
try{
 const ctx=await browser.newContext({viewport:{width:1280,height:900}});await blockPointerLock(ctx);const p=await ctx.newPage();p.on('pageerror',e=>report.errors.push(e.message));
 if(process.argv.includes('--baseline'))for(const file of ['WorkerBody','FPSRig']){
  const original=await readFile(`output/hand-repair/before/${file}.ts`,'utf8');
  await p.route(`**/src/player/${file}.ts*`,async route=>{
   const response=await route.fetch(),live=await response.text(),three=live.match(/import \* as THREE from ["']([^"']+)/)[1];
   let code=ts.transpileModule(original,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/Electrical-Game/'));
   code=code.replace(/from ["']([^"']+)["']/g,(match,spec)=>{
    if(spec==='three')return `from ${JSON.stringify(three)}`;
    if(spec==='three/addons/loaders/GLTFLoader.js')return `from ${JSON.stringify(live.match(/import \{ GLTFLoader \} from ["']([^"']+)/)[1])}`;
    if(spec.startsWith('.'))return `from ${JSON.stringify(new URL(spec+'.ts',route.request().url()).pathname)}`;
    return match;
   });await route.fulfill({response,body:code,contentType:'application/javascript'});
  });
 }
 await p.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await p.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,null,{timeout:90000});await p.locator('#start-button').click();await p.keyboard.press('Digit4');
 await p.evaluate(()=>{const g=window.__wireTheHouse;window.realStep=g.step.bind(g);g.step=()=>{};});
 for(const [name,yaw,pitch,crouch,side] of [['level',0,-.2,false,'right'],['oblique',-.6,-.2,false,'right'],['down',0,-1.1,false,'right'],['crouch',0,-.3,true,'left']]){
  await p.locator(`#hammer-view-${side}`).click();
  const data=await p.evaluate(async({yaw,pitch,crouch})=>{const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera;g.player.workPosition.locked=false;g.player.workPosition.released=false;g.player.crouched=crouch;g.player.velocity.set(0,0,0);g.player.yaw=yaw;g.player.pitch=pitch;c.position.set(-.6,crouch?.95:1.65,g.room.brickWall.volume.frontZ+.8);g.renderer.viewCamera=null;
   for(let i=0;i<90;i++)window.realStep(1/60);g.renderer.render();await g.renderer.waitForFrame();
   const arms={};for(const side of ['L','R']){const hand=w.bone('hand.'+side),q=hand.getWorldQuaternion(hand.quaternion.clone()),long=w.point('middle.01.'+side).sub(w.point('hand.'+side)).normalize(),fore=w.point('hand.'+side).sub(w.point('forearm.'+side)).normalize();arms[side]={wristBendDegrees:long.angleTo(fore)*180/Math.PI,shoulder:w.point('upper_arm.'+side).toArray(),elbow:w.point('forearm.'+side).toArray(),wrist:w.point('hand.'+side).toArray(),middle:w.point('middle.01.'+side).toArray(),handQ:q.toArray()};}
   return {arms,grips:g.fpsRig.anatomicalGrips(),telemetry:w.telemetry,hammerFit:g.fpsRig.hammerFit};},{yaw,pitch,crouch});report.cases.push({name,...data});
  await p.screenshot({path:`${out}/${name}-fps.png`});
  for(const side of ['R','L']){
   await p.evaluate(async side=>{const g=window.__wireTheHouse,w=g.workerBody,v=g.modelInspector.camera,c=g.renderer.camera,V=c.position.constructor;w.overview=true;const target=w.point('hand.'+side).lerp(w.point('middle.01.'+side),.5),offset=new V(side==='R'?.36:-.36,.22,.38).applyAxisAngle(new V(0,1,0),g.player.yaw);v.position.copy(target).add(offset);v.lookAt(target);v.aspect=1280/900;v.fov=48;v.near=.005;v.updateProjectionMatrix();g.renderer.viewCamera=v;g.renderer.render();await g.renderer.waitForFrame();},side);
   await p.screenshot({path:`${out}/${name}-${side}.png`});
  }
  for(const view of ['front','side']){
   await p.evaluate(async view=>{const g=window.__wireTheHouse,w=g.workerBody,v=g.modelInspector.camera,V=v.position.constructor,Q=v.quaternion.constructor,q=new Q().setFromAxisAngle(new V(0,1,0),g.player.yaw);w.overview=true;w.update(0,g.renderer.camera,g.player,g.fpsRig,'hammer',false,false);const target=g.renderer.camera.position.clone().add(new V(0,-.38,-.18).applyQuaternion(q));v.position.copy(target).add(new V(view==='front'?.9:1.15,.2,view==='front'?-.9:.6).applyQuaternion(q));v.lookAt(target);v.aspect=1280/900;v.fov=48;v.near=.005;v.updateProjectionMatrix();g.renderer.viewCamera=v;g.renderer.render();await g.renderer.waitForFrame();},view);
   await p.screenshot({path:`${out}/${name}-${view}.png`});
  }
 }
 if(process.argv.includes('--motion')){
  report.motion=await p.evaluate(async()=>{
   const g=window.__wireTheHouse,w=g.workerBody,c=g.renderer.camera;g.player.crouched=false;g.renderer.viewCamera=null;w.overview=false;g.player.workPosition.locked=false;g.player.workPosition.released=false;const samples=[],cpu=[],frames=[];let prev=null,last=performance.now();
   for(let i=0;i<300;i++){
    await new Promise(requestAnimationFrame);const time=performance.now();
    g.player.yaw=Math.sin(i*.024)*.55;g.player.pitch=-.55+Math.cos(i*.021)*.6;c.position.set(-.6+Math.sin(i*.027)*.15,1.65,g.room.brickWall.volume.frontZ+.8);g.player.velocity.set(Math.cos(i*.027)*.25,0,0);window.realStep(1/60);
    const qs=['upper_arm.R','forearm.R','hand.R','upper_arm.L','forearm.L','hand.L'].map(n=>w.bone(n).getWorldQuaternion(c.quaternion.clone()));
    const wrists=['L','R'].map(s=>w.point('middle.01.'+s).sub(w.point('hand.'+s)).angleTo(w.point('hand.'+s).sub(w.point('forearm.'+s)))*180/Math.PI);
    if(i>=30){cpu.push(performance.now()-time);frames.push(time-last);samples.push({i,wrists,reach:w.telemetry.gripReachErrors,turn:Math.max(...qs.map((q,j)=>q.angleTo(prev[j])))*180/Math.PI});}
    prev=qs;last=time;g.renderer.render();await g.renderer.waitForFrame();
   }
   const percentile=(a,p)=>[...a].sort((a,b)=>a-b)[Math.floor((a.length-1)*p)];return{samples,cpuP95Ms:percentile(cpu,.95),frameP95Ms:percentile(frames,.95),frameMaxMs:Math.max(...frames),drawCalls:g.renderer.webgl.info.render.calls,triangles:g.renderer.webgl.info.render.triangles,maxJointStepDegrees:Math.max(...samples.map(s=>s.turn)),maxWristBend:Math.max(...samples.flatMap(s=>s.wrists)),maxReachError:Math.max(...samples.flatMap(s=>Object.values(s.reach)))};
  });
 }
 await p.locator('#model-inspector-open').click();await p.waitForFunction(()=>window.__wireTheHouse.modelInspector.worker?.loaded);await p.selectOption('#model-tool','hammer');
 for(const view of ['side','front']){
  await p.evaluate(async view=>{const g=window.__wireTheHouse,m=g.modelInspector;m.playing=false;m.updatePose(0);const V=m.camera.position.constructor;m.controls.target.set(0,1.25,-.23);m.camera.position.copy(m.controls.target).add(new V(1.0,.24,view==='front'?-.9:.8));m.camera.fov=48;m.camera.updateProjectionMatrix();m.controls.update();g.renderer.render();await g.renderer.waitForFrame();},view);
  await p.screenshot({path:`${out}/panel-${view}.png`});
 }
 if(process.argv.includes('--verify')){for(const r of report.cases){for(const a of Object.values(r.arms))assert(a.wristBendDegrees<26,`${r.name}: folded wrist`);for(const error of Object.values(r.telemetry.gripReachErrors))assert(error<.004,`${r.name}: detached grasp`);}assert.deepEqual(report.errors,[]);if(report.motion){assert(report.motion.maxReachError<.01);assert(report.motion.maxJointStepDegrees<15);}}
 console.log(JSON.stringify(report.cases.map(r=>({name:r.name,wrists:Object.fromEntries(Object.entries(r.arms).map(([s,a])=>[s,a.wristBendDegrees])),reach:r.telemetry.gripReachErrors})),null,2));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
