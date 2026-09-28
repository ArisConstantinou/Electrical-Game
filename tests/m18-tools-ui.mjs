import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
import {routeBuildingDist} from './building-qa-utils.mjs';

const baseline=process.argv.includes('--baseline');
const out=process.env.M18_OUT??`output/m18-tools/${baseline?'before-fps':'after-fps'}`;
await mkdir(out,{recursive:true});
const report={baseline,errors:[],cases:[],physicalMobile:false};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const mobile of [false,true]){
  const viewport=mobile?{width:390,height:844}:{width:1366,height:768};
  const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);
  if(!baseline)await routeBuildingDist(context);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/');await page.locator('#apprentice-count').selectOption('0');
  await page.locator('#start-button').click({timeout:120000});
  await page.evaluate(()=>{const g=window.__wireTheHouse;window.toolStep=g.step.bind(g);g.step=()=>{};g.mixing.finished=true;g.mixing.setActive(false);});
  const step=n=>page.evaluate(n=>{for(let i=0;i<n;i++)window.toolStep(1/60,0,false);},n);
  for(const kind of ['drill','driver']){
   if(mobile){if(!await page.locator('#mobile-tool-slider').isVisible())await page.locator('#worker-bar-handle').tap();const b=page.locator(`#mobile-tool-slider [data-tool="${kind}"]`);await b.scrollIntoViewIfNeeded();await b.tap();}
   else await page.keyboard.press(kind==='drill'?'Digit0':'KeyB');
   await step(30);await page.waitForTimeout(1200);
   const info=await page.evaluate(({kind,baseline})=>{
    const g=window.__wireTheHouse,t=g.fpsRig.tools.get(kind);let meshes=0,triangles=0,old=false;
    t.traverse(o=>{if(o.isMesh&&o.userData.toolModelPart){meshes++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}if(/Photographed cordless|Compact impact driver housing/.test(o.name))old=true;});
    const samples=[];for(let i=0;i<100;i++){const start=performance.now();window.toolStep(1/60,0,false);samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);
    return {kind,model:t.userData.productModel,loaded:t.userData.modelLoaded,tip:t.userData.tipPoint,grip:t.userData.gripPoint,meshes,triangles,old,trigger:!!t.getObjectByName('Index finger trigger'),rotor:!!t.getObjectByName('reference-motor'),pose:g.fpsRig.debugPose(),renderError:g.renderer.renderError,selected:g.selectedTool,performance:{meanMs:samples.reduce((a,b)=>a+b)/samples.length,p95Ms:samples[94],maxMs:samples[99]},overflow:document.documentElement.scrollWidth>innerWidth};
   },{kind,baseline});
   assert.equal(info.selected,kind);assert(!info.renderError&&!info.overflow);assert(info.rotor);
   if(!baseline){assert.equal(info.model,`Milwaukee M18 ${kind==='drill'?'FPD3':'FID3'}`);assert(info.loaded&&info.trigger&&!info.old);assert(info.meshes<20,'Material batching must keep each tool under 20 meshes');}
   await page.evaluate(async()=>{const r=window.__wireTheHouse.renderer;await r.waitForFrame();r.render();await r.waitForFrame();});
   await page.screenshot({path:`${out}/${mobile?'mobile':'desktop'}-${kind}.png`});
   report.cases.push({mobile,viewport,...info});
  }
  await context.close();
 }
 assert.deepEqual(report.errors,[]);
}finally{await browser.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
