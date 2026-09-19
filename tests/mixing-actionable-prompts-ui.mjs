import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {blockPointerLock} from './browser-safety.mjs';
const url=process.argv.find(a=>/^https?:/.test(a))??'http://127.0.0.1:5362/Electrical-Game/';
const repro=process.argv.includes('--repro');
const baseline=repro?execFileSync('git',['show','HEAD:src/systems/MixingStation.ts'],{encoding:'utf8'}):null;
const out=repro?'output/mixing-actionable-prompts-baseline':'output/mixing-actionable-prompts';await mkdir(out,{recursive:true});
const report={url,mobileIsEmulation:true,cases:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
for(const layout of [{name:'desktop',width:1366,height:768,mobile:false},{name:'mobile',width:390,height:844,mobile:true}]){
 const context=await browser.newContext({viewport:{width:layout.width,height:layout.height},isMobile:layout.mobile,hasTouch:layout.mobile});await blockPointerLock(context);
 const page=await context.newPage();await page.routeWebSocket(/.*/,ws=>{const server=ws.connectToServer();server.onMessage(message=>{try{if(['update','full-reload'].includes(JSON.parse(message).type))return;}catch{}ws.send(message);});});page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 if(repro)await page.route('**/src/systems/MixingStation.ts*',async route=>{
  const live=await route.fetch(),liveSource=await live.text(),three=liveSource.match(/import \* as THREE from ["']([^"']+)["']/)?.[1];
  const compiled=ts.transpileModule(baseline,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/(from\s+|import\s+)(["'])([^"']+)\2/g,(all,prefix,quote,specifier)=>{
   const resolved=specifier==='three'?three:specifier.startsWith('.')?new URL(specifier+(/\.css$/.test(specifier)?'':'.ts'),route.request().url()).pathname:specifier;return `${prefix}${quote}${resolved}${quote}`;
  });await route.fulfill({response:live,body:compiled,contentType:'application/javascript'});
 });
 await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.mixing,undefined,{timeout:120000});await page.locator('#start-button')[layout.mobile?'tap':'click']();
 await page.evaluate(()=>{const g=window.__wireTheHouse;window.__promptStep=g.step.bind(g);g.step=()=>{};g.mixing.setActive(true);g.mixing.chooseTool('shovel');});
 const step=(n=2)=>page.evaluate(n=>{for(let i=0;i<n;i++)window.__promptStep(1/60);},n);
 const state=()=>page.evaluate(()=>{const m=window.__wireTheHouse.mixing,p=document.querySelector('#mixing-world-prompt');return{target:m.telemetry.aimedTarget,tool:m.tool,prompt:p.textContent,hidden:p.hidden,mobileHidden:document.querySelector('#mobile-interact').hidden,activity:m.telemetry.activity,sand:m.batch.sandScoops};});
 await step();
 const freshAim=await page.evaluate(()=>{
  const g=window.__wireTheHouse,m=g.mixing,c=g.renderer.camera;
  m.models.group.updateMatrixWorld(true);
  const sand=m.models.sand.getWorldPosition(c.position.clone());
  c.position.set(sand.x,1.65,sand.z-1.9);
  const oldTarget=m.stationTrowel.getWorldPosition(c.position.clone());
  c.lookAt(oldTarget);c.updateMatrixWorld(true);
  c.lookAt(sand.clone().add({x:0,y:.25,z:0}));
  // No render/rig update between player look and native station request.
  const target=m.telemetry.aimedTarget;
  g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;
  return target;
 });
 report.freshAim={layout:layout.name,target:freshAim,repro};
 assert.equal(freshAim,'sand','A new look must raycast current camera rotation before rendering');
 const samples=[];
 for(const x of [-.55,-.28,0,.28,.55]){
  const geometry=await page.evaluate(x=>{const g=window.__wireTheHouse,m=g.mixing,c=g.renderer.camera;m.models.group.updateMatrixWorld(true);const p=m.models.sand.getWorldPosition(c.position.clone());c.position.set(p.x,1.65,p.z-1.9);const aim=p.clone();aim.x+=x;aim.y=.20;c.lookAt(aim);c.updateMatrixWorld(true);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;g.player.crouched=false;return{camera:c.position.toArray(),aim:aim.toArray()};},x);await step();const before=await state();samples.push({x,geometry,before});assert.equal(before.target,'sand','Every visible central sand sample must remain sand from the same position');assert.match(before.prompt,/ΠΑΡΕ ΜΙΑ ΦΤΥΑΡΙΑ/);
 }
 const press=async()=>{if(layout.mobile){await page.locator('#mobile-interact').tap();await step();}else{await page.keyboard.down('KeyE');await step();await page.keyboard.up('KeyE');}await step(105);};
 await press();assert.equal((await state()).sand,1,'Native interaction takes a scoop from last sample');
 await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${layout.name}-sand.png`});
 // Incompatible held tool: no contextual command and pressing E does nothing.
 await page.evaluate(()=>window.__wireTheHouse.mixing.chooseTool('trowel'));await step();const wrongTool=await state();assert(wrongTool.hidden);assert.equal(wrongTool.prompt,'');assert(wrongTool.mobileHidden);
 await page.keyboard.down('KeyE');await step();await page.keyboard.up('KeyE');await step(105);assert.equal((await state()).sand,1);assert.equal((await state()).activity,null);
 // Look at the bucket with an incompatible tool, then at empty floor.
 const quiet=[];
 for(const kind of ['bucket','floor']){
  await page.evaluate(kind=>{const g=window.__wireTheHouse,m=g.mixing,c=g.renderer.camera,p=m.models.bucket.getWorldPosition(c.position.clone());if(kind==='floor'){p.x+=.65;p.z-=.8;}else p.y+=.2;c.lookAt(p);c.updateMatrixWorld(true);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;},kind);await step();const s=await state();assert(s.hidden,`${kind} cannot tell player to look at a remote bag or aim another tool`);quiet.push({kind,...s});
 }
 await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${layout.name}-quiet.png`});
 report.cases.push({layout:layout.name,freshAim,samples,wrongTool,quiet});await context.close();
}
assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({passed:report.passed,url,report:`${out}/report.json`}));
