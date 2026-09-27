import {chromium} from 'playwright';import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';import {routeBuildingDist} from './building-qa-utils.mjs';
const out=process.env.QA_OUTPUT??'output/start-turn-performance',renderer=process.env.QA_RENDERER??'webgpu';await mkdir(out,{recursive:true});
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(os.homedir(),'.codex/skills/develop-web-game/scripts/browser_lifecycle.mjs')));
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:path.resolve(out)});
const report={errors:[],renderer};
await runManagedClient(session,180000,async()=>{
 const context=await session.browser.newContext({viewport:{width:1718,height:1259},deviceScaleFactor:1});
 await blockPointerLock(context);await routeBuildingDist(context);
 await context.route('**/__wire-house-mansion-level**',r=>r.fulfill({json:{slots:[]}}));
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 await page.addInitScript(()=>{
  window.turnLongTasks=[];new PerformanceObserver(list=>{for(const e of list.getEntries())window.turnLongTasks.push({at:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:true});
 });
 const url=new URL(process.env.QA_BASE??'http://127.0.0.1:5365/Electrical-Game/');url.searchParams.set('renderer',renderer);
 report.url=url.href;await page.goto(url.href);
 report.module=await page.locator('script[type="module"][src]:not([src*="@vite"])').first().getAttribute('src');
 await page.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart,null,{timeout:120000});
 report.load=await page.evaluate(()=>({readyMs:performance.now(),crew:document.querySelector('#apprentice-count').value,loadLongTasks:window.turnLongTasks}));
 await page.evaluate(()=>{
  const g=window.__wireTheHouse,r=g.renderer,b=r.gpu.backend;
  const p=window.turnProfile={active:false,phase:'initial',frames:[],steps:[],resources:[],startedAt:0};
  const step=g.step;g.step=function(...a){const at=performance.now();try{return step.apply(this,a);}finally{if(p.active)p.steps.push({at,ms:performance.now()-at,phase:p.phase});}};
  const render=r.gpu.render;r.gpu.render=function(...a){const at=performance.now(),dirty=g.room.sun.shadow.needsUpdate;
   const main=a[0]===r.scene&&a[1]===r.renderCamera&&!this.getRenderTarget();
   try{return render.apply(this,a);}finally{if(main&&p.active){const i=r.webgl.info;p.frames.push({at,phase:p.phase,yaw:g.player.yaw,position:g.player.camera.position.toArray(),cpuRenderMs:performance.now()-at,shadowDirty:dirty,calls:i.render.calls,triangles:i.render.triangles,programs:i.memory.programs,geometries:i.memory.geometries,textures:i.memory.textures,heap:performance.memory?.usedJSHeapSize});}}
  };
  for(const key of ['createNodeBuilder','createRenderPipeline','createProgram','createAttribute','createIndexAttribute','createTexture','updateTexture']){
   if(typeof b[key]!=='function')continue;const fn=b[key];b[key]=function(...a){const at=performance.now(),result=fn.apply(this,a);
    if(p.active)p.resources.push({at,phase:p.phase,key,ms:performance.now()-at,name:a[0]?.object?.name??a[0]?.name??''});
    if(key==='createNodeBuilder'&&result?.build){const build=result.build;result.build=function(...args){const at=performance.now();try{return build.apply(this,args);}finally{if(p.active)p.resources.push({at,phase:p.phase,key:'nodeBuild',ms:performance.now()-at,name:this.object?.name??''});}};}
    return result;
   };
  }
 });
 await page.locator('#start-button').click();
 report.environment=await page.evaluate(()=>{
  const g=window.__wireTheHouse,b=g.renderer.gpu.backend,gl=b.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info');
  return{ua:navigator.userAgent,api:gl?'webgl':'webgpu',backend:b.constructor.name,dpr:devicePixelRatio,canvas:[g.renderer.webgl.domElement.width,g.renderer.webgl.domElement.height],gpu:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):b.device?.adapterInfo?.architecture??null};
 });
 report.initial=await page.evaluate(()=>{const g=window.__wireTheHouse;return{position:g.player.camera.position.toArray(),yaw:g.player.yaw,pitch:g.player.pitch,tool:g.selectedTool,waterLitres:g.roomWater.telemetry.floorLitres,progress:document.querySelector('#start-load-percent').value};});
 const phases=[['initial',2000,0,0],['first-turn',1500,0,Math.PI],['first-room',6000,Math.PI,Math.PI],['return',1000,Math.PI,0],['initial-repeat',1000,0,0],['repeat-turn',1500,0,Math.PI],['repeat-room',6000,Math.PI,Math.PI]];
 for(const [name,ms,from,to] of phases){
  await page.evaluate(async({name,ms,from,to,initial})=>{
   const g=window.__wireTheHouse,p=window.turnProfile;p.phase=name;p.active=true;if(!p.startedAt)p.startedAt=performance.now();const at=performance.now();
   await new Promise(resolve=>{const update=()=>{const t=Math.min(1,(performance.now()-at)/ms);g.player.yaw=initial.yaw+from+(to-from)*t;if(t<1)requestAnimationFrame(update);else resolve();};requestAnimationFrame(update);});
  },{name,ms,from,to,initial:report.initial});
 }
 report.samples=await page.evaluate(()=>{window.turnProfile.active=false;return{...window.turnProfile,longTasks:window.turnLongTasks.filter(t=>t.at>=window.turnProfile.startedAt),lifecycle:window.__wireTheHouse.renderer.lifecycleTelemetry};});
 await page.screenshot({path:`${out}/rear-room.png`});
 const stats=values=>{const v=values.toSorted((a,b)=>a-b);return{n:v.length,mean:v.reduce((a,b)=>a+b,0)/Math.max(1,v.length),p95:v[Math.floor(v.length*.95)]??null,max:v.at(-1)??null};};
 report.phases=phases.map(([name])=>{
  const f=report.samples.frames.filter(s=>s.phase===name),intervals=f.map((s,i)=>i?s.at-f[i-1].at:null).filter(v=>v!==null);
  const resource=report.samples.resources.filter(s=>s.phase===name);
  const costs=Object.fromEntries([...new Set(resource.map(r=>r.key))].map(key=>[key,stats(resource.filter(r=>r.key===key).map(r=>r.ms))]));
  const frame=stats(intervals);return{name,fps:frame.mean?1000/frame.mean:null,frame,step:stats(report.samples.steps.filter(s=>s.phase===name).map(s=>s.ms)),render:stats(f.map(s=>s.cpuRenderMs)),drawCalls:stats(f.map(s=>s.calls)),triangles:stats(f.map(s=>s.triangles)),programs:[f[0]?.programs,f.at(-1)?.programs],geometries:[f[0]?.geometries,f.at(-1)?.geometries],costs};
 });
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({renderer,load:report.load.readyMs,environment:report.environment,initial:report.initial,phases:report.phases,errors:report.errors}));
 assert.deepEqual(report.errors,[]);
 assert.equal(report.environment.api,renderer,'The requested renderer must run without a fallback');
 assert.deepEqual(report.initial,{position:[0,1.65,5.2],yaw:Math.PI,pitch:-.08,tool:'spray',waterLitres:0,progress:'READY'},'Preparation restores the accepted launch state');
 const first=report.phases.filter(p=>p.name==='first-turn'||p.name==='first-room');
 const coldBuilders=first.reduce((n,p)=>n+(p.costs.nodeBuild?.n??0),0);
 for(const phase of report.phases)assert(phase.frame.n>20,'Every rotation/hold phase must include real submitted frames');
 assert.equal(coldBuilders,0,'The first turn must not build the rear-room shaders during gameplay');
 assert(first.every(p=>p.programs[0]===p.programs[1]),'Rear-room GPU programs were prepared before READY');
 assert.equal(report.samples.lifecycle.graphicsFault,false);assert.equal(report.samples.lifecycle.deviceLost,false);
 await context.close();
});
