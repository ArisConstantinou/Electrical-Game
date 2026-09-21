import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {routeLocalDist} from './local-dist-route.mjs';
await mkdir('output/mobile-wheelbarrow-spill',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await blockPointerLock(context);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await routeLocalDist(page);
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.locator('#start-button').tap({timeout:120000});
 await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;window.testStep=g.step.bind(g);g.step=()=>{};g.mixing.finished=true;g.mixing.setActive(false);const w=g.mixing.wheelbarrow;w.model.group.position.set(0,0,1);w.yaw=0;w.mortarSlump.reset(3185);w.massKg=114;w.enter();});
 const step=async(n)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.testStep(1/60);},n);
 await step(5);const center=async sel=>{const r=await page.locator(sel).boundingBox();assert(r);return{x:r.x+r.width/2,y:r.y+r.height/2,r:r.width/2,width:r.width,height:r.height};};
 const tip=await center('#cart-tip'),cdp=await context.newCDPSession(page),points=new Map();
 assert(tip.width>=75&&tip.height>=44&&tip.x-tip.width/2>=0&&tip.x+tip.width/2<=390);
 await page.screenshot({path:'output/mobile-wheelbarrow-spill/before.png'});
 const send=async(type)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:[...points.values()]});
 points.set(1,{id:1,x:tip.x,y:tip.y});await send('touchStart');
 const samples=[];for(let i=0;i<12;i++){await step(20);samples.push(await page.evaluate(()=>{const w=window.__wireTheHouse.mixing.wheelbarrow;return{state:w.state,speed:w.speed,roll:w.roll,pitch:w.pitch,stability:w.stability,massKg:w.massKg,yaw:w.yaw,playerYaw:window.__wireTheHouse.player.yaw};}));if(samples.at(-1).state==='flipped')break;}
 points.clear();await send('touchEnd');
 assert.equal(samples.at(-1).state,'flipped','Holding mobile tip must overturn a full cart');
 await step(250);const final=await page.evaluate(()=>window.__wireTheHouse.mixing.wheelbarrow.telemetry);
 assert(final.massKg<1,'Overturned cart must spill its load');assert(Math.abs(final.totalKg-114)<1e-4,'Mortar mass must be conserved');
 assert.deepEqual(errors,[]);await page.screenshot({path:'output/mobile-wheelbarrow-spill/after.png'});
 console.log(JSON.stringify({passed:true,tip,samples,final:{state:final.state,massKg:final.massKg,totalKg:final.totalKg},errors}));await context.close();
}finally{await browser.close();}
