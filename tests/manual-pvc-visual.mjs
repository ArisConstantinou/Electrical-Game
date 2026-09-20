import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/manual-pvc/visual';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const mobile of process.argv.includes('--mobile')?[true]:[false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:768},hasTouch:mobile,isMobile:mobile});await blockPointerLock(context);
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/');await page.locator('#start-button').click({timeout:120000});await page.waitForTimeout(500);
  const state=await page.evaluate(async()=>{
   const g=window.__wireTheHouse,p=g.pvc;await g.workerBody.ready;const step=g.step.bind(g);window.pvcVisualStep=step;g.step=()=>{};
   p.stock.layout(1);p.phase='marking';p.setFocus();for(let i=0;i<100;i++)step(1/60);
   g.renderer.render();await g.renderer.waitForFrame();
   return {body:g.workerBody.telemetry,pvc:p.telemetry,measure:document.querySelector('#pvc-live-measure').getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-marking.png`});
  await writeFile(`${out}/${mobile?'mobile':'desktop'}-marking.json`,JSON.stringify({state,errors},null,2));
  assert.equal(await page.locator('#pvc-panel').count(),0);
  assert.equal(state.body.visible,false,'Character must not occlude the overhead measuring view');
  assert(state.measure.left>=0&&state.measure.right<=state.width,'Live measurement must stay in the viewport');
  await page.mouse.move(300,220);await page.mouse.move(300,245);await page.evaluate(()=>window.pvcVisualStep(1/60));
  if(mobile){
    const touch=await context.newCDPSession(page),before=await page.evaluate(()=>window.__wireTheHouse.pvc.bend.mark);
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:280,y:230}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:280,y:265}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.evaluate(()=>window.pvcVisualStep(1/60));
    assert((await page.evaluate(()=>window.__wireTheHouse.pvc.bend.mark))>before,'Native touch drag must move the square');
    assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.markingProgress),0,'Dragging must not also paint');
    await touch.detach();
  }
  const customCm=await page.evaluate(()=>window.__wireTheHouse.pvc.bend.mark*100);
  if(mobile)await page.tap('[data-pvc="save"]');else await page.keyboard.press('KeyP');await page.evaluate(()=>window.pvcVisualStep(1/60));
  assert(await page.evaluate(cm=>window.__wireTheHouse.pvc.customPresets.some(p=>Math.abs(p.cm-cm)<.05),customCm),JSON.stringify(await page.evaluate(cm=>({cm,mark:window.__wireTheHouse.pvc.bend.mark,presets:window.__wireTheHouse.pvc.customPresets,phase:window.__wireTheHouse.pvc.phase,focused:window.__wireTheHouse.pvc.focused,message:window.__wireTheHouse.pvc.message,queue:window.__wireTheHouse.pvc.queue.length}),customCm)));
  await page.reload();await page.locator('#start-button').waitFor({timeout:120000});await page.waitForFunction(()=>Boolean(window.__wireTheHouse?.pvc));
  assert(await page.evaluate(cm=>window.__wireTheHouse.pvc.customPresets.some(p=>Math.abs(p.cm-cm)<.05),customCm),'Custom preset must survive reload');
  await page.locator('#start-button').click();
  const restored=await page.evaluate(()=>{const g=window.__wireTheHouse;g.pvc.phase='spring';g.pvc.setFocus();for(let i=0;i<60;i++)g.step(1/60);return{body:g.workerBody.visible,opacity:g.pvc.pipe.material.opacity};});
  assert(restored.body,'Same body returns outside the overhead view');assert.equal(restored.opacity,1);
  if(mobile)await page.tap('[data-pvc="transparent"]');else await page.keyboard.press('KeyR');await page.evaluate(()=>window.__wireTheHouse.step(1/60));assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.pipe.material.opacity),.4);
  if(mobile)await page.tap('[data-pvc="transparent"]');else await page.keyboard.press('KeyR');await page.evaluate(()=>window.__wireTheHouse.step(1/60));assert.equal(await page.evaluate(()=>window.__wireTheHouse.pvc.pipe.material.opacity),1);
  console.log(JSON.stringify({mobile,reach:state.body.gripReachErrors,measure:state.measure,overflow:state.overflow,errors}));assert.equal(errors.length,0);
  await context.close();
 }
}finally{await browser.close();}
