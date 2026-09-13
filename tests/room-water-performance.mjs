import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const output='output/room-water';await mkdir(output,{recursive:true});
const report={date:new Date().toISOString(),url:'http://127.0.0.1:5362/Electrical-Game/',viewport:{width:1366,height:768},headless:true,limitations:[
  'Controlled headless Chrome desktop benchmark, not physical-device performance or a hardware capability claim.',
  'Normal simulation remains active. Automatic render submission is replaced temporarily by one explicit render per requestAnimationFrame, awaited through renderer.waitForFrame and a backend GPU completion fence.',
  'Completion intervals include browser scheduling, CPU work and GPU synchronization overhead. They are not isolated GPU timestamp measurements or the previous synchronous-submit benchmark.',
  '60 controlled ChasingSystem.freeHit calls use real gameplay geometry/debris. Floor volume/time fixtures accelerate 44 L puddle merging and 1544 L room flooding; no hose-rate claim.',
  'JS heap is Chromium performance.memory when available. GPU memory is not exposed.'
],backends:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
for(const requestedBackend of ['webgpu','webgl']){
 const page=await browser.newPage({viewport:report.viewport}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`${report.url}${requestedBackend==='webgl'?'?renderer=webgl':''}`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__wireTheHouse,undefined,{timeout:120000});
 await page.locator('#start-button').click();await page.keyboard.press('Digit4');
 for(let i=0;i<5;i++)await page.keyboard.press('BracketLeft');
 const result=await page.evaluate(async requestedBackend=>{
  const g=window.__wireTheHouse,r=g.renderer,backend=r.webgl.backend;
  const summarize=values=>{const sorted=[...values].sort((a,b)=>a-b);return{samples:values.length,averageMs:values.reduce((a,b)=>a+b,0)/values.length,p95Ms:sorted[Math.floor((sorted.length-1)*.95)],worstMs:sorted.at(-1)};};
  const gpu=backend.device,gl=backend.gl;
  const fence=async()=>{if(gpu?.queue)await gpu.queue.onSubmittedWorkDone();else if(gl)gl.finish();else throw Error('No backend completion fence available');};
  let adapter=null;if(gpu?.adapterInfo){const a=gpu.adapterInfo;adapter={vendor:a.vendor,architecture:a.architecture,device:a.device,description:a.description};}
  let glRenderer=null;if(gl){const extension=gl.getExtension('WEBGL_debug_renderer_info');glRenderer=extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);}
  const environment={requestedBackend,actualBackend:g.roomWater.telemetry.backend,userAgent:navigator.userAgent,devicePixelRatio,adapter,glRenderer,completionFence:gpu?'GPUQueue.onSubmittedWorkDone':'WebGL2.finish'};
  const impactTimes=[];
  for(let i=0;i<60;i++){
   const x=-.6+(i%5)*.05,y=.75+Math.floor(i/5)*.045,c=r.camera;
   c.position.set(-.5,g.player.eyeHeight,-1.18);c.lookAt(x,y,g.room.brickWall.volume.frontZ);g.player.yaw=c.rotation.y;g.player.pitch=c.rotation.x;c.updateMatrixWorld(true);
   const start=performance.now(),impact=g.chasing.freeHit(c,false);impactTimes.push({ms:performance.now()-start,success:!!impact});
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  await g.room.brickWall.waitForGeometry();await r.waitForFrame();await fence();
  r.camera.position.set(0,g.player.eyeHeight,1.8);r.camera.lookAt(-.5,.45,-1.1);g.player.yaw=r.camera.rotation.y;g.player.pitch=r.camera.rotation.x;g.fpsRig.visible=false;
  const originalRender=r.render.bind(r);r.render=()=>{};
  const frame=async()=>{await new Promise(requestAnimationFrame);const start=performance.now();originalRender();await r.waitForFrame();await fence();return performance.now()-start;};
  const stages=[];
  try{
   for(const stage of ['worked-wall-44-litres','worked-wall-1544-litres']){
    if(stage==='worked-wall-44-litres'){g.roomWater.addFloorWater(-.7,-.7,22);g.roomWater.addFloorWater(.7,-.7,22);for(let i=0;i<180;i++)g.roomWater.update(1/30);}
    else{g.roomWater.addFloorWater(0,0,1500);for(let i=0;i<3600;i++)g.roomWater.update(1/30);}
    const warmup=performance.now();while(performance.now()-warmup<1500)await frame();
    const intervals=[],completion=[],sampleStart=performance.now();let previous=sampleStart;
    while(performance.now()-sampleStart<5000){completion.push(await frame());const now=performance.now();intervals.push(now-previous);previous=now;}
    const durationMs=performance.now()-sampleStart,info=r.webgl.info;
    stages.push({stage,durationMs,completedFps:intervals.length*1000/durationMs,completionIntervals:summarize(intervals),renderThroughGpuCompletion:summarize(completion),render:{...info.render},memory:{...info.memory,jsHeapUsedBytes:performance.memory?.usedJSHeapSize??null},water:g.roomWater.telemetry,masonry:g.room.brickWall.telemetry,workSurface:JSON.parse(window.render_game_to_text()).workSurface,renderError:r.renderError});
   }
  }finally{r.render=originalRender;}
  return{environment,impactProcessing:{...summarize(impactTimes.map(v=>v.ms)),successful:impactTimes.filter(v=>v.success).length},stages};
 },requestedBackend);
 result.errors=errors;report.backends.push(result);await writeFile(`${output}/performance.json`,JSON.stringify(report,null,2));
 assert.equal(result.environment.actualBackend,requestedBackend);assert.ok(result.impactProcessing.successful>0);assert.deepEqual(errors,[]);
 for(const stage of result.stages){assert.equal(stage.renderError,'');assert.ok(stage.completionIntervals.samples>0);assert.ok(stage.masonry.removedVolumeCm3>0);assert.ok(Math.abs(stage.water.conservationErrorLitres)<1e-5);}
 console.log(JSON.stringify({backend:requestedBackend,impacts:result.impactProcessing,stages:result.stages.map(s=>({stage:s.stage,fps:s.completedFps,frames:s.completionIntervals,render:s.render}))}));
 await page.close();
}
}finally{await writeFile(`${output}/performance.json`,JSON.stringify(report,null,2));await browser.close();}
