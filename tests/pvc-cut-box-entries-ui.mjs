import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';

const baseline=process.argv.includes('--baseline'),live=process.argv.includes('--live');
const performanceOnly=process.argv.includes('--performance-only'),desktopOnly=process.argv.includes('--desktop-only')||performanceOnly;
const out=process.env.PVC_CUT_OUT??`output/pvc-cut-box-entries/${baseline?'before':live?'live':'after'}`;
const url=process.env.GAME_URL??'http://127.0.0.1:5365/Electrical-Game/';
await mkdir(out,{recursive:true});
const report={baseline,live,url,sourceRef:process.env.PVC_SOURCE_REF??null,environment:'Windows Chrome headless; Core Ultra 9 285K / RTX 5080 and Intel Graphics host; touch cases are emulation, not a physical phone',errors:[],cases:[]};
report.performanceOnly=performanceOnly;
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const viewport of [{width:1095,height:1139},{width:390,height:844},{width:844,height:390}]){
  if((baseline||desktopOnly)&&viewport.width!==1095)continue;
  const mobile=viewport.width!==1095,name=!mobile?'desktop':viewport.width<500?'portrait':'landscape';
  const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});
  await blockPointerLock(context);if(!live&&process.env.TASK_BUILD_ROOT)await serveTaskBuild(context,url);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(url);await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').click({timeout:120000});
  await page.waitForFunction(()=>window.__wireTheHouse.started);
  await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;window.cutTick=g.step.bind(g);g.step=()=>{};g.player.update=()=>{};g.mixing.finished=true;g.mixing.setActive(false);});
  const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.cutTick(1/60,0,false);},n??3);
  const state=()=>page.evaluate(()=>window.__wireTheHouse.pvc.telemetry);
  const key=async code=>{await page.keyboard.down(code);await step(2);await page.keyboard.up(code);await step(2);};
  const click=async selector=>{if(mobile)await page.locator(selector).tap();else await page.locator(selector).click();await step();};
  const cut=async()=>{if(!baseline)await click('#pvc-cut-confirm');else{await page.mouse.down();await step(2);await page.mouse.up();}await step(32);};
  const snap=async label=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}-${label}.png`});};
  const row={name,viewport,checks:[]};report.cases.push(row);
  const check=(name,pass,detail)=>{row.checks.push({name,pass,detail});if(!baseline)assert(pass,`${name}: ${JSON.stringify(detail)}`);};
  const staged=name==='portrait';
  if(!baseline&&staged){
   await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,p=g.mission.points[1],pos=p.boxGroup.getWorldPosition(c.position.clone());window.dispatchEvent(new CustomEvent('wirehouse:select-tool',{detail:'drill'}));c.position.set(pos.x,.22,pos.z+.90);c.lookAt(pos.x,.16,pos.z-.03);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);});
   await key('KeyE');assert.equal((await state()).phase,'fastener-marking');
   await key('KeyE');await key('KeyE');await click('#pvc-drill-holes');await step(150);
   await key('KeyE');await step(95);assert.equal((await state()).phase,'sealed');row.staged=await state();
  }
  await page.evaluate(()=>{
   const g=window.__wireTheHouse,p=g.mission.points[1],pvc=g.pvc,c=g.renderer.camera,pos=p.boxGroup.getWorldPosition(c.position.clone());
   pvc.bend=new pvc.bend.constructor(.9);pvc.bend.angles.fill(90/16);pvc.quantity=1;pvc.phase='extracting';pvc.elapsed=1.5;pvc.animate(.01);
   c.position.set(pos.x,.95,pos.z+.95);c.lookAt(pos);g.player.crouched=true;g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);
  });await step(2);await key('KeyE');await step(70);
  assert.equal((await state()).phase,'fitting','Fixture must enter the real fitting interaction');
  row.initial=await state();await snap('fitting');row.fittingPerformance=await measure(page);
  if(performanceOnly){await context.close();continue;}
  const initial=await page.evaluate(()=>{const p=window.__wireTheHouse.pvc,root=new p.pipe.constructor();p.orientAtBox(root,0);const box=p.target.boxGroup.getWorldPosition(root.position.clone());return{pipeX:root.position.x,boxX:box.x,entries:p.target.boxGroup.boxes.map(b=>({kind:b.kind,bottomEntries:b.bottomConduitEntries?.map(v=>v.toArray())??[]}))};});
  check('pipe uses a lateral bottom entry',Math.abs(initial.pipeX-initial.boxX)>.015,initial);
  check('two actual bottom entries per gang box',initial.entries.every(e=>e.bottomEntries.length===2),initial.entries);
  const controls=page.locator('#pvc-fit-controls');check('visible flush and entry controls',await controls.isVisible(),await controls.count());
  const desired=await page.evaluate(()=>{const p=window.__wireTheHouse.pvc;return p.bend.mark-.205;});
  await page.evaluate(value=>{const g=window.__wireTheHouse;g.player.lookHandler(0,(value-g.pvc.cutS)/.0006);},desired);await step(2);
  check('free cut reaches beyond the old fixed safety band',Math.abs((await state()).cutCm/100-desired)<.00001,await state());
  await cut();check('complete free cut with a separate offcut',(await state()).phase==='cut'&&(await state()).offcuts===1,await state());
  await snap('free-cut');
  if(baseline){
   row.performance=await measure(page);continue;
  }
  // Trimming remains available after a successful cut, independent of fitting.
  // The support is now independent: move it clear with native W/S before
  // asking the blade to travel across its occupied band.
  await page.evaluate(()=>{window.__wireTheHouse.pvc.supportS=.85;});
  await page.evaluate(()=>{const g=window.__wireTheHouse;g.player.lookHandler(0,.015/.0006);});await step(2);
  assert.equal((await state()).phase,'fitting');await cut();assert.equal((await state()).offcuts,2);
  await key('KeyE');assert.equal((await state()).phase,'cut','A deliberately short pipe may be cut but cannot be installed');
  check('short free cuts are retained instead of undone',/κοντή/.test((await state()).message),await state());
  await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.pvc;p.supportS=p.cutFrom+.025;g.player.lookHandler(0,(p.bend.mark+.2-.004-p.cutS)/.0006);});await step(70);
  check('lowest curved cut keeps both hands above the floor',await page.evaluate(()=>window.__wireTheHouse.pvc.arms.every(a=>a.wrist.y>=.015)),await state());
  await cut();check('complete low cut through the upright curve',(await state()).phase==='cut'&&(await state()).cutHeightCm<3,await state());await snap('lowest-cut');
  // Restore an uncut stock pipe for the independent flush / install scenario.
  await page.evaluate(()=>{const p=window.__wireTheHouse.pvc;p.cutFrom=0;p.carried.cutFrom=0;p.carried.mesh.update(p.bend);p.phase='fitting';p.cutS=p.flushCut();p.supportS=null;});await step(2);
  await page.evaluate(()=>{const g=window.__wireTheHouse;g.player.lookHandler(0,(.02-g.pvc.cutS)/.0006);});await step(70);
  // Keep the independent support below the high blade and within arm reach.
  await page.evaluate(()=>{window.__wireTheHouse.pvc.supportS=.45;});await step(3);
  await snap('high-cut');
  row.highPose=await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.pvc,point=p.pipe.localToWorld(g.renderer.camera.position.clone().set(p.bend.at(p.cutS).x,p.bend.at(p.cutS).y,0)).project(g.renderer.camera);return{point:point.toArray(),body:g.workerBody.telemetry,hands:['L','R'].map(s=>g.workerBody.point('hand.'+s).toArray()),camera:g.renderer.camera.position.toArray(),drivers:p.arms.map(a=>({side:a.side,shoulder:a.shoulder.toArray(),wrist:a.wrist.toArray()}))};});
  check('high cuts remain visible and retain actual worker hand contact',Math.abs(row.highPose.point[0])<1&&Math.abs(row.highPose.point[1])<1&&Object.values(row.highPose.body.gripReachErrors).every(e=>e<.008),row.highPose);
  await cut();assert.equal((await state()).phase,'cut');assert((await state()).fitErrorMm>30);
  await key('KeyE');assert.equal((await state()).phase,'fitting','An overlong cut is retained and can be trimmed again');
  await click('#pvc-cut-flush');const flush=await state();
  check('flush snap matches the actual lower box lip',Math.abs(flush.cutHeightCm-flush.entryHeightCm)<.00001,flush);
  check('flush remains installable',flush.fitReady,flush);
  const bounds=await controls.locator('button').evaluateAll(buttons=>buttons.map(b=>({id:b.id,...(()=>{const r=b.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})()})));
  check('controls fit the viewport with touch targets',bounds.every(b=>b.x>=0&&b.y>=0&&b.x+b.width<=innerWidthFor(viewport)&&b.y+b.height<=viewport.height&&b.width>=44&&b.height>=44),bounds);
  const left=flush.entryPosition;
  await click('#pvc-entry-next');const right=await state();
  check('right entry actually moves the pipe',right.entryPosition[0]-left[0]>.03,{left,right:right.entryPosition});
  await click('#pvc-entry-previous');check('left entry can be selected again',Math.abs((await state()).entryPosition[0]-left[0])<1e-8,await state());
  await snap('flush-left');await cut();assert.equal((await state()).phase,'cut');
  // Fit first, then drill and thread wires while the same pipe remains fitted.
  // Explicitly staged wires still support the independent wire-first sequence.
  await key('KeyE');
  if(staged){assert.equal((await state()).phase,'pipe-install-ready');row.marked=await state();}
  else{
   await step(50);
   assert.equal((await state()).phase,'fastener-marking',JSON.stringify(await state()));
   assert(await page.evaluate(()=>Boolean(window.__wireTheHouse.mission.points[1].conduit)),'Pipe stays fitted while marking');
   await key('KeyE');await key('KeyE');assert.equal((await state()).fasteners.pairs,1);
   row.marked=await state();await click('#pvc-drill-holes');await step(150);assert.equal((await state()).phase,'fastener-insert-ready');
   await key('KeyE');await step(95);assert.equal((await state()).phase,'fastener-tighten-ready');
  }
  if(staged){await key('KeyE');await step(50);}assert.equal((await state()).phase,'fastener-tighten-ready');
  const installed=await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.mission.points[1],V=g.renderer.camera.position.constructor,world=p.conduit.getWorldPosition(new V()),entry=g.pvc.telemetry.entryPosition;return{position:world.toArray(),entry,recipe:p.conduit.userData.pvcRecipe};});
  check('installed conduit retains the selected entry',Math.abs(installed.position[0]-left[0])<1e-8&&Math.abs(installed.position[2]-left[2])<1e-8,installed);
  check('fasteners straddle the selected pipe',row.marked.fasteners.positions[0].x<left[0]&&row.marked.fasteners.positions[1].x>left[0],row.marked.fasteners.positions);
  await key('KeyE');await step(160);assert.equal((await state()).phase,'batch');assert.equal((await state()).installed,1);
  const wire=await page.evaluate(()=>{const g=window.__wireTheHouse,pair=g.pvc.fastenerPairs[0],mesh=pair.rebar.getObjectByName('Open wall-anchored tying wire');pair.rebar.updateWorldMatrix(true,true);const curve=mesh.geometry.parameters.path;return{left:mesh.localToWorld(curve.getPoint(0)).toArray(),right:mesh.localToWorld(curve.getPoint(1)).toArray(),bow:mesh.localToWorld(curve.getPoint(.5)).toArray(),twist:pair.rebar.getObjectByName('tie-wire-twist').getWorldPosition(g.renderer.camera.position.clone()).toArray(),holes:[pair.left.marker.position.toArray(),pair.right.marker.position.toArray()]};});
  check('closed tying wire meets the selected pipe and retains both anchors',Math.abs(wire.bow[0]-left[0])<1e-6&&Math.abs(wire.bow[2]-(left[2]+.01115))<.00001&&Math.abs(wire.twist[0]-left[0])<1e-6&&wire.left.every((v,i)=>Math.abs(v-wire.holes[0][i])<1e-6)&&wire.right.every((v,i)=>Math.abs(v-wire.holes[1][i])<1e-6),wire);
  await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.mission.points[1],c=g.renderer.camera,box=p.boxGroup.getWorldPosition(c.position.clone());c.position.set(box.x,box.y,box.z+.68);c.lookAt(box);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;g.pvc.present();});
  await snap('installed');row.performance=await measure(page);row.final=await state();
  await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=!baseline;
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({out,baseline,passed:report.passed,checks:report.cases.map(c=>({name:c.name,failed:c.checks.filter(x=>!x.pass)})),errors:report.errors}));
function innerWidthFor(viewport){return viewport.width;}
async function measure(page){return page.evaluate(async()=>{
 const g=window.__wireTheHouse,samples=[];for(let i=0;i<30;i++)window.cutTick(1/60,0,true);
 for(let i=0;i<120;i++){const t=performance.now();window.cutTick(1/60,0,true);samples.push(performance.now()-t);}samples.sort((a,b)=>a-b);
 const times=[],submissions=[],draw=g.renderer.drawScene.bind(g.renderer);g.renderer.drawScene=function(scene){if(scene===this.scene)times.push(performance.now());const result=draw(scene);if(scene===this.scene){const i=this.webgl.info;submissions.push({calls:i.render.calls,triangles:i.render.triangles});}return result;};
 g.step=(dt,waterDt,present,bodyDt)=>window.cutTick(dt,0,present,bodyDt);
 try{await new Promise(resolve=>{const start=performance.now(),tick=()=>{if(performance.now()-start<2200)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});}finally{g.step=()=>{};g.renderer.drawScene=draw;}
 const frames=times.slice(9).map((t,i)=>t-times[i+8]).sort((a,b)=>a-b);
 const median=key=>submissions.map(i=>i[key]).sort((a,b)=>a-b)[Math.floor(submissions.length/2)];
 const info=g.renderer.webgl.info;return{phase:g.pvc.phase,backend:g.renderer.webgl.backend.isWebGPUBackend?'WebGPU':g.renderer.webgl.backend.isWebGLBackend?'WebGL':'unknown',meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,p95Ms:samples[114],maxMs:samples.at(-1),renderedFrames:times.length,frameP95Ms:frames[Math.floor(frames.length*.95)],frameMaxMs:frames.at(-1),stallsOver50Ms:frames.filter(t=>t>50).length,geometries:info.memory.geometries,textures:info.memory.textures,calls:median('calls'),triangles:median('triangles')};
});}
