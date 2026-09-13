import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/';
const out=process.argv[3]??'output/chisel-balanced-ui';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={url,mobileIsEmulation:true,fixture:'Initial camera placement and deterministic frame stepping only. Tilt, side, roll, approach, held percussion and release use native input. No stubbed collision, contact or damage.',scenarios:[]};
const settle=(page,n=100)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__chiselStep(1/60);},n);
const click=(page,mobile,id)=>page.locator(id)[mobile?'tap':'click']();
async function state(page){return page.evaluate(()=>{const g=window.__wireTheHouse,w=g.room.brickWall,c=g.renderer.camera,hit=g.fpsRig.contact(c,w),h=g.fpsRig.tools.get('hammer'),m=g.fpsRig.flatTip,p=c.position.clone();return {contact:!!hit,workPosition:{...g.player.workPosition},requestedTilt:w.chiselTiltDegrees,requestedSide:w.chiselSideDegrees,fit:g.fpsRig.hammerFit,edgeDegrees:w.chiselEdgeAngle*180/Math.PI,icon:document.querySelector('#chisel-edge-degrees').textContent,tip:g.fpsRig.chiselTipWorld.toArray(),camera:c.position.toArray(),pose:g.fpsRig.debugPose(),impactCount:w.impactCount,removed:w.volume.removedNodeCount,width:h.userData.nominalBladeWidthM,length:h.localToWorld(p.clone().fromArray(h.userData.tipPoint)).distanceTo(h.localToWorld(p.clone().fromArray(h.userData.chiselStartPoint))),edgeWidth:m.localToWorld(p.clone().set(-.025,0,-.05)).distanceTo(m.localToWorld(p.clone().set(.025,0,-.05))),overflow:document.documentElement.scrollWidth>innerWidth,renderError:g.renderer.renderError};});}
function arms(s){for(const a of s.pose.arms){const d=(p,q)=>Math.hypot(...p.map((v,i)=>v-q[i]));assert(Math.abs(d(a.shoulder,a.elbow)-.31)<1e-5);assert(Math.abs(d(a.elbow,a.wrist)-.27)<1e-5);}}
try{for(const mobile of [false,true]){
 const name=mobile?'mobile':'desktop',page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse);await click(page,mobile,'#start-button');await page.evaluate(()=>{document.exitPointerLock();const g=window.__wireTheHouse;window.__chiselStep=g.step.bind(g);g.step=()=>{};});
 if(mobile)await click(page,true,'[data-tool="hammer"]');else await page.keyboard.press('Digit4');
 await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;g.hammerWorkStance.restore(c);c.position.set(0,1.65,-.9);c.lookAt(0,1.3,-2.41);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});await settle(page,1);
 await page.keyboard.down('KeyE');await settle(page,40);await page.keyboard.up('KeyE');assert.equal((await state(page)).impactCount,0,'Distant action cannot remove masonry');
 let cdp=mobile?await page.context().newCDPSession(page):null;
 if(cdp){const b=await page.locator('#joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height*.1,id:2}]});}else await page.keyboard.down('KeyW');
 await settle(page,120);if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up('KeyW');await settle(page);
 const initial=await state(page);assert(initial.contact,`${name}: native approach must seat the chisel`);assert(Math.abs(initial.length-.40)<1e-6);assert(Math.abs(initial.edgeWidth-.05)<1e-6);assert.equal(initial.requestedTilt,15);
 const poses=[];
 for(const tilt of [15,30,45,55,0,-15,-30,-45,-55]){
   if(mobile){if(tilt!==15){await click(page,true,'#settings-toggle');await click(page,true,'#chisel-tilt');await click(page,true,'#settings-close');}}
   else {let current=(await state(page)).requestedTilt;while(current!==tilt){await page.keyboard.press(current<tilt?'BracketRight':'BracketLeft');current=(await state(page)).requestedTilt;}}
   await settle(page,140);const s=await state(page);arms(s);assert(s.contact,`${name}: manual tilt ${tilt} must keep contact: ${JSON.stringify(s.fit)}`);assert.equal(s.requestedTilt,tilt);assert.equal(s.overflow,false);poses.push(s);
   if([15,55,-45].includes(tilt)){await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();});await page.screenshot({path:`${out}/${name}-tilt-${tilt}.png`});}
 }
 // Return to a digging stroke; native roll must change the live icon and blade.
 if(mobile){await click(page,true,'#settings-toggle');await click(page,true,'#chisel-tilt');await click(page,true,'#chisel-angle');await click(page,true,'#settings-close');}
 else {for(let i=0;i<14;i++)await page.keyboard.press('BracketRight');await page.keyboard.press('KeyR');}
 await settle(page);const rolled=await state(page);assert.equal(rolled.edgeDegrees,45);assert.equal(rolled.icon,'45°');
 const before=rolled.impactCount;
 if(cdp){const b=await page.locator('#look-joystick').boundingBox(),p={x:b.x+b.width/2,y:b.y+b.height/2,id:3};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...p,x:p.x+4}]});}else await page.keyboard.down('KeyE');
 await settle(page,120);if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up('KeyE');const after=await state(page);assert(after.impactCount>before,`${name}: Manual tilt + roll must deliver actual impacts`);await settle(page,30);assert.equal((await state(page)).impactCount,after.impactCount,'Release must stop percussion');
 if(cdp){const b=await page.locator('#joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height*.9,id:4}]});}else await page.keyboard.down('KeyS');
 await settle(page,50);if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up('KeyS');const backedAway=await state(page);assert.equal(backedAway.workPosition.locked,false);assert(backedAway.camera[2]>after.camera[2]+.2,'Backward movement releases hammer working stance');
 assert.deepEqual(errors,[]);report.scenarios.push({name,initial,poses,rolled,after,backedAway,errors});await page.close();
}}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({url,platforms:report.scenarios.map(s=>s.name),checks:['40cm exposed length','5cm cutting edge','native approach','nine manual tilt settings','fixed arm lengths','live blade rotation','real held impacts','release','mobile overflow','backward stance release'],errors:[]}));
