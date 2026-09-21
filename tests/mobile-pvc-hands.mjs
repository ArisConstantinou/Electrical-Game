import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const out=process.env.PVC_HANDS_OUT??'output/mobile-pvc-hands';await mkdir(out,{recursive:true});
const report={emulation:true,cases:[],errors:[]},browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const viewport of [{width:390,height:680},{width:844,height:390}]){
 const name=viewport.width<500?'portrait':'landscape',context=await browser.newContext({viewport,isMobile:true,hasTouch:true});await blockPointerLock(context);
 const page=await context.newPage();await page.routeWebSocket('**',()=>{});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(process.env.GAME_URL??'http://127.0.0.1:5365/Electrical-Game/');await page.locator('#start-button').tap({timeout:120000});
 await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;window.tick=g.step.bind(g);g.step=()=>{};g.mixing.finished=true;g.mixing.setActive(false);const c=g.renderer.camera;c.position.set(.9,1.65,.75);c.lookAt(3.58,1.25,1.15);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;});
 const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.tick(1/60,0,false);},n??3);
 const state=()=>page.evaluate(()=>window.__wireTheHouse.pvc.telemetry);
 const tap=async selector=>{await page.locator(selector).tap();await step();};
 const snap=async label=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}-${label}.png`});};
 const cdp=await context.newCDPSession(page);
 const hold=async n=>{const r=await page.locator('#pvc-use').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height/2,id:1}]});await step(n);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await step();};
 await step();await tap('#pvc-prompt');await step(130);assert.equal((await state()).phase,'loose');await tap('#pvc-prompt');await step(110);assert.equal((await state()).phase,'marking');await snap('marking');
 await tap('#pvc-mark-confirm');await step(60);assert.equal((await state()).phase,'spring');await snap('spring');await hold(100);assert.equal((await state()).phase,'bending');
 const poses=[];
 for(let i=0;i<10;i++){
  if(i)await tap('[data-pvc="forward"]');await hold(30);
  const pose=await page.evaluate(()=>{const g=window.__wireTheHouse;return{thumbRise:g.workerBody.point('thumb.03.R').y-g.workerBody.point('thumb.01.R').y,contacts:g.pvc.anatomicalGrips().map(c=>({side:c.side,point:c.center.toArray()})),body:g.workerBody.telemetry,hands:['L','R'].map(s=>g.workerBody.point('hand.'+s).project(g.renderer.camera).toArray())};});
  assert(pose.body.visible);for(const side of ['L','R'])assert(pose.body.fingerFit['pipeWrist'+side].bendDegrees<5,'Wrist retains its anatomical rest alignment');for(const e of Object.values(pose.body.gripReachErrors))assert(e<.008,'Hands remain seated');
  if(pose.hands.some(p=>Math.abs(p[0])>=1||Math.abs(p[1])>=1))await snap('out-of-view');
  for(const p of pose.hands)assert(Math.abs(p[0])<1&&Math.abs(p[1])<1,`Both wrists remain in view: ${name}, bend ${i+1}, ${JSON.stringify(p)}`);poses.push(pose);
  if(i===4||i===9){assert(pose.thumbRise>0,'Right thumb points upward toward the bend');assert(pose.contacts.find(c=>c.side===1).point[1]<pose.contacts.find(c=>c.side===-1).point[1],'Working hand bends downward');}if(i===4||i===9)await snap(i===4?'bend-45':'bend-90');
 }
 assert(Math.abs((await state()).angle-90)<.01);await tap('[data-pvc="undo"]');assert((await state()).angle<90);await hold(30);await tap('[data-pvc="confirm"]');assert.equal((await state()).phase,'review');
 const text=await page.locator('#pvc-prompt').textContent();assert(!/\b(E|LMB|RMB|ESC|Mouse)\b/.test(text));await snap('review');
 await tap('[data-pvc="confirm"]');await step(110);assert.equal((await state()).phase,'batch');assert.equal((await state()).prepared,1);
 report.cases.push({name,poses});await context.close();
}assert.deepEqual(report.errors,[]);report.passed=true;}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}console.log({passed:report.passed,cases:report.cases.length,errors:report.errors});
