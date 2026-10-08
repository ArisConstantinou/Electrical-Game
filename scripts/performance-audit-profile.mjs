import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {blockPointerLock} from '../tests/browser-safety.mjs';
import {routeBuildingDist} from '../tests/building-qa-utils.mjs';
import {createRoute} from '../public/performance/tour.js';
import os from 'node:os';import {pathToFileURL} from 'node:url';
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills/develop-web-game/scripts/browser_lifecycle.mjs')).href);
const name=process.argv[2]??'desktop-1080-webgl';
const distOption=process.argv.indexOf('--dist'),distRoot=distOption>=0?path.resolve(process.argv[distOption+1]):null;
const profiles={
 'desktop-1440-webgpu':{viewport:{width:2560,height:1440},deviceScaleFactor:1},
 'desktop-1080-webgl':{viewport:{width:1920,height:1080},deviceScaleFactor:1,webgl:true},
 'android-portrait-webgpu':{viewport:{width:412,height:915},deviceScaleFactor:2.625,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'},
 'mobile-portrait-webgl':{viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,webgl:true},
 'mobile-landscape-webgl':{viewport:{width:844,height:390},deviceScaleFactor:3,isMobile:true,hasTouch:true,webgl:true},
 'mobile-cpu4-webgl':{viewport:{width:360,height:800},deviceScaleFactor:2,isMobile:true,hasTouch:true,webgl:true,cpuRate:4},
 'tablet-webgl':{viewport:{width:1180,height:820},deviceScaleFactor:2,isMobile:true,hasTouch:true,webgl:true}
};
if(!profiles[name])throw Error('Unknown profile '+name);
const {webgl,cpuRate,...profile}=profiles[name];
const out=path.resolve(process.env.QA_PROFILE_OUT??'output/performance-audit',(process.argv.includes('--label')?process.argv[process.argv.indexOf('--label')+1]:'profile')+'-'+name);await mkdir(out,{recursive:true});
const report={name,profile,distRoot,cpuRate:cpuRate??1,physicalMobile:false,method:'Five apprentices, actual simulation/render loop. Camera fixtures use the authored site route; cases record the actual measured scenes. 360-degree sweep sampled twice. Nested CPU spans are not additive. CPU throttling and desktop GPU do not model a physical mobile SoC. Production asset interception is explicitly identified by distRoot; otherwise this is the actual live development source.',cases:[],errors:[],started:new Date().toISOString()};
report.counterVersion=2;
const session=await launchManagedBrowser(chromium,{channel:'chrome',headless:true,screenshotDir:out});
try{await runManagedClient(session,900000,async()=>{
 const context=await session.browser.newContext(profile);await blockPointerLock(context);if(distRoot)await routeBuildingDist(context,distRoot);const p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message));
 report.consoleErrors=[];p.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const cdp=await context.newCDPSession(p);if(cpuRate)await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpuRate});
 await p.addInitScript(()=>{window.__auditTasks=[];new PerformanceObserver(l=>window.__auditTasks.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});});
 const began=Date.now();await p.goto('http://127.0.0.1:5365/Electrical-Game/'+(webgl?'?renderer=webgl':''));await p.waitForFunction(()=>window.__wireTheHouse?.isReadyForStart&&!document.querySelector('#start-button')?.disabled,null,{timeout:150000});report.readyMs=Date.now()-began;
 await p.locator('#apprentice-count').selectOption('5');await p.locator('#start-button').click();
 report.actualApprentices=await p.evaluate(()=>window.__wireTheHouse.apprentice.count);
 report.hiddenPreparation=await p.evaluate(()=>{const g=window.__wireTheHouse,rows=[];g.renderer.scene.traverse(o=>{if(o.type==='PerspectiveCamera'&&o!==g.renderer.camera){const rig=o.children.find(c=>c.type==='Group'&&c.children.length>10);if(rig)rows.push({camera:o.name,visible:o.visible,rigVisible:rig.visible,prepared:g.renderer.hiddenTransforms.prepared.has(rig),children:rig.children.length});}});return rows;});
 report.browser=session.browser.version();
 const system=await session.browser.newBrowserCDPSession();report.browserSystem=await system.send('SystemInfo.getInfo');await system.detach();
 let poses=createRoute({passes:1}).filter(n=>n.roomId);
 poses.push({roomId:'stairs-ground',label:'Ground stair flight',x:5.5,z:9.5,floor:.75,yaw:Math.PI},{roomId:'stairs-landing',label:'Ground landing looking down',x:6.5,z:11.6,floor:1.65,yaw:0,pitch:-.6});
 const sceneArg=process.argv.indexOf('--scenes');if(sceneArg>=0){const wanted=process.argv[sceneArg+1].split(',');poses=poses.filter(p=>wanted.includes(p.roomId));}
 for(const pose of poses){
 await p.evaluate(pose=>{const g=window.__wireTheHouse;g.input.resetTransientInput();g.player.workPosition.locked=false;g.player.workPosition.released=false;g.player.camera.position.set(pose.x,pose.floor+g.player.eyeHeight,pose.z);g.player.yaw=pose.yaw;g.player.pitch=pose.pitch??-.2;g.selectTool('spray');},pose);
 await p.waitForTimeout(800);
 const samples=[];for(let pass=1;pass<=2;pass++)samples.push(await p.evaluate(async ({pose,pass})=>{
 const g=window.__wireTheHouse,r=g.renderer,times=[],cpu=[],draws=[],triangles=[],spans={},restores=[];const started=performance.now();
 const wrap=(owner,key,label)=>{if(typeof owner?.[key]!=='function')return;const old=owner[key];restores.push(()=>owner[key]=old);owner[key]=function(...args){const s=performance.now();try{return old.apply(this,args);}finally{(spans[label]??=[]).push(performance.now()-s);}};};
 for(const [o,k,l] of [[g.room,'update','room'],[g.room.mansionWing,'aimMasonry','masonryAim'],[g.room.mansionWing,'updateGameplayVisibility','visibility'],[g.siteOcclusion,'update','occlusion'],[g.masonryBatch,'update','masonryBatch'],[g.workerBody,'update','worker'],[g.apprentice,'update','apprentices'],[g.mixing,'update','mixing'],[r,'render','renderer'],[r,'prepareMaterials','materials'],[r,'drawScene','drawScene']])wrap(o,k,l);
 const oldStep=g.step,oldRender=r.render;
 g.step=function(...args){const now=performance.now();g.player.yaw=pose.yaw+(now-started)*Math.PI*2/3000;g.player.pitch=pose.pitch??(-.2+Math.sin((now-started)/3000*Math.PI*4)*.4);const b=performance.now();try{return oldStep.apply(this,args);}finally{cpu.push(performance.now()-b);}};
 r.render=function(...args){const result=oldRender.apply(this,args);if(result){times.push(performance.now());draws.push(this.gpu.info.render.drawCalls);triangles.push(this.gpu.info.render.triangles);}return result;};
 try{await new Promise(resolve=>setTimeout(resolve,3000));}finally{g.step=oldStep;r.render=oldRender;for(const restore of restores.reverse())restore();}
 const stats=v=>{const s=[...v].sort((a,b)=>a-b);return {count:v.length,meanMs:v.length?v.reduce((a,b)=>a+b,0)/v.length:null,p50Ms:s[Math.floor(s.length*.5)]??null,p95Ms:s[Math.ceil(s.length*.95)-1]??null,p99Ms:s[Math.ceil(s.length*.99)-1]??null,maxMs:s.at(-1)??null};};
 const intervals=times.slice(1).map((t,i)=>t-times[i]),frame=stats(intervals),b=r.gpu.backend,gl=b.gl,ext=gl?.getExtension('WEBGL_debug_renderer_info');
 return {pass,frames:frame,fps:frame.meanMs?1000/frame.meanMs:0,over50ms:intervals.filter(t=>t>50).length,over100ms:intervals.filter(t=>t>100).length,cpu:stats(cpu),spans:Object.fromEntries(Object.entries(spans).map(([k,v])=>[k,stats(v)])),drawCalls:Math.max(0,...draws)||null,triangles:Math.max(0,...triangles)||null,heapMB:performance.memory?.usedJSHeapSize/1048576,geometries:r.gpu.info.memory.geometries,textures:r.gpu.info.memory.textures,canvas:[r.gpu.domElement.width,r.gpu.domElement.height],backend:b.device?'WebGPU':'WebGL',adapter:b.device?.adapterInfo??null,gpu:gl?(ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)):null,longTasks:window.__auditTasks.filter(t=>t.start>=started),renderer:r.lifecycleTelemetry,error:r.renderError,position:g.player.camera.position.toArray()};
 },{pose,pass}));
 const item={pose,samples};report.cases.push(item);
 console.log(JSON.stringify({name,room:pose.roomId,fps:samples.map(s=>+s.fps.toFixed(1)),p95:samples.map(s=>+s.frames.p95Ms?.toFixed(1)),cpu:samples.map(s=>+s.cpu.meanMs?.toFixed(1))}));
 if(['G-work','G-foyer','G-outside','stairs-landing'].includes(pose.roomId)){await p.evaluate(pose=>{const g=window.__wireTheHouse;g.player.yaw=pose.yaw;g.player.pitch=pose.pitch??-.2;},pose);await p.waitForTimeout(150);await p.screenshot({path:path.join(out,pose.roomId+'.png')});}
 await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
 if(['G-work','G-foyer'].includes(pose.roomId)){
 await cdp.send('Profiler.enable');await cdp.send('Profiler.start');await p.waitForTimeout(4000);const {profile:cpuProfile}=await cdp.send('Profiler.stop');await writeFile(path.join(out,pose.roomId+'.cpuprofile'),JSON.stringify(cpuProfile));
 }
 }
 // One CPU profile in the reported problem area after the measured samples.
 await p.evaluate(()=>{const g=window.__wireTheHouse;g.player.camera.position.set(3.8,1.65,8.5);g.player.yaw=-1.5;g.player.pitch=-.2;});await p.waitForTimeout(500);
 await cdp.send('Profiler.enable');await cdp.send('Profiler.start');await p.waitForTimeout(4000);const {profile:cpuProfile}=await cdp.send('Profiler.stop');await writeFile(path.join(out,'stairs.cpuprofile'),JSON.stringify(cpuProfile));
 if(distRoot&&name==='desktop-1440-webgpu'){
 // Timestamp queries use a feature already granted to this ephemeral game's
 // GPUDevice. Keep the query readback outside the normal FPS/CPU measurements.
 await p.evaluate(()=>{const g=window.__wireTheHouse;g.player.camera.position.set(0,1.65,2);g.player.yaw=0;g.player.pitch=-.2;g.selectTool('spray');});await p.waitForTimeout(800);
 report.gpuTiming=await p.evaluate(async()=>{
  const g=window.__wireTheHouse,r=g.renderer,gpu=r.gpu,b=gpu.backend;
  if(!b.device?.features.has('timestamp-query'))return {available:false,reason:'Existing device did not grant timestamp-query'};
  const previous=b.trackTimestamp;b.trackTimestamp=true;const samples=[];
  try{for(let i=0;i<45;i++){await new Promise(requestAnimationFrame);await r.waitForFrame();const duration=await gpu.resolveTimestampsAsync('render');if(i>=5&&Number.isFinite(duration)&&duration>0)samples.push(duration);}}
  finally{b.trackTimestamp=previous;}
  const sorted=[...samples].sort((a,b)=>a-b);
  return {available:!!samples.length,scene:'G-work',method:'Separate WebGPU timestamp-query probe, existing device feature; total GPU render-pass duration of the last resolved frame, including recorded shadow/colour passes. Readback overhead is outside reported normal frame timings.',count:samples.length,meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1),samples,error:r.renderError};
 });
 console.log('GPU TIMING '+JSON.stringify({...report.gpuTiming,samples:undefined}));
 }
 if(name==='desktop-1440-webgpu'||name==='mobile-portrait-webgl'){
 // Read-only contact-range comparison after all FPS/CPU measurements. The
 // second ray is a diagnostic query only; it never applies a strike.
 await p.keyboard.press('Digit4');
 await p.evaluate(()=>{const g=window.__wireTheHouse;window.__rayStep=g.step.bind(g);g.step=()=>{};g.input.resetTransientInput();g.room.mansionWing.restoreDemolition({});g.player.camera.position.set(15.3,1.65,15);g.player.yaw=Math.PI;g.player.pitch=-.07677189126977772;g.player.workPosition.locked=false;g.player.workPosition.released=false;g.lastHammerMasonryAim=null;g.failedHammerMasonry=null;g.hammerSpeed=2.5;});
 const rayStep=n=>p.evaluate(async n=>{const g=window.__wireTheHouse;for(let i=0;i<n;i++){window.__rayStep(1/60);if(i%12===0)await g.renderer.waitForFrame();}},n);
 await rayStep(180);await p.screenshot({path:path.join(out,'wall-ray-before.png')});
 const useRay=async()=>{if(profile.hasTouch){const b=await p.locator('#look-joystick').boundingBox();await p.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else{await p.mouse.move(profile.viewport.width/2,profile.viewport.height/2);await p.mouse.down();}};
 await useRay();await rayStep(180);if(profile.hasTouch)await useRay();else await p.mouse.up();
 report.wallRay=await p.evaluate(()=>{const g=window.__wireTheHouse,c=g.renderer.camera,V=c.position.constructor,w=g.lastHammerMasonryAim.wall,eye=c.getWorldPosition(new V()),view=c.getWorldDirection(new V()),plane=w.workPlane(eye),entry=eye.clone().addScaledVector(view,-eye.clone().sub(plane.point).dot(plane.normal)/view.dot(plane.normal));
 const side=g.hammerWorkStance.sideDegrees*Math.PI/180,tilt=g.hammerWorkStance.actualTiltDegrees*Math.PI/180,direction=new V(0,1,0).cross(plane.normal).normalize().multiplyScalar(Math.sin(side)*Math.cos(tilt)).addScaledVector(plane.normal,-Math.cos(side)*Math.cos(tilt)).add(new V(0,-Math.sin(tilt),0));
 const origin=entry.clone().addScaledVector(direction,-.02),range=Math.min(.65,.24/Math.max(.04,-direction.dot(plane.normal)));
 const old=w.aim(c,range,origin,direction,.001),extended=w.aim(c,range+.04,origin,direction,.001);
 const serialize=h=>h?{index:h.index,point:h.point.toArray(),distance:h.distance}:null;
 return {status:g.fpsRig.contactStatus,removed:w.removedClayNodes,range,origin:origin.toArray(),direction:direction.toArray(),ordinary:serialize(old),extended:serialize(extended),plane:{point:plane.point.toArray(),normal:plane.normal.toArray()},failed:g.failedHammerMasonry?.attempts??null};});
 await p.screenshot({path:path.join(out,'wall-ray-after.png')});await writeFile(path.join(out,'wall-ray.json'),JSON.stringify(report.wallRay,null,2));console.log('WALL RAY '+JSON.stringify(report.wallRay));
 }
 await context.close();
 });}catch(e){report.failure=String(e.stack??e);throw e;}finally{report.finished=new Date().toISOString();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
