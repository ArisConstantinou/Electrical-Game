import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/mobile-aligned-controls';await mkdir(out,{recursive:true});
const report={mobileIsEmulation:true,cases:[],errors:[]},browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const viewport of [{width:390,height:844},{width:844,height:390},{width:320,height:740},{width:667,height:375}]){
 const name=(viewport.width<viewport.height?'portrait':'landscape')+'-'+viewport.width,context=await browser.newContext({viewport,isMobile:true,hasTouch:true,deviceScaleFactor:1});await blockPointerLock(context);
 const page=await context.newPage();await page.routeWebSocket('**',()=>{});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.locator('#start-button').tap({timeout:120000});await page.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded);await page.waitForTimeout(1200);
 await page.evaluate(()=>{const g=window.__wireTheHouse;window.controlStep=g.step.bind(g);g.step=()=>{};g.renderer.camera.position.set(.7,1.65,-.5);g.player.yaw=0;g.player.pitch=-.3;});
 const step=async(n=1)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.controlStep(1/60,0,false);},n);
 const state=()=>page.evaluate(()=>{const g=window.__wireTheHouse;return{move:{...g.input.mobileMove},look:{...g.input.mobileLook},held:g.input.actionHeld,driving:g.mixing.wheelbarrow.driving,fast:g.mixing.wheelbarrow.mobileFast,speed:g.mixing.wheelbarrow.speed,yaw:g.player.yaw,position:g.renderer.camera.position.toArray()};});
 const center=async(sel)=>{const r=await page.locator(sel).boundingBox();assert(r,sel+' visible');return{...r,x:r.x+r.width/2,y:r.y+r.height/2,r:r.width/2};};
 const left=await center('#joystick'),right=await center('#look-joystick');assert(Math.abs(left.y-right.y)<1,'Pads share horizontal centre line');assert.equal(left.width,right.width);
 const cdp=await context.newCDPSession(page),points=new Map();
 const down=async(id,x,y)=>{points.set(id,{id,x,y});await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[...points.values()]});};
 const move=async(id,x,y)=>{points.set(id,{id,x,y});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[...points.values()]});};
 const cancel=async()=>{points.clear();await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});};
 const responses=[];
 for(const fraction of [0,.04,.12,.25,.5,1]){
  await down(1,left.x,left.y);await move(1,left.x+left.r*fraction,left.y);const s=await state();responses.push({fraction,value:s.move.x});assert.equal(s.move.y,0);
  if(fraction<=.04)assert.equal(s.move.x,0,'Small finger jitter remains neutral');else assert(s.move.x>0&&s.move.x<=1);
  const held=await center('#joystick');assert.equal(held.y,right.y,'Pad must not jump under finger');await cancel();assert.deepEqual((await state()).move,{x:0,y:0});
 }
 for(let i=2;i<responses.length;i++)assert(responses[i].value>responses[i-1].value,'Movement curve is monotonic');assert(responses[3].value<.15,'Quarter travel allows fine positioning');assert(responses.at(-1).value>.99);
 await down(1,left.x+8,left.y+5);assert.deepEqual((await state()).move,{x:0,y:0},'Off-centre press starts neutral');await move(1,left.x+8+left.r,left.y+5-left.r);assert(Math.abs(Math.hypot(...Object.values((await state()).move))-1)<1e-5,'Diagonal speed bounded');
 await down(2,right.x,right.y);await move(2,right.x+right.r*.3,right.y);let s=await state();assert(s.held&&s.move.x>0&&s.look.x>0,'Independent move, aim and held use');await step(12);await cancel();s=await state();assert(!s.held);assert.deepEqual(s.move,{x:0,y:0});assert.deepEqual(s.look,{x:0,y:0});
 await step();await page.evaluate(async()=>{const g=window.__wireTheHouse;g.renderer.render();await g.renderer.waitForFrame();});await page.screenshot({path:`${out}/${name}-aligned.png`});
 // Place the player near the real tray, then use its actual touch interaction.
 await page.evaluate(()=>{const g=window.__wireTheHouse,cart=g.mixing.wheelbarrow,root=cart.model.group;g.mixing.setActive(false);g.player.velocity.set(0,0,0);g.renderer.camera.position.copy(root.localToWorld(g.renderer.camera.position.clone().set(0,1.65,-1.1)));g.player.yaw=root.rotation.y+Math.PI;g.player.pitch=-.60;});await step(3);
 await page.locator('#mobile-interact').tap();await step(90);assert((await state()).driving,'Touch enters wheelbarrow');
 const release=await center('#cart-release'),fast=await center('#cart-fast');for(const b of [release,fast]){assert(b.x-b.width/2>=0&&b.y-b.height/2>=0&&b.x+b.width/2<=viewport.width&&b.y+b.height/2<=viewport.height);assert(b.height>=44);}
 await down(1,left.x,left.y);await move(1,left.x,left.y-left.r*.5);await step(20);const normal=await state();assert(normal.speed>.05);
 await down(3,fast.x,fast.y);await step(20);assert((await state()).fast,'Hold enables cart fast movement');await cancel();assert(!(await state()).fast,'Canceled fast hold resets');
 await page.evaluate(async()=>{const g=window.__wireTheHouse;g.renderer.render();await g.renderer.waitForFrame();});await page.screenshot({path:`${out}/${name}-wheelbarrow.png`});
 await page.locator('#cart-release').tap();await step(2);assert(!(await state()).driving,'Touch releases wheelbarrow');
 report.cases.push({name,left,right,responses,normal,release,fast});await context.close();
 }assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}console.log({passed:report.passed,cases:report.cases.length,errors:report.errors});
