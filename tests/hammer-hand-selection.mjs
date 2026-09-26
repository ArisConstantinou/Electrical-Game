import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {routeBuildingDist} from './building-qa-utils.mjs';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/hammer-hand-selection';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={cases:[],errors:[],mobileIsEmulation:true};
try{for(const mobile of [false,true]){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},isMobile:mobile,hasTouch:mobile});
 await blockPointerLock(context);await routeBuildingDist(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});
 await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();
 if(mobile){await page.locator('#worker-bar-handle').tap();await page.locator('#mobile-tool-slider [data-tool="hammer"]').tap();}else await page.keyboard.press('Digit4');
 await page.evaluate(async()=>{const g=window.__wireTheHouse;await g.workerBody.ready;await g.renderer.waitForFrame();window.qaStep=g.step.bind(g);g.step=()=>{};g.player.camera.position.set(0,1.65,g.room.brickWall.volume.frontZ+.9);g.player.yaw=0;g.player.pitch=-.25;g.player.workPosition.locked=true;g.player.workPosition.targetDistanceM=.9;for(let i=0;i<90;i++)window.qaStep(1/60,1/60,false);});
 const step=async(n=90)=>page.evaluate(n=>{const g=window.__wireTheHouse;for(let i=0;i<n;i++)window.qaStep(1/60,1/60,false);return {selected:g.fpsRig.hammerHandedness,rear:g.fpsRig.debugPose().arms.find(a=>a.gripRole==='rear').side,angle:g.room.brickWall.chiselSideDegrees,right:document.querySelector('#hammer-view-right').getAttribute('aria-pressed'),left:document.querySelector('#hammer-view-left').getAttribute('aria-pressed'),position:g.player.camera.position.toArray()};},n);
 const initial=await step();assert.equal(initial.selected,'right');assert.equal(initial.rear,1);
 const openSettings=async()=>{if(!await page.locator('#settings-toggle').isVisible())await page.locator('#worker-bar-handle').tap();await page.locator('#settings-toggle').tap();};
 for(const hand of ['right','left','right']){
  if(mobile){await openSettings();if((await step()).selected!==hand)await page.locator('#hammer-view-toggle').tap();await page.locator('#settings-close').tap();}
  else await page.locator('#hammer-view-'+hand).click();
  const before=await step();assert.equal(before.selected,hand);assert.equal(before[hand],'true');
  const rows=[];
  if(mobile){
   // The mobile settings cycle passes through both signs and zero.
   await openSettings();
   for(let i=0;i<9;i++){await page.locator('#chisel-side').tap();rows.push(await step());}
   await page.locator('#settings-close').tap();
  }else{
   for(const angle of [-45,0,45,0]){
    let current=(await step(1)).angle;
    while(current!==angle){await page.keyboard.press(current<angle?'KeyJ':'KeyK');current=(await step(1)).angle;}
    rows.push(await step());
   }
  }
  for(const row of rows){assert.equal(row.selected,hand,'Blade angle changed chosen hand');assert.equal(row.rear,hand==='right'?1:-1,'Rear grip changed hands');assert.equal(row[hand],'true','Selected hand button is stale');assert.deepEqual(row.position,before.position,'Hand/angle selection moved camera');}
  report.cases.push({profile:mobile?'mobile':'desktop',hand,angles:rows.map(r=>r.angle)});
 }
 await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}.png`});await context.close();
}assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
