import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {blockPointerLock} from './browser-safety.mjs';

const browser=await chromium.launch({channel:'chrome',headless:true});
let report;
try{
  const context=await browser.newContext({viewport:{width:390,height:680},isMobile:true,hasTouch:true});await blockPointerLock(context);
  const page=await context.newPage();await page.goto('http://127.0.0.1:5365/Electrical-Game/');await page.locator('#start-button').tap({timeout:120000});
  report=await page.evaluate(async()=>{
    const g=window.__wireTheHouse,step=g.step.bind(g),p=g.pvc,c=g.renderer.camera;await g.workerBody.ready;g.step=()=>{};
    c.position.set(-.5,1.2,-1.35);c.rotation.set(-.32,0,0);g.player.pitch=-.32;g.player.yaw=0;g.player.velocity.set(0,0,0);p.phase='carrying';p.focused=false;
    const current=p.anatomicalGrips.bind(p),percentile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*q)];
    const profile=async mode=>{
      p.anatomicalGrips=mode==='legacy'?()=>current().map(grip=>({...grip,active:true,firstPersonClearance:.05})):current;
      for(let i=0;i<80;i++)step(1/60,0,false);
      const samples=[];for(let i=0;i<240;i++){const start=performance.now();step(1/60,0,false);samples.push(performance.now()-start);}
      g.renderer.render();await g.renderer.waitForFrame();
      const delta=g.workerBody.position.clone().sub(c.position);return{mode,meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,p95Ms:percentile(samples,.95),maxMs:Math.max(...samples),activeGrips:p.anatomicalGrips().filter(grip=>grip.active).length,horizontalBodyOffset:Math.hypot(delta.x,delta.z),calls:g.renderer.webgl.info.render.calls,triangles:g.renderer.webgl.info.render.triangles};
    };
    const legacy=await profile('legacy'),optimized=await profile('optimized');p.anatomicalGrips=current;
    return{environment:'Headless Chrome mobile viewport on Windows host; simulation CPU comparison, not physical-iPhone FPS or GPU timing.',legacy,optimized};
  });
  assert.equal(report.legacy.activeGrips,2);assert.equal(report.optimized.activeGrips,1);assert(report.optimized.horizontalBodyOffset>.26);assert(report.optimized.p95Ms<=report.legacy.p95Ms*1.15,JSON.stringify(report));
  await context.close();
}finally{await browser.close();}
await mkdir('output/pvc-carry-performance',{recursive:true});await writeFile('output/pvc-carry-performance/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
