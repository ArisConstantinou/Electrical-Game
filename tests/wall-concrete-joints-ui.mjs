import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';

const out=process.env.QA_JOINT_OUTPUT??'output/wall-concrete-joints/after';
const url=process.env.QA_JOINT_URL??'http://127.0.0.1:5365/Electrical-Game/';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={errors:[],checks:[],physicalPhone:false};
try{
 const context=await browser.newContext({viewport:{width:1118,height:1223}});
 await blockPointerLock(context);await routeBuildingDist(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(url);
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});
 await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();
 await page.locator('#start-screen').waitFor({state:'hidden'});
 report.joints=await page.evaluate(async()=>{
  const g=window.__wireTheHouse;await g.workerBody.ready;window.jointStep=g.step.bind(g);g.step=()=>{};g.player.update=()=>{};
  g.room.updateWorldMatrix(true,true);const Box=g.pvc.targetGuideBounds.constructor;
  const jambs=[];g.room.traverse(o=>{if(o.name==='Exposed concrete passage jamb')jambs.push(new Box().setFromObject(o));});
  return [-1,1].flatMap(side=>{
   const jamb=jambs.find(b=>Math.sign(b.getCenter(g.renderer.camera.position.clone()).x)===side);
   const names=[`Original room rear ${side<0?'west':'east'} infill`,`Passage ${side<0?'west':'east'} fired-clay partition`];
   return names.map(name=>{
    const wall=g.room.mansionWing.masonryDemolition.get(name),axis=wall.alongX?'x':'z';
    const backing=new Box().setFromObject(wall.backing),overlap=backing.clone().intersect(jamb);
    const point=wall.group.localToWorld(g.renderer.camera.position.clone().set(wall.alongX?(side<0?wall.length/2:-wall.length/2):0,1.5,wall.alongX?0:-wall.length/2));
    const ends=wall.group.getObjectByName('Four-chamber exposed hollow clay block ends');
    const normal=wall.alongX?'z':'x',brickDepth=.24*Math.abs(wall.group.scale[normal]),centre=wall.group.position[normal];
    return {name,axis,side,jamb:{min:jamb.min.toArray(),max:jamb.max.toArray()},columnDepth:jamb.max[normal]-jamb.min[normal],brickDepth,frontProjection:jamb.max[normal]-(centre+brickDepth/2),backProjection:(centre-brickDepth/2)-jamb.min[normal],clearOpening:side<0?-jamb.max.x*2:jamb.min.x*2,backing:{min:backing.min.toArray(),max:backing.max.toArray()},overlapM:overlap.isEmpty()?0:overlap.max[axis]-overlap.min[axis],contactM:point[axis],expectedContactM:wall.alongX?(side<0?jamb.min.x:jamb.max.x):jamb.max.z,cutEnds:ends.children.reduce((n,o)=>n+o.count,0),expectedCutEnds:wall.rows};
   });
  });
 });
 const pose=async(side,exterior=false)=>{
  await page.evaluate(({side,exterior})=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(side*(exterior?1.2:1.18),1.65,exterior?4.15:3.12);c.lookAt(side*1.48,1.5,3.7);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;c.updateMatrixWorld(true);}, {side,exterior});
  await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});
 };
 for(const side of [-1,1])for(const exterior of [false,true]){await pose(side,exterior);await page.screenshot({path:`${out}/${side<0?'west':'east'}-${exterior?'outside':'inside'}.png`});}
 await pose(1);
 report.performance=await page.evaluate(async()=>{
  const g=window.__wireTheHouse,samples=[];for(let i=0;i<35;i++)window.jointStep(1/60);
  for(let i=0;i<120;i++){const start=performance.now();window.jointStep(1/60);samples.push(performance.now()-start);}
  const draw=g.renderer.drawScene.bind(g.renderer),draws=[];g.renderer.drawScene=function(scene){draw(scene);const info=g.renderer.webgl.info;draws.push({calls:info.render.calls,triangles:info.render.triangles});};
  await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();g.renderer.drawScene=draw;samples.sort((a,b)=>a-b);
  const intervals=[];g.step=window.jointStep;await new Promise(resolve=>{let count=0,last=0;const tick=now=>{if(count++>=30&&last)intervals.push(now-last);last=now;if(count<90)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});g.step=()=>{};intervals.sort((a,b)=>a-b);
  return {environment:'Windows Chrome headless, 1118x1223, same fixed east-jamb camera',meanStepMs:samples.reduce((a,b)=>a+b,0)/samples.length,p95StepMs:samples[114],maxStepMs:samples.at(-1),frameP95Ms:intervals[Math.floor(intervals.length*.95)],frameMaxMs:intervals.at(-1),draws,geometries:g.renderer.webgl.info.memory.geometries,textures:g.renderer.webgl.info.memory.textures};
 });
 for(const joint of report.joints){assert(joint.overlapM<.0001,`${joint.name}: ${joint.overlapM*1000} mm overlap with concrete`);assert(Math.abs(joint.contactM-joint.expectedContactM)<.0001,`${joint.name}: wall must terminate at concrete face`);assert.equal(joint.cutEnds,joint.expectedCutEnds,'Concrete contact must not display exposed hollow clay ends');}
 report.checks.push('both rear infills and passage partitions terminate at concrete with zero solid overlap');
 for(const joint of report.joints){
  const near=(value,expected,label)=>assert(Math.abs(value-expected)<.0001,`${joint.name}: ${label} ${value*100} cm must equal ${expected*100} cm`);
  near(joint.columnDepth,.15,'column thickness');near(joint.brickDepth,.10,'brick thickness');
  near(joint.frontProjection,.025,'front projection');near(joint.backProjection,.025,'back projection');near(joint.clearOpening,2.7,'clear passage opening');
 }
 report.checks.push('15cm concrete and centred 10cm masonry leave 2.5cm on both faces and retain 2.7m clear opening');
 report.work=await page.evaluate(()=>{
  const g=window.__wireTheHouse,wing=g.room.mansionWing,c=g.renderer.camera,Box=g.pvc.targetGuideBounds.constructor,results=[];
  for(const side of [-1,1]){
   const wall=wing.masonryDemolition.get(`Original room rear ${side<0?'west':'east'} infill`);
   const point=wall.group.localToWorld(c.position.clone().set(side<0?wall.length/2-.1:-wall.length/2+.1,1.5,0));c.position.copy(point).add(c.position.clone().set(0,0,-.6));c.lookAt(point);c.updateMatrixWorld(true);
   const aim=wall.aim(c);if(!aim)return {error:'No masonry contact',side};
   const before=wall.removedClayNodes;for(let i=0;i<8;i++)wall.strikeAt(aim.index,c,'chase');
   const nodes=wall.removedClayNodes,saved=wall.damageSnapshot(),damagedContact=Boolean(wall.aim(c));wall.restoreDamage(saved);
   const restoredContact=Boolean(wall.aim(c)),bounds=new Box().setFromObject(wall.backing);
   point.x+=side*.38;c.position.copy(point).add(c.position.clone().set(0,0,-.6));c.lookAt(point);c.updateMatrixWorld(true);
   results.push({side,nodes: nodes-before,restoredNodes:wall.removedClayNodes,damagedContact,restoredContact,neighborContact:Boolean(wall.aim(c)),backingBounds:[bounds.min.toArray(),bounds.max.toArray()]});
  }return results;
 });
 assert(Array.isArray(report.work),JSON.stringify(report.work));for(const work of report.work){assert(work.nodes>0);assert.equal(work.nodes,work.restoredNodes);assert.equal(work.damagedContact,work.restoredContact);assert(work.neighborContact);}
 report.checks.push('masonry at each corrected edge remains aimable, chaseable and restores local damage');
 await page.setViewportSize({width:390,height:844});await pose(1);await page.screenshot({path:`${out}/mobile.png`});
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({out,passed:report.passed,joints:report.joints,checks:report.checks,performance:report.performance,errors:report.errors}));
