import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills/develop-web-game/scripts/browser_lifecycle.mjs')));
const out=path.resolve(process.env.QA_COLUMN_OUTPUT??'output/column-projection');await mkdir(out,{recursive:true});
const url=process.env.QA_COLUMN_URL??'http://127.0.0.1:5365/Electrical-Game/?renderer=webgl';
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
const report={errors:[],physicalPhone:false};
await runManagedClient(session,240000,async()=>{
 const context=await session.browser.newContext({viewport:{width:1280,height:900}});await blockPointerLock(context);await routeBuildingDist(context);
 await context.route('**/__wire-house-mansion-level**',r=>r.fulfill({status:404,body:'Browser-local QA'}));
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});
 await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();
 report.contacts=await page.evaluate(()=>{
  const g=window.__wireTheHouse,wing=g.room.mansionWing,Box=g.pvc.targetGuideBounds.constructor;
  g.room.updateWorldMatrix(true,true);const contacts=[];
  g.room.traverse(mesh=>{
   if(!mesh.isMesh||mesh.isInstancedMesh||!mesh.userData.constructionColumnAxes)return;
   const box=new Box().setFromObject(mesh),centre=box.getCenter(mesh.position.clone());
   const nearest=new Map();
   for(const wall of wing.editableWalls.values()){
    if(wall.userData.levelEditorKind!=='brick-wall')continue;
    const normal=wall.userData.alongX?'z':'x',along=normal==='z'?'x':'z',p=wall.getWorldPosition(centre.clone());
    const height=wall.userData.height??3,length=wall.userData.length;
    if(box.max.y<=p.y+.01||box.min.y>=p.y+height-.01)continue;
    const distance=Math.abs(centre[normal]-p[normal]),reach=/\b(column|support|supporting)\b/i.test(mesh.name)?.25:.18;
    if(distance>reach||Math.abs(centre[along]-p[along])>length/2+.18)continue;
    if(nearest.has(normal)&&nearest.get(normal).distance<=distance)continue;
    const depth=.24*Math.abs(wall.scale[normal]);
    nearest.set(normal,{column:mesh.name,wall:wall.name,normal,distance,axes:mesh.userData.constructionColumnAxes,centre:centre.toArray(),wallCentre:p.toArray(),size:box.getSize(centre.clone()).toArray(),positive:box.max[normal]-(p[normal]+depth/2),negative:(p[normal]-depth/2)-box.min[normal]});
   }
   contacts.push(...nearest.values());
  });return contacts;
 });
 const pose=async(position,target)=>{
  await page.evaluate(async({position,target})=>{const g=window.__wireTheHouse,c=g.renderer.camera;g.player.update=()=>{};c.position.fromArray(position);c.lookAt(...target);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;c.updateMatrixWorld(true);await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();},{position,target});
 };
 for(const [name,position,target] of [
  ['original-room',[-1.8,1.65,-1.65],[-2.72,1.5,-2.41]],
  ['ground-west-room',[0,1.65,9.25],[-1.2,1.5,8.6]],
  ['upper-west-room',[1.7,4.95,9.3],[3,4.8,8.6]],
  ['upper-east-room',[19.6,4.95,7.6],[21.1,4.8,6.1]],
 ]){await pose(position,target);await page.screenshot({path:path.join(out,`${name}.png`)});}
 await pose([0,1.65,9.25],[-1.2,1.5,8.6]);
 report.performance=await page.evaluate(async()=>{
  const g=window.__wireTheHouse,samples=[];for(let i=0;i<30;i++)g.step(1/60);
  for(let i=0;i<120;i++){const t=performance.now();g.step(1/60);samples.push(performance.now()-t);}samples.sort((a,b)=>a-b);
  const intervals=[];await new Promise(resolve=>{let count=0,last=0;const tick=now=>{if(count++>30&&last)intervals.push(now-last);last=now;if(count<150)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});intervals.sort((a,b)=>a-b);
  const info=g.renderer.webgl.info;
  return {stepMean:samples.reduce((a,b)=>a+b,0)/samples.length,stepP95:samples[114],stepMax:samples.at(-1),frameP95:intervals[Math.floor(intervals.length*.95)],frameMax:intervals.at(-1),calls:info.render.calls,triangles:info.render.triangles,geometries:info.memory.geometries,textures:info.memory.textures,viewport:'1280x900',renderer:'Chrome Windows headless WebGL'};
 });
 await page.setViewportSize({width:390,height:844});await pose([1.7,4.95,9.3],[3,4.8,8.6]);await page.screenshot({path:path.join(out,'mobile-upper-west-room.png')});
 report.violations=report.contacts.filter(c=>Math.max(c.positive,c.negative)>.0251);
 await context.close();
});
await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({contacts:report.contacts.length,violations:report.violations.length,examples:report.violations.slice(0,8),performance:report.performance,errors:report.errors}));
assert.deepEqual(report.errors,[]);assert.equal(report.violations.length,0,'Columns must project at most 25 mm from adjacent brick faces');
assert(report.contacts.length>190,'Cover wall contacts throughout the authored rooms and floors');
for(const contact of report.contacts)for(const side of ['positive','negative'])assert(Math.abs(contact[side]-.025)<.0001,`${contact.column}: ${side} face must project exactly 25 mm from ${contact.wall}`);
