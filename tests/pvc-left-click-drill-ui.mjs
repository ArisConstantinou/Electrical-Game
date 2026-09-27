import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';

const baseline=process.argv.includes('--baseline');
const url=process.env.DRILL_QA_URL??'http://127.0.0.1:5365/Electrical-Game/';
const out=process.env.DRILL_QA_OUTPUT??`output/left-click-drill/${baseline?'before':'after'}`;
await mkdir(out,{recursive:true});
const report={url,baseline,errors:[],checks:[],performance:[],physicalPhone:false};
const server=await chromium.launchServer({channel:'chrome',headless:true});
const browser=await chromium.connect(server.wsEndpoint());
const processSnapshot=()=>process.platform!=='win32'?[]:JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"@(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId;parent=$_.ParentProcessId;created=$_.CreationDate.ToString('o')} }) | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true})||'[]');
const owned=[],rootPid=server.process().pid;
function recordOwned(){let all=processSnapshot();if(!Array.isArray(all))all=[all];const tree=all.filter(p=>p.pid===rootPid);for(let i=0;i<12;i++){const children=all.filter(p=>!tree.some(t=>t.pid===p.pid)&&tree.some(t=>t.pid===p.parent));if(!children.length)break;tree.push(...children);}for(const p of tree)if(!owned.some(t=>t.pid===p.pid&&t.created===p.created))owned.push(p);}
recordOwned();
try{
 for(const touch of baseline?[false]:[false,true]){
  const viewport=touch?{width:390,height:844}:{width:1366,height:768};
  const context=await browser.newContext({viewport,hasTouch:touch,isMobile:touch});
  await blockPointerLock(context);if(!baseline)await routeBuildingDist(context);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(url);await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click({timeout:120000});
  await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;window.drillStep=g.step.bind(g);g.step=()=>{};g.mixing.finished=true;g.mixing.setActive(false);});
  const step=(n=2)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.drillStep(1/60,0,false);},n);
  const state=()=>page.evaluate(()=>window.__wireTheHouse.pvc.telemetry);
  const key=async()=>{await page.keyboard.down('KeyE');await step();await page.keyboard.up('KeyE');await step();};
  const mark=touch?async()=>{await page.locator('#look-joystick').tap();await step();}:key;
  const click=async()=>{await page.mouse.down();await step();await page.mouse.up();await step();};
  const snap=async name=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${touch?'touch':'desktop'}-${name}.png`});};
  await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.mission.points[0],c=g.renderer.camera,pos=p.boxGroup.getWorldPosition(c.position.clone()),bottom=pos.y-p.boxGroup.groupHeight/2;dispatchEvent(new CustomEvent('wirehouse:select-tool',{detail:'drill'}));c.position.set(pos.x,.72,pos.z+.90);c.lookAt(pos.x,(bottom+.08)/2,pos.z-.03);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);});
  await step();assert(await page.evaluate(()=>window.__wireTheHouse.pvc.fastenerPrepAvailable));await mark();await step(70);assert.equal((await state()).phase,'fastener-marking');
  await page.mouse.move(viewport.width/2,viewport.height/2);await step();
  await page.evaluate(()=>{window.__wireTheHouse.pvc.fastenerAim={x:-.72,y:.72};});
  if(!touch&&!baseline){
   await click();assert.equal((await state()).fasteners.holes,0,'LMB must not mark a new hole or start before a complete pair');
   await mark();await click();assert.equal((await state()).fasteners.holes,1);assert.equal((await state()).phase,'fastener-marking','Unpaired holes cannot drill');
  }else await mark();
  await page.evaluate(()=>window.__wireTheHouse.player.lookHandler(44,18));await mark();
  await page.evaluate(()=>window.__wireTheHouse.player.lookHandler(-52,-10));await mark();
  await page.evaluate(()=>window.__wireTheHouse.player.lookHandler(35,22));await mark();
  report.marked=await state();assert.equal(report.marked.fasteners.holes,4,JSON.stringify(report.marked));assert.equal(report.marked.fasteners.pairs,2);
  await snap('marked');
  const profile=await page.evaluate(async()=>{const g=window.__wireTheHouse,samples=[];for(let i=0;i<120;i++){const t=performance.now();window.drillStep(1/60,0,false);samples.push(performance.now()-t);}const frames=[];for(let i=0;i<45;i++){const t=performance.now();await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();frames.push(performance.now()-t);}samples.sort((a,b)=>a-b);frames.sort((a,b)=>a-b);return{simulationMeanMs:samples.reduce((a,b)=>a+b)/samples.length,p95Ms:samples[114],maxMs:samples[119],renderWaitP95Ms:frames[42],renderWaitMaxMs:frames[44],calls:g.renderer.webgl.info.render.calls,triangles:g.renderer.webgl.info.render.triangles};});
  report.performance.push({touch,viewport,...profile});
  const removed=await page.evaluate(()=>window.__wireTheHouse.room.brickWall.volume.removedNodeCount);
  if(touch){await page.locator('#pvc-drill-holes').tap();await step();}
  else await click();
  report.afterClick=await state();await snap('click');
  assert.equal((await state()).phase,'fastener-drilling','Left mouse click must start drilling without Escape or clicking the toolbar');
  assert.equal((await state()).fasteners.holes,4,'Drilling must retain every chosen hole');
  if(!touch){await page.mouse.down();await step(240);await page.mouse.up();await step();}else await step(240);
  assert.equal((await state()).phase,'fastener-insert-ready');assert.equal((await state()).fasteners.drilled,4);
  assert(await page.evaluate(before=>window.__wireTheHouse.room.brickWall.volume.removedNodeCount>before,removed));
  await snap('drilled');await mark();await step(145);assert.equal((await state()).phase,'sealed');
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.mission.points[0].userData.pvcFasteners.sequence),'marked-drilled-open-wire');
  assert.equal((await state()).focused,false);assert((await state()).fasteners.rebars.every(r=>r.visible));
  report.checks.push(touch?'Touch: four marks -> toolbar drill -> four real holes -> persistent open wire':'Desktop: reject zero/odd marks -> E adds four marks -> LMB drills -> held click cannot repeat -> E inserts wire');
  await context.close();
 }
 assert.equal(report.errors.length,0,report.errors.join('\n'));
}finally{
 recordOwned();await browser.close();await server.close();let remaining=processSnapshot();if(!Array.isArray(remaining))remaining=[remaining];report.browser={rootPid,remainingPids:remaining.filter(p=>owned.some(t=>p.pid===t.pid&&p.created===t.created)).map(p=>p.pid)};
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));assert.equal(report.browser.remainingPids.length,0,'Owned browser processes must exit');
}
console.log(JSON.stringify({checks:report.checks,errors:report.errors,performance:report.performance,browser:report.browser}));
