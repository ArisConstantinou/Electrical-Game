import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {routeBuildingDist} from './building-qa-utils.mjs';
import {blockPointerLock} from './browser-safety.mjs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {launchManagedBrowser}=await import(pathToFileURL(path.join(os.homedir(),'.codex/skills/develop-web-game/scripts/browser_lifecycle.mjs')).href);
const stage=process.env.QA_STAGE??'after',out=`output/directional-jump/${stage}`;await mkdir(out,{recursive:true});
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
const report={stage,live:process.env.QA_LIVE==='1',mobileIsEmulation:true,profiles:[],errors:[]};
try{
 for(const [name,width,height,mobile] of [['desktop',1366,768,false],['phone',390,844,true],['tablet',820,1180,true],['landscape',844,390,true]]){
  if(process.env.QA_PROFILE&&process.env.QA_PROFILE!==name)continue;
  const context=await session.browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});await blockPointerLock(context);await routeBuildingDist(context);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push({name,message:e.message}));await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
  await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();
  await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;await g.renderer.waitForFrame();window.qaStep=g.step.bind(g);g.step=()=>{};g.selectTool('spray');});
  const r={name,cases:[]};report.profiles.push(r);
  const reset=async()=>page.evaluate(()=>{const g=window.__wireTheHouse,p=g.player;g.mobileControls.cancelActiveGestures();g.input.resetTransientInput();p.camera.position.set(23,1.65,-14);p.yaw=-.65;p.pitch=-.22;p.crouched=false;p.grounded=true;p.jumpOffset=0;p.verticalVelocity=0;p.jumpPreparationLeft=0;p.workPosition.locked=false;p.workPosition.released=true;for(let i=0;i<40;i++)window.qaStep(1/60,0,false);});
  const step=async(n=1)=>page.evaluate(n=>{const g=window.__wireTheHouse;for(let i=0;i<n;i++)window.qaStep(1/60,0,false);return{pos:g.player.camera.position.toArray(),velocity:g.player.velocity.toArray(),height:g.player.jumpOffset,grounded:g.player.grounded,crouched:g.player.crouched,move:{...g.input.mobileMove},look:{...g.input.mobileLook},held:g.input.actionHeld,keys:[...g.input.keys],owners:{move:g.mobileControls.joystickPointer,aim:g.mobileControls.lookActionPointer,use:g.mobileControls.usePointer}};},n);
  const screenshot=async label=>{await page.evaluate(async()=>{const g=window.__wireTheHouse;g.renderer.render();await g.renderer.waitForFrame();});await page.screenshot({path:`${out}/${name}-${label}.png`});};
  // Native key events reproduce the reset in releaseAutomaticStance, even on
  // a touch device. No injection of jumpRequested is used for acceptance.
  const dirs=mobile?[['diagonal-run',['KeyW','KeyD','ShiftLeft']]]:[['still',[]],['forward',['KeyW']],['back',['KeyS']],['left',['KeyA']],['right',['KeyD']],...['KeyW','KeyS'].flatMap(a=>['KeyA','KeyD'].flatMap(b=>[[`${a}-${b}`,[a,b]],[`${a}-${b}-run`,[a,b,'ShiftLeft']]]))];
  for(const [label,keys] of dirs){
   await reset();for(const key of keys)await page.keyboard.down(key);const start=await step(6);await page.keyboard.down('Space');const flight=await step(10);
   if(stage!=='before'){assert(flight.height>.2);for(const key of keys)assert(flight.keys.includes(key),`Jump erased ${key}`);if(keys.length)assert(Math.hypot(flight.velocity[0],flight.velocity[2])>2);}
   for(const key of keys)await page.keyboard.up(key);await page.keyboard.up('Space');const release=await step(9);
   const travel=Math.hypot(release.pos[0]-flight.pos[0],release.pos[2]-flight.pos[2]);
   if(stage!=='before'&&keys.length)assert(travel>.25,'Flight must continue after release');
   if(label==='diagonal-run'||label==='KeyW-KeyD-run')await screenshot('airborne');
   await page.keyboard.down('Space');const landed=await step(70);await page.keyboard.up('Space');if(stage!=='before')assert(landed.grounded);
   r.cases.push({label,start,flight,release,travel,landed});
  }
  if(!mobile&&stage!=='before'){
   await reset();await page.keyboard.down('KeyW');await page.keyboard.down('ShiftLeft');const run=await step(6);
   await page.mouse.click(width/2,height/2,{button:'right'});const rightClick=await step(10);
   assert(rightClick.height>.2&&rightClick.keys.includes('KeyW')&&rightClick.keys.includes('ShiftLeft'));
   assert(Math.abs(Math.hypot(rightClick.velocity[0],rightClick.velocity[2])-Math.hypot(run.velocity[0],run.velocity[2]))<1e-8,'Right-click jump must retain the actual configured running speed');
   await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');await step(70);r.cases.push({label:'right-click-running',flight:rightClick});
  }
  if(mobile){
   const controls=await page.evaluate(()=>({old:[...document.querySelectorAll('#mobile-stand,#mobile-crouch,#mobile-jump,#quick-work-height,#site-pro-use,#mobile-interact')].map(e=>e.id),overflow:document.documentElement.scrollWidth>innerWidth,labels:[document.querySelector('#joystick').getAttribute('aria-label'),document.querySelector('#look-joystick').getAttribute('aria-label')]}));r.controls=controls;
   if(stage!=='before'){assert.deepEqual(controls.old,[]);assert(!controls.overflow);}
   const cdp=await context.newCDPSession(page),touches=new Map();
   const send=async(type,id,x=0,y=0)=>{const ending=touches.get(id);if(type==='touchStart'||type==='touchMove')touches.set(id,{id,x,y,radiusX:7,radiusY:7,force:1});else touches.delete(id);if(type==='touchCancel')touches.clear();await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?(ending?[ending]:[]):type==='touchCancel'?[]:[...touches.values()]});};
   const rect=async id=>{const b=await page.locator(id).boundingBox();assert(b&&b.width>=44&&b.height>=44);assert(b.x>=0&&b.y>=0&&b.x+b.width<=width+1&&b.y+b.height<=height+1);return{x:b.x+b.width/2,y:b.y+b.height/2,w:b.width};};
   const tap=async(id,x,y)=>{await send('touchStart',id,x,y);await send('touchEnd',id);};
   if(stage!=='before')for(const mode of ['fixed','floating'])for(const aimMode of ['stick','drag']){
    await reset();await page.evaluate(({mode,aimMode})=>{const g=window.__wireTheHouse;g.movementStickMode=mode;g.mobileControls.setMovementStickMode(mode);g.hud.updateMovementStick(mode);g.aimInputMode=aimMode;g.mobileControls.setAimInputMode(aimMode);g.hud.updateAimInput(aimMode);},{mode,aimMode});
    const left=await rect('#joystick'),right=await rect('#look-joystick');
    await tap(1,left.x,left.y);await tap(2,left.x,left.y);assert((await step(12)).crouched,'Double tap must crouch');
    await tap(3,left.x,left.y);await send('touchStart',4,left.x,left.y);assert(!(await step(12)).crouched,'Next double tap must stand');
    await send('touchMove',4,left.x+left.w*.3,left.y-left.w*.3);const moving=await step(6);assert(Math.hypot(moving.move.x,moving.move.y)>.2);
    await send('touchStart',5,right.x,right.y);await page.waitForTimeout(390);const jumping=await step(10);assert(jumping.height>.2&&Math.hypot(jumping.velocity[0],jumping.velocity[2])>1,'Right hold must jump without releasing MOVE');
    await send('touchEnd',4);const release=await step(9);assert(Math.hypot(release.pos[0]-jumping.pos[0],release.pos[2]-jumping.pos[2])>.15,'Touch release retains momentum');
    const settled=await step(70);await page.waitForTimeout(390);assert((await step(8)).grounded,'Holding AIM must not repeat jumps');await send('touchEnd',5);
    await reset();await send('touchStart',6,right.x,right.y);await send('touchMove',6,right.x+25,right.y-20);await page.waitForTimeout(390);const aiming=await step(12);assert(aiming.grounded,'Dragging AIM must not jump');assert(aimMode==='drag'||Math.hypot(aiming.look.x,aiming.look.y)>.1);await send('touchEnd',6);
    await send('touchStart',7,right.x,right.y);await page.waitForTimeout(100);await send('touchEnd',7);const tapped=await step(12);assert(tapped.grounded&&tapped.held,'Short AIM tap must start use, without jumping');await tap(7,right.x,right.y);assert(!(await step()).held,'Second tap must stop continuous work');
    await send('touchStart',8,left.x,left.y);await send('touchMove',8,left.x+22,left.y-22);await tap(10,right.x,right.y);await send('touchStart',9,right.x,right.y);await send('touchMove',9,right.x+23,right.y-18);const work=await step(1);assert(work.held&&Math.hypot(work.move.x,work.move.y)>.1,'MOVE/AIM/tapped USE must stay independent');await send('touchEnd',9);const afterAimRelease=await step();assert(afterAimRelease.held,JSON.stringify({mode,aimMode,work,afterAimRelease}));await send('touchEnd',8);await tap(10,right.x,right.y);assert(!(await step()).held);
    for(const cancel of ['pointercancel','lostpointercapture','blur','settings','orientation','resize']){
     await send('touchStart',11,right.x,right.y);await page.evaluate(cancel=>{const el=document.querySelector('#look-joystick'),g=window.__wireTheHouse;if(cancel==='settings')g.hud.shell.classList.add('settings-open');else if(cancel==='blur'||cancel==='orientation'||cancel==='resize')dispatchEvent(new Event(cancel==='orientation'?'orientationchange':cancel));else el.dispatchEvent(new PointerEvent(cancel,{pointerId:g.mobileControls.lookActionPointer,pointerType:'touch',bubbles:true}));},cancel);await page.waitForTimeout(390);assert((await step(12)).grounded,`Canceled ${cancel} must not jump`);await send('touchCancel',11);await page.evaluate(()=>window.__wireTheHouse.hud.shell.classList.remove('settings-open'));
    }
    r.cases.push({mode,aimMode,moving,jumping,release,settled,gestureChecks:12});
   }
  }
  // Callback cadence diagnoses input scheduling only, not rendered FPS.
  // Presented-image performance is measured separately in jump-performance.
  await reset();await page.evaluate(()=>{const g=window.__wireTheHouse;g.step=window.qaStep;});
  r.performance=await page.evaluate(async()=>{const intervals=[];let previous=performance.now();await new Promise(resolve=>{const tick=t=>{intervals.push(t-previous);previous=t;if(intervals.length>=120)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);});const frames=intervals.slice(10).sort((a,b)=>a-b);const g=window.__wireTheHouse;return{measurement:'requestAnimationFrame callback cadence, not presented FPS',userAgent:navigator.userAgent,width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio,medianMs:frames[Math.floor(frames.length*.5)],p95Ms:frames[Math.floor(frames.length*.95)],maxMs:Math.max(...frames),over50Ms:frames.filter(f=>f>50).length,renderError:g.renderer.renderError};});
  assert.equal(r.performance.renderError,'');await screenshot('controls');await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await session.cleanup();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report.profiles.map(p=>({name:p.name,cases:p.cases.length,performance:p.performance})),null,2));
