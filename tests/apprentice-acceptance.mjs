import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/apprentice/acceptance';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={errors:[],checks:[],performance:[]};
try{
 for(const scenario of ['zero','desktop','portrait','landscape']){
  const mobile=['portrait','landscape'].includes(scenario),viewport=scenario==='portrait'?{width:390,height:844}:scenario==='landscape'?{width:844,height:390}:{width:1366,height:768};
  const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/');await page.waitForFunction(()=>window.__wireTheHouse,{},{timeout:120000});
  await page.selectOption('#apprentice-count',scenario==='zero'?'0':'1');await page.screenshot({path:`${out}/${scenario}-start.png`});
  await page.locator('#start-button').click();await page.waitForTimeout(650);
  await page.evaluate(()=>{const g=window.__wireTheHouse;window.testStep=g.step.bind(g);g.step=()=>{};const c=g.renderer.camera;c.position.set(-.8,1.65,-.75);c.lookAt(-.8,1.2,-2.41);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;});
  const step=async n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.testStep(1/60);},n);
  await step(3);
  const before=await page.evaluate(()=>({paint:window.__wireTheHouse.room.brickWall.freeMarkCount,removed:window.__wireTheHouse.room.brickWall.telemetry.removedVolume,crouched:window.__wireTheHouse.player.crouched}));
  if(mobile){await page.locator('[data-apprentice="point"]').tap();await page.locator('#look-joystick').tap();}else{await page.mouse.click(680,380);}
  await step(4);
  // Short touch is edge-triggered; hold is covered by the desktop gameplay test.
  assert.ok(await page.evaluate(()=>window.__wireTheHouse.apprentice.telemetry.highlightSamples>0));
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.room.brickWall.freeMarkCount),before.paint);
  await page.locator('[data-apprentice="layout"]').click();await step(3);
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.phase),'idle');
  await page.screenshot({path:`${out}/${scenario}-layout.png`});
  await page.locator('[data-apprentice="cancel"]').click();await step(3);
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.telemetry.job),null);
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.room.brickWall.telemetry.removedVolume),before.removed);
  await page.keyboard.press('v');await step(2);
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.player.crouched),before.crouched);
  assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.mode),'plan');
  if(scenario==='desktop'){
   await page.keyboard.press('Digit0');await step(2);await page.keyboard.press('t');await step(2);
   await page.mouse.down();await step(8);await page.mouse.up();await step(2);
   assert.equal(await page.evaluate(()=>window.__wireTheHouse.laserLevel.working),false,'pointing cannot operate the previous drill');
   assert.equal(await page.evaluate(()=>window.__wireTheHouse.fpsRig.visible),false,'pointing hides the previous tool');
  }
  if(scenario==='zero'){
   await page.locator('[data-apprentice="point"]').click();await step(2);await page.locator('[data-apprentice="layout"]').click();await step(2);await page.locator('[data-apprentice="confirm"]').click();await step(2);
   assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.phase),'idle');
   assert.equal(await page.evaluate(()=>window.__wireTheHouse.apprentice.body.visible),false);
  }
  if(scenario==='desktop'){
   report.performance=await page.evaluate(async()=>{
    const g=window.__wireTheHouse,c=g.renderer.camera;g.apprentice.command('cancel');c.position.set(.2,1.65,2.8);c.lookAt(.8,1,.6);g.player.pitch=c.rotation.x;g.player.yaw=c.rotation.y;
    const percentile=(a,q)=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*q)],runs=[];
    for(const count of [0,1,0,1]){g.apprentice.count=count;const cpu=[],frames=[];let last=performance.now();for(let i=0;i<80;i++){await new Promise(requestAnimationFrame);const t=performance.now();window.testStep(1/60);await g.renderer.waitForFrame();if(i>=20){cpu.push(performance.now()-t);frames.push(t-last);}last=t;}
     runs.push({count,submitMedianMs:percentile(cpu,.5),submitP95Ms:percentile(cpu,.95),frameMedianMs:percentile(frames,.5),frameP95Ms:percentile(frames,.95),frameMaxMs:Math.max(...frames),over50ms:frames.filter(n=>n>50).length,render:{...g.renderer.webgl.info.render}});
    }
    return{scope:'Headless Chrome, same loaded scene, zero versus one visible idle apprentice; CPU submission is not GPU timing. Mobile performance is not measured.',browser:navigator.userAgent,cores:navigator.hardwareConcurrency,viewport:[innerWidth,innerHeight],runs};
   });
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${scenario}: horizontal overflow`);
  report.checks.push(`${scenario}: yellow mark without spray; no demolition before OK; cancel preserves wall; V does not crouch; viewport fits`);
  await context.close();
 }
 assert.deepEqual(report.errors,[]);
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report));
