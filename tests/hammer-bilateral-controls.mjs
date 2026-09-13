import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/',out=process.argv[3]??'output/hammer-bilateral-controls';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,mobileIsEmulation:true,fixture:'Initial camera placement and deterministic clock only. Real Q/J/K keys, visible buttons, settings and held keyboard/touch strokes. Pointer Lock blocked before navigation.',cases:[],errors:[]};
const step=(p,n=120)=>p.evaluate(async n=>{for(let i=0;i<n;i++){window.__sideStep(1/60);if((i+1)%12===0){await window.__wireTheHouse.chasing.waitForDebrisSplits();await window.__wireTheHouse.renderer.waitForFrame();}}},n);
const state=p=>p.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,h=g.fpsRig.tools.get('hammer'),V=c.position.constructor;return{requested:g.room.brickWall.chiselSideDegrees,actual:g.hammerWorkStance.sideDegrees,position:c.position.toArray(),yaw:g.player.yaw,pitch:g.player.pitch,housingX:c.worldToLocal(h.localToWorld(new V(.02,-.055,-.1))).x,pose:g.fpsRig.debugPose(),contact:!!g.fpsRig.contact(c,g.room.brickWall),left:document.querySelector('#hammer-view-left').getAttribute('aria-pressed'),right:document.querySelector('#hammer-view-right').getAttribute('aria-pressed'),impacts:g.room.brickWall.impactCount,debris:g.chasing.debrisStrikeCount,removed:g.room.brickWall.volume.removedVolume,locked:g.player.workPosition.locked,overflow:document.documentElement.scrollWidth>innerWidth,pointerLock:document.pointerLockElement?.id??null,error:g.renderer.renderError};});
const unchanged=(a,b,label)=>{assert.deepEqual(b.position,a.position,`${label}: side selection moved camera`);assert.equal(b.yaw,a.yaw);assert.equal(b.pitch,a.pitch);};
const arms=s=>{for(const a of s.pose.arms){const d=(u,v)=>Math.hypot(...u.map((x,i)=>x-v[i]));assert(Math.abs(d(a.shoulder,a.elbow)-.31)<1e-6);assert(Math.abs(d(a.elbow,a.wrist)-.27)<1e-6);}};
try{for(const mobile of[false,true]){
 const name=mobile?'mobile':'desktop',context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);const p=await context.newPage();p.on('pageerror',e=>report.errors.push(`${name}: ${e.message}`));await p.goto(url);await p.waitForFunction(()=>window.__wireTheHouse?.renderer.renderCamera,{timeout:120000});const click=id=>p.locator(id)[mobile?'tap':'click']();await click('#start-button');if(mobile)await click('[data-tool="hammer"]');else await p.keyboard.press('Digit4');
 await p.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;window.__sideStep=g.step.bind(g);g.step=()=>{};c.position.set(0,1.65,g.room.brickWall.volume.frontZ+.9);c.lookAt(0,1.3,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});await p.keyboard.down('KeyW');await step(p);await p.keyboard.up('KeyW');await step(p);let initial=await state(p);assert.equal(initial.requested,-15);assert.equal(initial.actual,-15);assert(initial.housingX>.1);assert.equal(initial.right,'true');
 const cases=[];
 for(const side of['left','right','left']){
  const before=await state(p);if(!mobile&&side==='left')await p.keyboard.press('KeyQ');else await click(`#hammer-view-${side}`);await step(p);const after=await state(p);unchanged(before,after,`${name}/${side}`);assert.equal(after.requested,side==='left'?15:-15);assert.equal(after.actual,after.requested);assert.equal(after[side],'true');assert(after.housingX*(side==='left'?-1:1)>.1);assert(after.contact);arms(after);assert.equal(after.pose.arms.find(a=>a.gripRole==='rear').side,side==='left'?-1:1);cases.push({side,...after});
  await p.evaluate(async()=>{const g=window.__wireTheHouse;await g.renderer.waitForFrame();window.__sideStep(0);await g.renderer.waitForFrame();});await p.screenshot({path:`${out}/${name}-${side}.png`});
 }
 // J/K use exact signed angles, including a true wall-normal zero.
 for(const target of[0,-5,5,-25,25,0]){
  if(mobile&&Math.abs(target)===25){await click('#settings-toggle');let current=(await state(p)).requested;for(let i=0;current!==target&&i<20;i++){await click('#chisel-side');current=(await state(p)).requested;}await click('#settings-close');assert.equal(current,target);}
  else {let current=(await state(p)).requested;while(current!==target){await p.keyboard.press(current<target?'KeyJ':'KeyK');current=(await state(p)).requested;}}
  const before=await state(p);await step(p);const after=await state(p);unchanged(before,after,`${name}/exact${target}`);assert.equal(after.actual,target,`${name}: hidden side bias or deadband`);assert(after.contact,`${name}: ${target} not reachable`);arms(after);cases.push({angle:target,...after});
 }
 await click('#settings-toggle');await click('#hammer-view-toggle');await click('#settings-close');await step(p);assert.equal((await state(p)).requested,15);
 const cdp=mobile?await context.newCDPSession(p):null;
 for(const side of['left','right']){
  await click(`#hammer-view-${side}`);await step(p);const before=await state(p);
  if(mobile){const b=await p.locator('#look-joystick').boundingBox(),q={id:9,x:b.x+b.width*.5,y:b.y+b.height*.5};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[q]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...q,x:q.x+4}]});}else await p.keyboard.down('KeyE');
  await step(p,180);if(mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await p.keyboard.up('KeyE');const after=await state(p);assert(after.impacts+after.debris>before.impacts+before.debris+2,`${name}/${side}: no held physical strokes`);assert(after.removed>before.removed,`${name}/${side}: no masonry removal`);arms(after);assert.equal(after.error,'');assert.equal(after.pointerLock,null);assert.equal(after.overflow,false);cases.push({held:side,...after});
 }
 const layout=await p.evaluate(()=>[...document.querySelectorAll('.hammer-view-buttons button')].map(b=>({font:parseFloat(getComputedStyle(b).fontSize),height:b.getBoundingClientRect().height,width:b.getBoundingClientRect().width})));
 assert(layout.every(b=>b.font>=12&&b.height>=44&&b.width>=44));report.cases.push({name,cases,layout});console.log(JSON.stringify({name,pass:true,requestedAngles:cases.filter(c=>c.angle!==undefined).map(c=>c.actual),held:cases.filter(c=>c.held).map(c=>({side:c.held,impacts:c.impacts,debris:c.debris})),layout}));await context.close();
}assert.deepEqual(report.errors,[]);report.passed=true;
}catch(e){report.failure=String(e.stack??e);throw e;}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
