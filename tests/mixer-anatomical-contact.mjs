import {chromium} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const backend=process.argv.includes('--webgpu')?'webgpu':'webgl';
const swapped=process.argv.includes('--swapped'),tool=process.argv.includes('--hammer')?'hammer':'mixer';const phase=process.argv.includes('--before')?'before':'after',out=`output/mixer-anatomical-contact/${tool}${swapped?'-swapped':''}/${phase}${backend==='webgpu'?'-webgpu':''}`;await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report=[];
try{const c=await browser.newContext({viewport:{width:1440,height:810}});await blockPointerLock(c);const p=await c.newPage();p.on('pageerror',e=>{throw e;});
if(phase==='before'){
 const original=await readFile('output/mixer-anatomical-contact/before/WorkerBody.ts','utf8');
 await p.route('**/src/player/WorkerBody.ts*',async route=>{const response=await route.fetch(),live=await response.text(),three=live.match(/import \* as THREE from ["']([^"']+)/)[1],loader=live.match(/import \{ GLTFLoader \} from ["']([^"']+)/)[1];const code=ts.transpileModule(original,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll("'three'",JSON.stringify(three)).replaceAll("'three/addons/loaders/GLTFLoader.js'",JSON.stringify(loader)).replaceAll('import.meta.env.BASE_URL',JSON.stringify('/Electrical-Game/'));await route.fulfill({response,body:code,contentType:'application/javascript'});});
}
await p.goto(`http://127.0.0.1:5365/Electrical-Game/?renderer=${backend}`);await p.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,null,{timeout:90000});await p.locator('#start-button').click();await p.evaluate(()=>{const g=window.__wireTheHouse;window.contactStep=g.step.bind(g);g.step=()=>{};});
for(const [name,key] of [['idle',null],['left','KeyA'],['right','KeyD'],['back','KeyS'],['forward','KeyW']]){
 await p.evaluate(({tool,swapped})=>{const g=window.__wireTheHouse,c=g.renderer.camera;g.input.resetTransientInput();g.player.velocity.set(0,0,0);g.player.yaw=Math.PI;g.player.pitch=-.45;g.player.crouched=false;c.position.set(-.3,1.65,.2);c.rotation.set(-.45,Math.PI,0);g.workerBody.resetPreviewMotion();if(tool==='mixer'){g.mixing.setActive(true);g.mixing.chooseTool('mixer');}else{g.mixing.setActive(false);g.selectTool('hammer');g.hammerAutoSide=false;g.room.brickWall.chiselSideDegrees=swapped?15:-15;g.fpsRig.hammerHandedness=swapped?'left':'right';}for(let i=0;i<24;i++)window.contactStep(1/60,0,false);},{tool,swapped});
 if(key)await p.keyboard.down(key);const frameErrors=await p.evaluate(()=>{const values=[];for(let i=0;i<24;i++){window.contactStep(1/60,0,false);values.push({...window.__wireTheHouse.workerBody.telemetry.gripReachErrors});}return values;});if(key)await p.keyboard.up(key);
 const data=await p.evaluate(async()=>{const g=window.__wireTheHouse,w=g.workerBody;g.renderer.viewCamera=null;g.renderer.render();await g.renderer.waitForFrame();const grips=g.mixing.active?g.mixing.anatomicalGrips():g.fpsRig.anatomicalGrips();return{velocity:g.player.velocity.toArray(),bodyYaw:w.rotation.y,pose:w.poseSnapshot(),worker:w.telemetry,fingers:grips.filter(t=>t.active).map(t=>{const side=t.side===1?'R':'L',inverse=t.rotation.clone().invert();return{side,points:['index','middle','ring','little'].flatMap(d=>[1,2,3].map(j=>w.point(`${d}.0${j}.${side}`).sub(t.center).applyQuaternion(inverse).toArray()))};}),grips:grips.map(t=>({side:t.side,center:t.center.toArray(),rotation:t.rotation.toArray(),section:t.section,active:t.active}))};});report.push({name,...data,frameErrors});await p.screenshot({path:`${out}/${name}.png`});
 await p.evaluate(async swapped=>{const g=window.__wireTheHouse,c=g.renderer.camera,v=g.modelInspector.camera,grips=g.mixing.active?g.mixing.anatomicalGrips():g.fpsRig.anatomicalGrips(),grip=grips.find(t=>t.side===(swapped?1:-1));v.position.copy(grip.center).add(c.position.clone().sub(grip.center).normalize().multiplyScalar(.38));v.lookAt(grip.center);v.aspect=c.aspect;v.fov=42;v.updateProjectionMatrix();g.renderer.viewCamera=v;g.renderer.render();await g.renderer.waitForFrame();},swapped);
 const style=await p.addStyleTag({content:'#game-shell > :not(#game-stage){visibility:hidden!important}'});await p.screenshot({path:`${out}/${name}-detail.png`});await style.evaluate(e=>e.remove());
 if(name==='idle'){
  await p.evaluate(async swapped=>{const g=window.__wireTheHouse,v=g.modelInspector.camera,t=(g.mixing.active?g.mixing.anatomicalGrips():g.fpsRig.anatomicalGrips()).find(t=>t.side===(swapped?1:-1)),axis=t.center.clone().set(0,1,0).applyQuaternion(t.rotation);v.position.copy(t.center).add(axis.set(.28,-.14,.10));v.lookAt(t.center);g.renderer.render();await g.renderer.waitForFrame();},swapped);
  await p.screenshot({path:`${out}/palm-detail.png`});
 }
 const stopped=await p.evaluate(()=>{const g=window.__wireTheHouse,frames=[];for(let i=0;i<48;i++){window.contactStep(1/60,0,false);frames.push({...g.workerBody.telemetry.gripReachErrors});}return{velocity:g.player.velocity.toArray(),frames};});report.at(-1).stopped=stopped;
}
if(process.argv.includes('--performance')){
 const performanceReport=await p.evaluate(async()=>{const g=window.__wireTheHouse;g.renderer.viewCamera=null;const cpu=[],frames=[];let last=performance.now();for(let i=0;i<120;i++){await new Promise(requestAnimationFrame);const start=performance.now();window.contactStep(1/60,0,false);g.renderer.render();await g.renderer.waitForFrame();if(i>=30){cpu.push(performance.now()-start);frames.push(start-last);}last=start;}const q=(a,p)=>[...a].sort((a,b)=>a-b)[Math.floor((a.length-1)*p)];return{viewport:[innerWidth,innerHeight],browser:navigator.userAgent,cpuP95Ms:q(cpu,.95),frameP95Ms:q(frames,.95),frameMaxMs:Math.max(...frames),framesOver50ms:frames.filter(n=>n>50).length,render:{...g.renderer.webgl.info.render},memory:{...g.renderer.webgl.info.memory}};});
 await writeFile(`${out}/performance.json`,JSON.stringify(performanceReport,null,2));
}
if(phase!=='before')for(const r of report){
 for(const frame of [...r.frameErrors,...r.stopped.frames])for(const gap of Object.values(frame))assert(gap<.005,`${tool}/${r.name}: hand detached ${gap} m`);
 assert(Math.hypot(...r.stopped.velocity)<.025,`${r.name}: did not stop`);
 // A closed finger bends around the handle in its own transverse plane.
 // Tool sway may roll a palm around the grip, so world/posture invariance
 // would incorrectly reject legitimate arm motion.
 for(const hand of r.fingers)for(let i=0;i<hand.points.length;i+=3)for(let j=1;j<3;j++)assert(Math.abs(hand.points[i+j][1]-hand.points[i][1])<.003,`${tool}/${r.name}/${hand.side}: finger twisted along handle`);
}
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}console.log(JSON.stringify(report.map(({name,worker})=>({name,reach:worker.gripReachErrors}))));
