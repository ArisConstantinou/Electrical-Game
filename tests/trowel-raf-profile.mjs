import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {blockPointerLock} from './browser-safety.mjs';

const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/?renderer=webgl',out=process.argv[3]??'output/trowel-raf-profile';
await mkdir(out,{recursive:true});
const paths=['src/core/Renderer.ts','src/core/Game.ts','src/player/FPSRig.ts','src/player/ToolModels.ts','src/systems/MortarSystem.ts','src/systems/MortarField.ts','src/systems/WorkSurfaceClearance.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const report={url,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceBefore:await hashes(),method:'Actual RAF, native stationary touch hold/release, 390x844 DPR3 Chromium. Camera fixture established once; no clock or frame gating. Inclusive CPU timings overlap. Physical iPhone unverified.',console:[],errors:[],cases:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});await blockPointerLock(context);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.text().includes('vite')||m.type()==='error')report.console.push(m.text());});
 await page.routeWebSocket('**',()=>{});
 await page.goto(url);await page.locator('#start-button').tap({timeout:120000});await page.locator('[data-tool="trowel"]').tap();
 await page.evaluate(()=>{
  const g=window.__wireTheHouse,c=g.renderer.camera;c.position.set(.3,g.player.eyeHeight,g.room.brickWall.volume.frontZ+.8);g.player.pitch=-.2;g.player.yaw=0;c.rotation.set(-.2,0,0,'YXZ');
  const p=window.__trowelRAF={active:false,stage:'idle',frames:[],renders:[],methods:{},rafs:[],start:0};
  const raf=t=>{if(p.active)p.rafs.push({t,pending:g.renderer.framePending});requestAnimationFrame(raf);};requestAnimationFrame(raf);
  for(const [o,prefix,names]of [[g,'game',['step']],[g.mortar,'mortar',['swing','update','preview','syncFieldGeometry','deposit']],[g.mortar.field,'field',['remesh','add']],[g.fpsRig,'rig',['update','poseTrowel']],[g.renderer,'renderer',['render','prepareMaterials']],[g.renderer.gpu.backend,'backend',['createRenderPipeline','_completeCompile','createAttribute','createTexture','updateTexture','createBindings','updateBindings']]])for(const name of names){
   const original=o[name];if(typeof original!=='function')continue;
   o[name]=function(...args){const t=performance.now();try{return original.apply(this,args);}finally{if(p.active){const d=performance.now()-t,label=prefix+'.'+name,a=p.methods[label]??=[];a.push({t,d,stage:g.mortar.throwFeedback.stage});if(prefix==='game'){const f=g.mortar.throwFeedback,tool=g.fpsRig.tools.get('trowel');p.frames.push({t,dt:args[0],cpu:d,stage:f.stage,castElapsed:f.castElapsed,holding:f.holding,roll:f.motion.rollDegrees,pitch:g.player.pitch,cameraPitch:g.renderer.camera.rotation.x,renderPitch:g.renderer.renderCamera.rotation.x,tool:tool.position.toArray(),projectiles:g.mortar.projectiles.length});}}}};
  }
  const original=g.renderer.gpu.render.bind(g.renderer.gpu);g.renderer.gpu.render=(scene,camera)=>{const result=original(scene,camera);if(p.active&&scene===g.renderer.scene&&!g.renderer.gpu.getRenderTarget())p.renders.push({t:performance.now(),stage:g.mortar.throwFeedback.stage});return result;};
 });
 await page.evaluate(shadow=>{globalThis.__warmShadowProbe=shadow;},process.env.QA_PREWARM_SHADOW==='1');
 if(process.env.QA_PREWARM==='1')report.prewarm=await page.evaluate(async()=>{
  // Diagnostic only: compile the same material/geometry variants before timing.
  // No new mortar mass is emitted and the real RAF is restored before probes.
  const g=window.__wireTheHouse,step=g.step;g.step=()=>{};await g.renderer.waitForFrame();
  const group=new g.mortar.group.constructor(),Mesh=g.mortar.target.constructor;
  for(const geometry of g.mortar.clodGeometries){const mesh=new Mesh(geometry,g.mortar.clodMaterial);mesh.castShadow=true;mesh.frustumCulled=false;mesh.position.copy(g.renderer.camera.position);mesh.position.z-=.4;mesh.scale.setScalar(.04);group.add(mesh);}
  const deposit=new Mesh(g.mortar.wetGeometry,g.mortar.mortarMaterial);deposit.castShadow=deposit.receiveShadow=true;deposit.frustumCulled=false;deposit.position.copy(g.renderer.camera.position);deposit.position.z-=.5;group.add(deposit);
  const start=performance.now();g.renderer.scene.add(group);
  try{
   g.renderer.prepareMaterials();await g.renderer.gpu.compileAsync(group,g.renderer.renderCamera,g.renderer.scene);
   if(globalThis.__warmShadowProbe){
    let Target;g.renderer.scene.traverse(object=>{if(object.shadow?.map)Target=object.shadow.map.constructor;});
    if(!Target)throw new Error('Expected initialized scene shadow render target');
    const target=new Target(1,1),previous=g.renderer.gpu.getRenderTarget();
    try{g.renderer.gpu.setRenderTarget(target);g.renderer.gpu.render(g.renderer.scene,g.renderer.renderCamera);}finally{g.renderer.gpu.setRenderTarget(previous);target.dispose();}
   }
   return{ms:performance.now()-start,meshes:group.children.length,shadow:!!globalThis.__warmShadowProbe};
  }
  finally{g.renderer.scene.remove(group);g.step=step;}
 });
 const cdp=await context.newCDPSession(page),b=await page.locator('#look-joystick').boundingBox();
 if(process.env.QA_CPU_RATE)await cdp.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.QA_CPU_RATE)});
 const touch=held=>cdp.send('Input.dispatchTouchEvent',{type:held?'touchStart':'touchEnd',touchPoints:held?[{x:b.x+b.width/2,y:b.y+b.height/2,id:1}]:[]});
 await page.waitForTimeout(1000);
 for(let cast=0;cast<Number(process.env.QA_CASTS??3);cast++){
  await page.evaluate(()=>{const p=window.__trowelRAF;p.frames=[];p.renders=[];p.methods={};p.rafs=[];p.start=performance.now();p.active=true;});
  await page.waitForTimeout(250);await touch(true);await page.waitForTimeout(475);await touch(false);await page.waitForTimeout(1800);
  const data=await page.evaluate(()=>{const p=window.__trowelRAF;p.active=false;const g=window.__wireTheHouse,summary={};for(const stage of [...new Set(p.frames.map(f=>f.stage))]){const a=p.frames.filter(f=>f.stage===stage),cpu=a.map(f=>f.cpu).sort((a,b)=>a-b),r=p.renders.filter(f=>f.stage===stage),gaps=r.slice(1).map((f,i)=>f.t-r[i].t).sort((a,b)=>a-b);summary[stage]={steps:a.length,renders:r.length,meanCPU:cpu.reduce((a,b)=>a+b,0)/cpu.length,maxCPU:cpu.at(-1),p95FrameMs:gaps[Math.floor(gaps.length*.95)]??null,pitchMin:Math.min(...a.map(f=>f.pitch)),pitchMax:Math.max(...a.map(f=>f.pitch))};}return{duration:performance.now()-p.start,summary,frames:p.frames,renders:p.renders,methods:p.methods,rafs:p.rafs,launched:g.mortar.launchedMass,backend:g.roomWater.waterProBackend,renderError:g.renderer.renderError,pointerLock:!!document.pointerLockElement};});
  data.fps=data.renders.length*1000/data.duration;report.cases.push(data);console.log(JSON.stringify({cast,fps:data.fps,summary:data.summary,launched:data.launched}));
  await page.screenshot({path:`${out}/cast-${cast}-recovered.png`});
  assert(data.launched>0);assert.equal(data.renderError,'');assert.equal(data.pointerLock,false);
  assert(data.summary.flip?.renders>0&&data.summary.reset?.renders>0,'Native throw must present both release and recovery frames');
  assert(Math.max(...data.frames.map(f=>f.pitch))-Math.min(...data.frames.map(f=>f.pitch))<1e-8,'A stationary held touch must not rotate the camera');
  if(process.env.QA_ASSERT_WARM==='1'){
   const pipelines=data.methods['backend.createRenderPipeline']??[];
   if(data.backend==='webgl')assert.equal(pipelines.length,0,'Startup must precompile blocking WebGL clod and deposit shaders');
   else assert(pipelines.every(p=>p.d<5),'WebGPU pipeline registration must remain below the blocking shader hitch budget');
  }
 }
 await context.close();assert.deepEqual(report.errors,[]);
}finally{await browser.close();report.sourceAfter=await hashes();report.sourceChanged=JSON.stringify(report.sourceBefore)!==JSON.stringify(report.sourceAfter);report.hmrObserved=report.console.some(s=>/hot updated|page reload/.test(s));await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({sourceChanged:report.sourceChanged,hmrObserved:report.hmrObserved,errors:report.errors}));
