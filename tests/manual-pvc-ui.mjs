import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const url=process.argv.find(x=>x.startsWith('http'))??'http://127.0.0.1:5365/Electrical-Game/';
const baseline=process.argv.includes('--baseline');
const out=`output/manual-pvc/${baseline?'before':'after'}`;await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,baseline,errors:[],checks:[]};
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.goto(url);await page.locator('#start-button').click({timeout:120000});await page.waitForTimeout(600);
 await page.evaluate(()=>{const g=window.__wireTheHouse;window.pvcStep=g.step.bind(g);g.step=()=>{};});
 const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.pvcStep(1/60);},n);
 const aim=async(position,target)=>{await page.evaluate(({position,target})=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.fromArray(position);c.lookAt(...target);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);},{position,target});await step(2);};
 const snap=async name=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}.png`});report.poses??={};report.poses[name]=await page.evaluate(()=>({pvc:window.__wireTheHouse.pvc?.telemetry,body:window.__wireTheHouse.workerBody.telemetry}));};
 const state=()=>page.evaluate(()=>window.__wireTheHouse.pvc.telemetry);
 const key=async(code,n=2)=>{await page.keyboard.down(code);await step(n);await page.keyboard.up(code);await step(2);};
 const use=async(n=2)=>{await page.mouse.down();await step(n);await page.mouse.up();await step(2);};
 let cutMouseY=400;
 const cutAt=async cm=>{const current=(await state()).cutCm;cutMouseY+=(cm-current)/.06;await page.mouse.move(1000,cutMouseY);await step(2);};
 await aim([.9,1.65,.75],[3.58,1.25,1.15]);await snap('01-stock');
 await page.keyboard.press('Digit1');await step(2);await snap('02-spring');
 report.state=JSON.parse(await page.evaluate(()=>window.render_game_to_text()));
 report.workshopPresent=await page.evaluate(()=>Boolean(window.__wireTheHouse.pvc));
 if(!baseline)assert(report.workshopPresent,'Manual PVC workflow is missing');
 if(!baseline){
  await key('KeyE');assert.equal((await state()).phase,'opening');await snap('03-opening');await step(130);assert.equal((await state()).phase,'loose');
  await key('KeyE');await step(110);assert.equal((await state()).phase,'marking');await snap('04-marking');
  assert.equal(await page.locator('#pvc-panel').count(),0,'No PVC sidebar panel');
  await key('Tab');assert.equal((await state()).markCm,140);await key('Tab');assert.equal((await state()).markCm,50);
  await page.mouse.move(1000,350);await step(2);const beforeMove=(await state()).markCm;
  await page.mouse.move(1000,355,{steps:5});await step(5);const custom=(await state()).markCm;assert(custom>beforeMove,'Small mouse movements must move the guide');
  assert.match(await page.locator('#pvc-live-measure').textContent(),new RegExp(custom.toFixed(1)));
  await key('KeyP');assert(await page.evaluate(cm=>window.__wireTheHouse.pvc.presets.some(p=>Math.abs(p.cm-cm)<.05&&!p.builtin),custom));
  assert(await page.evaluate(()=>window.__wireTheHouse.pvc.stock.liveMarks.visible));await snap('04b-live-mark');
  await page.mouse.move(1000,400);await step(2);
  for(let i=0;i<5&&(await state()).markCm!==50;i++)await key('Tab');
  assert.equal((await state()).markCm,50);await page.mouse.down();await step(60);
  assert.equal((await state()).markingProgress,1);assert.equal((await state()).phase,'spring','Finishing the line must advance without a second E');
  assert.equal((await state()).springInsertion,0);await step(30);assert.equal((await state()).phase,'spring','Held marker click must not also insert the spring');
  await page.mouse.up();await step(2);await snap('05-marked-spring-ready');
  await use();await step(100);assert.equal((await state()).phase,'bending');assert.equal((await state()).springInsertion,1);
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.pipe.material.opacity),1);await key('KeyR');assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.pipe.material.opacity),.4);await snap('07-spring-inside');
  await key('KeyE');assert.equal((await state()).phase,'bending','E must not bend automatically');
  await page.mouse.move(1000,400);await page.mouse.down();await step(65);await page.mouse.up();await step(2);assert.equal((await state()).angle,9,'Holding in one place must stop locally');
  for(let cell=1;cell<10;cell++){
    await key('KeyD');assert.equal((await state()).grip,cell);
    await page.mouse.down();await step(30);await page.mouse.up();await step(2);
    if(cell===4)await snap('08-progressive-bend');
  }
  assert(Math.abs((await state()).angle-90)<1e-6);await snap('09-bent-90');
  await key('Escape');assert.equal((await state()).focused,false);const saved=(await state()).angle;
  await aim([1.2,1.65,.6],[2.2,.02,.15]);await key('KeyE');assert.equal((await state()).focused,true);assert.equal((await state()).angle,saved);
  await key('KeyE');assert.equal((await state()).phase,'review');await snap('10-review');
  for(let i=0;i<19;i++)await key('Equal',1);assert.equal((await state()).quantity,20);
  await key('KeyE');await step(100);assert.equal((await state()).phase,'batch');assert.equal((await state()).prepared,20);assert.equal((await state()).raw,0);assert.equal((await state()).total,20);
  await aim([1.7,1.65,.4],[2.85,.03,.1]);await snap('11-batch');await key('KeyE');assert.equal((await state()).phase,'carrying');assert.equal((await state()).prepared,19);await snap('12-carry');
  report.checks.push('stock -> marking -> spring -> ten local bends -> 90 degrees -> pause/resume -> batch 20 -> carry');
  // This checkout already supplies real bonded boxes and physically carved lanes.
  const targetPose=await page.evaluate(()=>{
    const g=window.__wireTheHouse,p=g.mission.points[0],pos=p.boxGroup.getWorldPosition(g.renderer.camera.position.clone());
    return{camera:[pos.x,.95,pos.z+.95],target:[pos.x,pos.y,pos.z],ready:g.mortar.ready(p)};
  });assert(targetPose.ready);
  await page.evaluate(()=>{window.__wireTheHouse.player.crouched=true;});
  await aim(targetPose.camera,targetPose.target);await key('KeyE');await step(70);assert.equal((await state()).phase,'fitting',JSON.stringify(await state()));await snap('13-fitting');
  await use();assert.equal((await state()).phase,'fitting','Cannot cut zero-length offcut');
  // Deliberately long: keep an extra 15 mm, then trim using the live readout.
  let desired=await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.pvc.target;return g.pvc.bend.topHeight-(p.boxGroup.getWorldPosition(g.renderer.camera.position.clone()).y-p.boxGroup.groupHeight/2+.015);});
  await cutAt((desired-.015)*100);await use();await step(32);assert.equal((await state()).phase,'cut');assert((await state()).fitErrorMm>10);await snap('14-long-cut');
  await key('KeyE');assert.equal((await state()).phase,'fitting');await cutAt(desired*100);await use();await step(32);assert.equal((await state()).phase,'cut');assert(Math.abs((await state()).fitErrorMm)<1);await snap('15-cut-to-fit');
  // Reject a blocked lane, then restore the same real collision implementation.
  await page.evaluate(()=>{const v=window.__wireTheHouse.room.brickWall.volume;window.pvcCavity=v.cavityBox.bind(v);v.cavityBox=()=>({clear:false});});
  await key('KeyE');assert.equal((await state()).phase,'cut','Blocked channel must reject installation');assert.match((await state()).message,/τούβλο|δάπεδο/);
  await page.evaluate(()=>{window.__wireTheHouse.room.brickWall.volume.cavityBox=window.pvcCavity;});
  await key('KeyE');await step(40);assert.equal((await state()).phase,'batch',JSON.stringify(await state()));assert.equal((await state()).installed,1);assert.equal((await state()).total,20);await snap('16-installed');
  const installed=await page.evaluate(()=>{const p=window.__wireTheHouse.mission.points[0];return{stage:p.stage,recipe:p.conduit?.userData.pvcRecipe};});assert.equal(installed.stage,'complete');assert.equal(installed.recipe.angles.reduce((a,b)=>a+b,0),90);
  await key('KeyR');assert.equal(await page.evaluate(()=>window.__wireTheHouse.mission.points[0].conduit.children[0].material.opacity),1);
  await key('KeyR');assert.equal(await page.evaluate(()=>window.__wireTheHouse.mission.points[0].conduit.children[0].material.opacity),.4);
  report.checks.push('prepared bonded box -> fit -> long cut -> re-cut -> blocked-lane rejection -> actual formed pipe installed; R toggles held and installed PVC');report.pvc=await state();
 }
 report.errors=report.errors.filter(message=>message!=='Pointer Lock disabled for automated verification');
 assert.equal(report.errors.length,0,report.errors.join('\n'));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({url,baseline,errors:report.errors,checks:report.checks,workshopPresent:report.workshopPresent}));
