import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';
const b=await chromium.launch({channel:'chrome',headless:true});
try{
const c=await b.newContext({viewport:{width:1440,height:810}});await blockPointerLock(c);const p=await c.newPage();
await p.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');await p.waitForFunction(()=>window.__wireTheHouse?.workerBody.loaded,null,{timeout:90000});await p.locator('#start-button').click();
await p.evaluate(()=>{const g=window.__wireTheHouse,step=g.step.bind(g);window.samples=[];g.step=(...args)=>{const t=performance.now();step(...args);window.samples.push(performance.now()-t);};});
const sample=async mode=>{await p.waitForTimeout(500);return p.evaluate(async mode=>{window.samples=[];const frames=[];let previous=performance.now();for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);const t=performance.now();frames.push(t-previous);previous=t;}const q=(a,n)=>a.slice().sort((a,b)=>a-b)[Math.floor((a.length-1)*n)];return {mode,cpuP95Ms:q(window.samples,.95),frameP50Ms:q(frames,.5),frameP95Ms:q(frames,.95),maxMs:Math.max(...frames),over50:frames.filter(x=>x>50).length,heap:performance.memory?.usedJSHeapSize,render:window.__wireTheHouse.renderer.webgl.info.memory};},mode);};
const runs=[await sample('game-before')];await p.locator('#model-inspector-open').click();await p.waitForFunction(()=>window.__wireTheHouse.modelInspector.telemetry.loaded);runs.push(await sample('character-panel'));await p.locator('#model-live').click();runs.push(await sample('live-panel'));await p.locator('#model-close').click();runs.push(await sample('game-after'));
const device=await p.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return{browser:navigator.userAgent,cores:navigator.hardwareConcurrency,gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)};});
const result={device,viewport:[1440,810],scope:'Headless desktop Chrome/WebGL; CPU submission and RAF timing, not GPU time or physical mobile evidence. First-open character is cached for reuse.',runs};await writeFile('output/model-inspector/performance.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await b.close();}
