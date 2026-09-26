import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';
const base=process.argv[2]??'http://127.0.0.1:5365/Electrical-Game/',out=process.argv[3]??'output/phone-resume';await mkdir(out,{recursive:true});
const report={base,limitations:'Explicit document freeze/resume events around a Chromium scheduler freeze request, plus real GPU context loss. Visible headless tabs do not emit lifecycle events for the CDP request alone. Not a physical iPhone lock test.',cases:[],errors:[],consoleErrors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const backend of process.env.QA_PLATFORM?[process.env.QA_PLATFORM]:['webgl','webgpu']){
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});await blockPointerLock(context);
  await serveTaskBuild(context,base);
  const page=await context.newPage();await page.routeWebSocket('**',()=>{});page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
  await page.goto(base+(backend==='webgl'?'?renderer=webgl':''));await page.locator('#start-button').tap({timeout:120000});
  await page.locator('[data-tool="hose"]').tap();
  await page.evaluate(async()=>{
   const g=window.__wireTheHouse,v=g.room.brickWall.volume;
   for(let i=0;i<8;i++){const h=v.raycast({x:.4+i*.01,y:1.3,z:-2},{x:0,y:0,z:-1},.8);if(h)v.impact({point:h.point,direction:{x:0,y:0,z:-1},edge:{x:1,y:0,z:0},chisel:'flat',widthM:.05,energyJ:8});}
   g.room.brickWall.flushGeometry();await g.room.brickWall.waitForGeometry();g.roomWater.addFloorWater(0,0,100);
   window.__resumeObjects=[g.renderer.scene,g.room.brickWall.volume,g.roomWater.field,g.mission,g.mortar];
   window.__resumeFrames=0;window.__resumeLifecycle=[];for(const name of ['freeze','resume','visibilitychange'])document.addEventListener(name,()=>window.__resumeLifecycle.push(name));
   for(const name of ['webglcontextlost','webglcontextrestored'])document.querySelector('#game-canvas').addEventListener(name,()=>window.__resumeLifecycle.push(name));
   const render=g.renderer.render.bind(g.renderer);g.renderer.render=(...args)=>{const accepted=render(...args);if(accepted)window.__resumeFrames++;return accepted;};
  });
  const cdp=await context.newCDPSession(page);
  const state=()=>page.evaluate(()=>{const g=window.__wireTheHouse;return{frames:window.__resumeFrames,held:g.input.actionHeld,keys:[...g.input.keys],move:g.input.mobileMove,look:g.input.mobileLook,tool:g.selectedTool,removed:g.room.brickWall.volume.removedVolume,waterReceived:g.roomWater.telemetry.receivedLitres,emitted:g.mortar.waterGunLitres,camera:g.renderer.camera.position.toArray(),sameObjects:[g.renderer.scene,g.room.brickWall.volume,g.roomWater.field,g.mission,g.mortar].every((o,i)=>o===window.__resumeObjects[i]),pending:g.renderer.framePending,error:g.renderer.renderError,locked:!!document.pointerLockElement,lifecycle:window.__resumeLifecycle,renderer:g.renderer.lifecycleTelemetry??null};});
  for(const scenario of ['freeze','freeze-again','context-loss','stalled-frame']){
   if(process.env.QA_SCENARIO&&scenario!==process.env.QA_SCENARIO)continue;
   if(scenario==='context-loss'&&backend!=='webgl')continue;
   const b=await page.locator('#look-joystick').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:b.x+b.width*.5,y:b.y+b.height*.5}]});await page.waitForTimeout(300);
   const before=await state();assert(before.held&&before.removed>0);
   const record={backend,scenario,before};report.cases.push(record);
   if(scenario==='context-loss'){
    await page.evaluate(()=>{const gl=document.querySelector('#game-canvas').getContext('webgl2');window.__lostExtension=gl.getExtension('WEBGL_lose_context');if(!window.__lostExtension)throw Error('Missing real WebGL context-loss extension');window.__lostExtension.loseContext();});
    await page.waitForTimeout(500);record.pausedEmission=await page.evaluate(()=>window.__wireTheHouse.mortar.waterGunLitres);await page.evaluate(()=>window.__lostExtension.restoreContext());
   }else{
    if(scenario==='stalled-frame'){
     // A deliberately unresolved optical frame models a driver promise lost
     // during suspension; ordinary freeze alone need not trigger that fault.
     await page.evaluate(()=>{const r=window.__wireTheHouse.renderer,w=r.water;window.__oldWaterUpdate=w.update;w.update=()=>new Promise(resolve=>{window.__releaseStalledFrame=resolve;});});
     await page.waitForFunction(()=>typeof window.__releaseStalledFrame==='function');
    }
    record.pausedEmission=await page.evaluate(()=>{document.dispatchEvent(new Event('freeze'));return window.__wireTheHouse.mortar.waterGunLitres;});
    await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await page.waitForTimeout(800);await cdp.send('Page.setWebLifecycleState',{state:'active'});
    await page.evaluate(()=>document.dispatchEvent(new Event('resume')));
    if(scenario==='stalled-frame'){
     // Lock a second time while the first recovery is still waiting for its
     // lost frame; the newer wake must not inherit a permanent suspended flag.
     await page.waitForTimeout(150);await page.evaluate(()=>document.dispatchEvent(new Event('freeze')));await page.waitForTimeout(200);await page.evaluate(()=>document.dispatchEvent(new Event('resume')));
    }
   }
   try{await page.waitForFunction(previous=>window.__resumeFrames>previous+12,before.frames,{timeout:20000});}catch(error){record.failedState=await state();throw error;}
   const after=await state();record.after=after;assert.equal(after.removed,before.removed,'Resume preserves excavation');assert.equal(after.tool,before.tool);assert(after.sameObjects&&after.waterReceived>=before.waterReceived);assert.equal(after.emitted,record.pausedEmission,'Background time must not emit a backlog of hose water');assert.deepEqual(after.camera,before.camera);assert(!after.held&&!after.locked);assert.deepEqual(after.keys,[]);assert.deepEqual(after.move,{x:0,y:0});assert.deepEqual(after.look,{x:0,y:0});assert.equal(after.error,'');
   if(scenario==='stalled-frame'){await page.evaluate(()=>window.__releaseStalledFrame());await page.waitForTimeout(300);const late=await state();assert(late.frames>after.frames&&!late.error,'Late abandoned frame must not stop the recovered renderer');}
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   // A fresh physical gesture after waking still operates the same loaded game.
   const control=await page.locator('#look-joystick').boundingBox();const e0=(await state()).emitted;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:2,x:control.x+control.width*.5,y:control.y+control.height*.5}]});await page.waitForTimeout(300);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert((await state()).emitted>e0);
   await page.screenshot({path:`${out}/${backend}-${scenario}.png`});console.log(JSON.stringify({backend,scenario,framesAfter:after.frames-before.frames,passed:true}));
  }
  await page.locator('[data-tool="trowel"]').tap();
  const use=await page.locator('#look-joystick').boundingBox();
  const massBefore=await page.evaluate(()=>window.__wireTheHouse.mortar.launchedMass);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:3,x:use.x+use.width*.5,y:use.y+use.height*.5}]});await page.waitForTimeout(350);
  await page.evaluate(()=>document.dispatchEvent(new Event('freeze')));await page.waitForTimeout(800);await page.evaluate(()=>document.dispatchEvent(new Event('resume')));await page.waitForTimeout(700);
  const chargedResume=await page.evaluate(()=>({held:window.__wireTheHouse.input.actionHeld,mass:window.__wireTheHouse.mortar.launchedMass,casting:window.__wireTheHouse.mortar.throwFeedback.casting}));
  assert(!chargedResume.held&&!chargedResume.casting);assert.equal(chargedResume.mass,massBefore,'Waking after a held trowel must not launch a scoop');await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  report.cases.push({backend,scenario:'charged-trowel-resume',...chargedResume});
  await context.close();
 }
 assert.deepEqual(report.errors,[]);
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
