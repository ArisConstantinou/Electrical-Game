import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
import {blockPointerLock} from './browser-safety.mjs';

const baseline=process.argv.includes('--baseline'),live=process.argv.includes('--live');
const out=process.env.BEND_QA_OUTPUT??`output/bending-indicators/${baseline?'before':live?'live':'after'}`;
const url=process.env.BEND_QA_URL??'http://127.0.0.1:5365/Electrical-Game/';await mkdir(out,{recursive:true});
const report={url,baseline,live,errors:[],checks:[],viewports:[],performance:[],physicalPhone:false};
// Only this test browser sees the candidate's compiled code. Unchanged public
// assets use the existing, identified listener; no second server/port is used.
async function candidate(context){
 if(live||baseline&&!process.env.BEND_BASELINE_DIST)return;
 const root=path.resolve(baseline?process.env.BEND_BASELINE_DIST:'dist');
 await context.route(url+'**',async route=>{
  const relative=decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length))||'index.html';
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep))return route.abort();
  if(relative!=='index.html'&&!/\.(js|css|wasm)$/.test(relative))return route.continue();
  try{await route.fulfill({body:await readFile(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/wasm'});}catch(error){if(error.code==='ENOENT')return route.continue();throw error;}
 });
}
const server=await chromium.launchServer({channel:'chrome',headless:true});
const browser=await chromium.connect(server.wsEndpoint()),rootPid=server.process().pid;
const processes=()=>{
 if(process.platform!=='win32')return [];
 const script="Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' } | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId;parent=$_.ParentProcessId;created=$_.CreationDate.ToString('o');command=$_.CommandLine} } | ConvertTo-Json -Compress";
 const value=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:10000})||'[]');return Array.isArray(value)?value:[value];
};
const owned=[];
function captureOwned(){const all=processes();let tree=all.filter(p=>p.pid===rootPid);for(let i=0;i<12;i++){const children=all.filter(p=>!tree.some(t=>t.pid===p.pid)&&tree.some(t=>t.pid===p.parent&&p.created>=t.created));if(!children.length)break;tree.push(...children);}for(const p of tree)if(!owned.some(o=>o.pid===p.pid&&o.created===p.created))owned.push(p);}
captureOwned();
try{
 for(const mobile of process.argv.includes('--desktop-only')?[false]:[false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1420,height:923},isMobile:mobile,hasTouch:mobile});
  await blockPointerLock(context);await candidate(context);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(url);await page.locator('#start-button').click({timeout:120000});
  await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;window.bendStep=g.step.bind(g);g.step=()=>{};});
  const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.bendStep(1/60,0,false);},n);
  const state=()=>page.evaluate(()=>window.__wireTheHouse.pvc.telemetry);
  const fixture=async(phase='bending',angle=90,grip=7)=>{
   await page.evaluate(({phase,angle,grip})=>{const g=window.__wireTheHouse,p=g.pvc;p.phase=phase;p.insertion=phase==='spring'?0:1;p.bend.angles.fill(0);p.bend.angles.fill(angle/8,0,8);p.bend.grip=grip;p.bend.revision++;p.quantity=1;p.message='';p.setFocus();},{phase,angle,grip});await step(60);
  };
  const snapshot=async name=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-${name}.png`});};
  const click=async name=>{const locator=page.locator(`[data-bend-action="${name}"]`);if(mobile)await locator.tap();else await locator.click();await step(2);};
  const key=async name=>{await page.keyboard.down(name);await step(2);await page.keyboard.up(name);await step(2);};
  const highlight=()=>page.evaluate(()=>{const p=window.__wireTheHouse.pvc,h=p.bendHighlight;if(!h)return null;const range=h.userData.activeRange,positions=h.active.geometry.getAttribute('position'),V=p.pipe.position.constructor;const centers=[];for(const section of [0,4]){const center=new V();for(let j=0;j<12;j++)center.add(new V().fromBufferAttribute(positions,section*12+j));center.divideScalar(12);const point=p.bend.at(range[section===0?0:1]);centers.push(center.distanceTo(new V(point.x,point.y,0)));}return{visible:h.visible,activeVisible:h.active.visible,range:h.userData.range,activeRange:range,centers,geometry:h.active.geometry.uuid,positionBuffer:positions.count,material:h.active.material.color.getHex()};});
  const layout=async()=>{
   const metrics=await page.evaluate(()=>{
    const root=document.querySelector('#pvc-bend-hud'),elements=[...root.querySelectorAll('button,.pvc-bend-metrics,.pvc-bend-dock')].filter(e=>e.getClientRects().length);
    const p=window.__wireTheHouse.pvc,center=p.bend.at(p.bend.gripS),projected=p.pipe.localToWorld(p.pipe.position.clone().set(center.x,center.y,0)).project(window.__wireTheHouse.renderer.camera);
    return{width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,highlightPoint:{x:(projected.x+1)*innerWidth/2,y:(1-projected.y)*innerHeight/2},items:elements.map(e=>({action:e.dataset.bendAction??e.className,rect:e.getBoundingClientRect().toJSON(),font:getComputedStyle(e).fontSize})),joysticks:[...document.querySelectorAll('#joystick,#look-joystick')].map(e=>e.getBoundingClientRect().toJSON())};
   });
   assert.equal(metrics.overflow,false);
   for(const item of metrics.items){const r=item.rect;assert(r.left>=0&&r.top>=0&&r.right<=metrics.width+.5&&r.bottom<=metrics.height+.5,`${item.action} outside ${metrics.width}x${metrics.height}: ${JSON.stringify(r)}`);if(item.action.startsWith('pvc-'))continue;assert(r.height>=44&&r.width>=44,`${item.action} touch target is too small`);assert(parseFloat(item.font)>=12);}
   const dock=metrics.items.find(i=>i.action==='pvc-bend-dock').rect,card=metrics.items.find(i=>i.action==='pvc-bend-metrics').rect;
   const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
   assert(!overlaps(dock,card),'Bend controls overlap the measurement/quantity card');
   if((await state()).phase==='bending'){const p=metrics.highlightPoint;assert(![dock,card].some(r=>p.x>r.left&&p.x<r.right&&p.y>r.top&&p.y<r.bottom),'The HUD must not cover the active bend highlight');}
   if(mobile)for(const joystick of metrics.joysticks)assert(!overlaps(dock,joystick)&&!overlaps(card,joystick),'Bend UI overlaps a joystick');
   report.viewports.push(metrics);
  };
  await fixture();await snapshot('bending');
  if(!mobile){
   report.performance.push(await page.evaluate(async()=>{
    const g=window.__wireTheHouse,samples=[];for(let i=0;i<30;i++)window.bendStep(1/60,0,false);
    for(let i=0;i<120;i++){const start=performance.now();window.bendStep(1/60,0,false);samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);
    const original=g.renderer.drawScene.bind(g.renderer),draws=[];g.renderer.drawScene=function(scene){original(scene);const info=g.renderer.webgl.info;draws.push({calls:info.render.calls,triangles:info.render.triangles});};
    await g.renderer.waitForFrame();g.renderer.render();await g.renderer.waitForFrame();g.renderer.drawScene=original;
    const frames=[];g.step=window.bendStep;await new Promise(resolve=>{let count=0,last=0;const tick=now=>{if(count++>=30&&last)frames.push(now-last);last=now;if(count<100)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});g.step=()=>{};frames.sort((a,b)=>a-b);
    return{environment:'Windows Chrome headless 1420x923, same 90 degree/grip 7 fixture; no physical-phone FPS claim',meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,p95Ms:samples[114],maxMs:samples.at(-1),frameP95Ms:frames[Math.floor(frames.length*.95)],frameMaxMs:frames.at(-1),fps:1000/(frames.reduce((a,b)=>a+b,0)/frames.length),draws,geometries:g.renderer.webgl.info.memory.geometries,textures:g.renderer.webgl.info.memory.textures};
   }));
  }
  if(baseline){await fixture('review');await snapshot('quantity');report.missingHighlight=!(await highlight());report.missingVisualHUD=await page.locator('#pvc-bend-hud').count()===0;await context.close();continue;}
  if(process.argv.includes('--performance-only')){await context.close();continue;}
  assert(await page.locator('#pvc-bend-hud').isVisible());assert.equal(await page.locator('#pvc-prompt').isVisible(),false);assert.equal(await page.locator('#pvc-live-measure').isVisible(),false);assert.equal(await page.locator('#pvc-touch-controls').isVisible(),false);
  assert.match(await page.locator('[data-bend-angle]').textContent(),/90.0°/);assert.match(await page.locator('[data-bend-radius]').textContent(),/127 mm/);await layout();
  if(mobile){await page.setViewportSize({width:844,height:390});await step(2);await layout();await snapshot('landscape-bending');await page.setViewportSize({width:390,height:844});await step(2);}
  let h=await highlight();assert(h?.visible&&h.activeVisible);assert(h.centers.every(n=>n<1e-6),'Highlight must follow the exact curved material cell');assert(Math.abs(h.activeRange[1]-h.activeRange[0]-.025)<1e-9);
  const geometry=h.geometry;await click('forward');assert.equal((await state()).grip,8);h=await highlight();assert.equal(h.geometry,geometry,'Moving grip must reuse GPU buffers');assert(Math.abs(h.activeRange[0]-.5)<1e-9);await click('back');assert.equal((await state()).grip,7);
  await click('pause');assert.equal((await state()).focused,false);assert.equal((await highlight()).visible,false);assert.equal(await page.locator('#pvc-bend-hud').isVisible(),false);await page.evaluate(()=>window.__wireTheHouse.pvc.setFocus());await step(2);assert.equal((await state()).angle,90);assert.equal((await state()).grip,7);
  await click('undo');assert.equal((await state()).angle,89);assert.match(await page.locator('[data-bend-angle]').textContent(),/89.0°/);assert.equal((await highlight()).geometry,geometry);
  await click('transparent');assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.pipe.material.opacity),.4);assert((await highlight()).visible);await click('transparent');
  if(!mobile){await key('KeyA');assert.equal((await state()).grip,6);await key('KeyD');assert.equal((await state()).grip,7);await key('KeyR');assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.transparent),true);await key('KeyR');}
  report.checks.push(`${mobile?'touch':'desktop'}: exact curved highlight, finite A/D/button selection, undo, transparency and buffer reuse`);
  await fixture('spring',0,0);await snapshot('spring');assert((await highlight()).visible);assert.equal((await highlight()).activeVisible,false);assert.equal(await page.locator('[data-bend-action="confirm"]').isVisible(),false);
  const use=page.locator('[data-bend-action="use"]'),box=await use.boundingBox();
  if(mobile){const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});await step(2);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
  else{await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await step(2);await page.mouse.up();}
  await step(105);assert.equal((await state()).phase,'bending');
  for(let cell=0;cell<8;cell++){
   if(cell)await click('forward');
   const button=await use.boundingBox();
   if(mobile){const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:button.x+button.width/2,y:button.y+button.height/2}]});await step(34);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
   else{await page.mouse.move(button.x+button.width/2,button.y+button.height/2);await page.mouse.down();await step(34);await page.mouse.up();}
   await step(2);
   if(cell===3)await snapshot('progressive');
  }
  assert((await state()).ready);const stopped=(await state()).angle;await step(5);assert.equal((await state()).angle,stopped,'Releasing hold must stop bending');
  await click('confirm');assert.equal((await state()).phase,'review');assert.equal((await highlight()).activeVisible,false);await layout();
  assert(await page.locator('[data-bend-action="qty-less"]').isDisabled());assert.equal((await state()).quantity,1);await click('qty-more');assert.equal((await state()).quantity,2);await click('qty-5');assert.equal((await state()).quantity,5);
  await click('qty-all');assert.equal((await state()).quantity,20);assert(await page.locator('[data-bend-action="qty-more"]').isDisabled());
  if(!mobile){await key('Minus');assert.equal((await state()).quantity,19);await page.mouse.wheel(0,-80);await step(2);assert.equal((await state()).quantity,20);await key('Equal');assert.equal((await state()).quantity,20);}
  await click('qty-5');await snapshot('quantity');assert.match(await page.locator('[data-bend-action="confirm"]').textContent(),/×5/);
  if(mobile){await page.setViewportSize({width:844,height:390});await step(2);await layout();await snapshot('landscape-quantity');await page.setViewportSize({width:390,height:844});await step(2);}
  await click('confirm');await step(100);assert.equal((await state()).phase,'carrying');assert.equal((await state()).raw,15);assert.equal((await state()).prepared,4);assert.equal((await state()).totalAll,100);assert.equal(await page.locator('#pvc-bend-hud').isVisible(),false);assert.equal((await highlight()).visible,false);
  report.checks.push(`${mobile?'touch':'desktop'}: spring insertion -> held progressive bend -> review -> +/-/presets -> production -> one in hand; conserved stock`);
  await context.close();
 }
 assert.equal(report.errors.length,0,report.errors.join('\n'));
 if(baseline){assert(report.missingHighlight&&report.missingVisualHUD,'The exact bug must reproduce before changes');report.expectedFailure='Missing bend highlight and visual controls on unchanged live base';}
}finally{
 captureOwned();await browser.close();await server.close();
 const remaining=processes().filter(p=>owned.some(o=>o.pid===p.pid&&o.created===p.created));
 report.browserLifecycle={rootPid,owned,remainingPids:remaining.map(p=>p.pid),closed:server.process().exitCode!==null||server.process().signalCode!==null};
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
 assert(report.browserLifecycle.closed&&remaining.length===0,'Owned QA browser processes must all exit');
}
console.log(JSON.stringify({out,checks:report.checks,expectedFailure:report.expectedFailure,performance:report.performance,errors:report.errors}));
