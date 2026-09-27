import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';
const baseline=process.argv.includes('--baseline'),live=process.argv.includes('--live');
const out=process.env.PVC_FALL_OUT??`output/pvc-full-cut-fall/${baseline?'before':'after'}`,url='http://127.0.0.1:5365/Electrical-Game/';
await mkdir(out,{recursive:true});const report={baseline,url,errors:[],cases:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const viewport of [{width:1095,height:1139},{width:390,height:844}]){
 const mobile=viewport.width===390,name=mobile?'touch':'desktop';
 const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);
 if(!live)await serveTaskBuild(context,url);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(url);await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click({timeout:120000});await page.waitForFunction(()=>window.__wireTheHouse.started);
 await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;window.fallTick=g.step.bind(g);g.step=()=>{};g.player.update=()=>{};g.mixing.finished=true;g.mixing.setActive(false);
  const p=g.pvc,c=g.renderer.camera,box=g.mission.points[1].boxGroup.getWorldPosition(c.position.clone());
  p.bend=new p.bend.constructor(.9);p.bend.angles.fill(90/16);p.quantity=1;p.phase='extracting';p.elapsed=1.5;p.animate(.01);
  c.position.set(box.x,.95,box.z+.95);c.lookAt(box);g.player.crouched=true;g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);
 });
 const tick=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.fallTick(1/60,0,true);},n);
 const key=async code=>{await page.keyboard.down(code);await tick(2);await page.keyboard.up(code);await tick(2);};
 const snap=async suffix=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}-${suffix}.png`});};
 const move=async s=>{await page.evaluate(s=>{const g=window.__wireTheHouse;g.player.lookHandler(0,(s-g.pvc.cutS)/.0006);},s);await tick(3);};
 const row={name,checks:[],falls:[]};report.cases.push(row);const check=(name,pass,detail)=>{row.checks.push({name,pass,detail});if(!baseline)assert(pass,`${name}: ${JSON.stringify(detail)}`);};
 await key('KeyE');await tick(70);assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.phase),'fitting');
 // Move the support above the intended low cut. Both travel directions are
 // tested on actual remaining material, with no casing-height safety band.
 await page.evaluate(()=>{window.__wireTheHouse.pvc.supportS=.20;});await tick(3);
 await move(.90);check('cursor reaches below the old box band',await page.evaluate(()=>Math.abs(window.__wireTheHouse.pvc.cutS-.90)<1e-6),await page.evaluate(()=>window.__wireTheHouse.pvc.cutS));
 await move(1.098);check('cursor reaches the bottom of the upright curve',await page.evaluate(()=>Math.abs(window.__wireTheHouse.pvc.cutS-1.098)<1e-6),await page.evaluate(()=>window.__wireTheHouse.pvc.cutS));
 await snap('bottom');
 // Hold low on the retained pipe; moving the cutter up leaves this hand still.
 await page.evaluate(()=>{const p=window.__wireTheHouse.pvc;p.supportS=.85;p.cutS=.65;p.phase='fitting';});await tick(15);
 await move(.05);await tick(70);const high=await page.evaluate(()=>{const p=window.__wireTheHouse.pvc;return{cut:p.cutS,hand:p.supportS,gap:p.supportPlaneGap(p.supportS)};});
 check('cursor reaches the top while support stays independently low',Math.abs(high.cut-.05)<1e-6&&Math.abs(high.hand-.85)<1e-6,high);await snap('top');
 await move(.35);await tick(15);
 const cut=async()=>{if(baseline){await page.mouse.down();await tick(1);await page.mouse.up();}else{if(mobile)await page.locator('#pvc-cut-confirm').tap();else await page.locator('#pvc-cut-confirm').click();await tick(1);}await tick(27);};
 // This is intentionally overlong; it must remain genuinely cut and trimmable.
 await cut();assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.phase),'cut');
 const state=()=>page.evaluate(()=>{const g=window.__wireTheHouse,p=g.pvc,m=p.offcuts.at(-1),b=m.geometry.boundingBox,c=b.getCenter(g.renderer.camera.position.clone());return{phase:p.phase,cutFrom:p.cutFrom,cutHeight:p.bend.topHeight-p.bend.at(p.cutFrom).x,cutS:p.cutS,centre:m.localToWorld(c).toArray(),quaternion:m.quaternion.toArray(),motion:p.offcutMotion?.telemetry??null,offcuts:p.offcuts.length,total:p.telemetry.totalAll};});
 const release=await state();row.falls.push(release);await snap('release');
 check('detached geometry starts at the actual elevated cut',release.centre[1]>.65,release);
 await tick(12);const falling=await state();row.falls.push(falling);await snap('falling');
 check('real offcut geometry falls and rotates',falling.centre[1]<release.centre[1]-.04&&falling.quaternion.some((q,i)=>Math.abs(q-release.quaternion[i])>.01),{release,falling});
 await tick(25);row.falls.push(await state());await snap('impact');await tick(210);const floor=await state();row.falls.push(floor);
 // The release/fall/impact view is unchanged. Look down for the separate
 // floor receipt, after motion has finished; never move the actual offcut.
 await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.pvc,c=g.renderer.camera,b=p.target.boxGroup.getWorldPosition(c.position.clone());c.position.set(b.x,.6,b.z+1.0);c.lookAt(b.x,.10,b.z+.25);p.cameraDestination.copy(c.position);p.targetRotation.copy(c.quaternion);});await tick(1);await snap('floor');
 check('offcut rests on the floor',floor.centre[1]<.02&&(!floor.motion||floor.motion.at(-1).settled),floor);
 if(baseline){await context.close();continue;}
 await key('KeyE');assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.phase),'fitting');
 await move(.50);await cut();const again=await state();check('overlong pipe can be cut again',again.offcuts===2&&Math.abs(again.cutFrom-.50)<1e-6&&again.cutHeight>.30,again);
 await key('KeyE');await page.locator('#pvc-cut-flush').click();await tick(15);
 check('flush preset reaches the actual box after repeated trimming',await page.evaluate(()=>{const t=window.__wireTheHouse.pvc.telemetry;return Math.abs(t.cutHeightCm-t.entryHeightCm)<.00001;}),await page.evaluate(()=>window.__wireTheHouse.pvc.telemetry));
 await cut();const final=await state();check('three actual offcuts and inventory conservation',final.offcuts===3&&final.total===100,final);
 if(mobile){const b=await page.locator('#joystick').boundingBox(),cdp=await context.newCDPSession(page),x=b.x+b.width/2,y=b.y+b.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x,y:y+b.height*.45}]});await tick(20);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
 else{await page.keyboard.down('KeyS');await tick(20);await page.keyboard.up('KeyS');}
 check('W/S or the left joystick independently moves the support',await page.evaluate(()=>window.__wireTheHouse.pvc.supportS>.85),await page.evaluate(()=>window.__wireTheHouse.pvc.supportS));
 await key('Escape');await tick(240);check('gravity continues after leaving cutting mode',await page.evaluate(()=>window.__wireTheHouse.pvc.offcutMotion.telemetry.every(p=>p.settled)),await state());
 await context.close();
 }assert.deepEqual(report.errors,[]);report.passed=!baseline;
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({out,passed:report.passed,cases:report.cases.map(c=>({name:c.name,checks:c.checks})),errors:report.errors}));
