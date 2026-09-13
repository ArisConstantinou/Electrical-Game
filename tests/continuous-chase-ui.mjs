import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';

const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/';
const out=process.argv[3]??'output/continuous-chase-ui';
const baseline=process.env.CHASE_BASELINE==='1';
await mkdir(out,{recursive:true});
const report={url,baseline,mobileIsEmulation:true,fixture:'Pristine real wall and deterministic camera/clock placement. Native held tool, strafe and speed controls. No fabricated damage/contact.',cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
const step=(page,n)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__chaseStep(1/60);},n);
async function capture(page,path){
  await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();window.__chaseStep(0);await r.waitForFrame();});
  await page.screenshot({path});
}
const state=page=>page.evaluate(()=>{const g=window.__wireTheHouse,w=g.room.brickWall,c=g.renderer.camera,r=g.fpsRig,v=c.getWorldDirection(c.position.clone()),focus=c.position.clone().addScaledVector(v,(w.volume.frontZ-c.position.z)/v.z);return {camera:c.position.toArray(),focus:focus.toArray(),yaw:g.player.yaw,pitch:g.player.pitch,tip:r.chiselTipWorld.toArray(),locked:g.player.workPosition.locked,reachable:r.reachable,inAir:r.chiselInAir,reason:r.reachReason,fit:structuredClone(r.hammerFit),pose:r.debugPose(),impacts:w.impactCount,removed:w.volume.removedNodeCount,volume:w.volume.removedVolume,speed:g.hammerSpeed,held:g.input.actionHeld,keys:[...g.input.keys],fragments:g.chasing.activeFragmentCount,rubble:g.chasing.particles.map(p=>({size:[p.halfWidth*2,p.halfHeight*2,p.halfDepth*2],volume:p.mesh.userData.volume,actual:p.mesh.userData.actualFractureGeometry,detached:p.mesh.userData.detached})),renderError:g.renderer.renderError};});
try{for(const mobile of (baseline?[false]:[false,true])){
  const platform=mobile?'mobile':'desktop',context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile}),page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.renderer.renderCamera,{timeout:120000});
  await page.locator('#start-button')[mobile?'tap':'click']();await page.waitForTimeout(800);
  await page.evaluate(()=>{document.exitPointerLock();const g=window.__wireTheHouse;window.__chaseStep=g.step.bind(g);g.step=()=>{};window.__chasePristine=g.room.brickWall.volume.serialize();});
  const click=id=>page.locator(id)[mobile?'tap':'click']();
  if(mobile){await click('[data-tool="hammer"]');await click('#settings-toggle');await click('#aim-control-mode');await click('#settings-close');}else await page.keyboard.press('Digit4');
  await step(page,2);
  const cdp=mobile?await context.newCDPSession(page):null;
  let touches=[];
  async function touch(type,next){touches=next;await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:touches});}
  async function hold(on){if(!mobile){await page.keyboard[on?'down':'up']('KeyE');return;}if(on){const b=await page.locator('#look-joystick').boundingBox(),p={x:b.x+b.width/2,y:b.y+b.height/2,id:5};await touch('touchStart',[p]);await touch('touchEnd',[]);await touch('touchStart',[p]);}else await touch('touchEnd',[]);}
  async function move(direction,on){if(!mobile){await page.keyboard[on?'down':'up'](direction==='left'?'KeyA':direction==='right'?'KeyD':direction==='back'?'KeyS':'KeyW');return;}if(on){const b=await page.locator('#joystick').boundingBox(),p={x:b.x+b.width*(direction==='left'?.16:direction==='right'?.84:.5),y:b.y+b.height*(direction==='back'?.84:direction==='forward'?.16:.5),id:8};await touch('touchStart',[...touches.filter(t=>t.id!==8),p]);}else await touch('touchEnd',touches.filter(t=>t.id!==8));}
  async function setSpeed(speed){
    await click('#settings-toggle');const slider=page.locator('#hammer-speed');
    if(!baseline)assert.equal(await slider.getAttribute('max'),'800','Missing 8x speed range');
    await slider.focus();await page.keyboard.press('Home');for(let i=0;i<Math.round(speed*100/25);i++)await page.keyboard.press('ArrowRight');await click('#settings-close');await step(page,3);
  }
  async function fixture(speed,side){
    await page.evaluate(side=>{const g=window.__wireTheHouse,c=g.renderer.camera,w=g.room.brickWall;g.hammerWorkStance.restore(c);g.player.workPosition.locked=false;g.player.workPosition.released=false;w.volume.restore(window.__chasePristine);w.flushGeometry();c.position.set(Math.tan(side*65*Math.PI/180)*.46,1.65,w.volume.frontZ+.46);c.lookAt(0,1.3,w.volume.frontZ);g.player.yaw=side*65*Math.PI/180;g.player.pitch=c.rotation.x;w.chiselTiltDegrees=55;w.chiselSideDegrees=-side*25;},side);
    await step(page,160);await move('forward',true);for(let i=0;i<120;i++){await step(page,1);if((await state(page)).locked)break;}await move('forward',false);await step(page,160);
    await setSpeed(speed);
  }
  for(const side of (baseline?[1]:[-1,1]))for(const speed of (baseline?[Number(process.env.CHASE_SPEED??1)]:[2.5,8])){
    await fixture(speed,side);const initial=await state(page),result={platform,side,speed,initial,stationary:[],left:[],right:[]};report.cases.push(result);await hold(true);
    for(let i=0;i<20;i++){await step(page,30);result.stationary.push(await state(page));}
    await capture(page,`${out}/${platform}-${side}-${speed}-stationary.png`);
    // Equal short wall spans at both rates, rather than running out of the room.
    // At 8x each sample covers ~10 cm; at 2.5x ~9.4 cm.
    const moveFrames=speed>=8?10:30;
    await move('left',true);for(let i=0;i<10;i++){await step(page,moveFrames);result.left.push(await state(page));}await move('left',false);
    await capture(page,`${out}/${platform}-${side}-${speed}-left.png`);
    await move('right',true);for(let i=0;i<8;i++){await step(page,moveFrames);result.right.push(await state(page));}await move('right',false);await hold(false);await step(page,1);
    await capture(page,`${out}/${platform}-${side}-${speed}-right.png`);
    await setSpeed(0);await hold(true);result.stoppedBefore=await state(page);await step(page,120);result.stoppedAfter=await state(page);await hold(false);
    await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
    if(!baseline){assert(initial.locked,'Native approach did not lock work stance');assert.equal(result.stoppedAfter.speed,0);assert.equal(result.stoppedAfter.impacts,result.stoppedBefore.impacts,'0% must stop percussion');assert.equal(result.stoppedAfter.volume,result.stoppedBefore.volume,'0% must preserve wall material');let previousTip=initial.tip;for(const s of result.stationary){assert(s.tip[2]<=previousTip[2]+.001,'Empty chamber caused bit to withdraw from existing hole');if(s.inAir){assert((s.tip[0]-previousTip[0])*side<.003,'Empty chamber caused sideways bit withdrawal');assert(s.tip[1]-previousTip[1]<.003,'Empty chamber caused upward bit withdrawal');}previousTip=s.tip;}assert.equal(initial.speed,speed,'Native speed control did not apply');for(const sample of [...result.stationary,...result.left,...result.right]){assert(sample.reachable,`${platform}/${speed}: lost physical reach (${JSON.stringify(sample.fit)})`);assert(Math.abs(sample.yaw-initial.yaw)<1e-8,'Strafe changed view yaw');assert(Math.abs(sample.pitch-initial.pitch)<1e-8,'Strafe changed view pitch');assert.equal(sample.renderError,'');assert((sample.fit.feedM??0)<=.240001,'Body feed exceeded bounded reach');for(const arm of sample.pose.arms){const d=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));assert(Math.abs(d(arm.shoulder,arm.elbow)-.31)<1e-5,'Upper arm stretched');assert(Math.abs(d(arm.elbow,arm.wrist)-.27)<1e-5,'Forearm stretched');}}assert(result.stationary.at(-1).volume>initial.volume,'Held hammer did not excavate');const leftStart=result.stationary.at(-1);assert(result.left.at(-1).focus[0]<leftStart.focus[0]-.2,'A/joystick did not traverse left along wall');assert(result.left.at(-1).volume>leftStart.volume,'Moving held hammer did not remove actual wall');assert(result.left.filter((s,i)=>s.volume>(i?result.left[i-1].volume:leftStart.volume)).length>=8,'Held A has gaps in ongoing masonry removal');const rightStart=result.left.at(-1);assert(result.right.at(-1).focus[0]>rightStart.focus[0]+.15,'D/joystick did not reverse along wall');}
  }
  await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;g.hammerWorkStance.restore(c);g.player.workPosition.locked=false;g.player.workPosition.released=true;c.position.set(0,1.65,-.8);c.lookAt(0,0,-2);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;});
  await step(page,90);await capture(page,`${out}/${platform}-actual-rubble-floor.png`);
  await setSpeed(8);await click('#settings-toggle');await page.locator('#hammer-speed').scrollIntoViewIfNeeded();
  const speedUI=await page.locator('label[for="hammer-speed"]').evaluate(e=>({font:parseFloat(getComputedStyle(e.querySelector('small')).fontSize),value:e.querySelector('output').textContent,max:e.querySelector('input').max,overflow:document.documentElement.scrollWidth>innerWidth}));
  assert.equal(speedUI.max,'800');assert.equal(speedUI.value,'800%');assert(speedUI.font>=12);assert(!speedUI.overflow);
  await capture(page,`${out}/${platform}-speed-settings.png`);await click('#settings-close');
  await context.close();
}}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
if(!baseline)for(const platform of ['desktop','mobile'])for(const side of [-1,1]){
  const slow=report.cases.find(c=>c.platform===platform&&c.side===side&&c.speed===2.5),fast=report.cases.find(c=>c.platform===platform&&c.side===side&&c.speed===8);
  const rate=c=>(c.left.at(-1).impacts-c.stationary.at(-1).impacts)/(c.speed===8?100/60:5);
  assert(rate(fast)>rate(slow)*1.8,`${platform}/${side}: 8x did not deliver faster real impacts during native strafe`);
}
assert.deepEqual(report.errors,[]);
console.log(JSON.stringify({url,baseline,cases:report.cases.length,summary:report.cases.map(c=>({platform:c.platform,side:c.side,speed:c.speed,reachFailures:[...c.stationary,...c.left,...c.right].filter(s=>!s.reachable).length,stationaryRemoved:c.stationary.at(-1).volume-c.initial.volume,leftRemoved:c.left.at(-1).volume-c.stationary.at(-1).volume,maxBodyFeed:Math.max(...c.stationary.map(s=>s.fit.feedM??0)),largestRubbleM:Math.max(...[...c.stationary,...c.left,...c.right].flatMap(s=>s.rubble??[]).flatMap(r=>r.size)),stoppedImpacts:c.stoppedAfter.impacts-c.stoppedBefore.impacts})),errors:report.errors}));


