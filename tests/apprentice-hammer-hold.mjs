import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';

const out=process.env.QA_OUTPUT??'output/apprentice-hammer-hold';
const renderer=process.env.QA_RENDERER??'webgpu';
const mobile=process.env.QA_MOBILE==='1';
await mkdir(out,{recursive:true});
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(os.homedir(),'.codex/skills/develop-web-game/scripts/browser_lifecycle.mjs')));
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:path.resolve(out)});
const report={renderer,mobile,errors:[],poses:[],work:[]};
await runManagedClient(session,180000,async()=>{
 const context=await session.browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});
 await blockPointerLock(context);await routeBuildingDist(context);
 await context.route('**/__wire-house-mansion-level**',route=>route.fulfill({json:{slots:[]}}));
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(`${process.env.QA_BASE??'http://127.0.0.1:5365/Electrical-Game/'}?renderer=${renderer}`);
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});
 await page.locator('#start-button').click();
 await page.waitForFunction(()=>window.__wireTheHouse.started);
 await page.locator('#start-screen').waitFor({state:'hidden'});
 await page.evaluate(()=>{
  const g=window.__wireTheHouse;window.holdTestStep=g.step.bind(g);g.step=()=>{};
  g.fpsRig.visible=false;g.workerBody.visible=false;
  const c=g.renderer.camera;c.position.set(-.45,1.65,-.95);c.lookAt(.8,1.1,1.25);c.updateMatrixWorld(true);
  window.readHammer=()=>{
   const a=g.apprentice;
   return{phase:a.phase,hasHammer:a.hasHammer,attached:a.hammer.parent===a.hammerParent,rigVisible:a.rig.visible,
    position:a.camera.position.toArray(),eyePitch:a.camera.rotation.x,grips:a.rig.anatomicalGrips().filter(grip=>grip.active).map(grip=>({side:grip.side,center:grip.center.toArray()})),
    wristErrors:a.body.telemetry.gripReachErrors,workTool:a.workTool,workVisible:a.workTool? a.workTools.get(a.workTool).visible:false,telemetry:a.telemetry};
  };
 });
 for(const [name,position] of [['front',[-.45,1.65,-.95]],['side',[2.4,1.65,1.3]]]){
  const pose=await page.evaluate(async({position})=>{
   const g=window.__wireTheHouse,a=g.apprentice,c=g.renderer.camera;
   c.position.fromArray(position);c.lookAt(.8,1.1,1.25);c.updateMatrixWorld(true);
   for(let i=0;i<60;i++)a.update(1/60);
   const v=a.camera.position.clone();
   // Collect real grip targets and solved skeletal wrist errors, not a mock pose.
   const grips=a.rig.anatomicalGrips().filter(grip=>grip.active).map(grip=>({side:grip.side,center:grip.center.toArray()}));
   a.hammer.getWorldPosition(v);
   await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();
   return{phase:a.phase,hasHammer:a.hasHammer,attached:a.hammer.parent===a.hammerParent,rigVisible:a.rig.visible,position:v.toArray(),grips,body:a.body.telemetry};
  },{position});
  report.poses.push({name,...pose});await page.screenshot({path:path.join(out,name+'.png')});
 }
 await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({renderer,poses:report.poses.map(({name,hasHammer,attached,rigVisible,position,grips,body})=>({name,hasHammer,attached,rigVisible,position,grips,wristErrors:body.gripReachErrors})),errors:report.errors}));
 assert.deepEqual(report.errors,[]);
 for(const pose of report.poses){
  assert.equal(pose.hasHammer,true,'An idle apprentice must already hold the demolition hammer');
  assert.equal(pose.attached,true,'The hammer must travel with the apprentice rig');
  assert.equal(pose.rigVisible,true);
  assert.equal(pose.grips.length,2,'Both hands must grip the existing hammer handles');
  assert(pose.grips.every(grip=>grip.center[1]>.7),'The grips must be carried above the floor');
  assert(Object.values(pose.body.gripReachErrors).every(error=>error<.02),'Both skeletal wrists must reach their grips');
 }
 const carried=state=>{
  report.lastState=state;
  assert(state.hasHammer&&state.attached&&state.rigVisible,'The existing hammer must stay attached and visible');
  assert.equal(state.grips.length,2);assert(Object.values(state.wristErrors).every(error=>error<.02),JSON.stringify(state));
 };
 await page.evaluate(()=>{
  const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(-.45,1.65,-.95);c.lookAt(.8,1.1,1.25);c.updateMatrixWorld(true);
  const a=g.apprentice;a.issueGroundOrder(a.camera.position.clone().set(1.4,0,1.5),'go');
 });
 let moving=false;
 for(let i=0;i<20;i++){
  const state=await page.evaluate(()=>{const a=window.__wireTheHouse.apprentice;for(let n=0;n<6;n++)a.update(1/60);return window.readHammer();});
  carried(state);report.work.push({step:'walk',phase:state.phase,position:state.position});
  if(state.phase==='directed')moving=true;if(state.phase==='done')break;
 }
 assert(moving,'Exercise the actual directed walk before arrival');
 assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.phase),'done');
 await page.evaluate(()=>{const a=window.__wireTheHouse.apprentice;a.pipeSelection=0;a.command('pipe-socket');});
 let cutting=false;
 for(let i=0;i<180;i++){
  const state=await page.evaluate(()=>{const a=window.__wireTheHouse.apprentice;for(let n=0;n<36;n++)a.update(1/60);return window.readHammer();});
  if(state.workTool){
   assert.equal(state.workTool,'cutter');assert(state.workVisible);assert.equal(state.rigVisible,false,'Hide the hammer while both hands use the PVC cutter');
   if(!cutting){
    cutting=true;report.work.push({step:'cut',...state});
    await page.evaluate(async()=>{
     const g=window.__wireTheHouse,c=g.renderer.camera,target=g.apprentice.camera.position.clone();target.y-=.3;
     c.position.set(1.8,1.65,.05);c.lookAt(target);c.updateMatrixWorld(true);
     await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();
    });
    await page.screenshot({path:path.join(out,'cutting.png')});
   }
  }else if(!state.rigVisible&&(state.phase==='done'||state.telemetry.pipeJob?.step==='wait-crew')){
   assert(state.hasHammer&&state.attached,'Retain the same tool during the short stand-up transition');
   assert(state.position[1]<1.55||Math.abs(state.eyePitch)>=.25,'Only hide the carry rig while returning to its reachable standing posture');
   assert.equal(state.grips.length,0);
  }else carried(state);
  assert.notEqual(state.phase,'blocked',JSON.stringify(state.telemetry));
  if(state.phase==='done'){report.work.push({step:'pipe-done',...state});break;}
 }
 assert(cutting,'Exercise the native cutter workflow');
 const finished=await page.evaluate(()=>{const a=window.__wireTheHouse.apprentice;for(let i=0;i<60;i++)a.update(1/60);return window.readHammer();});carried(finished);
 assert.equal(finished.phase,'done');assert.equal(finished.telemetry.pipeBatch.finishedSocket,20);
 const batch=finished.telemetry.pipeBatch;
 assert(Math.abs(batch.claimedRaw*3-batch.finishedM-batch.kerfM-batch.remnantM)<1e-7,'Retain the actual PVC material accounting');
 // The native construction path parks the same hammer before using other tools.
 await page.evaluate(()=>{const a=window.__wireTheHouse.apprentice;a.issueGroundOrder(a.camera.position.clone(),'mix');});
 for(let i=0;i<120;i++){
  const state=await page.evaluate(()=>{const a=window.__wireTheHouse.apprentice;for(let n=0;n<12;n++)a.update(1/60);return window.readHammer();});
  if(!state.hasHammer){report.work.push({step:'parked-for-mixing',...state});assert.equal(state.attached,false);assert.equal(state.rigVisible,false);break;}
  assert.notEqual(state.phase,'blocked',JSON.stringify(state.telemetry));
 }
 assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.hasHammer),false);
 // A controlled blocked-work fixture exercises the existing cancellation path,
 // which returns the floor tool to idle. Do not alter material production.
 const returned=await page.evaluate(()=>{const a=window.__wireTheHouse.apprentice;a.phase='blocked';a.blockedFrom='construction';a.command('cancel');a.update(1/60);return window.readHammer();});
 carried(returned);assert.equal(returned.phase,'idle');report.work.push({step:'cancel-rehold',...returned});
 await page.evaluate(()=>{
  const g=window.__wireTheHouse,a=g.apprentice,mark=a.camera.position.clone().set(-.8,1.2,-2.41);
  g.renderer.camera.position.set(2.4,1.65,2.8); // Keep the observer out of the worker's aisle.
  if(!a.columnOccupied(mark))throw new Error('The demolition fixture requires untouched masonry');
  a.groundIntent='break';a.anchor=mark.clone();a.lines=[mark.clone()];a.command('break-now');
 });
 assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.phase),'walking','A carried hammer skips the old floor-fetch stage');
 for(let i=0;i<120;i++){
  const state=await page.evaluate(()=>{const a=window.__wireTheHouse.apprentice;for(let n=0;n<12;n++)a.update(1/60);return window.readHammer();});
  report.lastState=state;
  assert.notEqual(state.phase,'blocked',JSON.stringify(state.telemetry));
  if(state.telemetry.removedVolume>0){report.work.push({step:'native-demolition',...state});break;}
 }
 assert(report.work.some(state=>state.step==='native-demolition'),JSON.stringify(report.lastState.telemetry));
 const hidden=await page.evaluate(async()=>{const a=window.__wireTheHouse.apprentice;await a.prepareCrew(0);a.update(1/60);return{body:a.body.visible,hammer:a.hammer.visible,camera:a.camera.visible};});
 assert.deepEqual(hidden,{body:false,hammer:false,camera:false});report.zeroCrew=hidden;
 await page.evaluate(async()=>{const a=window.__wireTheHouse.apprentice;await a.prepareCrew(1);a.update(1/60);window.__wireTheHouse.step=window.holdTestStep;});
 await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({checks:['idle two-hand grips','native walk and arrival','20 native PVC cuts and conservation','hammer hidden for cutter','construction parking and cancellation rehold','native wall demolition without fetching','zero-crew visibility'],errors:report.errors}));
 assert.deepEqual(report.errors,[]);
 await context.close();
}).catch(async error=>{report.failure=error.message;await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));throw error;});
