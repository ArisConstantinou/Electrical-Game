import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {routeBuildingDist} from './building-qa-utils.mjs';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/directional-jump/tool-use';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={mobileIsEmulation:true,cases:[],errors:[]};
try{
 for(const [name,width,height] of [['phone',390,844],['tablet',820,1180]]){
  if(process.env.QA_PROFILE&&process.env.QA_PROFILE!==name)continue;
  const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:1});await blockPointerLock(context);await routeBuildingDist(context);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
  await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').tap();
  await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;window.useStep=g.step.bind(g);g.step=()=>{};g.mixing.setActive(false);});
  const step=n=>page.evaluate(n=>{for(let i=0;i<(n??3);i++)window.useStep(1/60,1/60,false);},n);
  const tap=async()=>{await page.locator('#look-joystick').tap();await step(3);};
  await page.evaluate(()=>{const g=window.__wireTheHouse;g.selectTool('hose');g.renderer.camera.position.set(.7,1.65,1.1);g.player.yaw=0;g.player.pitch=-.1;});await step();
  const water=()=>page.evaluate(()=>window.__wireTheHouse.mortar.waterGunLitres);
  const beforeWater=await water();await tap();await step(30);const waterUsed=await water();assert(waterUsed>beforeWater,'AIM tap must actually discharge the hose');await tap();const stoppedWater=await water();await step(30);assert.equal(await water(),stoppedWater,'Second tap stops water');
  // Prepare the existing recipe; insertion and motor use are native AIM taps.
  await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.mixing,c=g.renderer.camera,b=m.models.bucket.getWorldPosition(c.position.clone());g.mobileControls.cancelActiveGestures();m.batch.addWater(20/3);m.batch.openSack(0);for(let i=0;i<6;i++){m.batch.scoopCement(0);m.batch.pour('trowel');}for(let i=0;i<12;i++){m.batch.scoopSand();m.batch.pour('shovel');}c.position.set(b.x,g.player.eyeHeight,b.z-.92);c.lookAt(b.x,.3,b.z);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;m.setActive(true);m.chooseTool('mixer');});await step();
  await tap();await step(120);assert(await page.evaluate(()=>window.__wireTheHouse.mixing.inserted),'Tap must insert mixer');
  const mixed=await page.evaluate(()=>{const g=window.__wireTheHouse;return{progress:g.mixing.batch.mixProgress,active:g.mixing.mixingNow,held:g.input.interactionHeld,actionHeld:g.input.actionHeld,target:g.hud.shell.dataset.mixingInteract,station:g.mixing.telemetry};});
  await writeFile(`${out}/${name}-mix-diagnostic.json`,JSON.stringify(mixed,null,2));assert(mixed.active&&mixed.progress>0,'Tap must run mixer through action or INTERACT path: '+JSON.stringify(mixed));
  await tap();const stoppedMix=await page.evaluate(()=>window.__wireTheHouse.mixing.batch.mixProgress);await step(40);assert.equal(await page.evaluate(()=>window.__wireTheHouse.mixing.batch.mixProgress),stoppedMix,'Next tap stops mixing');
  await tap();await step(40);assert(await page.evaluate(progress=>window.__wireTheHouse.mixing.mixingNow&&window.__wireTheHouse.mixing.batch.mixProgress>progress,stoppedMix),'A following tap restarts mixing');await tap();
  // Exercise real stock pickup and all eight bend grips through the same tap.
  await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;g.mobileControls.cancelActiveGestures();g.mixing.finished=true;g.mixing.setActive(false);g.selectTool('fitting');c.position.set(.9,1.65,.75);c.lookAt(3.58,1.25,1.15);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);});await step();
  const pvc=()=>page.evaluate(()=>window.__wireTheHouse.pvc.telemetry);
  await tap();await step(130);assert.equal((await pvc()).phase,'loose');await tap();await step(110);assert.equal((await pvc()).phase,'marking');
  await page.locator('#pvc-mark-confirm').tap();await step(60);assert.equal((await pvc()).phase,'spring');await tap();await step(100);assert.equal((await pvc()).phase,'bending');
  const angles=[];
  for(let i=0;i<8;i++){
   if(i){await page.locator('[data-pvc="forward"]').tap();await step();}
   await tap();await step(30);await tap();await step();angles.push((await pvc()).angle);
   const settled=(await pvc()).angle;await step(15);assert.equal((await pvc()).angle,settled,'Tap stop must stop the PVC bend');
  }
  assert((await pvc()).ready,'All eight tap-controlled bend grips reach 90 degrees');assert.equal((await pvc()).phase,'review','Tap at 90 degrees advances into review');await tap();assert.equal((await pvc()).phase,'extracting','A discrete production tap must advance immediately');
  assert.equal(await page.locator('#site-pro-use,#mobile-interact').count(),0);
  await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}-pvc.png`});
  report.cases.push({name,waterUsed:waterUsed-beforeWater,mixed,angles,pvc:(await pvc()).phase});await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.map(c=>({name:c.name,waterUsed:c.waterUsed,mixerProgress:c.mixed.progress,angles:c.angles,pvc:c.pvc})),errors:report.errors},null,2));
