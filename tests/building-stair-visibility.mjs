import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {serveTaskBuild} from './serve-task-build.mjs';
const out=process.env.QA_STAIR_OUTPUT??'output/building-stair-visibility';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),report={cases:[],errors:[]};
try{for(const mobile of [false,true]){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1789,height:960},isMobile:mobile,hasTouch:mobile});
 await blockPointerLock(context);await serveTaskBuild(context,'http://127.0.0.1:5365/Electrical-Game/');
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/'+(mobile?'?renderer=webgl':''));
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:120000});
 await page.locator('#apprentice-count').selectOption('0');await page.locator('#start-button').click();
 for(const feet of [0,3.3,-3.4,-6.8]){
  await page.evaluate(feet=>{const g=window.__wireTheHouse;g.player.camera.position.set(feet>=0?1.5:7.5,feet+1.65,feet>=0?14.5:7.25);g.player.yaw=feet>=0?-.8:0;g.player.pitch=-.35;},feet);
  await page.waitForTimeout(250);
  const result=await page.evaluate(()=>{const g=window.__wireTheHouse,m=g.room.mansionWing;const nodes=[];m.traverseVisible(o=>{if(o.isMesh&&o.userData.openStairShaft&&o.layers.test(g.renderer.renderCamera.layers))nodes.push(o.name);});return {visibleShaftMeshes:nodes,steps:m.children.filter(o=>/^site-asset:b[12]-stair-flight-[ab]:/.test(o.name)).map(o=>({name:o.name,visible:o.visible})),corridorVisible:m.children.find(o=>o.name==='site-asset:b2-circulation-structural-floor:1')?.visible,rendererError:g.renderer.renderError};});
  await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-${feet}.png`});
  assert(result.visibleShaftMeshes.some(n=>n.includes('B2 closed stair shaft foundation')||n.includes('B2 stair shaft')),'Open shaft must retain a rendered enclosure and foundation');
  assert.equal(result.steps.length,4);assert(result.steps.every(o=>o.visible),'Both lower levels must retain their actual closed stair flights from every floor');
  assert.equal(result.rendererError,'');report.cases.push({mobile,feet,...result});
  if(feet>=0){assert(result.corridorVisible,'Lower corridor remains visible through the open stair foot');assert(await page.evaluate(()=>window.__wireTheHouse.room.mansionWing.children.find(o=>o.name==='site-asset:b1-garage-and-services-structural-floor:1')?.visible),'Oblique foyer view sees the garage floor beyond the corridor opening');}
 }
 await page.evaluate(()=>{const g=window.__wireTheHouse;g.player.camera.position.set(12,1.65,14.4);g.player.yaw=2.4;g.player.pitch=.12;});
 await page.waitForTimeout(250);
 const courtyard=await page.evaluate(()=>{const m=window.__wireTheHouse.room.mansionWing;return {shell:m.children.filter(o=>o.userData.openStairShaft&&!o.userData.editorIgnore).every(o=>o.visible),details:m.children.filter(o=>/^site-asset:b[12]-(?:exposed-frame-column|unfinished-workshop-partition|electrical-store-partition)/.test(o.name)).map(o=>({name:o.name,visible:o.visible}))};});
 assert(courtyard.shell,'Open shaft/corridor shell persists from the courtyard');assert(courtyard.details.length>10&&courtyard.details.every(o=>!o.visible),'Below-grade garage/storage details must not render through ground slabs from the courtyard');
 report.cases.push({mobile,courtyard});
 await page.evaluate(()=>window.__wireTheHouse.masonryBatch.disableForEditor());
 const editor=await page.evaluate(()=>{const m=window.__wireTheHouse.room.mansionWing;m.restoreGameplayVisibility();return [...m.children].filter(o=>o.userData.openStairShaft&&!o.userData.editorIgnore).every(o=>o.visible);});
 assert(editor,'Authored shaft objects restored for editing');await context.close();
}assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.length}));
