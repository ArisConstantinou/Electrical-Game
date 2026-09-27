import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';

const baseline=process.argv.includes('--baseline'),out=process.env.PIPE_QA_OUTPUT??`output/pipe-interactions/${baseline?'before':'after'}`;
const performanceOnly=process.argv.includes('--performance-only');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={baseline,errors:[],bundles:[],checks:[],physicalPhone:false};
try{
 if(!process.argv.includes('--mobile-only')){
 const context=await browser.newContext({viewport:{width:1366,height:768}});
 await blockPointerLock(context);if(!baseline)await routeBuildingDist(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/');await page.locator('#start-button').click({timeout:120000});await page.waitForFunction(()=>window.__wireTheHouse.started);
 await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;window.pipeStep=g.step.bind(g);window.pipePlayerUpdate=g.player.update.bind(g.player);g.step=()=>{};g.player.update=()=>{};});
 const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.pipeStep(1/60);},n);
 const aim=async(index,spread=false)=>{
  await page.evaluate(({index,spread})=>{
   const g=window.__wireTheHouse,c=g.renderer.camera,s=g.pvc.stock,V=s.position.constructor;
   const target=spread?s.sitePoint(2.2-index*.58,.025,1.75):s.bundleCenter(index).add(new V(.14,1.4,0));
   c.position.copy(target).add(spread?new V(0,.9,.6):new V(-1.2,.1,0));c.lookAt(target);
   g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);
  },{index,spread});await step(2);
 };
 const snap=async name=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}.png`});};
 const key=async code=>{await page.keyboard.down(code);await step(2);await page.keyboard.up(code);await step(2);};
 const state=()=>page.evaluate(()=>window.__wireTheHouse.pvc.telemetry);
 for(let index=0;index<5;index++){
  await aim(index);
  const row=await page.locator('#pvc-prompt').evaluate(e=>({visible:!e.hidden,text:e.textContent,border:getComputedStyle(e).borderWidth,font:getComputedStyle(e).fontSize}));
  const debug=await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,s=g.pvc.stock,hit=s.bundleAt(c,3),ray=g.pvc.ray;return{camera:c.position.toArray(),rotation:c.rotation.toArray(),bundle:hit?.index,room:ray.intersectObject(g.room,true).slice(0,2).map(h=>({name:h.object.name,distance:h.distance}))};});
  report.bundles.push({index,...row,state:await state(),debug});
  if(index===0||index===4)await snap(`sealed-${index}`);
  if(!baseline){assert(row.visible,`Bundle ${index+1}: missing E card`);assert.match(row.text,/ΚΟΨΕ/);assert.equal(row.border,'2px');assert.equal((await state()).aimedBundle,index);assert.equal((await state()).stockHighlights[index],'blue');}
 }
 await aim(0);
 report.performance=await page.evaluate(async()=>{
  const g=window.__wireTheHouse,samples=[];
  for(let i=0;i<35;i++)window.pipeStep(1/60);
  for(let i=0;i<120;i++){const start=performance.now();window.pipeStep(1/60);samples.push(performance.now()-start);}
  const draw=g.renderer.drawScene.bind(g.renderer);let draws=[];g.renderer.drawScene=function(scene){draw(scene);const info=g.renderer.webgl.info;draws.push({calls:info.render.calls,triangles:info.render.triangles});};
  await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();g.renderer.drawScene=draw;samples.sort((a,b)=>a-b);
  const intervals=[];g.step=window.pipeStep;await new Promise(resolve=>{let count=0,last=0;const frame=now=>{if(count++>=30&&last)intervals.push(now-last);last=now;if(count<90)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});g.step=()=>{};intervals.sort((a,b)=>a-b);
  return{environment:'Windows Chrome headless, 1366x768; fixed camera; physical-phone performance unverified',meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,p95Ms:samples[114],maxMs:samples[119],fps:1000/(intervals.reduce((a,b)=>a+b,0)/intervals.length),frameP95Ms:intervals[Math.floor(intervals.length*.95)],frameMaxMs:intervals.at(-1),draws,geometries:g.renderer.webgl.info.memory.geometries,textures:g.renderer.webgl.info.memory.textures};
 });
 if(!baseline&&!performanceOnly){
  await aim(4);await page.evaluate(()=>{const g=window.__wireTheHouse;g.player.update=window.pipePlayerUpdate;for(let i=0;i<20;i++)window.pipeStep(1/60);const c=g.renderer.camera,p=g.pvc.stock.bundleCenter(4).add(new c.position.constructor(.14,1.4,0));c.lookAt(p);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;for(let i=0;i<2;i++)window.pipeStep(1/60);g.player.update=()=>{};});
  assert.equal((await state()).aimedBundle,4,'The fifth bundle remains reachable after normal player collision updates');report.checks.push('normal player positioning and collision still allow fifth-bundle targeting');
  await aim(4);await page.evaluate(()=>window.__wireTheHouse.pvc.stock.bundleRoots[4].visible=false);await step(2);assert.equal((await state()).aimedBundle,null);await page.evaluate(()=>window.__wireTheHouse.pvc.stock.bundleRoots[4].visible=true);
  await aim(4);await page.evaluate(()=>window.__wireTheHouse.renderer.camera.position.x-=4);await step(2);assert.equal((await state()).aimedBundle,null);
  await aim(4);await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,V=c.position.constructor;let template;g.room.traverse(o=>{if(!template&&o.isMesh&&!o.isInstancedMesh&&o.geometry?.type==='BoxGeometry')template=o;});const blocker=new template.constructor(new template.geometry.constructor(.3,.3,.3),template.material);blocker.scale.set(1,1,1);blocker.rotation.set(0,0,0);blocker.position.copy(c.position).addScaledVector(c.getWorldDirection(new V()),.5);g.room.worldToLocal(blocker.position);blocker.visible=true;g.room.add(blocker);g.room.updateMatrixWorld(true);window.pipeBlocker=blocker;});await step(2);report.occlusion=await page.evaluate(()=>{const p=window.__wireTheHouse.pvc,b=window.pipeBlocker;return{ray:p.ray.ray.direction.toArray(),origin:p.ray.ray.origin.toArray(),far:p.ray.far,position:b.position.toArray(),world:b.matrixWorld.elements,hits:p.ray.intersectObject(b,true).map(h=>h.distance)};});assert.equal((await state()).aimedBundle,null);assert.equal(await page.locator('#pvc-prompt').isVisible(),false);await page.evaluate(()=>{window.pipeBlocker.removeFromParent();window.pipeBlocker.geometry.dispose();delete window.pipeBlocker;});
  report.checks.push('hidden, distant and physically occluded pipes cannot receive E or blue highlights');
  for(let index=0;index<5;index++){
   await aim(index);await key('KeyE');assert.equal((await state()).phase,'opening');assert.equal((await state()).activeBundle,index);
   await step(130);assert.equal((await state()).phase,'loose');await aim(index);assert.match(await page.locator('#pvc-prompt').textContent(),/ΑΠΛΩΣΕ/);
   if(index===4)await snap('loose-4');
   await key('KeyE');await step(110);assert.equal((await state()).phase,'marking');
   const bounds=await page.evaluate(index=>{const s=window.__wireTheHouse.pvc.stock;return{spread:s.bundleSpread[index],remaining:s.bundleRemaining[index],straps:s.bundleStraps(index).map(x=>x.visible)};},index);
   assert.equal(bounds.spread,1);assert.equal(bounds.remaining,20);assert(bounds.straps.every(x=>!x));
   await key('Escape');
  }
  report.checks.push('five independent cut-ties -> lay-down -> marking workflows');
  await aim(0,true);await key('KeyE');assert.equal((await state()).activeBundle,0);assert.equal((await state()).phase,'marking');
  await key('KeyE');await step(60);assert.equal((await state()).phase,'spring');
  await page.mouse.down();await step(2);await page.mouse.up();await step(100);assert.equal((await state()).phase,'bending');
  for(let cell=0;cell<8;cell++){if(cell){await key('KeyD');}await page.mouse.down();await step(35);await page.mouse.up();await step(2);}
  await key('KeyE');assert.equal((await state()).phase,'review');await key('KeyE');await step(100);assert.equal((await state()).phase,'carrying');assert.equal((await state()).raw,19);assert.equal((await state()).totalAll,100);
  await aim(4,true);assert.match(await page.locator('#pvc-prompt').textContent(),/ΕΠΙΣΤΡΟΦΗ/);await key('KeyE');assert.equal((await state()).carrying,false);assert.equal((await state()).prepared,1);assert.equal((await state()).totalAll,100);await snap('returned-4');
  await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,V=c.position.constructor,p=g.pvc.prepared[0].mesh;const target=p.localToWorld(new V(.25,0,0));c.position.copy(target).add(new V(0,.8,.4));c.lookAt(target);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);});await step(2);
  assert.match(await page.locator('#pvc-prompt').textContent(),/ΠΑΡΕ/);await key('KeyE');assert.equal((await state()).carrying,true);await aim(2,true);await key('KeyE');assert.equal((await state()).carrying,false);assert.equal((await state()).totalAll,100);
  report.checks.push('real pipe production -> return to another bundle -> exact prepared pickup -> return elsewhere, conserved 100 pipes');
  await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.lookAt(c.position.x-3,c.position.y,c.position.z);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;});await step(2);
  assert((await state()).stockHighlights.every(x=>x==='yellow'));assert.equal(await page.locator('#pvc-prompt').isVisible(),false);
  report.checks.push('look-away clears E card and restores yellow outlines');
 }
 }
 if(!performanceOnly){
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await blockPointerLock(mobile);if(!baseline)await routeBuildingDist(mobile);
 const mp=await mobile.newPage();mp.on('pageerror',e=>report.errors.push(e.message));await mp.goto('http://127.0.0.1:5365/Electrical-Game/');await mp.locator('#start-button').tap({timeout:120000});await mp.waitForFunction(()=>window.__wireTheHouse.started);
 await mp.locator('#start-screen').waitFor({state:'hidden'});
 await mp.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;const step=g.step.bind(g),c=g.renderer.camera,V=c.position.constructor,p=g.pvc.stock.bundleCenter(4).add(new V(.14,1.4,0));g.step=()=>{};g.player.update=()=>{};c.position.copy(p).add(new V(-1.2,.1,0));c.lookAt(p);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);for(let i=0;i<2;i++)step(1/60);});
 report.mobile=await mp.evaluate(()=>{const g=window.__wireTheHouse,e=g.pvc.prompt,c=g.renderer.camera,ray=g.pvc.ray;return{started:g.started,telemetry:g.pvc.telemetry,hidden:e.hidden,display:getComputedStyle(e).display,boxAssembly:g.hud.shell.dataset.boxAssembly,startClass:document.querySelector('#start-screen').className,camera:c.position.toArray(),rotation:c.rotation.toArray(),rawBundle:g.pvc.stock.bundleAt(c,3)?.index,blockers:ray.intersectObjects([g.room,g.mixing.models.group],true).slice(0,3).map(h=>({name:h.object.name,distance:h.distance})),stock:g.pvc.stock.bundleCenter(4).toArray()};});
 await mp.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await mp.screenshot({path:`${out}/mobile-sealed-4.png`});
 if(!baseline){assert(await mp.locator('#pvc-prompt').isVisible());assert((await mp.locator('#pvc-prompt').boundingBox()).height>=44);assert.equal(await mp.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await mp.setViewportSize({width:844,height:390});await mp.evaluate(async()=>{const g=window.__wireTheHouse;g.pvc.present();await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();});await mp.screenshot({path:`${out}/mobile-landscape-4.png`});const box=await mp.locator('#pvc-prompt').boundingBox();assert(box.x>=0&&box.x+box.width<=844&&box.y>=0&&box.y+box.height<=390);await mp.locator('#pvc-prompt').tap();await mp.evaluate(()=>window.__wireTheHouse.pvc.handleInput(1/60,false,false));assert.equal(await mp.evaluate(()=>window.__wireTheHouse.pvc.telemetry.phase),'opening');report.checks.push('390x844 and 844x390 touch card fits and advances the selected bundle');}
 }
 assert.equal(report.errors.length,0,report.errors.join('\n'));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({out,baseline,checks:report.checks,bundles:report.bundles.map(({index,visible})=>({index,visible})),performance:report.performance,errors:report.errors}));
