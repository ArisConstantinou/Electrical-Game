import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';
const out='output/tool-view-regression',report={scope:'Headless PC Chrome/WebGL; mobile viewport is emulation, not phone GPU evidence. CPU submission includes simulation and render submission, not GPU timing.',cases:[],errors:[]};
await mkdir(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const mobile of [false,true]){
 const viewport=mobile?{width:390,height:844}:{width:1440,height:810};
 const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile});await blockPointerLock(context);const page=await context.newPage();await page.routeWebSocket('**',()=>{});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await page.locator('#start-button').click({timeout:120000});await page.waitForTimeout(1200);
 await page.evaluate(()=>{const g=window.__wireTheHouse;window.perfStep=g.step.bind(g);g.step=()=>{};g.player.velocity.set(0,0,0);g.renderer.camera.position.set(.7,1.65,-.5);});
 for(const tool of ['spray','drill','hose']){
  const result=await page.evaluate(async tool=>{const g=window.__wireTheHouse;g.selectTool(tool);const cpu=[],frames=[];let last=performance.now();
   for(let i=0;i<120;i++){await new Promise(requestAnimationFrame);const start=performance.now();g.player.yaw=Math.sin(i*.04)*.3;g.player.pitch=-.85;window.perfStep(1/60,0,false);g.renderer.render();await g.renderer.waitForFrame();if(i>=40){cpu.push(performance.now()-start);frames.push(start-last);}last=start;}
   const p95=a=>a.sort((a,b)=>a-b)[Math.floor(a.length*.95)];return{tool,cpuP95Ms:p95(cpu),frameP95Ms:p95(frames),frameMaxMs:Math.max(...frames),framesOver50ms:frames.filter(t=>t>50).length,calls:g.renderer.webgl.info.render.calls,triangles:g.renderer.webgl.info.render.triangles,error:g.renderer.renderError};
  },tool);assert.equal(result.error,'');report.cases.push({mobile,viewport,...result});
 }await context.close();
}assert.deepEqual(report.errors,[]);}finally{await writeFile(`${out}/held-tool-performance.json`,JSON.stringify(report,null,2));await browser.close();}console.log(report);
