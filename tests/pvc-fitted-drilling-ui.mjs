import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';
const baseline=process.argv.includes('--baseline'),wireFirst=process.argv.includes('--wire-first'),out=process.env.PVC_FITTED_OUT??`output/pvc-fit-before-ties/${baseline?'before-focused':'after-focused'}`;
const url=process.env.GAME_URL??'http://127.0.0.1:5365/Electrical-Game/';await mkdir(out,{recursive:true});
const report={url,baseline,errors:[],cases:[],physicalPhone:false},browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const viewport of [{width:1366,height:768},{width:390,height:844},{width:844,height:390}].filter(v=>(!process.argv.includes('--touch-only')||v.width!==1366)&&(!process.argv.includes('--desktop-only')||v.width===1366))){
  const mobile=viewport.width!==1366,name=mobile?(viewport.width===390?'portrait':'landscape'):'desktop';
  const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);await routeBuildingDist(context);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(url);
  await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();
  // Seed one genuinely cut 90-degree stock pipe; the full production and cut
  // sequence is independently exercised by manual-pvc-ui.mjs.
  await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;window.fitTick=g.step.bind(g);g.step=()=>{};const p=g.pvc,V=g.renderer.camera.position.constructor;p.bend.angles.fill(90/8,0,8);p.bend.revision++;p.bend.grip=7;p.target=g.mission.points[0];const box=p.target.boxGroup.getWorldPosition(new V());p.cutFrom=p.cutS=p.bend.topHeight-(box.y-p.target.boxGroup.groupHeight/2+.015);const mesh=new p.pipe.constructor();mesh.update(p.bend,p.cutFrom);p.rawCount--;p.carried={mesh,recipe:p.bend.recipe(),cutFrom:p.cutFrom,bundle:0,originBundle:0};p.transition('cut');p.setFocus();for(let i=0;i<80;i++)window.fitTick(1/60);});
  if(wireFirst)await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.pvc,c=g.renderer.camera,world=p.target.boxGroup.getWorldPosition(c.position.clone());p.prepared.push(p.carried);p.carried=null;p.target=null;p.transition('batch');p.focused=false;window.dispatchEvent(new CustomEvent('wirehouse:select-tool',{detail:'drill'}));c.position.set(world.x,.72,world.z+.9);c.lookAt(world.x,.18,world.z-.03);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);});
  const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.fitTick(1/60);},n),state=()=>page.evaluate(()=>window.__wireTheHouse.pvc.telemetry);
  const use=async()=>{if(mobile)await page.locator('#look-joystick').tap();else await page.keyboard.press('KeyE');await step(3);};
  const snap=async label=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}-${label}.png`});};
  await use();await step(80);assert.equal((await state()).phase,'fastener-marking');await snap('fitted');
  let pipe=await page.evaluate(()=>{const c=window.__wireTheHouse.mission.points[0].conduit;c?.updateMatrixWorld(true);return c?{uuid:c.uuid,matrix:c.matrixWorld.toArray()}:null;});assert.equal(Boolean(pipe),!baseline&&!wireFirst,'Fit the actual pipe before preparing its fixings unless wire was explicitly prepared first');
  const pipeVisibleBeforeDrilling=Boolean(pipe);
  const stable=async()=>{if(baseline||wireFirst&&!pipe)return;const actual=await page.evaluate(()=>{const c=window.__wireTheHouse.mission.points[0].conduit;c?.updateMatrixWorld(true);return c?.visible?{uuid:c.uuid,matrix:c.matrixWorld.toArray()}:null;});assert.deepEqual(actual,pipe,'Keep the same fitted pipe visible and stationary');assert.equal((await state()).totalAll,100,'Conserve pipe inventory while fitting and tying');};
  let profile;
  if(process.argv.includes('--profile'))profile=await page.evaluate(async()=>{const g=window.__wireTheHouse,r=g.renderer,draw=r.drawScene.bind(r),work=[],frames=[];let count=0,last,resources;r.drawScene=function(scene){draw(scene);resources={calls:r.webgl.info.render.calls,triangles:r.webgl.info.render.triangles,textures:r.webgl.info.memory.textures};};g.step=function(...args){const start=performance.now();window.fitTick(...args);if(count>45)work.push(performance.now()-start);};try{await new Promise(resolve=>{const frame=now=>{if(count>45&&last)frames.push(now-last);last=now;if(++count<150)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});await r.waitForFrame();}finally{g.step=()=>{};r.drawScene=draw;}work.sort((a,b)=>a-b);frames.sort((a,b)=>a-b);return{simulationMeanMs:work.reduce((a,b)=>a+b,0)/work.length,simulationP95Ms:work[Math.floor(work.length*.95)],frameP95Ms:frames[Math.floor(frames.length*.95)],frameMaxMs:frames.at(-1),over50ms:frames.filter(ms=>ms>50).length,...resources};});
  const holes=await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,p=g.mission.points[0],pos=p.boxGroup.getWorldPosition(c.position.clone()),volume=g.room.brickWall.volume,min=.09,max=Math.max(.13,pos.y-p.boxGroup.groupHeight/2-.065);return[[-.065,.85],[.05,.75]].map(([x,y])=>{const hit=volume.raycast({x:pos.x+x,y:min+(max-min)*y,z:volume.frontZ+.1},{x:0,y:0,z:-1},1);if(!hit)throw new Error('Real masonry required');return[hit.point.x,hit.point.y,hit.point.z];});});
  for(const [index,point] of holes.entries()){
   await page.evaluate(point=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.lookAt(...point);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;c.updateMatrixWorld(true);},point);await step(2);
   if(mobile)await page.locator('#look-joystick').tap();else{await page.mouse.move(viewport.width/2,viewport.height/2);await page.mouse.down();await step(2);await page.mouse.up();}await step(20);
   assert.equal((await state()).phase,'fastener-drilling');await stable();await snap('drilling-'+index);await step(40);assert.equal((await state()).fasteners.drilled,index+1);await stable();
  }
  const marks=(await state()).fasteners;assert.equal(marks.holes,2);assert.equal(marks.pairs,1);assert.equal((await state()).phase,'fastener-insert-ready');assert.equal(await page.locator('#pvc-drill-holes').isVisible(),false);await snap('holes');
  if(!baseline){await use();await step(70);
   if(wireFirst){assert.equal((await state()).phase,'batch');assert.equal((await state()).totalAll,100);await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.pvc;p.takePrepared(p.prepared[0]);p.target=g.mission.points[0];p.cutS=p.cutFrom;p.transition('cut');p.setFocus();});await step(80);await use();assert.equal((await state()).phase,'pipe-install-ready');await use();await step(45);pipe=await page.evaluate(()=>{const c=window.__wireTheHouse.mission.points[0].conduit;c.updateMatrixWorld(true);return{uuid:c.uuid,matrix:c.matrixWorld.toArray()};});}
   assert.equal((await state()).phase,'fastener-tighten-ready');await stable();await snap('wire-around-pipe');const anchored=(await state()).fasteners.rebars.map(r=>r.position);await use();await step(25);await stable();await snap('twisting');await step(55);assert.equal((await state()).phase,'batch');assert.equal((await state()).installed,1);assert.equal((await state()).totalAll,100);assert.deepEqual((await state()).fasteners.rebars.map(r=>r.position),anchored);await stable();assert.equal(await page.evaluate(()=>window.__wireTheHouse.mission.points[0].userData.pvcFasteners.sequence),wireFirst?'marked-drilled-open-wire-pipe-inserted-twisted':'pipe-inserted-marked-drilled-wire-threaded-twisted');}
  report.cases.push({name,viewport,pipeVisibleBeforeDrilling,profile,final:await state()});await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.map(c=>({name:c.name,fitted:c.pipeVisibleBeforeDrilling,profile:c.profile})),errors:report.errors}));
