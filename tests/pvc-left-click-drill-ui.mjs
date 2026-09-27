import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';

const baseline=process.argv.includes('--baseline');
const url=process.env.DRILL_QA_URL??'http://127.0.0.1:5365/Electrical-Game/';
const out=process.env.DRILL_QA_OUTPUT??`output/direct-drill/${baseline?'before':'after'}`;
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
  {
   let ePresses=0;await page.exposeFunction('recordDrillE',()=>ePresses++);await page.evaluate(()=>addEventListener('keydown',e=>{if(e.code==='KeyE')window.recordDrillE();}));
   await page.mouse.move(viewport.width/2,viewport.height/2);
   const holes=await page.evaluate(()=>{const g=window.__wireTheHouse,p=g.mission.points[0],c=g.renderer.camera,pos=p.boxGroup.getWorldPosition(c.position.clone()),volume=g.room.brickWall.volume,max=Math.max(.13,pos.y-p.boxGroup.groupHeight/2-.065),min=.09,span=max-min;dispatchEvent(new CustomEvent('wirehouse:select-tool',{detail:'drill'}));c.position.set(pos.x,.72,pos.z+.90);return[[-.065,.85],[.05,.75],[-.08,.2],[.038,.25]].map(([x,y])=>{const hit=volume.raycast({x:pos.x+x,y:min+span*y,z:volume.frontZ+.1},{x:0,y:0,z:-1},1);if(!hit)throw new Error('Fixture must aim at real brick');return[hit.point.x,hit.point.y,hit.point.z];});});
   const aim=async point=>{await page.evaluate(point=>{const g=window.__wireTheHouse,c=g.renderer.camera;c.lookAt(...point);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);},point);await step();};
   await aim(holes[0]);await snap('aim-before');
   const removed=await page.evaluate(()=>window.__wireTheHouse.room.brickWall.volume.removedNodeCount);
   const performanceSamples=await page.evaluate(()=>{const samples=[];for(let i=0;i<120;i++){const t=performance.now();window.drillStep(1/60,0,false);samples.push(performance.now()-t);}samples.sort((a,b)=>a-b);return{meanMs:samples.reduce((a,b)=>a+b)/samples.length,p95Ms:samples[114],maxMs:samples[119]};});report.performance.push({touch,viewport,...performanceSamples});
   await aim(holes[0]);report.aimHits=[await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;return g.room.brickWall.volume.raycast(c.getWorldPosition(c.position.clone()),c.getWorldDirection(c.position.clone()),1.8)?.point;})];await (touch?mark:click)();report.firstClick=await state();await snap('first-click');
   assert.equal(report.firstClick.phase,'fastener-drilling','The first left click must drill directly, without E or prior circles');
   assert.equal(report.firstClick.fasteners.holes,1);assert.equal(ePresses,0);
   assert(await page.evaluate(()=>{const p=window.__wireTheHouse.pvc;return !p.securingCursor.visible&&p.fastenerHoles.every(h=>h.marker.children.every(m=>!m.visible));}),'No red aiming/marking circles before the real hole');
   await step(55);assert.equal((await state()).fasteners.drilled,1);assert.equal((await state()).phase,'fastener-marking');
   assert(await page.evaluate(before=>window.__wireTheHouse.room.brickWall.volume.removedNodeCount>before,removed),'First click must remove actual masonry');
   await (touch?mark:click)();await step(55);assert.equal((await state()).fasteners.holes,1,'An already drilled unpaired hole must not duplicate');
   for(const invalid of [[(holes[0][0]+holes[1][0])/2,holes[0][1],holes[0][2]],[holes[0][0]-.15,holes[0][1],holes[0][2]],holes[2]]){
    await aim(invalid);await (touch?mark:click)();await step(55);assert.equal((await state()).fasteners.holes,1,'Pipe gap, outside chase and another unpaired same-side hole must be rejected');
   }
   if(touch){
    const pad=await page.locator('#look-joystick').boundingBox(),x=pad.x+pad.width/2,y=pad.y+pad.height/2;
    const before=await page.evaluate(()=>window.__wireTheHouse.player.yaw),cdp=await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+28,y:y-12}]});await step(20);
    assert(Math.abs(await page.evaluate(()=>window.__wireTheHouse.player.yaw)-before)>.01,'Right joystick drag must still turn the actual camera while drilling');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await step();await cdp.detach();
    assert.equal((await state()).fasteners.holes,1,'Dragging must aim without drilling');
   }
   for(let i=1;i<holes.length;i++){
    await aim(holes[i]);report.aimHits.push(await page.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera;return g.room.brickWall.volume.raycast(c.getWorldPosition(c.position.clone()),c.getWorldDirection(c.position.clone()),1.8)?.point;}));if(touch){await mark();await step(60);}else{await page.mouse.down();await step(60);await page.mouse.up();await step();}
    report.directStep={i,state:await state()};assert.equal(report.directStep.state.fasteners.drilled,i+1,JSON.stringify(report.directStep));
    assert.equal((await state()).phase,i%2?'fastener-insert-ready':'fastener-marking');
   }
   const drilled=(await state()).fasteners;assert.equal(drilled.holes,4);assert.equal(drilled.pairs,2);
   report.aimHits.forEach((point,i)=>{assert(point);assert(Math.abs(drilled.positions[i].x-point.x)<.001,'Hole X must match the actual surface under the crosshair');assert(Math.abs(drilled.positions[i].y-point.y)<.001,'Hole Y must match the actual surface under the crosshair');assert(Math.abs(drilled.positions[i].z-point.z)<.001,'Hole must contact real masonry instead of an empty reference plane');});
   assert.equal(await page.locator('#pvc-drill-holes').isVisible(),false,'Desktop must not require the drill toolbar');
   await snap('four-drilled');await (touch?mark:click)();await step(145);assert.equal((await state()).phase,'sealed');assert.equal(ePresses,0);
   assert((await state()).fasteners.rebars.every(r=>r.visible));assert.equal(await page.evaluate(()=>window.__wireTheHouse.mission.points[0].userData.pvcFasteners.sequence),'marked-drilled-open-wire');
   report.checks.push(`${touch?'Mobile right joystick centre':'Desktop LMB'}: first LMB drills at crosshair with no E/circles; duplicate rejected; four independent click/hold holes form two pairs; primary action threads wire`);
   await context.close();continue;
  }

 }
 assert.equal(report.errors.length,0,report.errors.join('\n'));
}finally{
 recordOwned();await browser.close();await server.close();let remaining=processSnapshot();if(!Array.isArray(remaining))remaining=[remaining];report.browser={rootPid,remainingPids:remaining.filter(p=>owned.some(t=>p.pid===t.pid&&p.created===t.created)).map(p=>p.pid)};
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));assert.equal(report.browser.remainingPids.length,0,'Owned browser processes must exit');
}
console.log(JSON.stringify({checks:report.checks,errors:report.errors,performance:report.performance,browser:report.browser}));
