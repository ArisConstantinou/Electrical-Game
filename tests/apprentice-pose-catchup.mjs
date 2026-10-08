import assert from 'node:assert/strict';
import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';import {routeBuildingDist} from './building-qa-utils.mjs';
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills/develop-web-game/scripts/browser_lifecycle.mjs')).href);
const out=path.resolve(process.env.QA_OUTPUT??'output/apprentice-pose-catchup');await mkdir(out,{recursive:true});
const report={cases:[],errors:[],functionalClock:true},session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
try{await runManagedClient(session,300000,async()=>{
 for(const mobile of [false,true]){
  const context=await session.browser.newContext({viewport:mobile?{width:390,height:844}:{width:1920,height:1080},isMobile:mobile,hasTouch:mobile});
  await blockPointerLock(context);await routeBuildingDist(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/'+(mobile?'?renderer=webgl':''));
  await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});await page.locator('#apprentice-count').selectOption('5');
  await page.waitForFunction(()=>!document.querySelector('#start-button').disabled);await page.locator('#start-button').click();await page.waitForTimeout(500);
  await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.renderer.waitForFrame();window.__catchupStep=g.step.bind(g);g.step=()=>{};});
  await page.screenshot({path:path.join(out,(mobile?'mobile':'desktop')+'-before.png')});
  const result=await page.evaluate(async()=>{
   const g=window.__wireTheHouse,bodies=[g.apprentice.body,...g.apprentice.crew.map(m=>m.body)],dt=[.05,.05,.05,.05,.013];
   const fields=['phase','clock','gaitBlend','travelTurn','hammerBrace','bend'];
   const temporal=body=>Object.fromEntries(fields.map(key=>[key,body[key]]));
   const pose=body=>[...body.position.toArray(),...body.quaternion.toArray(),...body.bones.values()].flatMap(value=>typeof value==='number'?[value]:[...value.position.toArray(),...value.quaternion.toArray(),...value.matrixWorld.elements]);
   const rows=[];
   for(const body of [bodies[1],bodies[2]]){
    const mate=g.apprentice.crew.find(m=>m.body===body),initial=temporal(body),travel=body.travel.clone(),camera=mate.camera.clone(),rig=mate.rig;
    if(rig.anatomicalGrips().some(grip=>grip.active))throw Error('Idle fixture has an active tool grip');
    // Restart both paths from the same retained finger/rigid-grasp caches and
    // skeletal transforms, not just the animation clocks. Those caches are
    // deliberately stateful and otherwise contaminate a repeat comparison.
    const cloneHistory=value=>value?{rotation:value.rotation.clone(),swivel:value.swivel.clone()}:undefined;
    const cacheState=Object.fromEntries(['thumbPoseCache','boxFingerPoseCache'].map(key=>[key,new Map([...body[key]].map(([k,v])=>[k,{key:v.key,angles:[...v.angles]}]))]));
    const graspHistory=cloneHistory(body.graspHistory),graspTool=body.graspTool,boxHistory=new Map([...body.boxGraspHistory].map(([k,v])=>[k,cloneHistory(v)]));
    const rootPosition=body.position.clone(),rootRotation=body.quaternion.clone(),bones=[...body.bones.values()].map(b=>({bone:b,p:b.position.clone(),q:b.quaternion.clone()}));
    const restore=()=>{
     Object.assign(body,initial);body.travel.copy(travel);body.position.copy(rootPosition);body.quaternion.copy(rootRotation);
     for(const {bone,p,q} of bones){bone.position.copy(p);bone.quaternion.copy(q);}
     for(const [key,cache] of Object.entries(cacheState))body[key]=new Map([...cache].map(([k,v])=>[k,{key:v.key,angles:[...v.angles]}]));
     body.graspHistory=cloneHistory(graspHistory);body.graspTool=graspTool;body.boxGraspHistory=new Map([...boxHistory].map(([k,v])=>[k,cloneHistory(v)]));
     body.updateMatrixWorld(true);for(const skeleton of body.skeletons)skeleton.update();
    };
    for(const fixture of [{name:'idle',velocity:[0,0,0],eye:1.65,yaw:0},{name:'forward',velocity:[0,0,-.9],eye:1.65,yaw:0},{name:'reverse',velocity:[0,0,.9],eye:1.65,yaw:0},{name:'side-left',velocity:[-.9,0,0],eye:1.65,yaw:.6},{name:'side-right',velocity:[.9,0,0],eye:1.65,yaw:-.6},{name:'idle-low',velocity:[0,0,0],eye:.95,yaw:.4}]){
     camera.position.y=fixture.eye;camera.rotation.set(-.3,fixture.yaw,0);camera.updateMatrixWorld(true);
     const player={eyeHeight:fixture.eye,velocity:camera.position.clone().fromArray(fixture.velocity),yaw:fixture.yaw,pitch:-.3};
     const grips=fixture.station?rig.anatomicalGrips():[];
     const args=[camera,player,rig,'hammer',false,!!fixture.station,grips,undefined];
     restore();for(const delta of dt)body.update(delta,...args,true);const expectedPose=pose(body),expectedTemporal=temporal(body);
     restore();let unpresentedMatrixUpdates=0;const matrix=body.updateMatrixWorld;
     body.updateMatrixWorld=function(...a){unpresentedMatrixUpdates++;return matrix.apply(this,a);};
     for(const delta of dt.slice(0,-1))body.update(delta,...args,false);
     body.updateMatrixWorld=matrix;body.update(dt.at(-1),...args,true);
     const actualPose=pose(body),actualTemporal=temporal(body);
     rows.push({body:body.name,fixture:fixture.name,unpresentedMatrixUpdates,maxPoseDifference:Math.max(...actualPose.map((v,i)=>Math.abs(v-expectedPose[i]))),maxTemporalDifference:Math.max(...fields.map(key=>Math.abs(actualTemporal[key]-expectedTemporal[key])))});
    }
    restore();
   }
   const auditIntegration=()=>{
    const integration=bodies.map(body=>({name:body.name,updates:0,fullPoseCalls:0,dt:0})),restoreUpdates=[];
    bodies.forEach((body,i)=>{const update=body.update,matrix=body.updateMatrixWorld;
     body.update=function(delta,...args){let calls=0;body.updateMatrixWorld=function(...a){calls++;return matrix.apply(this,a);};try{return update.call(this,delta,...args);}finally{body.updateMatrixWorld=matrix;integration[i].updates++;integration[i].dt+=delta;if(calls)integration[i].fullPoseCalls++;}};
     restoreUpdates.push(()=>body.update=update);
    });
    try{for(let i=0;i<dt.length;i++)window.__catchupStep(dt[i],dt[i],i===dt.length-1,i===dt.length-1?dt.reduce((a,b)=>a+b,0):null);}finally{for(const restore of restoreUpdates)restore();}
    return integration;
   };
   const integration=auditIntegration();await g.renderer.waitForFrame();
   const mate=g.apprentice.crew[0],center=g.pvc.stock.bundleCenter(1),rawBefore=g.apprentice.pipeBatch.telemetry;
   mate.assign(1,'socket',1);mate.assignment.step='cut';mate.camera.position.set(3.13,.95,center.z-.1);g.player.camera.position.set(.4,1.65,-.5);
   const workingIntegration=auditIntegration(),cutElapsed=mate.assignment.elapsed,rawAfter=g.apprentice.pipeBatch.telemetry;
   await g.renderer.waitForFrame();
   return {count:g.apprentice.count,rows,integration,workingIntegration,cutElapsed,stockUnchanged:JSON.stringify(rawBefore)===JSON.stringify(rawAfter),simulatedTime:dt.reduce((a,b)=>a+b,0),error:g.renderer.renderError};
  });
  report.cases.push({mobile,...result});await page.screenshot({path:path.join(out,(mobile?'mobile':'desktop')+'-after.png')});await context.close();
 }
 assert.deepEqual(report.errors,[]);
 for(const result of report.cases){
  assert.equal(result.count,5);assert.equal(result.error,'');
  for(const row of result.rows){assert(row.maxPoseDifference<1e-8,JSON.stringify(row));assert(row.maxTemporalDifference<1e-10,JSON.stringify(row));assert.equal(row.unpresentedMatrixUpdates,0,'Unpresented physics steps still solve the whole body hierarchy');}
  for(const [i,body]of result.integration.entries()){assert.equal(body.updates,5);assert.equal(body.fullPoseCalls,i===0?5:1,'Idle crew defer their geometry while the active hammer carrier retains every full pose');assert(Math.abs(body.dt-result.simulatedTime)<1e-10,'Do not lose apprentice simulation time');}
  for(const [i,body]of result.workingIntegration.entries()){assert.equal(body.updates,5);assert.equal(body.fullPoseCalls,i<=1?5:1,'An assigned cutter must retain every complete pose and contact');assert(Math.abs(body.dt-result.simulatedTime)<1e-10);}
  assert(result.cutElapsed>0,'Exercise reachable cutter contacts');assert(result.stockUnchanged,'Short catch-up must not invent a pipe receipt');
 }
 report.passed=true;
});}catch(error){report.failure=String(error.stack??error);throw error;}finally{await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,platforms:report.cases.map(c=>({mobile:c.mobile,comparisons:c.rows.length,integration:c.integration})),errors:report.errors}));
