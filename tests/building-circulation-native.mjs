import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';
const out='output/building-native';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={checks:[],errors:[],note:'Real key input on Windows Chrome. Camera heading set by test; no teleport after Start. Five apprentices, actual wall-clock soak.'};
try{
 const context=await browser.newContext({viewport:{width:1366,height:768}});await blockPointerLock(context);await routeBuildingDist(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});
 await page.locator('#apprentice-count').selectOption('5');await page.locator('#start-button').click();
 const start=Date.now();
 const walk=async(name,x,z,floor)=>{
  await page.evaluate(({x,z})=>{
   const g=window.__wireTheHouse,p=g.player;p.yaw=Math.atan2(p.camera.position.x-x,p.camera.position.z-z);p.pitch=-.06;
   // Latch the real frame crossing; browser polling can miss a short arrival
   // interval during a long render even though the player walked through it.
   window.__waypoint={reached:false,minimum:Infinity};window.__walkStep=g.step;
   g.step=function(...args){const value=window.__walkStep.apply(this,args),d=Math.hypot(p.camera.position.x-x,p.camera.position.z-z);window.__waypoint.minimum=Math.min(window.__waypoint.minimum,d);if(d<.14)window.__waypoint.reached=true;return value;};
  },{x,z});
  await page.keyboard.down('KeyW');
  try{await page.waitForFunction(()=>window.__waypoint.reached,null,{timeout:10000,polling:20});}
  catch(error){
   report.blocked={name,x,z,...await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.player,pos=p.camera.position;return {position:pos.toArray(),feet:pos.y-p.eyeHeight,contacts:p.collisionContacts,velocity:p.velocity.toArray(),crew:g.apprentice.collisionObstacles(),nearby:p.obstacleProvider().filter(o=>o.minX<pos.x+.6&&o.maxX>pos.x-.6&&o.minZ<pos.z+.6&&o.maxZ>pos.z-.6)};})};
   await page.screenshot({path:`${out}/blocked.png`});throw error;
  }
  finally{await page.keyboard.up('KeyW');await page.evaluate(()=>{window.__wireTheHouse.step=window.__walkStep;});}
  await page.waitForTimeout(180);
  const value=await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.player;return {position:p.camera.position.toArray(),feet:p.camera.position.y-p.eyeHeight,contacts:p.collisionContacts};});
  report.checks.push({name,...value,elapsedMs:Date.now()-start});
  if(floor!==undefined)assert(Math.abs(value.feet-floor)<.10,`${name} floor ${value.feet} expected ${floor}`);
 };
 await walk('initial-old-room',0,2,0);await walk('leave-old-room',0,9,0);
 await walk('user-photo-position',3.1,12.9,0);await walk('natural-foyer-approach',3.35,8.8,0);
 await walk('open-foyer-doorway',3.35,7.25,0);await walk('open-stair-forecourt',5.5,7.25,0);
 await walk('first-stair',5.5,8.14,.15);
 for(let level=1;level<=4;level++){
  const floor=3.3*level;
  await walk(`L${level}-mid`,5.5,11.64,floor-1.65);await walk(`L${level}-turn`,7.5,11.64,floor-1.65);
  await walk(`L${level}-arrival`,7.5,7.25,floor);await walk(`L${level}-room`,7.5,2.75,floor);
  await page.screenshot({path:`${out}/L${level}-room.png`,timeout:15000});
  const mainX=level<=2?9.5:level===3?9:8.5,mainZ=level<=2?-2:level===3?-.8:.15;
  await walk(`L${level}-main-front-approach`,mainX,2.75,floor);await walk(`L${level}-main-front-window`,mainX,mainZ,floor);
  await walk(`L${level}-main-front-return`,mainX,2.75,floor);await walk(`L${level}-main-door-return`,7.5,2.75,floor);
  if(level<=2){
   await walk(`L${level}-door-approach`,7.5,3.5,floor);await walk(`L${level}-veranda`,17.1,3.5,floor);
   await walk(`L${level}-east-door`,17.1,7.95,floor);await walk(`L${level}-east-room`,19.5,7.95,floor);
   await page.screenshot({path:`${out}/L${level}-east-wing.png`,timeout:15000});
   await walk(`L${level}-east-return`,17.1,7.95,floor);await walk(`L${level}-veranda-return`,17.1,3.5,floor);
   await walk(`L${level}-front-door`,15.6,3.5,floor);await walk(`L${level}-front-room`,15.6,0,floor);
   await page.screenshot({path:`${out}/L${level}-front-wing.png`});
   await walk(`L${level}-front-exit`,15.6,3.5,floor);await walk(`L${level}-main-return`,7.5,3.5,floor);
  }else{
   const door=level===3?14.9:12.8;
   await walk(`L${level}-front-door`,door,2.75,floor);await walk(`L${level}-front-room`,door,.7,floor);
   await page.screenshot({path:`${out}/L${level}-front-wing.png`});
   await walk(`L${level}-front-exit`,door,2.75,floor);await walk(`L${level}-main-return`,7.5,2.75,floor);
  }
  await walk(`L${level}-back`,7.5,7.25,floor);
  await walk(`L${level}-west-bridge`,3.7,7.25,floor);await walk(`L${level}-west-veranda`,3.7,10.4,floor);
  await walk(`L${level}-west-room`,2.1,10.4,floor);await page.screenshot({path:`${out}/L${level}-west-wing.png`});
  await walk(`L${level}-west-exit`,3.7,10.4,floor);await walk(`L${level}-west-bridge-return`,3.7,7.25,floor);await walk(`L${level}-stair-return`,7.5,7.25,floor);
  if(level<4){await walk(`L${level}-next-foot`,5.5,7.25,floor);await walk(`L${level}-next-start`,5.5,8.14,floor+.15);}
 }
 for(const floor of [9.9,6.6,3.3,0,-3.4,-6.8]){
  const half=floor<0?1.7:1.65;
  await walk(`${floor}-descend-B`,7.5,11.64,floor+half);await walk(`${floor}-mid-turn`,5.5,11.64,floor+half);
  await walk(`${floor}-descend-A`,5.5,7.25,floor);await walk(`${floor}-corridor`,7.5,7.25,floor);
  if(floor===0){
   await walk('ground-garage-approach',7.5,5.15,0);await walk('ground-garage-door',10,5.15,0);await walk('ground-garage-interior',10,2.75,0);await walk('ground-garage-return',10,5.15,0);await walk('ground-corridor-return',7.5,5.15,0);
  }else await walk(`${floor}-room-entry`,7.5,2.75,floor);
  if(floor<0){await walk(`${floor}-garage`,11,2.2,floor);await page.screenshot({path:`${out}/basement${floor}.png`});await walk(`${floor}-garage-return`,7.5,2.2,floor);}
  await walk(`${floor}-return-stair`,7.5,7.25,floor);
 }
 for(const floor of [-3.4,0]){
  await walk(`${floor}-ascend-foot`,5.5,7.25,floor-3.4);await walk(`${floor}-ascend-A`,5.5,11.64,floor-1.7);
  await walk(`${floor}-ascend-turn`,7.5,11.64,floor-1.7);await walk(`${floor}-ascend-B`,7.5,7.25,floor);
 }
 await walk('ground-stair-exit',5.5,7.25,0);await walk('ground-stair-edge',5.5,8.14,.15);await walk('clear-stair-guard',4.0,8.1,0);await walk('foyer-return',2.8,9,0);await walk('original-corridor',0,9,0);await walk('original-after-tour',0,2,0);
 while(Date.now()-start<300000){await page.waitForTimeout(Math.min(10000,300000-(Date.now()-start)));}
 await walk('soak-exit-original',0,9,0);await walk('soak-return-original',0,2,0);
 await page.screenshot({path:`${out}/original-after-five-minutes.png`});
 report.elapsedMs=Date.now()-start;assert.deepEqual(report.errors,[]);report.passed=true;
 console.log(JSON.stringify({passed:true,checks:report.checks.length,elapsedMs:report.elapsedMs}));
}catch(error){report.failure=String(error);throw error;}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
