import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const baseline=process.env.BASELINE==='1',out=`output/wheelbarrow-balance/${baseline?'before':'after'}`;
await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true}),report={errors:[]};
try{
 const context=await browser.newContext({viewport:{width:1100,height:900}});await blockPointerLock(context);const page=await context.newPage();await page.routeWebSocket('**',()=>{});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.locator('#start-button').click({timeout:120000});await page.waitForFunction(()=>window.__wireTheHouse.workerBody.loaded);
 report.cases=await page.evaluate(()=>{
  const g=window.__wireTheHouse,w=g.mixing.wheelbarrow;g.step=()=>{};const allowed=w.positionAllowed.bind(w),emit=w.emit.bind(w),results=[];let exits=[];
  w.emit=mass=>{exits.push(w.spillPoint.toArray());emit(mass);};
  const reset=()=>{g.input.keys.clear();w.release();w.state='parked';w.pitch=w.roll=w.pitchSpeed=w.rollSpeed=0;w.tipExposure=0;w.massKg=114;w.shovelKg=w.consumedKg=0;w.parcels.length=0;w.mortarSlump.reset(3185);w.model.group.position.set(1.2,0,-.8);w.yaw=0;w.model.group.rotation.set(0,0,0);w.update(0);w.enter();};
  window.cartLoadFeedback=[];
  for(const side of [-1,1])for(const displaced of [false,true]){reset();w.roll=side*.2;w.mortarSlump.loadOffset.set(displaced?-side*.12:0,0);w.step(1/120);window.cartLoadFeedback.push({side,displaced,roll:w.roll,rollSpeed:w.rollSpeed});}
  // Open-ground fixture isolates acceleration from room props. The native UI
  // suite separately retains actual collision geometry and interactions.
  for(const key of ['KeyW','KeyS','KeyA','KeyD'])for(const impact of [false,true]){
   reset();let elapsed=0;w.positionAllowed=()=>!impact||elapsed<1.1;g.input.keys.add(key);g.input.keys.add('ShiftLeft');let peak=0;
   for(let i=0;i<360;i++){elapsed=i/120;w.update(1/120);peak=Math.max(peak,w.stability);if(i===132)g.input.keys.clear();}
   results.push({key,impact,peak,...w.telemetry});
  }
  for(const side of [-1,1]){
   reset();w.positionAllowed=()=>true;g.input.keys.add('KeyW');g.input.keys.add('ShiftLeft');let peak=0;
   for(let i=0;i<390;i++){if(i===150)g.player.yaw+=side*Math.PI*.85;w.update(1/120);peak=Math.max(peak,w.stability);}
   results.push({steering:side,peak,...w.telemetry});
  }
  // Controlled severe tilts exercise every rim, without a front-only outlet.
  for(const angle of [.55,1.4])for(const [name,pitch,roll] of [['front',angle,0],['back',-angle,0],['left',0,angle],['right',0,-angle]]){
   reset();exits=[];w.release();w.state='flipped';w.pitch=pitch;w.roll=roll;w.positionAllowed=()=>true;for(let i=0;i<300;i++)w.update(1/120);
   const inverse=w.model.group.matrixWorld.clone().invert(),points=w.parcels.map(p=>p.position.clone().applyMatrix4(inverse));
   results.push({name,angle,...w.telemetry,exits,points:points.map(p=>p.toArray())});
  }
  w.positionAllowed=allowed;w.emit=emit;return results;
 });
 report.loadFeedback=await page.evaluate(()=>window.cartLoadFeedback);
 for(const side of [-1,1]){const pair=report.loadFeedback.filter(p=>p.side===side);assert(pair[1].rollSpeed*side>pair[0].rollSpeed*side+.02,'Downhill retained weight must reinforce the matching lean');}
 console.log(JSON.stringify(report.cases.map(({key,impact,name,state,peak,massKg,roll,pitch})=>({key,impact,name,state,peak,massKg,roll,pitch}))));
 if(!baseline){for(const c of report.cases){assert(Math.abs(c.totalKg-114)<1e-6);if(c.steering)assert.equal(c.state,'flipped','A violent running turn can overwhelm balance');else if(c.key)assert.equal(c.state,c.impact?'flipped':'driving',`${c.key} ${c.impact?'hard impact':'ordinary sprint'}`);else{assert(c.massKg<(c.angle>1?10:113.9),`${c.name} rim must spill at ${c.angle}`);const axis=c.name==='front'||c.name==='back'?2:0,sign=c.name==='front'||c.name==='right'?1:-1;assert(c.exits.every(p=>p[axis]*sign>0),`${c.name}: clumps must leave the downhill side`);}}}
 assert.deepEqual(report.errors,[]);
 // Expire messages from the earlier severe-impact fixtures before capturing
 // controlled subcritical tilts; simulation time was deliberately frozen.
 await page.waitForTimeout(2600);await page.evaluate(()=>{const g=window.__wireTheHouse;g.hud.update(g.mission.activePoint,false,g.mission.progress,g.selectedTool);});
 for(const side of [-1,1])for(const frames of [0,90,240]){
  const data=await page.evaluate(async({side,frames})=>{
   const g=window.__wireTheHouse,w=g.mixing.wheelbarrow;g.fpsRig.visible=g.workerBody.visible=false;g.input.keys.clear();w.release();w.state='flipped';w.pitch=0;w.roll=side*.55;w.pitchSpeed=w.rollSpeed=0;w.massKg=114;w.parcels.length=0;w.shovelKg=w.consumedKg=0;w.mortarSlump.reset(3185);w.yaw=0;w.model.group.position.set(1.2,0,-.8);w.update(0);for(let i=0;i<frames;i++)w.update(1/120);
   const c=g.renderer.camera,center=w.model.group.localToWorld(c.position.clone().set(0,.65,0));c.position.copy(center).add({x:0,y:1.1,z:-.95});c.lookAt(center);g.renderer.render();await g.renderer.waitForFrame();return w.telemetry;
  },{side,frames});(report.motion??=[]).push({side,frames,...data});await page.screenshot({path:`${out}/tilt-${side}-${frames}.png`});
 }
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
