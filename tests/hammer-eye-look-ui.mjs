import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';

const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/';
const out=process.argv[3]??'output/hammer-eye-look-ui';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,mobileIsEmulation:true,fixture:'Initial camera placement and deterministic frame stepping only. Approach, eye movement, overflow, held percussion, tool changes and withdrawal use native mouse, keyboard or touch events. The logical camera, tool matrices, contacts and damage are never stubbed.',scenarios:[]};
const settle=(page,n=1)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__eyeQAStep(1/60);},n);
const click=(page,mobile,id)=>page.locator(id)[mobile?'tap':'click']();
async function draw(page){await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();window.__eyeQAStep(0);await r.waitForFrame();});}
async function state(page){await draw(page);return page.evaluate(()=>{
  const g=window.__wireTheHouse,c=g.renderer.camera,v=g.renderer.renderCamera,h=g.fpsRig.tools.get('hammer'),tip=g.fpsRig.chiselTipWorld.clone(),p=tip.clone().project(v),r=document.querySelector('#reticle').getBoundingClientRect();h.updateWorldMatrix(true,false);
  return {gaze:{...g.player.gaze},base:{yaw:g.player.yaw,pitch:g.player.pitch},head:c.position.toArray(),logicalQuaternion:c.quaternion.toArray(),renderPosition:v.position.toArray(),renderQuaternion:v.quaternion.toArray(),toolMatrix:h.matrixWorld.toArray(),pose:g.fpsRig.debugPose(),tip:tip.toArray(),impactCount:g.room.brickWall.impactCount,removedNodes:g.room.brickWall.volume.removedNodeCount,workPosition:{...g.player.workPosition},actionHeld:g.input.actionHeld,reticle:{x:r.left+r.width/2,y:r.top+r.height/2},projected:{x:(p.x*.5+.5)*innerWidth,y:(-.5*p.y+.5)*innerHeight},renderError:g.renderer.renderError,overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight};
});}
const delta=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
function fixedWork(a,b,label){assert(Math.abs(a.base.yaw-b.base.yaw)<1e-7,`${label}: small gaze changed body yaw`);assert(Math.abs(a.base.pitch-b.base.pitch)<1e-7,`${label}: small gaze changed body pitch`);assert(delta(a.head,b.head)<1e-6,`${label}: eyes translated the head`);assert(delta(a.toolMatrix,b.toolMatrix)<1e-6,`${label}: eyes moved the held hammer`);assert(delta(a.tip,b.tip)<1e-6,`${label}: eyes moved the work point`);for(const arm of a.pose.arms){const other=b.pose.arms.find(v=>v.side===arm.side);assert(other);for(const joint of ['shoulder','elbow','wrist'])assert(delta(arm[joint],other[joint])<1e-6,`${label}: gaze moved ${arm.side} ${joint}`);}}
function reticle(s){assert(Math.hypot(s.reticle.x-s.projected.x,s.reticle.y-s.projected.y)<1.1,'Reticle must remain on the visible physical chisel tip');}
try{for(const mobile of [false,true]){
  const name=mobile?'mobile':'desktop',context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.renderer.renderCamera,{timeout:120000});await click(page,mobile,'#start-button');await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('#start-screen')).opacity)===0);
  await page.evaluate(()=>{document.exitPointerLock();const g=window.__wireTheHouse;window.__eyeQAStep=g.step.bind(g);g.step=()=>{};});
  if(mobile)await click(page,true,'[data-tool="hammer"]');else await page.keyboard.press('Digit4');
  await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;g.hammerWorkStance.restore(c);c.position.set(0,1.65,-.9);c.lookAt(0,1.3,-2.41);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});await settle(page,1);
  const cdp=mobile?await context.newCDPSession(page):null;
  async function walk(back=false,n=120){if(cdp){const b=await page.locator('#joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height*(back?.9:.1),id:9}]});}else await page.keyboard.down(back?'KeyS':'KeyW');await settle(page,n);if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up(back?'KeyS':'KeyW');await settle(page,160);}
  await walk();
  if(mobile){await click(page,true,'#settings-toggle');await click(page,true,'#aim-control-mode');await click(page,true,'#settings-close');await settle(page,1);}
  const pointer=mobile?await page.locator('#look-joystick').boundingBox():{x:683,y:384,width:0,height:0};
  let x=mobile?pointer.x+18:pointer.x,y=mobile?pointer.y+pointer.height/2:pointer.y;
  if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:3}]});
  else {await page.mouse.click(x,y,{button:'right'});await page.waitForFunction(()=>document.pointerLockElement?.id==='game-canvas');await page.mouse.move(x+1,y);x++;await settle(page,1);}
  async function move(dx,dy){x+=dx;y+=dy;if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y,id:3}]});else await page.mouse.move(x,y);await settle(page,1);}
  const initial=await state(page);assert(initial.workPosition.locked);assert(initial.gaze.enabled);assert.equal(initial.actionHeld,false);reticle(initial);await page.screenshot({path:`${out}/${name}-initial.png`});
  await move(18,-12);const small=await state(page);fixedWork(initial,small,name);assert(Math.abs(small.gaze.yaw)>0.005&&Math.abs(small.gaze.pitch)>0.001,'Native small input must actually move both eye axes');assert(delta(small.renderQuaternion,initial.renderQuaternion)>.001,'Rendered view must visibly rotate');assert(delta(small.renderPosition,initial.renderPosition)<1e-6,'Gaze must not translate the rendered camera');assert.equal(small.impactCount,initial.impactCount);reticle(small);await page.screenshot({path:`${out}/${name}-small-eye-look.png`});
  await move(-18,12);const returned=await state(page);fixedWork(initial,returned,`${name} return`);assert(Math.abs(returned.gaze.yaw)<1e-7&&Math.abs(returned.gaze.pitch)<1e-7,'Opposite input returns the eyes without moving the body');assert(delta(returned.renderQuaternion,initial.renderQuaternion)<1e-6);
  await move(18,-12);if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});const heldBefore=await state(page);
  if(cdp){await page.waitForTimeout(360);const b=await page.locator('#look-joystick').boundingBox(),p={x:b.x+b.width/2,y:b.y+b.height/2,id:4};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});}else await page.keyboard.down('KeyE');
  await settle(page,85);if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up('KeyE');const heldAfter=await state(page);assert(heldAfter.impactCount>heldBefore.impactCount,'Gaze must not disable held percussion');assert(heldAfter.removedNodes>heldBefore.removedNodes);assert(Math.abs(heldAfter.base.yaw-heldBefore.base.yaw)<1e-6&&Math.abs(heldAfter.base.pitch-heldBefore.base.pitch)<1e-6,'Looking aside must not retarget held percussion');assert(Math.hypot(heldAfter.tip[0]-heldBefore.tip[0],heldAfter.tip[1]-heldBefore.tip[1])<.035,'Held percussion must remain in the original local work area');reticle(heldAfter);
  if(cdp){x=pointer.x+18;y=pointer.y+pointer.height/2;await page.waitForTimeout(360);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:3}]});}
  await move(mobile?135:130,0);const overflow=await state(page);assert(Math.abs(overflow.gaze.yaw)<=overflow.gaze.maxYaw+1e-8);assert(Math.abs(overflow.base.yaw-heldAfter.base.yaw)>.02,'Beyond the gaze limit the body must turn');assert(delta(overflow.tip,heldAfter.tip)>.01,'Large input must move the actual work target');reticle(overflow);if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.screenshot({path:`${out}/${name}-large-look-overflow.png`});
  if(mobile)await click(page,true,'[data-tool="spray"]');else await page.keyboard.press('Digit3');await settle(page,2);const switched=await state(page);assert.equal(switched.gaze.enabled,false);assert.equal(switched.gaze.yaw,0);assert.equal(switched.gaze.pitch,0);
  if(mobile)await click(page,true,'[data-tool="hammer"]');else await page.keyboard.press('Digit4');await settle(page,160);await walk(true,60);const backedAway=await state(page);assert.equal(backedAway.workPosition.locked,false);assert.equal(backedAway.gaze.enabled,false);assert.equal(backedAway.gaze.yaw,0);assert.equal(backedAway.gaze.pitch,0);assert.equal(backedAway.overflow,false);assert.equal(backedAway.renderError,'');assert.deepEqual(errors,[]);
  let stick;
  if(mobile){
    await click(page,true,'#settings-toggle');await click(page,true,'#aim-input-mode');await click(page,true,'#settings-close');await settle(page,1);await walk();
    const stickInitial=await state(page);assert(stickInitial.gaze.enabled);assert.equal(await page.locator('#aim-input-mode b').textContent(),'STICK');
    const b=await page.locator('#look-joystick').boundingBox(),r=b.width/2;
    async function lean(sign){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+r+sign*r*.55,y:b.y+b.height/2-sign*r*.25,id:6}]});await settle(page,20);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});return state(page);}
    const stickSmall=await lean(1);fixedWork(stickInitial,stickSmall,'mobile stick');assert(Math.abs(stickSmall.gaze.yaw-stickInitial.gaze.yaw)>.002&&Math.abs(stickSmall.gaze.pitch-stickInitial.gaze.pitch)>.0005);assert.equal(stickSmall.impactCount,stickInitial.impactCount);reticle(stickSmall);await page.screenshot({path:`${out}/mobile-stick-small-eye-look.png`});
    const stickReturn=await lean(-1);fixedWork(stickInitial,stickReturn,'mobile stick return');assert(Math.abs(stickReturn.gaze.yaw-stickInitial.gaze.yaw)<1e-6&&Math.abs(stickReturn.gaze.pitch-stickInitial.gaze.pitch)<1e-6);assert.equal(stickReturn.overflow,false);stick={initial:stickInitial,small:stickSmall,returned:stickReturn};
  }
  assert.deepEqual(errors,[]);report.scenarios.push({name,initial,small,returned,heldBefore,heldAfter,overflow,switched,backedAway,stick,errors});await context.close();
}}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({url,platforms:report.scenarios.map(s=>s.name),checks:['native small gaze without body/tool movement','both eye axes','opposite return','physical tip reticle projection','held work target unchanged','bounded eye overflow turns body','tool change clears gaze','walking away clears gaze','native mobile stick gaze and return','mobile layout'],errors:[]}));
