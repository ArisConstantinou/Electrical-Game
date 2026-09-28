import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';

const baseline=process.argv.includes('--baseline'),live=process.argv.includes('--live');
const out=process.env.PVC_HEIGHT_OUT??`output/pvc-cutter-height/${baseline?'before':'after'}`;
const url='http://127.0.0.1:5365/Electrical-Game/';await mkdir(out,{recursive:true});
const report={baseline,live,url,cases:[],errors:[]},browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const viewport of [{width:1095,height:1139},{width:390,height:844},{width:844,height:390}]){
  if(baseline&&viewport.width!==1095)continue;
  const mobile=viewport.width!==1095,name=mobile?viewport.width===390?'portrait':'landscape':'desktop';
  const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);
  if(!live)await serveTaskBuild(context,url);
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(url);await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click({timeout:120000});
  await page.evaluate(async()=>{
   const g=window.__wireTheHouse;await g.workerBody.ready;window.heightTick=g.step.bind(g);g.step=()=>{};g.player.update=()=>{};g.mixing.finished=true;g.mixing.setActive(false);
   const p=g.pvc,c=g.renderer.camera,box=g.mission.points[1].boxGroup.getWorldPosition(c.position.clone());
   p.bend=new p.bend.constructor(.9);p.bend.angles.fill(90/16);p.quantity=1;p.phase='extracting';p.elapsed=1.5;p.animate(.01);
   c.position.set(box.x,.95,box.z+.95);c.lookAt(box);g.player.crouched=true;g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;c.updateMatrixWorld(true);
  });
  const tick=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.heightTick(1/60,0,true);},n);
  const state=()=>page.evaluate(()=>window.__wireTheHouse.pvc.telemetry);
  await page.keyboard.press('KeyE');await tick(70);assert.equal((await state()).phase,'fitting');
  const reset=(support=.2)=>page.evaluate(support=>{const p=window.__wireTheHouse.pvc;p.supportS=support;p.cutS=.55;p.setFitCamera();},support);
  const snap=async label=>{await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});await page.screenshot({path:`${out}/${name}-${label}.png`});};
  const checks=[];const check=(title,pass,detail)=>{checks.push({title,pass,detail});if(!baseline)assert(pass,`${name}: ${title}: ${JSON.stringify(detail)}`);};
  await tick(4);await snap('default-controls');
  await page.mouse.move(viewport.width/2,viewport.height/2);
  await reset();await tick(4);await snap('controls');
  const initial=await state();
  if(!mobile){
   await page.mouse.wheel(0,120);await tick(4);const wheeled=await state();
   check('wheel down lowers the cutter',wheeled.cutCm-initial.cutCm>1,{before:initial.cutCm,after:wheeled.cutCm});
   await reset();await page.keyboard.press('ArrowUp');await tick(4);const raised=await state();
   check('Up arrow raises the cutter',raised.cutCm<54.5,{cutCm:raised.cutCm});
  }
  const up=page.locator('#pvc-cut-height-up'),down=page.locator('#pvc-cut-height-down'),height=page.locator('#pvc-cut-height-status');
  check('visible dedicated height controls',await up.isVisible()&&await down.isVisible()&&await height.isVisible(),{up:await up.count(),down:await down.count(),height:await height.count()});
  if(!baseline){
   await reset();if(mobile)await up.tap();else await up.click();await tick(4);
   check('height up button raises by a small controlled step',(await state()).cutCm<55,await state());
   await reset();
   const box=await down.boundingBox();assert(box);const x=box.x+box.width/2,y=box.y+box.height/2;
   if(mobile){const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y}]});await tick(75);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
   else{await page.mouse.move(x,y);await reset();await page.mouse.down();await tick(75);await page.mouse.up();}
   const afterHold=await state();check('holding height down travels more than 20 cm',afterHold.cutCm>75,afterHold.cutCm);
   check('left support stays independent during height control',Math.abs(await page.evaluate(()=>window.__wireTheHouse.pvc.supportS)-.2)<1e-8,await page.evaluate(()=>window.__wireTheHouse.pvc.supportS));
   await reset(.75);await page.evaluate(()=>{const p=window.__wireTheHouse.pvc;p.setCut(.9);});await tick(4);
   const blocked=await state(),blockedText=await height.textContent();
   check('support collision stops movement with an explicit cue',blocked.cutCm<75&&/ΧΕΡΙ/.test(blockedText),{cutCm:blocked.cutCm,text:blockedText});
   await snap('hand-clearance');
   const rectangles=await Promise.all([up,down].map(button=>button.boundingBox()));
   check('height buttons remain fully inside viewport with touch targets',rectangles.every(r=>r&&r.x>=0&&r.y>=0&&r.x+r.width<=viewport.width&&r.y+r.height<=viewport.height&&r.width>=44&&r.height>=44),rectangles);
  }
  report.cases.push({name,viewport,checks,initialCutCm:initial.cutCm,final:await state()});await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=!baseline&&report.cases.every(c=>c.checks.every(x=>x.pass));
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({out,passed:report.passed,cases:report.cases.map(c=>({name:c.name,checks:c.checks.map(x=>({title:x.title,pass:x.pass}))})),errors:report.errors}));
